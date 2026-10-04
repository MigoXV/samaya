import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ItemView } from "./components";
import { preserveReadingPosition } from "./reading-position";
import type { Item, Turn } from "./types";

type Live = { text: string; kind: string };
type Summary = {
  diff: string | null;
  notice?: string | null;
  observedAt?: number | null;
};
const historyCache = new Map<
  string,
  { turns: Turn[]; cursor: string | null; visible: number }
>();
const itemCache = new Map<string, { items: Item[]; cursor: string | null }>();
function remember<T>(cache: Map<string, T>, key: string, value: T) {
  cache.set(key, value);
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
}
export function ExecutionHistory({
  tid,
  turnId,
  turnStatus,
  tab,
}: {
  tid: string;
  turnId?: string;
  turnStatus?: string;
  tab: string;
}) {
  const [turns, setTurns] = useState<Turn[]>(() => {
      const cached = historyCache.get(tid)?.turns || [];
      return turnId
        ? [
            {
              ...(cached.find((t) => t.id === turnId) || {
                id: turnId,
                items: [],
              }),
              status: turnStatus || "inProgress",
            },
            ...cached.filter((t) => t.id !== turnId),
          ]
        : cached;
    }),
    [cursor, setCursor] = useState<string | null>(
      () => historyCache.get(tid)?.cursor || null,
    ),
    [visible, setVisible] = useState(1),
    [loadingOlder, setLoadingOlder] = useState(false),
    [error, setError] = useState("");
  const version = useRef(0),
    region = useRef<HTMLElement>(null);
  useEffect(() => {
    if (turns.length) remember(historyCache, tid, { turns, cursor, visible });
  }, [tid, turns, cursor, visible]);
  useEffect(() => {
    const request = ++version.current;
    let active = true;
    void api<{ data: Turn[]; nextCursor: string | null }>(
      `/threads/${encodeURIComponent(tid)}/turns?limit=1`,
    )
      .then((r) => {
        if (!active || request !== version.current) return;
        setTurns((old) => [
          ...r.data,
          ...old.filter((t) => !r.data.some((n) => n.id === t.id)),
        ]);
        setCursor(r.nextCursor);
        setError("");
      })
      .catch((e) => {
        if (active && request === version.current) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [tid, turnId, turnStatus]);
  async function older() {
    if (visible < turns.length) {
      preserveReadingPosition(region.current);
      setVisible((n) => n + 3);
      return;
    }
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    const request = version.current;
    try {
      const r = await api<{ data: Turn[]; nextCursor: string | null }>(
        `/threads/${encodeURIComponent(tid)}/turns?limit=3&cursor=${encodeURIComponent(cursor)}`,
      );
      if (request !== version.current) return;
      preserveReadingPosition(region.current);
      setTurns((old) => [
        ...old,
        ...r.data.filter((t) => !old.some((o) => o.id === t.id)),
      ]);
      setCursor(r.nextCursor);
      setVisible((n) => n + 3);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingOlder(false);
    }
  }
  return (
    <section
      className="history-view"
      ref={region}
      aria-label={tab === "work" ? "连续执行记录" : "改动与结果"}
    >
      {tab === "result" && (
        <p className="result-notice">
          仅显示可恢复的轮次文件变更与回复。没有结构化测试结果，不推断验证通过；不代表整个目录的改动归属。
        </p>
      )}
      {error && <p role="alert">执行记录加载失败：{error}</p>}
      {(cursor || visible < turns.length) && (
        <button disabled={loadingOlder} onClick={() => void older()}>
          加载更早轮次
        </button>
      )}
      {[...turns.slice(0, visible)].reverse().map((t) => (
        <TurnHistory
          key={t.id}
          tid={tid}
          turn={t}
          tab={tab}
          latest={t.id === turns[0]?.id}
        />
      ))}
      {!turns.length && !error && (
        <p>{turnId ? "加载执行记录…" : "尚无执行轮次"}</p>
      )}
    </section>
  );
}
function TurnHistory({
  tid,
  turn,
  tab,
  latest,
}: {
  tid: string;
  turn: Turn;
  tab: string;
  latest: boolean;
}) {
  const cacheKey = `${tid}:${turn.id}`;
  const [items, setItems] = useState<Item[]>(
      () => itemCache.get(cacheKey)?.items || [],
    ),
    [cursor, setCursor] = useState<string | null>(
      () => itemCache.get(cacheKey)?.cursor || null,
    ),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(() => itemCache.has(cacheKey)),
    [loadingOlderItems, setLoadingOlderItems] = useState(false),
    [streamCursor, setStreamCursor] = useState<number | null>(null),
    [live, setLive] = useState<Record<string, Live>>({}),
    [summary, setSummary] = useState<Summary | null>(null);
  const region = useRef<HTMLElement>(null),
    version = useRef(0),
    alive = useRef(true),
    hasLoaded = useRef(itemCache.has(cacheKey)),
    completed = useRef(new Map<string, Item>()),
    chunks = useRef<Record<string, Live>>({});
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (loaded) remember(itemCache, cacheKey, { items, cursor });
  }, [cacheKey, loaded, items, cursor]);
  const base = `/threads/${encodeURIComponent(tid)}/turns/${encodeURIComponent(turn.id)}`;
  const load = useCallback(
    async (more?: string) => {
      const request = ++version.current;
      try {
        const r = await api<{
          data: { item: Item }[];
          nextCursor: string | null;
          samayaCursor?: number;
        }>(
          base +
            "/items?limit=20" +
            (more ? "&cursor=" + encodeURIComponent(more) : ""),
        );
        if (!alive.current || request !== version.current) return;
        const page = r.data
          .map((x) => completed.current.get(x.item.id) || x.item)
          .reverse();
        if (more) preserveReadingPosition(region.current);
        setItems((old) =>
          more
            ? [...page.filter((i) => !old.some((o) => o.id === i.id)), ...old]
            : [
                ...old.map((i) => page.find((n) => n.id === i.id) || i),
                ...page.filter((i) => !old.some((o) => o.id === i.id)),
              ],
        );
        if (more || !hasLoaded.current) setCursor(r.nextCursor);
        hasLoaded.current = true;
        setStreamCursor((old) => old ?? r.samayaCursor ?? 0);
        setLoaded(true);
        setError("");
      } catch (e) {
        if (alive.current && request === version.current) setError(String(e));
      }
    },
    [base],
  );
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, turn.status]);
  useEffect(() => {
    if (tab !== "result") return;
    let current = true;
    void api<Summary>(base + "/summary")
      .then((r) => {
        if (current) setSummary(r);
      })
      .catch((e) => {
        if (current)
          setSummary({
            diff: null,
            notice: `汇总差异不可用：${String(e)}；请核对文件事件。`,
          });
      });
    return () => {
      current = false;
    };
  }, [base, tab, turn.status]);
  useEffect(() => {
    if (streamCursor === null || turn.status !== "inProgress") return;
    const es = new EventSource(`/api/events?after=${streamCursor}`);
    let summaryVersion = 0;
    const reloadSummary = async () => {
      const request = ++summaryVersion;
      try {
        const next = await api<Summary>(base + "/summary");
        if (alive.current && request === summaryVersion) setSummary(next);
      } catch {
        if (alive.current && request === summaryVersion)
          setSummary({
            diff: null,
            notice: "汇总差异核对失败；请查看原生文件事件。",
          });
      }
    };
    let last = streamCursor,
      timer: ReturnType<typeof setTimeout> | undefined;
    const upsert = (item: Item) =>
      setItems((old) =>
        old.some((i) => i.id === item.id)
          ? old.map((i) => (i.id === item.id ? item : i))
          : [...old, item],
      );
    es.addEventListener("snapshot", () => {
      chunks.current = {};
      setLive({});
      completed.current.clear();
      void load();
      void reloadSummary();
    });
    es.onmessage = (e) => {
      const seq = Number(e.lastEventId || 0);
      if (seq && seq <= last) return;
      if (seq) last = seq;
      const event = JSON.parse(e.data),
        p = event.params || {};
      if (p.threadId !== tid || (p.turnId || p.turn?.id) !== turn.id) return;
      if (
        [
          "item/agentMessage/delta",
          "item/commandExecution/outputDelta",
        ].includes(event.method)
      ) {
        if (completed.current.has(p.itemId)) return;
        chunks.current[p.itemId] = {
          text: (
            (chunks.current[p.itemId]?.text || "") + (p.delta || "")
          ).slice(-100000),
          kind: event.method.includes("agentMessage")
            ? "agentMessage"
            : "commandExecution",
        };
        if (!timer)
          timer = setTimeout(() => {
            setLive({ ...chunks.current });
            timer = undefined;
          }, 250);
      } else if (event.method === "item/mcpToolCall/progress") {
        chunks.current[p.itemId] = {
          text: String(p.message || "").slice(-6000),
          kind: "mcpToolCall",
        };
        setLive({ ...chunks.current });
      } else if (event.method === "item/started") {
        if (!completed.current.has(p.item.id)) upsert(p.item);
      } else if (event.method === "item/completed") {
        // Replace the same native item, rather than adding a second streamed message.
        version.current++;
        completed.current.set(p.item.id, p.item);
        upsert(p.item);
        delete chunks.current[p.item.id];
        setLive({ ...chunks.current });
      } else if (event.method === "samaya/turnSummaryChanged") {
        void reloadSummary();
      } else if (event.method === "turn/completed") {
        chunks.current = {};
        setLive({});
        void load();
      }
    };
    const reconcile = setInterval(() => void load(), 5000);
    return () => {
      es.close();
      summaryVersion++;
      clearTimeout(timer);
      clearInterval(reconcile);
    };
  }, [tid, turn.id, turn.status, streamCursor, load, base]);
  const merged = [
    ...items,
    ...Object.entries(live)
      .filter(([id]) => !items.some((i) => i.id === id))
      .map(([id, v]) => ({ id, type: v.kind, status: "inProgress" }) as Item),
  ];
  const requirement = latest
    ? [...items].reverse().find((i) => i.type === "userMessage")
    : undefined;
  const files = items.flatMap(
    (i) => i.changes?.map((c) => ({ path: c.path, id: i.id })) || [],
  );
  return (
    <section ref={region} className="turn-history" data-turn-id={turn.id}>
      <div className="turn-divider">
        本轮 ·{" "}
        {(
          {
            completed: "已结束",
            inProgress: "执行中",
            interrupted: "已中断",
            failed: "失败",
          } as Record<string, string>
        )[turn.status] || turn.status}
        <span className="sr-only">轮次 {turn.id}</span>
      </div>
      {tab === "work" && latest && loaded && !requirement && (
        <small>
          本页尚未读取到用户要求{cursor ? "；可加载更早记录核对。" : "。"}
        </small>
      )}
      {error && (
        <p role="alert">
          {error} <button onClick={() => void load()}>重新加载记录</button>
        </p>
      )}
      {!loaded && !error && <p>加载执行记录…</p>}
      {cursor && (
        <button
          disabled={loadingOlderItems}
          onClick={async () => {
            setLoadingOlderItems(true);
            try {
              await load(cursor);
            } finally {
              setLoadingOlderItems(false);
            }
          }}
        >
          加载更早记录
        </button>
      )}
      {tab === "result" && (
        <>
          <nav className="file-index" aria-label="本轮变更文件">
            {files.length ? (
              files.map((f, i) => (
                <button
                  key={f.path + i}
                  onClick={() =>
                    document
                      .getElementById(`activity-${turn.id}-${f.id}`)
                      ?.scrollIntoView({ block: "start" })
                  }
                >
                  {f.path}
                </button>
              ))
            ) : (
              <p>本页记录未提供文件变更；可加载更早记录核对。</p>
            )}
          </nav>
          {summary?.diff ? (
            <details className="tool">
              <summary>本轮汇总差异 · 当前连接观察</summary>
              <pre>{summary.diff}</pre>
            </details>
          ) : (
            <p className="muted">
              {summary?.notice ||
                "当前连接未提供汇总差异；以下保留原生文件事件。"}
            </p>
          )}
        </>
      )}
      {merged.map((item) => {
        const fragment = live[item.id];
        const observed =
          fragment && fragment.kind !== "mcpToolCall"
            ? {
                ...item,
                type: fragment.kind,
                status: "inProgress",
                text:
                  fragment.kind === "agentMessage" ? fragment.text : item.text,
                aggregatedOutput:
                  fragment.kind === "commandExecution"
                    ? fragment.text
                    : item.aggregatedOutput,
              }
            : item;
        return (
          <div
            key={item.id}
            id={`activity-${turn.id}-${item.id}`}
            hidden={
              tab === "result" &&
              !["fileChange", "agentMessage"].includes(item.type)
            }
            data-item-id={item.id}
          >
            {fragment?.kind === "agentMessage" && (
              <details className="stream-notice">
                <summary>正在接收输出</summary>
                <small>
                  当前连接的流式片段，最多保留 100,000
                  字符；与历史衔接未确认，完成后以完整记录替换。
                </small>
              </details>
            )}
            <ItemView
              item={observed}
              progress={
                fragment?.kind === "mcpToolCall" ? fragment.text : undefined
              }
            />
          </div>
        );
      })}
    </section>
  );
}
