import {
  acceptPlanModeRead,
  getPlanMode,
  subscribePlanMode,
  useSharedPlanMode,
} from "./plan-mode-state";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Item, Receipt } from "./types";

import { readSavedPlan, writeSavedPlan, type SavedPlan } from "./saved-plan";

type ModeSettings = { current: string; expectedTurnId: string | null };
type PlanPage = { data: { item: Item }[]; nextCursor?: string | null };
export function PlanActions({
  tid,
  editable,
  connected,
  uncertain,
  active,
  run,
  open,
}: {
  tid: string;
  editable: boolean;
  connected: boolean;
  uncertain: boolean;
  active: boolean;
  run: (
    action: string,
    body: Record<string, unknown>,
  ) => Promise<Receipt | null>;
  open: (id: string) => void;
}) {
  const modeState = useSharedPlanMode(tid);
  const [candidate, setCandidate] = useState(() => readSavedPlan(tid));
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seen = useRef(new Set<string>());
  const revision = useRef(0);
  const dismiss = useCallback(() => {
    revision.current++;
    writeSavedPlan(tid, null);
    setCandidate(null);
    setVerified(false);
    setError("");
  }, [tid]);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const confirm = (turnId: string, saved?: SavedPlan) => {
      const request = ++revision.current;
      const modeVersion = getPlanMode(tid).version;
      void (async () => {
        try {
          const base = `/threads/${encodeURIComponent(tid)}`;
          const signal = controller.signal;
          const itemPath = `${base}/turns/${encodeURIComponent(turnId)}/items`;
          const [mode, first] = await Promise.all([
            api<ModeSettings>(`${base}/mode-settings`, { signal }),
            api<PlanPage>(`${itemPath}?limit=100`, { signal }),
          ]);
          let page = first;
          let plan: Item | undefined;
          const cursors = new Set<string>();
          while (
            alive &&
            request === revision.current &&
            mode.current === "plan" &&
            (!saved || mode.expectedTurnId === turnId)
          ) {
            plan = page.data
              .map((row) => row.item)
              .find(
                (item) =>
                  item.type === "plan" &&
                  item.text?.trim() &&
                  (!saved || item.id === saved.planItemId),
              );
            const cursor = page.nextCursor;
            if (plan || !cursor || cursors.has(cursor)) break;
            cursors.add(cursor);
            page = await api<PlanPage>(
              `${itemPath}?limit=100&cursor=${encodeURIComponent(cursor)}`,
              { signal },
            );
          }
          if (
            !alive ||
            request !== revision.current ||
            !acceptPlanModeRead(tid, mode.current, modeVersion)
          )
            return;
          if (
            mode.current !== "plan" ||
            !plan ||
            (saved && mode.expectedTurnId !== turnId)
          ) {
            dismiss();
            return;
          }
          const next = {
            turnId,
            planItemId: plan.id,
            deferred: saved?.deferred,
          };
          writeSavedPlan(tid, next);
          setCandidate(next);
          setVerified(true);
        } catch {
          // Until rechecked, a previously saved plan remains disabled.
        }
      })();
    };
    const saved = readSavedPlan(tid);
    if (editable && connected && saved) confirm(saved.turnId, saved);
    const completed = (event: Event) => {
      const data = (
        event as CustomEvent<{
          threadId: string;
          turn: { id: string; status: string };
        }>
      ).detail;
      if (
        !editable ||
        !connected ||
        data.threadId !== tid ||
        data.turn.status !== "completed" ||
        seen.current.has(data.turn.id)
      )
        return;
      seen.current.add(data.turn.id);
      confirm(data.turn.id);
    };
    const continued = (event: Event) => {
      if ((event as CustomEvent<{ threadId: string }>).detail.threadId === tid)
        dismiss();
    };
    let previousMode = getPlanMode(tid);
    const unsubscribe = subscribePlanMode(() => {
      const state = getPlanMode(tid);
      if (state === previousMode) return;
      previousMode = state;
      if (state.target) revision.current++;
      else if (state.current && state.current !== "plan") dismiss();
    });
    window.addEventListener("samaya:input-accepted", continued);
    window.addEventListener("samaya:turn-started", continued);
    window.addEventListener("samaya:turn-completed", completed);
    return () => {
      alive = false;
      controller.abort();
      unsubscribe();
      window.removeEventListener("samaya:input-accepted", continued);
      window.removeEventListener("samaya:turn-started", continued);
      window.removeEventListener("samaya:turn-completed", completed);
    };
  }, [tid, editable, connected, dismiss]);
  if (
    !candidate ||
    (modeState.target ?? modeState.current ?? "plan") !== "plan"
  )
    return null;
  const disabled =
    busy ||
    !editable ||
    !connected ||
    uncertain ||
    active ||
    !verified ||
    !!modeState.target;
  const execute = async (clearContext: boolean) => {
    if (disabled) return;
    setBusy(true);
    setError("");
    try {
      const result = await run("plan_execute", {
        threadId: tid,
        turnId: candidate.turnId,
        planItemId: candidate.planItemId,
        clearContext,
      });
      if (!result) {
        setError("执行未完成，请查看操作结果。");
        return;
      }
      dismiss();
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
          disabled={disabled}
          onClick={() => void execute(false)}
        >
          执行
        </button>
        <button
          type="button"
          className="quiet"
          disabled={disabled}
          onClick={() => void execute(true)}
        >
          清空上下文执行
        </button>
        {!candidate.deferred && (
          <button
            type="button"
            className="quiet"
            disabled={disabled}
            onClick={() => {
              const deferred = { ...candidate, deferred: true };
              writeSavedPlan(tid, deferred);
              setCandidate(deferred);
            }}
          >
            留在计划模式
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
