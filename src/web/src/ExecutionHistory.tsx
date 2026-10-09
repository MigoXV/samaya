import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ItemView } from "./components";
import { ToolSequence } from "./ToolSequence";
import { WorkingStatus } from "./WorkingStatus";
import "./execution-display.css";
import { preserveReadingPosition } from "./reading-position";
import { HistoryPagination } from "./HistoryPagination";
import type { HistoryPage } from "./HistoryPagination";
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
  turnStartedAt,
  working,
  tab,
}: {
  tid: string;
  turnId?: string;
  turnStatus?: string;
  turnStartedAt?: number | null;
  working: boolean;
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
    [paging, setPaging] = useState<Record<string, HistoryPage>>({}),
    [error, setError] = useState(""),
    [turnsReady, setTurnsReady] = useState(historyCache.has(tid)),
    [retrySource, setRetrySource] = useState("latest");
  const version = useRef(0),
    region = useRef<HTMLElement>(null),
    alive = useRef(true),
    hasTurnsPage = useRef(historyCache.has(tid)),
    turnCursor = useRef(historyCache.get(tid)?.cursor || null),
    revealed = useRef(1),
    turnsFailure = useRef(""),
    requests = useRef(new Set<AbortController>());
  useEffect(() => {
    if (turnsReady && turns.length)
      remember(historyCache, tid, { turns, cursor, visible });
  }, [tid, turns, cursor, visible, turnsReady]);
  useEffect(() => {
    alive.current = true;
    const pending = requests.current;
    return () => {
      alive.current = false;
      for (const controller of pending) controller.abort();
    };
  }, []);
  const refreshTurns = useCallback(async () => {
    if (!alive.current) return;
    const request = ++version.current;
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const r = await api<{ data: Turn[]; nextCursor: string | null }>(
        `/threads/${encodeURIComponent(tid)}/turns?limit=1`,
        { signal: controller.signal },
      );
      if (!alive.current || request !== version.current) return;
      setTurns((old) => [
        ...r.data,
        ...old.filter((t) => !r.data.some((n) => n.id === t.id)),
      ]);
      if (!hasTurnsPage.current) {
        turnCursor.current = r.nextCursor;
        setCursor(r.nextCursor);
      }
      hasTurnsPage.current = true;
      setTurnsReady(true);
      if (!turnsFailure.current) setError("");
    } catch (e) {
      if (alive.current && request === version.current) {
        setError(String(e));
        setRetrySource("latest");
      }
    } finally {
      requests.current.delete(controller);
    }
  }, [tid]);
  useEffect(() => {
    queueMicrotask(() => void refreshTurns());
  }, [refreshTurns, turnId, turnStatus]);
  const older = useCallback(async () => {
    if (!alive.current || turnsFailure.current) return 0;
    if (visible < turns.length) {
      if (visible !== revealed.current) return 0;
      revealed.current++;
      preserveReadingPosition(region.current);
      setVisible((n) => n + 1);
      setError("");
      return 1;
    }
    if (!cursor || cursor !== turnCursor.current) return 0;
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      // Admit one older turn at a time so its remaining items are read before crossing another boundary.
      const r = await api<{ data: Turn[]; nextCursor: string | null }>(
        `/threads/${encodeURIComponent(tid)}/turns?limit=1&cursor=${encodeURIComponent(cursor)}`,
        { signal: controller.signal },
      );
      if (!alive.current) return 0;
      if (r.nextCursor === cursor) throw new Error("历史游标未前进，请重试。");
      preserveReadingPosition(region.current);
      setTurns((old) => [
        ...old,
        ...r.data.filter((t) => !old.some((o) => o.id === t.id)),
      ]);
      setCursor(r.nextCursor);
      turnCursor.current = r.nextCursor;
      revealed.current++;
      setVisible((n) => n + 1);
      setError("");
      // Budget includes the admitted turn's initial item request.
      return 2;
    } catch (e) {
      if (alive.current) {
        turnsFailure.current = String(e);
        setError(String(e));
        setRetrySource("older");
      }
      return 0;
    } finally {
      requests.current.delete(controller);
    }
  }, [tid, cursor, turns, visible]);
  const reportPage = useCallback((id: string, page: HistoryPage | null) => {
    setPaging((old) => {
      const next = { ...old };
      if (page) next[id] = page;
      else delete next[id];
      return next;
    });
  }, []);
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
      <HistoryPagination
        region={region}
        pages={[
          ...(!turnsReady ? [undefined] : []),
          ...turns.slice(0, visible).map((t) => paging[t.id]),
        ]}
        hasEarlierTurns={!!cursor || visible < turns.length}
        loadEarlierTurns={older}
        error={error}
        retryTurns={async () => {
          turnsFailure.current = "";
          await (retrySource === "older" ? older() : refreshTurns());
        }}
      />
      {[...turns.slice(0, visible)].reverse().map((t) => (
        <TurnHistory
          key={t.id}
          tid={tid}
          turn={t}
          tab={tab}
          latest={t.id === turns[0]?.id}
          onPaging={reportPage}
          working={working && t.id === turnId}
          startedAt={t.id === turnId ? turnStartedAt : undefined}
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
  working,
  startedAt,
  onPaging,
}: {
  tid: string;
  turn: Turn;
  tab: string;
  latest: boolean;
  working: boolean;
  startedAt?: number | null;
  onPaging: (id: string, page: HistoryPage | null) => void;
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
    [streamCursor, setStreamCursor] = useState<number | null>(null),
    [live, setLive] = useState<Record<string, Live>>({}),
    [summary, setSummary] = useState<Summary | null>(null);
  const region = useRef<HTMLElement>(null),
    version = useRef(0),
    alive = useRef(true),
    hasLoaded = useRef(itemCache.has(cacheKey)),
    completed = useRef(new Map<string, Item>()),
    pageCursor = useRef(itemCache.get(cacheKey)?.cursor || null),
    pagingFailure = useRef(""),
    olderRequest = useRef<Promise<number> | null>(null),
    chunks = useRef<Record<string, Live>>({}),
    requests = useRef(new Set<AbortController>());
  useEffect(() => {
    alive.current = true;
    const pending = requests.current;
    return () => {
      alive.current = false;
      for (const controller of pending) controller.abort();
    };
  }, []);
  useEffect(() => {
    if (loaded) remember(itemCache, cacheKey, { items, cursor });
  }, [cacheKey, loaded, items, cursor]);
  const base = `/threads/${encodeURIComponent(tid)}/turns/${encodeURIComponent(turn.id)}`;
  const load = useCallback(
    async (more?: string) => {
      if (!alive.current) return 0;
      if (more && more !== pageCursor.current) return 0;
      const request = more ? version.current : ++version.current;
      const controller = new AbortController();
      requests.current.add(controller);
      try {
        const r = await api<{
          data: { item: Item }[];
          nextCursor: string | null;
          samayaCursor?: number;
        }>(
          base +
            "/items?limit=100" +
            (more ? "&cursor=" + encodeURIComponent(more) : ""),
          { signal: controller.signal },
        );
        if (!alive.current || (!more && request !== version.current)) return 0;
        if (more && r.nextCursor === more)
          throw new Error("历史游标未前进，请重试。");
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
        if (more || !hasLoaded.current) {
          pageCursor.current = r.nextCursor;
          setCursor(r.nextCursor);
        }
        hasLoaded.current = true;
        setStreamCursor((old) => old ?? r.samayaCursor ?? 0);
        setLoaded(true);
        if (more || !pagingFailure.current) setError("");
        return 1;
      } catch (e) {
        if (alive.current && (more || request === version.current)) {
          pagingFailure.current = String(e);
          setError(String(e));
        }
        return 0;
      } finally {
        requests.current.delete(controller);
      }
    },
    [base],
  );
  useEffect(() => {
    onPaging(turn.id, {
      ready: loaded || !!error,
      cursor,
      error,
      load: () => {
        if (pagingFailure.current) return Promise.resolve(0);
        if (olderRequest.current) return olderRequest.current;
        const request = load(loaded ? cursor || undefined : undefined);
        olderRequest.current = request;
        void request.finally(() => {
          olderRequest.current = null;
        });
        return request;
      },
      retry: () => {
        pagingFailure.current = "";
        return load(loaded ? cursor || undefined : undefined);
      },
    });
    return () => onPaging(turn.id, null);
  }, [onPaging, turn.id, loaded, cursor, error, load]);
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
  const authorIds = new Set<string>();
  let needsAuthor = true;
  for (const item of merged) {
    if (item.type === "userMessage") needsAuthor = true;
    else if (item.type === "agentMessage" && needsAuthor) {
      authorIds.add(item.id);
      needsAuthor = false;
    }
  }
  const renderItem = (item: Item) => {
    const fragment = live[item.id];
    const observed =
      fragment && fragment.kind !== "mcpToolCall"
        ? {
            ...item,
            type: fragment.kind,
            status: "inProgress",
            text: fragment.kind === "agentMessage" ? fragment.text : item.text,
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
          showAgentAuthor={authorIds.has(item.id)}
          progress={
            fragment?.kind === "mcpToolCall" ? fragment.text : undefined
          }
        />
      </div>
    );
  };
  // Keep calls within their native conversational position and turn boundary.
  const sections: { tools: boolean; items: Item[] }[] = [];
  for (const item of merged) {
    if (item.type === "reasoning") continue;
    const tools =
      tab === "work" &&
      !["userMessage", "agentMessage", "plan", "contextCompaction"].includes(
        item.type,
      );
    const last = sections.at(-1);
    if (tools && last?.tools) last.items.push(item);
    else sections.push({ tools, items: [item] });
  }
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
      {tab === "work" && latest && loaded && !requirement && !cursor && (
        <small>当前记录未包含用户要求。</small>
      )}
      {!loaded && !error && (
        <p className="history-local-loading">正在载入对话…</p>
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
              <p>已载入的记录未提供文件变更。</p>
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
      {sections.map((section) =>
        section.tools ? (
          <ToolSequence key={section.items[0].id} count={section.items.length}>
            {section.items.map(renderItem)}
          </ToolSequence>
        ) : (
          <Fragment key={section.items[0].id}>
            {section.items.map(renderItem)}
          </Fragment>
        ),
      )}
      {tab === "work" && latest && working && turn.status === "inProgress" && (
        <WorkingStatus
          tid={tid}
          turnId={turn.id}
          startedAt={startedAt ?? turn.startedAt}
        />
      )}
    </section>
  );
}
