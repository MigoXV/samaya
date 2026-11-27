import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "./api";
import { UsageBarChart, UsageCalendar } from "./UsageActivity";
import {
  activityDays,
  compactTokens,
  cumulativeActivity,
  durationLabel,
  hasNumber,
  weeklyActivity,
  type UsageHistory,
  type UsageSummary,
} from "./usage-activity";

type LimitWindow = {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
};
type Bucket = {
  limitId?: string | null;
  limitName?: string | null;
  planType?: string | null;
  primary?: LimitWindow | null;
  secondary?: LimitWindow | null;
  credits?: {
    balance?: string | null;
    unlimited?: boolean;
  } | null;
};
type Limits = {
  rateLimits?: Bucket;
  rateLimitsByLimitId?: Record<string, Bucket> | null;
  rateLimitResetCredits?: { availableCount: number } | null;
  updatedAt: number;
};
type Account = {
  type: string;
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
  planType?: string | null;
};
type UsageRead<T> = {
  data: T | null;
  loading: boolean;
  failed: "unsupported" | "unavailable" | null;
};

const accountUrl = "https://chatgpt.com/codex/cloud/settings/usage";
const tabs = { overview: "总览", usage: "用量" };
const views = { daily: "按日", weekly: "按周", cumulative: "累计" };
const dates = { 7: "近 7 天", 30: "近 30 天" };

const localTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function useUsageRead<T>(path: string, connected: boolean, revision: number) {
  const [state, setState] = useState<UsageRead<T>>({
    data: null,
    loading: true,
    failed: null,
  });
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    const { signal } = controller;
    queueMicrotask(() => {
      if (signal.aborted) return;
      setState((previous) => ({ ...previous, loading: true, failed: null }));
      void api<T>(path, { signal }).then(
        (data) => {
          if (!signal.aborted) setState({ data, loading: false, failed: null });
        },
        (error: unknown) => {
          if (!signal.aborted)
            setState((previous) => ({
              ...previous,
              loading: false,
              failed:
                error instanceof ApiError && error.status === 501
                  ? "unsupported"
                  : "unavailable",
            }));
        },
      );
    });
    return () => controller.abort();
  }, [connected, path, revision]);
  return state;
}

function UsageFeedback<T>({
  source,
  connected,
  label,
}: {
  source: UsageRead<T>;
  connected: boolean;
  label: string;
}) {
  if (!connected) return null;
  if (source.failed)
    return (
      <p role="alert" className="usage-message">
        {source.failed === "unsupported"
          ? `当前 Codex 服务不支持读取${label}`
          : `${label}读取失败`}
        {source.data
          ? "，保留上次确认的数据。"
          : source.failed === "unsupported"
            ? "。"
            : "，可刷新重试。"}
      </p>
    );
  if (source.loading && !source.data)
    return (
      <p role="status" className="usage-message">
        正在读取{label}…
      </p>
    );
  return null;
}

function AccountIdentity({
  account,
  plan,
}: {
  account?: Account | null;
  plan?: string | null;
}) {
  const { displayName, username, email } = account ?? {};
  const handle = username && `@${username.replace(/^@+/, "")}`;
  const name = displayName || handle || email;
  const planName = plan && plan[0].toUpperCase() + plan.slice(1);
  const metadata = [displayName ? handle : null, planName]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="usage-identity" aria-label="当前账号">
      <strong>
        {name ||
          (account?.type === "apiKey" ? "API 密钥账号" : "账号信息暂不可用")}
      </strong>
      {metadata && <span>{metadata}</span>}
      {email && email !== name && <span>{email}</span>}
    </div>
  );
}

const metrics: {
  key: keyof UsageSummary;
  label: string;
  format: (value: number) => string;
}[] = [
  { key: "lifetimeTokens", label: "累计 Token", format: compactTokens },
  { key: "peakDailyTokens", label: "单日峰值", format: compactTokens },
  {
    key: "longestRunningTurnSec",
    label: "最长单轮用时",
    format: durationLabel,
  },
  { key: "currentStreakDays", label: "当前连续使用", format: (n) => `${n} 天` },
  { key: "longestStreakDays", label: "最长连续使用", format: (n) => `${n} 天` },
];

