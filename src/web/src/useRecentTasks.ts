import { useEffect, useState } from "react";
import type { Observation } from "./monitor";

type Selection = { scope: string; ids: string[] };
const read = (): Selection | null => {
  try {
    return JSON.parse(
      sessionStorage.getItem("samaya.recent.selection") || "null",
    );
  } catch {
    return null;
  }
};

// Membership changes on navigation or explicit refresh, never on streaming output.
// All records remain monitored by useMonitor regardless of this display selection.
export function useRecentTasks(
  matching: Observation[],
  scope: string,
  limit: number,
  initialized: boolean,
) {
  const candidate = [...matching]
    .sort(
      (a, b) =>
        b.thread.updatedAt - a.thread.updatedAt ||
        a.thread.id.localeCompare(b.thread.id),
    )
    .slice(0, limit)
    .map((r) => r.thread.id);
  const [selection, setSelection] = useState<Selection | null>(read);
  const active =
    selection?.scope === scope ? selection : { scope, ids: candidate };
  const signature = JSON.stringify(active);
  useEffect(() => {
    if (!initialized) return;
    const next = JSON.parse(signature) as Selection;
    sessionStorage.setItem("samaya.recent.selection", signature);
    queueMicrotask(() =>
      setSelection((old) => (old?.scope === next.scope ? old : next)),
    );
  }, [signature, initialized]);
  const changed = JSON.stringify(candidate) !== JSON.stringify(active.ids);
  return {
    ids: active.ids,
    changed,
    update: () => setSelection({ scope, ids: candidate }),
    include: (id: string) =>
      setSelection({
        scope,
        ids: [id, ...active.ids.filter((x) => x !== id)].slice(0, limit),
      }),
  };
}
