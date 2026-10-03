import type { Receipt } from "./types";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Samaya-CSRF": csrf,
      ...init?.headers,
    },
  });
  const body = await response.json();
  if (response.status === 401)
    window.dispatchEvent(new Event("samaya:unauthorized"));
  if (!response.ok)
    throw new ApiError(
      typeof body.detail === "string"
        ? body.detail
        : `请求失败（${response.status}）`,
      response.status,
    );
  return body as T;
}
export type PendingOperation = {
  operationId: string;
  action: string;
  threadId?: string;
  scope: string;
};
export function pendingOperations(): PendingOperation[] {
  const legacy = localStorage.getItem("samaya.pending");
  if (legacy) {
    try {
      const p = JSON.parse(legacy);
      if (p.operationId)
        localStorage.setItem(
          "samaya.operation." + p.operationId,
          JSON.stringify({ ...p, scope: p.threadId || "create" }),
        );
      localStorage.removeItem("samaya.pending");
    } catch {
      /* Keep unreadable legacy metadata for manual inspection. */
    }
  }

  return Object.keys(localStorage)
    .filter((k) => k.startsWith("samaya.operation."))
    .flatMap((k) => {
      try {
        return [JSON.parse(localStorage.getItem(k)!)];
      } catch {
        return [];
      }
    });
}
export function clearOperation(id: string) {
  localStorage.removeItem("samaya.operation." + id);
  window.dispatchEvent(new Event("samaya:receipts"));
}
export async function operation(
  action: string,
  body: Record<string, unknown>,
): Promise<Receipt> {
  const scope = String(body.requestKey || body.threadId || "create");
  const submit = async () => {
    if (pendingOperations().some((p) => p.scope === scope))
      throw new Error("此对象有操作等待核查；请查询回执，其他任务仍可操作。");
    const operationId =
      crypto.randomUUID?.() ||
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    const entry: PendingOperation = {
      operationId,
      action,
      threadId: body.threadId as string | undefined,
      scope,
    };
    localStorage.setItem(
      "samaya.operation." + operationId,
      JSON.stringify(entry),
    );
    window.dispatchEvent(new Event("samaya:receipts"));
    let receipt: Receipt;
    try {
      receipt = await api<Receipt>("/operations", {
        method: "POST",
        body: JSON.stringify({ operationId, action, body }),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        clearOperation(operationId);
        throw error;
      }
      throw new Error("提交结果待确认。请查询操作回执，不要重复发送。", {
        cause: error,
      });
    }
    if (receipt.state === "succeeded" || receipt.state === "failed")
      clearOperation(operationId);
    if (receipt.state !== "succeeded")
      throw new Error(
        (receipt.state === "failed" ? "操作失败：" : "结果待确认：") +
          String(receipt.result?.message || "请查询回执"),
      );
    return receipt;
  };
  // Web Locks coordinate tabs before reserving a receipt. The server also checks turn/request identity.
  return navigator.locks
    ? navigator.locks.request("samaya:" + scope, submit)
    : submit();
}
