import type { Item, Turn } from "./types";
export const historyCache = new Map<
  string,
  { turns: Turn[]; cursor: string | null; visible: number }
>();
export const itemCache = new Map<
  string,
  { items: Item[]; cursor: string | null }
>();
function saved(cwd: string): string[] {
  try {
    const value = JSON.parse(
      localStorage.getItem("samaya.prompt-history." + cwd) || "[]",
    );
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string").slice(-100)
      : [];
  } catch {
    return [];
  }
}
export function rememberPrompt(cwd: string, text: string) {
  if (!text.trim()) return;
  const entries = saved(cwd);
  if (entries.at(-1) !== text) entries.push(text);
  try {
    localStorage.setItem(
      "samaya.prompt-history." + cwd,
      JSON.stringify(entries.slice(-100)),
    );
  } catch {
    /* Keep the composer usable if browser storage is full. */
  }
}
export function promptHistory(cwd: string, tid?: string): string[] {
  const local = saved(cwd);
  const native: string[] = [];
  for (const turn of [
    ...(historyCache.get(tid || "")?.turns || []),
  ].reverse()) {
    for (const item of itemCache.get(`${tid}:${turn.id}`)?.items ||
      turn.items ||
      []) {
      const text =
        item.type === "userMessage"
          ? item.text ||
            item.content
              ?.filter((c) => c.type === "text")
              .map((c) => c.text || "")
              .join("\n") ||
            ""
          : item.type === "commandExecution" && item.source === "userShell"
            ? "!" + item.command
            : "";
      if (text.trim() && !local.includes(text) && native.at(-1) !== text)
        native.push(text);
    }
  }
  return [...native, ...local].slice(-100);
}
