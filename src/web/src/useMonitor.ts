import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { MonitorSnapshot, Observation } from "./monitor";
export function useMonitor() {
  const [data, setData] = useState<MonitorSnapshot | null>(null),
    [records, setRecords] = useState(new Map<string, Observation>()),
    [online, setOnline] = useState(false),
    [disconnected, setDisconnected] = useState(false),
    [recovering, setRecovering] = useState(true),
    [error, setError] = useState("");
  const current = useRef<MonitorSnapshot | null>(null),
    fetching = useRef(false),
    again = useRef(false),
    alive = useRef(true),
    buffer = useRef<MonitorSnapshot[]>([]);
  const install = useCallback((next: MonitorSnapshot, full: boolean) => {
    const old = current.current;
    if (
      !full &&
      (!old ||
        old.generation !== next.generation ||
        next.revision > old.revision + 1)
    ) {
      setRecovering(true);
      return false;
    }
    if (
      old &&
      old.generation === next.generation &&
      next.revision < old.revision
    )
      return true;
    const merged = full
      ? next
      : { ...old, ...next, pendingRequests: old!.pendingRequests };
    current.current = merged;
    setData(merged);
    setRecords((prev) => {
      const incoming = new Map(next.records.map((r) => [r.thread.id, r]));
      const map = new Map(
        [...prev].filter(([id]) => !full || incoming.has(id)),
      );
      for (const r of next.records.filter((r) => map.has(r.thread.id)))
        map.set(r.thread.id, r);
      for (const r of next.records
        .filter((r) => !map.has(r.thread.id))
        .sort((a, b) => b.thread.updatedAt - a.thread.updatedAt))
        map.set(r.thread.id, r);
      next.removed?.forEach((id) => map.delete(id));
      return map;
    });
    return true;
  }, []);
  const refresh = useCallback(
    async function reconcile() {
      if (fetching.current) {
        again.current = true;
        return;
      }
      fetching.current = true;
      try {
        const next = await api<MonitorSnapshot>("/monitor");
        if (!alive.current) return;
        install(next, true);
        setError("");
        for (const patch of buffer.current) {
          if (
            patch.generation === next.generation &&
            patch.revision > next.revision &&
            !install(patch, false)
          )
            again.current = true;
        }
        buffer.current = [];
        if (!again.current) setRecovering(false);
      } catch (e) {
        if (alive.current)
          setError(
            e instanceof ApiError && e.status === 404
              ? "当前后端缺少任务总览接口。请重启 Samaya 后端以加载新版，再重新核对；会话记录仍保存在 Codex 中。"
              : String(e),
          );
      } finally {
        fetching.current = false;
        if (again.current && alive.current) {
          again.current = false;
          queueMicrotask(() => void reconcile());
        }
      }
    },
    [install],
  );
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => void refresh());
    const es = new EventSource("/api/events");
    es.onopen = () => {
      setOnline(true);
      setDisconnected(false);
    };
    es.onerror = () => {
      setDisconnected(true);
      setOnline(false);
      setRecovering(true);
    };
    es.addEventListener("snapshot", () => {
      setRecovering(true);
      void refresh();
    });
    es.addEventListener("monitor", (e) => {
      const patch = JSON.parse((e as MessageEvent).data) as MonitorSnapshot;
      if (fetching.current) {
        buffer.current.push(patch);
        return;
      }
      const keys =
        current.current?.pendingRequests.map(
          (p) => p.key + ":" + (p.responseState || ""),
        ) || [];
      if (
        !install(patch, false) ||
        JSON.stringify(keys) !==
          JSON.stringify(
            patch.requestStates || patch.requestKeys?.map((k) => k + ":"),
          )
      )
        void refresh();
    });
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (
        event.method === "samaya/connection" ||
        event.method === "samaya/requestChanged" ||
        event.method === "samaya/operation" ||
        event.method === "serverRequest/resolved" ||
        event.id !== undefined
      )
        void refresh();
    };
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      alive.current = false;
      es.close();
      clearInterval(timer);
    };
  }, [refresh, install]);
  return {
    data,
    records,
    online: online && !recovering,
    disconnected,
    error,
    refresh,
  };
}
