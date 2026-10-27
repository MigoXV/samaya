import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Item, Receipt } from "./types";

type Candidate = { turnId: string; planItemId: string };
export function PlanActions({
  tid,
  editable,
  run,
  open,
}: {
  tid: string;
  editable: boolean;
  run: (
    action: string,
    body: Record<string, unknown>,
  ) => Promise<Receipt | null>;
  open: (id: string) => void;
}) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seen = useRef(new Set<string>());
  const revision = useRef(0);
  const dismiss = () => {
    revision.current++;
    setCandidate(null);
    setError("");
  };
  useEffect(() => {
    let alive = true;
    const completed = (event: Event) => {
      const data = (
        event as CustomEvent<{
          threadId: string;
          turn: { id: string; status: string };
        }>
      ).detail;
      if (
        !editable ||
        data.threadId !== tid ||
        data.turn.status !== "completed" ||
        seen.current.has(data.turn.id)
      )
        return;
      seen.current.add(data.turn.id);
      const request = ++revision.current;
      void (async () => {
        try {
          const [mode, page] = await Promise.all([
            api<{ current: string }>(
              `/threads/${encodeURIComponent(tid)}/mode-settings`,
            ),
            api<{ data: { item: Item }[] }>(
              `/threads/${encodeURIComponent(tid)}/turns/${encodeURIComponent(data.turn.id)}/items?limit=100`,
            ),
          ]);
          const plan = page.data
            .map((row) => row.item)
            .find((item) => item.type === "plan" && item.text?.trim());
          if (
            alive &&
            request === revision.current &&
            mode.current === "plan" &&
            plan
          )
            setCandidate({ turnId: data.turn.id, planItemId: plan.id });
        } catch {
          /* A missed completion never fabricates a plan decision. */
        }
      })();
    };
    const continued = (event: Event) => {
      if ((event as CustomEvent<{ threadId: string }>).detail.threadId === tid)
        dismiss();
    };
    window.addEventListener("samaya:input-accepted", continued);
    window.addEventListener("samaya:turn-started", continued);
    window.addEventListener("samaya:turn-completed", completed);
    return () => {
      alive = false;
      window.removeEventListener("samaya:input-accepted", continued);
      window.removeEventListener("samaya:turn-started", continued);
      window.removeEventListener("samaya:turn-completed", completed);
    };
  }, [tid, editable]);
  if (!candidate) return null;
  const execute = async (clearContext: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await run("plan_execute", {
        threadId: tid,
        ...candidate,
        clearContext,
      });
      if (!result) {
        setError("执行未完成，请查看操作结果。");
        return;
      }
      setCandidate(null);
      const target = result.result?.threadId;
      if (typeof target === "string" && target !== tid) open(target);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="plan-actions" aria-label="计划已完成">
      <span>计划已完成</span>
      <div className="plan-actions-buttons">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void execute(false)}
        >
          执行
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void execute(true)}
        >
          清空上下文执行
        </button>
        <button type="button" disabled={busy} onClick={dismiss}>
          留在计划模式
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
