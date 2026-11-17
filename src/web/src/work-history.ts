import type { Item, ItemEntry, Turn } from "./types";

export type WorkState = "running" | "waiting" | "disconnected" | "stale";
export type ActivityKind =
  "app" | "search" | "command" | "files" | "agents" | "other";
export type Activity = {
  kind: ActivityKind;
  key: string;
  label: string;
  platform?: "figma" | "github";
  items: Item[];
};
export type WorkSegment = { key: string; user?: Item; items: Item[] };
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
export const nativeTime = (value: unknown): number | undefined =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 8640000000000000
    ? value
    : undefined;
export function historyItem(entry: ItemEntry, confirmed?: Item): Item {
  const item = confirmed || entry.item;
  return {
    ...item,
    samayaTiming: {
      ...entry.item.samayaTiming,
      ...(nativeTime(entry.startedAtMs) !== undefined
        ? { startedAtMs: entry.startedAtMs! }
        : {}),
      ...(nativeTime(entry.completedAtMs) !== undefined
        ? { completedAtMs: entry.completedAtMs! }
        : {}),
      ...confirmed?.samayaTiming,
    },
  };
}
export function isProcessItem(item: Item): boolean {
  if (item.type === "agentMessage") return item.phase === "commentary";
  return (
    !["userMessage", "reasoning", "plan", "contextCompaction"].includes(
      item.type,
    ) && item.source !== "userShell"
  );
}
export function workSegments(items: Item[]): WorkSegment[] {
  const segments: WorkSegment[] = [{ key: "start", items: [] }];
  for (const item of items) {
    if (item.type === "reasoning") continue;
    if (item.type === "userMessage" || item.source === "userShell") {
      const last = segments.at(-1)!;
      if (!last.user && !last.items.length) {
        last.user = item;
        last.key = item.id;
      } else segments.push({ key: item.id, user: item, items: [] });
    } else segments.at(-1)!.items.push(item);
  }
  return segments;
}
export function activityFor(item: Item): Omit<Activity, "items"> {
  const context = record(item.appContext);
  const nativeName = typeof context.appName === "string" ? context.appName : "";
  const server = String(item.server || item.namespace || "");
  const tool = String(item.tool || "");
  const identity = [nativeName, server, tool].map((s) => s.toLowerCase());
  const figma = identity.some(
    (s) =>
      s === "figma" || /^(?:mcp__)?(?:codex_apps__)?figma(?:$|__|[./])/.test(s),
  );
  const github = identity.some(
    (s) =>
      s === "github" ||
      /^(?:mcp__)?(?:codex_apps__)?github(?:$|__|[./])/.test(s),
  );
  if (figma || github || nativeName || item.type === "mcpToolCall") {
    const name = figma
      ? "Figma"
      : github
        ? "GitHub"
        : nativeName || server || "外部工具";
    return {
      kind: "app",
      key: `app:${name}`,
      label: `使用 ${name}`,
      platform: figma ? "figma" : github ? "github" : undefined,
    };
  }
  if (item.type === "webSearch")
    return { kind: "search", key: "search", label: "搜索网页" };
  if (item.type === "commandExecution")
    return { kind: "command", key: "command", label: "执行命令" };
  if (item.type === "fileChange")
    return { kind: "files", key: "files", label: "修改文件" };
  if (/collab|subAgent/i.test(item.type))
    return { kind: "agents", key: "agents", label: "子智能体活动" };
  return {
    kind: "other",
    key: `other:${server}:${tool}:${item.type}`,
    label: tool ? `调用 ${tool}` : "工具活动",
  };
}
export function groupActivities(items: Item[]): (Activity | Item)[] {
  const rows: (Activity | Item)[] = [];
  for (const item of items) {
    if (item.type === "agentMessage" || !isProcessItem(item)) {
      rows.push(item);
      continue;
    }
    const activity = activityFor(item);
    const last = rows.at(-1);
    if (last && "kind" in last && last.key === activity.key)
      (last as Activity).items.push(item);
    else rows.push({ ...activity, items: [item] });
  }
  return rows;
}
export function itemFailed(item: Item) {
  return (
    item.status === "failed" ||
    item.status === "interrupted" ||
    item.success === false ||
    (item.exitCode != null && item.exitCode !== 0) ||
    !!item.error
  );
}
export function activityHints(
  activity: Activity,
): { label: string; href?: string }[] {
  const hints = new Map<string, { label: string; href?: string }>();
  const add = (value: unknown, link = false) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (link) {
      try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) return;
        hints.set(url.hostname, { label: url.hostname, href: url.href });
      } catch {
        /* Unknown formats remain in raw details. */
      }
    } else hints.set(value, { label: value });
  };
  for (const item of activity.items) {
    const action = record(item.action),
      context = record(item.appContext);
    if (activity.kind === "search") {
      add(item.query);
      add(action.query);
      add(action.url, true);
      if (Array.isArray(action.queries)) action.queries.forEach((q) => add(q));
      if (Array.isArray(item.results))
        item.results.forEach((r) => add(record(r).url, true));
    } else if (activity.kind === "app") add(context.actionName);
    else if (activity.kind === "command") add(item.command);
    else if (activity.kind === "files")
      item.changes?.forEach((change) => add(change.path));
  }
  return [...hints.values()];
}
export const durationText = (seconds: number) => {
  seconds = Math.max(0, Math.floor(seconds));
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
  return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分`;
};
export function lastNativeTime(turn: Turn, items: Item[]): number | undefined {
  const times = items
    .flatMap((item) => [
      item.samayaTiming?.startedAtMs,
      item.samayaTiming?.completedAtMs,
    ])
    .map(nativeTime)
    .filter((v): v is number => v !== undefined);
  const end = nativeTime(turn.completedAt);
  if (end !== undefined) return end * 1000;
  return times.length ? Math.max(...times) : undefined;
}

// A latest page is authoritative about order as well as content. A final item
// may arrive over SSE before an earlier partial answer is recovered by paging.
export function mergeHistoryItems(
  old: Item[],
  page: Item[],
  older = false,
): Item[] {
  const byId = new Map(old.map((item) => [item.id, item]));
  const fresh = page.map((item) => ({
    ...item,
    samayaTiming: { ...byId.get(item.id)?.samayaTiming, ...item.samayaTiming },
  }));
  const ids = new Set(page.map((item) => item.id));
  if (older) return [...fresh, ...old.filter((item) => !ids.has(item.id))];
  if (!page.length) return old;
  const anchor = old.findIndex((item) => ids.has(item.id));
  if (anchor < 0) return [...old, ...fresh];
  return [
    ...old.slice(0, anchor).filter((item) => !ids.has(item.id)),
    ...fresh,
    ...old.slice(anchor).filter((item) => !ids.has(item.id)),
  ];
}

export function userMessageTime(
  item: Item,
  first: boolean,
  completeHistory: boolean,
  turnStartedAt?: number | null,
): number | undefined {
  const own =
    nativeTime(item.samayaTiming?.startedAtMs) ??
    nativeTime(item.samayaTiming?.completedAtMs);
  if (own !== undefined) return own;
  const start = nativeTime(turnStartedAt);
  return first && completeHistory && start !== undefined
    ? start * 1000
    : undefined;
}
