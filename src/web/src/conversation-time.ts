const nativeTime = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 8640000000000000
    ? value
    : undefined;

export const CONVERSATION_GAP_MS = 60 * 60 * 1000;
const localDay = (at: number, zone?: string) => {
  const fields = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (key: string) =>
    Number(fields.find((p) => p.type === key)!.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
};
export function showConversationTime(
  at: number | undefined,
  previous?: number,
  zone?: string,
): boolean {
  if (nativeTime(at) === undefined) return false;
  if (nativeTime(previous) === undefined) return true;
  return (
    at! >= previous! &&
    (at! - previous! >= CONVERSATION_GAP_MS ||
      localDay(at!, zone) !== localDay(previous!, zone))
  );
}
export function conversationTimeLabel(
  at: number,
  now = Date.now(),
  zone?: string,
) {
  const clock = new Intl.DateTimeFormat("zh-CN", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  const today = localDay(now, zone);
  const day = localDay(at, zone);
  if (day === today) return `今天 ${clock}`;
  if (day === today - 86400000) return `昨天 ${clock}`;
  const sameYear =
    new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric" }).format(
      at,
    ) ===
    new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric" }).format(
      now,
    );
  return `${new Intl.DateTimeFormat("zh-CN", { timeZone: zone, ...(!sameYear ? { year: "numeric" as const } : {}), month: "long", day: "numeric" }).format(at)} ${clock}`;
}
