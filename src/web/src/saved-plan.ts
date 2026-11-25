export type SavedPlan = {
  turnId: string;
  planItemId: string;
  deferred?: boolean;
};

const key = (tid: string) => `samaya.saved-plan.${tid}`;

export function readSavedPlan(tid: string): SavedPlan | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key(tid)) || "null");
    return typeof saved?.turnId === "string" &&
      typeof saved.planItemId === "string"
      ? saved
      : null;
  } catch {
    return null;
  }
}

export function writeSavedPlan(tid: string, plan: SavedPlan | null) {
  try {
    if (plan) localStorage.setItem(key(tid), JSON.stringify(plan));
    else localStorage.removeItem(key(tid));
  } catch {
    // The current view still works if browser storage is unavailable.
  }
}
