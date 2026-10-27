import { useEffect, useSyncExternalStore } from "react";
import { rootId, type Observation } from "./monitor";
const key = "samaya.hidden-workspaces.v1";
type Mark = { cursor: number; at: number; recency: number };
type Hidden = Record<string, Mark>;
function read(): Hidden {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, Mark] => {
        const m = entry[1] as Mark;
        return (
          !!m &&
          Number.isFinite(m.cursor) &&
          Number.isFinite(m.at) &&
          Number.isFinite(m.recency)
        );
      }),
    );
  } catch {
    return {};
  }
}
let snapshot = read();
const listeners = new Set<() => void>();
function update(value: Hidden) {
  snapshot = value;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* In-memory hiding still works. */
  }
  listeners.forEach((f) => f());
}
window.addEventListener("storage", (event) => {
  if (event.key === key || event.key === null) {
    snapshot = read();
    listeners.forEach((f) => f());
  }
});
function subscribe(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
function restoreWorkspace(cwd?: string) {
  if (cwd && !snapshot[cwd]) return;
  update(
    cwd
      ? Object.fromEntries(
          Object.entries(snapshot).filter(([path]) => path !== cwd),
        )
      : {},
  );
}
export function activityAt(r: Observation) {
  return Math.max(
    r.lastActivityAt || 0,
    r.thread.recencyAt ?? r.thread.updatedAt ?? 0,
  );
}
export function workspaceRecency(records: Map<string, Observation>) {
  const result = new Map<string, number>();
  for (const r of records.values()) {
    if (r.thread.archived) continue;
    const cwd =
      records.get(rootId(r.thread.id, records))?.thread.cwd || r.thread.cwd;
    result.set(cwd, Math.max(result.get(cwd) || 0, activityAt(r)));
  }
  return result;
}
export function useWorkspaceVisibility(
  records: Map<string, Observation>,
  cursor: number,
) {
  const saved = useSyncExternalStore(subscribe, () => snapshot);
  const renewed = new Set<string>();
  for (const r of records.values()) {
    const cwd =
      records.get(rootId(r.thread.id, records))?.thread.cwd || r.thread.cwd;
    const mark = saved[cwd];
    if (
      mark &&
      ((r.lastActivityId || 0) > mark.cursor ||
        (r.thread.recencyAt != null &&
          r.thread.recencyAt > Math.max(mark.at, mark.recency)))
    )
      renewed.add(cwd);
  }
  const hidden = new Set(Object.keys(saved).filter((cwd) => !renewed.has(cwd)));
  const renewKey = JSON.stringify([...renewed].sort());
  useEffect(() => {
    const paths: string[] = JSON.parse(renewKey);
    if (paths.length)
      update(
        Object.fromEntries(
          Object.entries(snapshot).filter(([cwd]) => !paths.includes(cwd)),
        ),
      );
  }, [renewKey]);
  return {
    hidden,
    hide(cwd: string) {
      update({
        ...snapshot,
        [cwd]: {
          cursor,
          at: Date.now() / 1000,
          recency: workspaceRecency(records).get(cwd) || 0,
        },
      });
    },
    restore: restoreWorkspace,
  };
}
export type WorkspaceVisibility = ReturnType<typeof useWorkspaceVisibility>;
