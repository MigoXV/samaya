import { useSyncExternalStore } from "react";
type ModeState = {
  current?: string;
  target?: string;
  version: number;
  refresh: number;
};
const empty: ModeState = { version: 0, refresh: 0 };
const states = new Map<string, ModeState>();
const listeners = new Set<() => void>();
export const getPlanMode = (tid?: string): ModeState =>
  (tid && states.get(tid)) || empty;
export function subscribePlanMode(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function write(tid: string, patch: Partial<ModeState>, advance = true) {
  const old = getPlanMode(tid);
  states.set(tid, { ...old, ...patch, version: old.version + Number(advance) });
  listeners.forEach((listener) => listener());
}
export function beginPlanMode(tid: string, target: string) {
  write(tid, { target });
}
export function confirmPlanMode(
  tid: string,
  current?: string,
  refresh = false,
) {
  write(tid, {
    ...(current ? { current } : {}),
    target: undefined,
    refresh: getPlanMode(tid).refresh + Number(refresh),
  });
}
export function acceptPlanModeRead(
  tid: string,
  current: string,
  version: number,
) {
  if (getPlanMode(tid).version !== version || getPlanMode(tid).target)
    return false;
  if (getPlanMode(tid).current === undefined) write(tid, { current }, false);
  else if (getPlanMode(tid).current !== current) confirmPlanMode(tid, current);
  return true;
}
export function useSharedPlanMode(tid?: string) {
  return useSyncExternalStore(subscribePlanMode, () => getPlanMode(tid));
}
