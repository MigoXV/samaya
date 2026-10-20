import { useStatusEntries } from "./inline-status-store";

const number = (value?: number) =>
  value == null ? "未提供" : value.toLocaleString("zh-CN");
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
            <small>
              {new Date(row.at).toLocaleTimeString("zh-CN")} · 本地快照
            </small>
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
              <p>
                Token：累计 {number(total?.totalTokens)} · 输入{" "}
                {number(total?.inputTokens)} · 缓存输入{" "}
                {number(total?.cachedInputTokens)} · 输出{" "}
                {number(total?.outputTokens)} · 推理{" "}
                {number(total?.reasoningOutputTokens)}
              </p>
              <p>
                上下文 {number(used)} / {number(capacity)}
                {capacity && used != null
                  ? ` · 剩余 ${Math.max(0, Math.round((1 - used / capacity) * 100))}%`
                  : ""}
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
              {limits.map((limit, index) => (
                <div key={limit.limitId || index}>
                  {[limit.primary, limit.secondary]
                    .filter((w): w is NonNullable<typeof w> => !!w)
                    .map((w, i) => (
                      <p key={i}>
                        {limit.limitName || limit.limitId || "账号"} ·{" "}
                        {w.windowDurationMins
                          ? `${w.windowDurationMins / 60} 小时限额`
                          : "用量限额"}
                        ：剩余 {Math.max(0, Math.round(100 - w.usedPercent))}%
                        {w.resetsAt
                          ? ` · ${new Date(w.resetsAt * 1000).toLocaleString("zh-CN")} 重置`
                          : " · 未提供重置时间"}
                      </p>
                    ))}
                </div>
              ))}
              {!limits.length && (
                <p>账号限额：{d.rateLimitsError || "未提供"}</p>
              )}
            </>
          )}
        </aside>
      );
    });
}
