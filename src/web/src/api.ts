import { beginPlanMode, confirmPlanMode } from "./plan-mode-state";
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
  accepted?: boolean;
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
const receiptWaiters = new Map<string, (receipt: Receipt) => void>();
export function acceptOperationReceipt(receipt: Receipt): boolean {
  if (!["succeeded", "failed"].includes(receipt.state)) return false;
  const entry = pendingOperations().find(
    (p) => p.operationId === receipt.operationId,
  );
  if (!entry) return false;
  const draftKey = "samaya.pendingDraft." + receipt.operationId;
  const draft = sessionStorage.getItem(draftKey);
  if (receipt.state === "failed" && draft && entry.threadId)
    sessionStorage.setItem(
      "samaya.failedDraft." + entry.threadId + "." + receipt.operationId,
      draft,
    );
  sessionStorage.removeItem(draftKey);
  receiptWaiters.get(receipt.operationId)?.(receipt);
  clearOperation(receipt.operationId);
  window.dispatchEvent(
    new CustomEvent("samaya:receipt-resolved", {
      detail: { entry, receipt, draft },
    }),
  );
  return true;
}
const receiptReads = new Map<string, Promise<void>>();
export async function reconcileOperations(
  entries: PendingOperation[],
): Promise<void> {
  await Promise.all(
    entries.map((entry) => {
      const existing = receiptReads.get(entry.operationId);
      if (existing) return existing;
      const read = api<Receipt>(
        "/operations/" + encodeURIComponent(entry.operationId),
        { signal: AbortSignal.timeout(5000) },
      )
        .then((receipt) => {
          if (receipt.operationId === entry.operationId)
            acceptOperationReceipt(receipt);
        })
        .catch(() => {
          /* Missing, unavailable or uncertain receipts remain protected; never replay writes. */
        })
        .finally(() => {
          receiptReads.delete(entry.operationId);
        });
      receiptReads.set(entry.operationId, read);
      return read;
    }),
  );
}
async function performOperation(
  action: string,
  body: Record<string, unknown>,
  onAccepted?: () => void,
): Promise<Receipt> {
  const scope = String(body.requestKey || body.threadId || "create");
  const submit = async () => {
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
    if (
      (action === "send" || action === "steer") &&
      typeof body.text === "string"
    )
      sessionStorage.setItem("samaya.pendingDraft." + operationId, body.text);
    window.dispatchEvent(new Event("samaya:receipts"));
    let receipt: Receipt;
    try {
      const confirmed = new Promise<Receipt>((resolve) =>
        receiptWaiters.set(operationId, resolve),
      );
      const post = () =>
        api<Receipt>("/operations", {
          method: "POST",
          headers: { Prefer: "respond-async" },
          body: JSON.stringify({ operationId, action, body }),
          signal: AbortSignal.timeout(30000),
        });
      const submission = navigator.locks
        ? navigator.locks.request(
            "samaya:" + scope,
            { ifAvailable: true },
            (lock) => {
              if (!lock)
                throw new ApiError("其它页面正在提交此对象，请稍后重试。", 409);
              return post();
            },
          )
        : post();
      receipt = await Promise.race([confirmed, submission]);
      if (receipt.state === "pending") {
        if (!localStorage.getItem("samaya.operation." + operationId)) {
          try {
            receipt = await api<Receipt>(
              "/operations/" + encodeURIComponent(operationId),
              {
                signal: AbortSignal.timeout(5000),
              },
            );
          } catch {
            /* Keep the accepted state until a receipt becomes available. */
          }
        }
      }
      if (
        ["send", "steer"].includes(action) &&
        (receipt.state === "pending" || receipt.state === "succeeded")
      )
        window.dispatchEvent(
          new CustomEvent("samaya:input-accepted", {
            detail: { threadId: body.threadId },
          }),
        );
      if (receipt.state === "pending") {
        if (localStorage.getItem("samaya.operation." + operationId)) {
          localStorage.setItem(
            "samaya.operation." + operationId,
            JSON.stringify({ ...entry, accepted: true }),
          );
          window.dispatchEvent(new Event("samaya:receipts"));
        }
        onAccepted?.();
        if (["send", "steer"].includes(action)) return receipt;
      }
      if (receipt.state === "pending") {
        while (receipt.state === "pending") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          try {
            receipt = await Promise.race([
              confirmed,
              api<Receipt>("/operations/" + encodeURIComponent(operationId), {
                signal: AbortSignal.timeout(5000),
              }),
            ]);
          } catch {
            /* The accepted operation continues while connectivity recovers. */
          }
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        clearOperation(operationId);
        throw error;
      }
      throw new Error("提交结果正在后台核对。", {
        cause: error,
      });
    } finally {
      receiptWaiters.delete(operationId);
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
  return submit();
}

export async function operation(
  action: string,
  body: Record<string, unknown>,
  onAccepted?: () => void,
): Promise<Receipt> {
  const target = (body.args as { value?: string })?.value;
  const changingMode =
    (target === "plan" || target === "default") &&
    action === "command" &&
    body.command === "plan" &&
    typeof body.threadId === "string";
  const tid = String(body.threadId || "");
  if (changingMode) beginPlanMode(tid, target);
  try {
    const receipt = await performOperation(action, body, onAccepted);
    if (changingMode)
      confirmPlanMode(
        tid,
        typeof receipt.result?.mode === "string"
          ? receipt.result.mode
          : undefined,
        !!receipt.result?.settingsPending,
      );
    return receipt;
  } catch (error) {
    if (changingMode) confirmPlanMode(tid, undefined, true);
    throw error;
  }
}
