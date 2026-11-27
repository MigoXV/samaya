export type UsageSummary = {
  lifetimeTokens: number | null;
  peakDailyTokens: number | null;
  longestRunningTurnSec: number | null;
  currentStreakDays: number | null;
  longestStreakDays: number | null;
};

export type ActivityDay = { date: Date; tokens: number | null };
export type UsageHistory = {
  summary: UsageSummary | null;
  dailyUsageBuckets: { startDate: string; tokens: number }[] | null;
  updatedAt: number;
};

const dayMs = 86_400_000;
const tokenCount = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const tokenUnits = [
  [1_000_000_000, "B"],
  [1_000_000, "M"],
  [1_000, "K"],
] as const;
const fullDate = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "full",
  timeZone: "UTC",
});
const shortDate = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});

export const dateKey = (date: Date) => date.toISOString().slice(0, 10);
export const dayLabel = (date: Date) => fullDate.format(date);
export const shortDay = (date: Date) => shortDate.format(date);
export function compactTokens(tokens: number) {
  // Switch suffix when rounding in the smaller unit would produce 1,000.
  const unit = tokenUnits.find(
    ([divisor]) => Math.abs(tokens) >= divisor - (divisor / 1_000) * 0.005,
  );
  return unit
    ? `${tokenCount.format(tokens / unit[0])}${unit[1]}`
    : tokenCount.format(tokens);
}
export const exactTokens = (tokens: number) =>
  `${tokens.toLocaleString("zh-CN")} Token`;
export const hasNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function activityDays(history: UsageHistory) {
  const tokens = new Map(
    (history.dailyUsageBuckets ?? [])
      .filter((day) => hasNumber(day.tokens) && day.tokens >= 0)
      .map((day) => [day.startDate, day.tokens]),
  );
  const observedAt = new Date(history.updatedAt * 1000);
  const year = observedAt.getUTCFullYear();
  const month = observedAt.getUTCMonth();
  const lastDay = observedAt.getUTCDate();
  const previousMonthEnd = new Date(Date.UTC(year - 1, month + 1, 0));
  const start = Date.UTC(
    year - 1,
    month,
    Math.min(lastDay, previousMonthEnd.getUTCDate()),
  );
  const end = Date.UTC(year, month, lastDay);
  return Array.from({ length: Math.round((end - start) / dayMs) }, (_, i) => {
    const date = new Date(start + (i + 1) * dayMs);
    return { date, tokens: tokens.get(dateKey(date)) ?? null };
  });
}

export function weeks(days: ActivityDay[]) {
  const firstWeekday = days[0]?.date.getUTCDay() ?? 0;
  const padded = [...Array<null>(firstWeekday).fill(null), ...days];
  return Array.from({ length: Math.ceil(padded.length / 7) }, (_, i) =>
    padded.slice(i * 7, (i + 1) * 7),
  );
}

export function weeklyActivity(days: ActivityDay[]): ActivityDay[] {
  return weeks(days).flatMap((week) => {
    const first = week.find((day) => day !== null);
    if (!first) return [];
    const knownDays = week.filter((day) => day?.tokens != null);
    return [
      {
        date: first.date,
        tokens: knownDays.length
          ? knownDays.reduce((sum, day) => sum + (day?.tokens ?? 0), 0)
          : null,
      },
    ];
  });
}

export function cumulativeActivity(days: ActivityDay[]): ActivityDay[] {
  let total = 0;
  return days.map((day) => {
    if (day.tokens === null) return day;
    total += day.tokens;
    return { ...day, tokens: total };
  });
}

export function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}
