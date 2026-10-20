import { useEffect, useState } from "react";
import { api } from "./api";
type Usage = {
  totalTokens?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
};
type Window = {
  usedPercent: number;
  windowDurationMins?: number;
  resetsAt?: number;
};
type Limit = {
  limitId?: string;
  limitName?: string;
  primary?: Window;
  secondary?: Window;
};
type Data = {
  cwd: string;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  tokenUsage?: {
    usage: { total?: Usage; last?: Usage; modelContextWindow?: number };
    observedAt: number;
  };
  rateLimits?: {
    rateLimits?: Limit;
    rateLimitsByLimitId?: Record<string, Limit>;
  };
  rateLimitsError?: string;
  observedAt: number;
};
export type Entry = {
  id: string;
  turnId: string | null;
  itemId: string | null;
  at: number;
  data?: Data;
  error?: string;
};
const pending = new Set<string>();
const key = (tid: string) => `samaya.status.${tid}`;
export function entries(tid: string): Entry[] {
  try {
    return (
      JSON.parse(sessionStorage.getItem(key(tid)) || "[]") as Entry[]
    ).map((row) =>
      !row.data && !row.error && !pending.has(row.id)
        ? { ...row, error: "上次读取未完成，请再次输入 /status。" }
        : row,
    );
  } catch {
    return [];
  }
}
function save(tid: string, list: Entry[]) {
  sessionStorage.setItem(key(tid), JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("samaya:status", { detail: tid }));
}
export async function printStatus(tid: string, turnId: string | null) {
  const turn = turnId
    ? document.querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`)
    : null;
  const itemId = turn?.querySelectorAll<HTMLElement>("[data-item-id]");
  const entry: Entry = {
    id: crypto.randomUUID(),
    turnId,
    itemId: itemId?.[itemId.length - 1]?.dataset.itemId || null,
    at: Date.now(),
  };
  pending.add(entry.id);
  save(tid, [...entries(tid), entry]);
  try {
    const result = await api<{ data: Data }>(
      `/threads/${encodeURIComponent(tid)}/command-context?command=status`,
    );
    entry.data = result.data;
  } catch (e) {
    entry.error = String(e);
  }
  pending.delete(entry.id);
  save(
    tid,
    entries(tid).map((row) => (row.id === entry.id ? entry : row)),
  );
}

export function useStatusEntries(tid: string) {
  const [list, setList] = useState(() => entries(tid));
  useEffect(() => {
    const update = (e: Event) => {
      if ((e as CustomEvent).detail === tid) setList(entries(tid));
    };
    window.addEventListener("samaya:status", update);
    return () => window.removeEventListener("samaya:status", update);
  }, [tid]);
  return list;
}
