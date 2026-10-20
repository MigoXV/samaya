import { rootId, waitingUnknown, type Observation } from "./monitor";
import type { Pending } from "./types";
/** Count confirmed executing conversations, deduplicating child agents by root. */
export function workspaceActivity(
  records: Map<string, Observation>,
  connected: boolean,
  requests: Pending[] = [],
) {
  const result = new Map<
    string,
    { running: Set<string>; uncertain: Set<string> }
  >();
  const now = Date.now();
  for (const r of records.values()) {
    if (r.thread.archived) continue;
    const root = rootId(r.thread.id, records);
    const cwd = records.get(root)?.thread.cwd || r.thread.cwd;
    const state = result.get(cwd) || {
      running: new Set<string>(),
      uncertain: new Set<string>(),
    };
    if (
      !connected ||
      r.error ||
      !r.confirmedAt ||
      now - r.confirmedAt * 1000 > 45000
    )
      state.uncertain.add(root);
    else if (
      r.thread.status.type === "active" &&
      r.turn?.status === "inProgress" &&
      !waitingUnknown(r, []) &&
      !requests.some((request) => request.params.threadId === r.thread.id)
    )
      state.running.add(root);
    result.set(cwd, state);
  }
  return result;
}