function OverviewMetrics({ summary }: { summary: UsageSummary | null }) {
  return (
    <section className="usage-section usage-metrics" aria-label="账号统计">
      <p className="usage-caption">账号统计</p>
      <dl>
        {metrics.map(({ key, label, format }) => {
          const value = summary?.[key];
          return (
            <div key={key}>
              <dt>{label}</dt>
              <dd
                title={
                  hasNumber(value) && key.endsWith("Tokens")
                    ? value.toLocaleString("zh-CN")
                    : undefined
                }
              >
                {hasNumber(value) ? format(value) : <small>暂无数据</small>}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function LimitRow({
  window,
  secondary,
}: {
  window: LimitWindow;
  secondary: boolean;
}) {
  const mins = window.windowDurationMins;
  const title =
    mins === 10080
      ? "每周额度"
      : mins && mins > 0
        ? `${mins % 60 === 0 ? `${mins / 60} 小时` : `${mins} 分钟`}额度`
        : secondary
          ? "长期额度"
          : "短期额度";
  const used = window.usedPercent;
  const remaining = hasNumber(used)
    ? Math.round(Math.max(0, Math.min(100, 100 - used)) * 10) / 10
    : null;
  return (
    <div className="usage-limit">
      <div className="usage-row">
        <span>{title}</span>
        <span>
          {remaining === null ? "额度暂不可用" : `剩余 ${remaining}%`}
        </span>
      </div>
      {remaining !== null && (
        <div
          className="usage-track"
          role="meter"
          aria-label={`${title}剩余`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={remaining}
        >
          <span style={{ width: `${remaining}%` }} />
        </div>
      )}
      <p className="usage-caption">
        {window.resetsAt && hasNumber(window.resetsAt)
          ? `${localTime(window.resetsAt)} 重置`
          : "重置时间暂不可用"}
      </p>
    </div>
  );
}

function UsageQuotas({
  source,
  connected,
}: {
  source: UsageRead<Limits>;
  connected: boolean;
}) {
  const data = source.data;
  const buckets = quotaBuckets(data);
  const credits = buckets.find(([, bucket]) => bucket.credits)?.[1].credits;
  const balance = credits?.balance;
  const resetCount = data?.rateLimitResetCredits?.availableCount;
  return (
    <>
      <section className="usage-section">
        <h2>当前额度</h2>
        <UsageFeedback source={source} connected={connected} label="当前额度" />
        {buckets.length > 0 && (
          <p className="usage-caption">按当前账号的额度窗口显示</p>
        )}
        <div className="usage-windows">
          {buckets.map(([id, bucket]) => (
            <div key={id} className="usage-bucket">
              {buckets.length > 1 && <h3>{bucket.limitName || id}</h3>}
              {bucket.primary && (
                <LimitRow window={bucket.primary} secondary={false} />
              )}
              {bucket.secondary && (
                <LimitRow window={bucket.secondary} secondary />
              )}
              {!bucket.primary && !bucket.secondary && (
                <p className="usage-caption">当前账户未提供额度窗口</p>
              )}
            </div>
          ))}
        </div>
        {!buckets.length && !source.loading && !source.failed && (
          <p className="usage-caption">额度暂不可用</p>
        )}
      </section>
      <section className="usage-section">
        <h2>余额与重置</h2>
        <div className="usage-balance">
          <p className="usage-caption">
            {credits?.unlimited
              ? "不限额度"
              : balance != null
                ? `余额 ${/^-?\d+$/.test(balance) ? BigInt(balance).toLocaleString("zh-CN") : balance} credits`
                : "余额暂不可用"}
          </p>
          <p className="usage-caption">
            {hasNumber(resetCount)
              ? `可用重置次数 ${resetCount}`
              : "重置次数暂不可用"}
          </p>
          <a
            className="usage-link"
            href={accountUrl}
            target="_blank"
            rel="noreferrer"
          >
            账户管理 ↗
          </a>
        </div>
      </section>
    </>
  );
}

function quotaBuckets(data: Limits | null): [string, Bucket][] {
  const mapped = Object.entries(data?.rateLimitsByLimitId ?? {}).filter(
    ([, bucket]) => bucket != null,
  );
  if (mapped.length) return mapped;
  return data?.rateLimits
    ? [[data.rateLimits.limitId || "codex", data.rateLimits]]
    : [];
}

export function UsageView({
  connected,
  back,
}: {
  connected: boolean;
  back: () => void;
}) {
  const [tab, setTab] = useState<keyof typeof tabs>("overview");
  const [group, setGroup] = useState<keyof typeof views>("daily");
  const [range, setRange] = useState<keyof typeof dates>(7);
  const [revision, setRevision] = useState(0);
  const identity = useUsageRead<{ account: Account | null }>(
    "/usage/account",
    connected,
    revision,
  );
  const history = useUsageRead<UsageHistory>(
    "/usage/history",
    connected,
    revision,
  );
  const limits = useUsageRead<Limits>("/usage", connected, revision);
  const account = identity.data?.account;
  const plan =
    account?.planType ??
    quotaBuckets(limits.data).find(([, bucket]) => bucket.planType)?.[1]
      .planType;
  const loading =
    connected && (identity.loading || history.loading || limits.loading);
  const days = useMemo(
    () => (history.data ? activityDays(history.data) : []),
    [history.data],
  );
  const overview = tab === "overview";
  const weeks = overview && group !== "daily" ? weeklyActivity(days) : [];
  const plotDays = overview
    ? group === "cumulative"
      ? cumulativeActivity(weeks)
      : weeks
    : days.slice(-range);
  const hasDays = (overview && group === "daily" ? days : plotDays).some(
    (day) => day.tokens !== null,
  );
  const updatedAt = overview ? history.data?.updatedAt : limits.data?.updatedAt;

  function navigateTabs(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "overview"
        : event.key === "End"
          ? "usage"
          : tab === "overview"
            ? "usage"
            : "overview";
    setTab(next);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`#usage-tab-${next}`)
      ?.focus();
  }

  return (
    <section className="usage-page" aria-label="使用情况">
      <div className="usage-content">
        <header>
          <div className="usage-actions">
            <button type="button" className="usage-link" onClick={back}>
              ‹ 返回
            </button>
            <button
              type="button"
              className="usage-link"
              disabled={!connected || loading}
              onClick={() => setRevision((previous) => previous + 1)}
            >
              {loading ? "正在刷新…" : "刷新"}
            </button>
          </div>
          <div className="usage-heading">
            <h1>使用情况</h1>
            <AccountIdentity account={account} plan={plan} />
          </div>
        </header>
        <nav
          className="usage-nav"
          role="tablist"
          aria-label="使用情况分类"
          onKeyDown={navigateTabs}
        >
          {(Object.keys(tabs) as (keyof typeof tabs)[]).map((item) => (
            <button
              type="button"
              role="tab"
              key={item}
              id={`usage-tab-${item}`}
              aria-selected={tab === item}
              aria-controls={`usage-panel-${item}`}
              tabIndex={tab === item ? 0 : -1}
              onClick={() => setTab(item)}
            >
              {tabs[item]}
            </button>
          ))}
        </nav>
        {!connected && (
          <p role="status" className="usage-message">
            连接恢复后将核对最新用量
            {history.data || limits.data ? "，当前显示上次确认的数据。" : "。"}
          </p>
        )}
        {identity.failed && !identity.data && (
          <p className="usage-message" role="status">
            账号信息读取失败，可刷新重试。
          </p>
        )}
        {(Object.keys(tabs) as (keyof typeof tabs)[]).map((item) => (
          <div
            key={item}
            role="tabpanel"
            id={`usage-panel-${item}`}
            aria-labelledby={`usage-tab-${item}`}
            hidden={tab !== item}
          >
            {tab === item && (
              <>
                {overview && (
                  <OverviewMetrics summary={history.data?.summary ?? null} />
                )}
                <section className="usage-section">
                  <div className="usage-section-heading">
                    <div>
                      <h2>{overview ? "Token 活动" : "用量趋势"}</h2>
                      <p className="usage-caption">
                        {overview ? "最近 12 个月" : "每日 Token"}
                      </p>
                    </div>
                    {overview ? (
                      <div
                        className="usage-filters"
                        role="group"
                        aria-label="活动汇总方式"
                      >
                        {(Object.keys(views) as (keyof typeof views)[]).map(
                          (view) => (
                            <button
                              type="button"
                              key={view}
                              aria-pressed={group === view}
                              onClick={() => setGroup(view)}
                            >
                              {views[view]}
                            </button>
                          ),
                        )}
                      </div>
                    ) : (
                      <div
                        className="usage-filters"
                        role="group"
                        aria-label="用量区间"
                      >
                        {([7, 30] as const).map((period) => (
                          <button
                            type="button"
                            key={period}
                            aria-pressed={range === period}
                            onClick={() => setRange(period)}
                          >
                            {dates[period]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <UsageFeedback
                    source={history}
                    connected={connected}
                    label="历史用量"
                  />
                  {hasDays ? (
                    overview && group === "daily" ? (
                      <UsageCalendar days={days} />
                    ) : (
                      <UsageBarChart
                        days={plotDays}
                        label={
                          overview
                            ? group === "weekly"
                              ? "每周 Token 总量"
                              : "区间累计 Token"
                            : "每日 Token"
                        }
                      />
                    )
                  ) : (
                    history.data && (
                      <p className="usage-caption usage-empty">
                        {history.data.dailyUsageBuckets == null
                          ? "每日 Token 数据暂不可用"
                          : "所选区间暂无用量记录"}
                      </p>
                    )
                  )}
                </section>
                {!overview && (
                  <UsageQuotas source={limits} connected={connected} />
                )}
              </>
            )}
          </div>
        ))}
        <footer className="usage-caption usage-source">
          Codex 账号数据
          {hasNumber(updatedAt) ? ` · 更新于 ${localTime(updatedAt)}` : ""}
        </footer>
      </div>
    </section>
  );
}
