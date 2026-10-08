import { useEffect, useState } from "react";

export function WorkingStatus({
  tid,
  turnId,
  startedAt,
}: {
  tid: string;
  turnId: string;
  startedAt?: number | null;
}) {
  const [observedAt] = useState(() => {
    const key = `samaya.working.${tid}.${turnId}`;
    const saved = Number(sessionStorage.getItem(key));
    const start = saved > 0 && saved <= Date.now() ? saved : Date.now();
    sessionStorage.setItem(key, String(start));
    return start;
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const nativeStart =
    startedAt != null && Number.isFinite(startedAt) && startedAt >= 0;
  const elapsed = Math.max(
    0,
    Math.floor((now - (nativeStart ? startedAt * 1000 : observedAt)) / 1000),
  );
  return (
    <div
      className="working-status"
      role="status"
      title={nativeStart ? "本轮持续时间" : "本次观察时长"}
    >
      <span className="sr-only">正在执行</span>
      <span aria-hidden="true">
        ◌ Working · <time dateTime={`PT${elapsed}S`}>{elapsed} s</time>
      </span>
    </div>
  );
}
