import { useStatusEntries } from "./inline-status-store";

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const number = (value?: number) =>
  value == null || !Number.isFinite(value)
    ? "未提供"
    : compactNumber.format(value);
function StatusMeter({
  label,
  percent,
  caption,
}: {
  label: string;
  percent?: number;
  caption: string;
}) {
  const value =
    typeof percent === "number" && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : null;
  const remaining = value === null ? null : 100 - value;
  const tone =
    remaining === null
      ? "unknown"
      : remaining < 25
        ? "danger"
        : remaining <= 50
          ? "warning"
          : "success";
  return (
    <div className="status-meter" data-tone={tone}>
      <div className="status-meter-title">
        <span>{label}</span>
      </div>
      <div className="status-meter-label">
        {value === null ? (
          <span>用量未提供</span>
        ) : (
          <span>剩余 {Math.round(remaining!)}%</span>
        )}
      </div>
      {value !== null && (
        <div
          className="status-meter-track"
          role="progressbar"
          aria-label={label + "剩余"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={100 - value}
          aria-valuetext={`剩余 ${Math.round(remaining!)}%`}
        >
          <span style={{ width: `${100 - value}%` }} />
        </div>
      )}
      <small>{caption}</small>
    </div>
  );
}

function windowName(minutes?: number) {
  if (!minutes) return "用量限额";
  return minutes % 1440 === 0
    ? `${minutes / 1440} 天限额`
    : minutes % 60 === 0
      ? `${minutes / 60} 小时限额`
      : `${minutes} 分钟限额`;
}

export function InlineStatus({
  tid,
  turnId,
  itemId = null,
}: {
  tid: string;
  turnId: string | null;
  itemId?: string | null;
}) {
  const list = useStatusEntries(tid);
  return list
    .filter((row) => row.turnId === turnId && (row.itemId || null) === itemId)
    .map((row) => {
      const d = row.data,
        usage = d?.tokenUsage?.usage;
      const total = usage?.total,
        used = usage?.last?.totalTokens,
        capacity = usage?.modelContextWindow;
      const limits = d?.rateLimits?.rateLimitsByLimitId
        ? Object.values(d.rateLimits.rateLimitsByLimitId)
        : d?.rateLimits?.rateLimits
          ? [d.rateLimits.rateLimits]
          : [];
      return (
        <aside
          key={row.id}
          className="inline-status"
          aria-label="会话状态与用量"
          role="status"
        >
          <header>
            <strong>/status</strong>
            <small>{new Date(row.at).toLocaleTimeString("zh-CN")}</small>
          </header>
          {!d ? (
            <p>{row.error || "正在读取会话状态与用量…"}</p>
          ) : (
            <>
              <p>
                模型 {d.model || "未提供"} · 思考强度{" "}
                {d.reasoningEffort || "默认"} · Fast{" "}
                {d.serviceTier === "fast" || d.serviceTier === "priority"
                  ? "开启"
                  : "关闭"}
              </p>
              <p className="status-cwd">工作区 {d.cwd}</p>
              <StatusMeter
                label="上下文"
                percent={
                  capacity && capacity > 0 && used != null
                    ? (used / capacity) * 100
                    : undefined
                }
                caption={`${number(used)} / ${number(capacity)} Tokens`}
              />
              {limits.map((limit, index) => (
                <div key={limit.limitId || index}>
                  {[limit.primary, limit.secondary]
                    .filter((w): w is NonNullable<typeof w> => !!w)
                    .map((w, i) => (
                      <StatusMeter
                        key={i}
                        label={`${limit.limitName || limit.limitId || "账号"} · ${windowName(w.windowDurationMins)}`}
                        percent={w.usedPercent}
                        caption={
                          w.resetsAt
                            ? `${new Date(w.resetsAt * 1000).toLocaleString("zh-CN")} 重置`
                            : "未提供重置时间"
                        }
                      />
                    ))}
                </div>
              ))}
              <p>
                Token：累计 {number(total?.totalTokens)} · 输入{" "}
                {number(total?.inputTokens)} · 缓存输入{" "}
                {number(total?.cachedInputTokens)} · 输出{" "}
                {number(total?.outputTokens)} · 推理{" "}
                {number(total?.reasoningOutputTokens)}
              </p>
              {d.tokenUsage ? (
                <small>
                  用量最近观察：
                  {new Date(d.tokenUsage.observedAt * 1000).toLocaleString(
                    "zh-CN",
                  )}
                  ；不会将缺失或旧数据当作零。
                </small>
              ) : (
                <small>当前连接尚未收到此会话的用量通知。</small>
              )}
              {!limits.length && (
                <p>账号限额：{d.rateLimitsError || "未提供"}</p>
              )}
            </>
          )}
        </aside>
      );
    });
}
