import { useEffect, useState } from "react";
import { api } from "./api";

type Goal = {
  objective: string;
  status: string;
  tokensUsed: number;
  tokenBudget?: number;
};
export function GoalStatus({
  tid,
  refresh,
  edit,
}: {
  tid: string;
  refresh: number;
  edit: () => void;
}) {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const result = await api<{ data: { goal: Goal | null } }>(
          `/threads/${encodeURIComponent(tid)}/command-context?command=goal`,
        );
        if (alive) {
          setGoal(result.data.goal);
          setStale(false);
        }
      } catch {
        if (alive) setStale(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tid, refresh]);
  if (!goal) return null;
  const label: Record<string, string> = {
    active: "推进中",
    paused: "已暂停",
    blocked: "受阻",
    complete: "已完成",
    budgetLimited: "预算已用完",
    usageLimited: "用量受限",
  };
  return (
    <button className="goal-status quiet" onClick={edit} title={goal.objective}>
      <span>
        {stale ? "目标状态待确认" : label[goal.status] || goal.status} ·{" "}
        {goal.objective}
      </span>
      <small>
        {goal.tokensUsed.toLocaleString()}
        {goal.tokenBudget ? ` / ${goal.tokenBudget.toLocaleString()}` : ""}{" "}
        tokens
      </small>
    </button>
  );
}
