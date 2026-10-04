import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

type Window = {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
};
type Bucket = {
  limitId?: string | null;
  limitName?: string | null;
  planType?: string | null;
  primary?: Window | null;
  secondary?: Window | null;
  credits?: {
    balance?: string | null;
    hasCredits?: boolean;
    unlimited?: boolean;
  } | null;
};
type Usage = {
  rateLimits?: Bucket;
  rateLimitsByLimitId?: Record<string, Bucket> | null;
  rateLimitResetCredits?: { availableCount: number } | null;
  updatedAt: number;
};
const accountUrl = "https://chatgpt.com/codex/cloud/settings/usage";
const date = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function LimitRow({
  window,
  secondary,
}: {
  window: Window;
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
  const remaining =
    typeof used === "number" && Number.isFinite(used)
      ? Math.max(0, Math.min(100, 100 - used))
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
        {window.resetsAt && Number.isFinite(window.resetsAt)
          ? `${date(window.resetsAt)} 重置`
          : "重置时间暂不可用"}
      </p>
    </div>
  );
}
export function UsageView({
  connected,
  settings,
}: {
  connected: boolean;
  settings: () => void;
}) {
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current || !connected) return;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await api<Usage>("/usage");
      if (alive.current) setData(result);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  }, [connected]);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => {
      if (alive.current) void refresh();
    });
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  const mapped = Object.entries(data?.rateLimitsByLimitId || {}).filter(
    ([, b]) => b && typeof b === "object",
  );
  const buckets = mapped.length
    ? mapped
    : data?.rateLimits
      ? [[data.rateLimits.limitId || "codex", data.rateLimits] as const]
      : [];
  const plan = buckets.find(([, b]) => b.planType)?.[1].planType;
  const credits = buckets.find(([, b]) => b.credits)?.[1].credits;
  const resetCount = data?.rateLimitResetCredits?.availableCount;
  return (
    <section className="usage-page" aria-label="使用情况">
      <header className="usage-heading">
        <h1>使用情况</h1>
        <button
          className="usage-link"
          disabled={!connected || loading}
          onClick={() => void refresh()}
        >
          {loading ? "正在刷新…" : "刷新 ↻"}
        </button>
      </header>
      <nav className="usage-nav" aria-label="账户导航">
        <span aria-current="page">总览</span>
        <a href={accountUrl} target="_blank" rel="noreferrer">
          账户管理 ↗
        </a>
        <button className="usage-link" onClick={settings}>
          返回设置
        </button>
      </nav>
      {!connected && (
        <p role="status" className="usage-caption">
          连接恢复后将核对最新用量。
        </p>
      )}
      {error && (
        <p role="alert">
          {error}
          {data ? "；保留上次确认的数据。" : ""}
        </p>
      )}
      {!data && !error && connected && (
        <p role="status" className="usage-caption">
          正在读取账户用量…
        </p>
      )}
      <section className="usage-section usage-plan">
        <h2>当前套餐</h2>
        <div className="usage-row">
          <span>
            {plan
              ? `${plan.charAt(0).toUpperCase() + plan.slice(1)} 套餐`
              : "套餐暂不可用"}
          </span>
          <a href={accountUrl} target="_blank" rel="noreferrer">
            管理套餐 ↗
          </a>
        </div>
        <p className="usage-caption">在账户管理中查看订阅详情</p>
      </section>
      <section className="usage-section usage-limits">
        <h2>用量限制</h2>
        {buckets.map(([id, b]) => (
          <div key={id} className="usage-bucket">
            {buckets.length > 1 && <h3>{b.limitName || id}</h3>}
            {b.primary && <LimitRow window={b.primary} secondary={false} />}
            {b.secondary && <LimitRow window={b.secondary} secondary />}
            {!b.primary && !b.secondary && (
              <p className="usage-caption">当前账户未提供额度窗口</p>
            )}
          </div>
        ))}
        {!buckets.length && <p className="usage-caption">额度暂不可用</p>}
      </section>
      <section className="usage-section">
        <h2>额度余额</h2>
        <div className="usage-row">
          <span>
            {credits?.unlimited
              ? "不限额度"
              : credits?.balance != null
                ? `${/^-?\d+$/.test(credits.balance) ? BigInt(credits.balance).toLocaleString("zh-CN") : credits.balance} credits`
                : "余额暂不可用"}
          </span>
          <a href={accountUrl} target="_blank" rel="noreferrer">
            管理额度 ↗
          </a>
        </div>
        <p className="usage-caption">购买与自动充值在账户管理中设置</p>
      </section>
      {typeof resetCount === "number" && (
        <section className="usage-section">
          <h2>额度重置</h2>
          <div className="usage-row">
            <span>可用重置次数 {resetCount}</span>
            <a href={accountUrl} target="_blank" rel="noreferrer">
              查看重置选项 →
            </a>
          </div>
        </section>
      )}
      {data && (
        <p className="usage-caption" role="status">
          更新于 {date(data.updatedAt)}
        </p>
      )}
    </section>
  );
}
