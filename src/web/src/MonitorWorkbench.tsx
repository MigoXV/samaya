import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, operation, pendingOperations, clearOperation } from "./api";
import { DirectoryPicker, Modal, RequestForm } from "./components";
import { ExecutionHistory } from "./ExecutionHistory";
import { ThemeSelect } from "./ThemeSelect";
import { useMonitor } from "./useMonitor";
import { useRecentTasks } from "./useRecentTasks";
import {
  clock,
  execution,
  progress,
  recentFact,
  projectName,
  requestLabel,
  rootId,
  threadTitle,
  waitingUnknown,
} from "./monitor";
import type { Observation } from "./monitor";
import type { Pending, Preview, Receipt, Status, Thread } from "./types";
import "./monitor.css";

type View =
  "pinned" | "overview" | "attention" | "records" | "settings" | "changes";
const preferences = () => {
  try {
    return JSON.parse(sessionStorage.getItem("samaya.monitor.view") || "{}");
  } catch {
    return {};
  }
};
const EMPTY: Pending[] = [];
const TaskRow = memo(function TaskRow({
  record,
  requests,
  childrenCount,
  activeChildren,
  selected,
  stale,
  pinned,
  unknownRequests,
  stopping,
  open,
  decide,
  pin,
}: {
  record: Observation;
  requests: Pending[];
  childrenCount: number;
  activeChildren: number;
  selected: boolean;
  stale: boolean;
  pinned: boolean;
  unknownRequests: boolean;
  stopping: boolean;
  open: (id: string) => void;
  decide: (id: string) => void;
  pin: (id: string) => void;
}) {
  const t = record.thread,
    fact = progress(record),
    unknown = unknownRequests;
  return (
    <div
      className={`task-row ${selected ? "is-selected" : ""}`}
      role="listitem"
      data-task-id={t.id}
    >
      <button
        className="task-open"
        aria-pressed={selected}
        onClick={() => open(t.id)}
      >
        <span className="task-identity">
          <strong>
            {pinned ? "置顶 · " : ""}
            {threadTitle(t)}
          </strong>
          <small>
            {projectName(t)}
            {t.parentThreadId ? " · 子任务" : ""}
            {childrenCount
              ? ` · ${childrenCount} 个子任务${activeChildren ? ` / ${activeChildren} 个执行中` : ""}`
              : ""}
          </small>
        </span>
        <span className="task-progress">
          <span
            className={
              execution(record).includes("失败") ? "attention-text" : ""
            }
          >
            {stopping ? "停止请求处理中" : execution(record)}
            {record.terminals.length
              ? ` · ${record.terminals.length} 个后台命令运行中`
              : ""}
          </span>
          <span className="fact" title={`${fact.source}：${fact.text}`}>
            {fact.source.startsWith("AI") ? "AI 说明 · " : ""}
            {fact.text}
          </span>
        </span>
      </button>
      <div className="task-decision">
        {requests.length ? (
          <button className="request-action" onClick={() => decide(t.id)}>
            {requestLabel(requests[0])}
            <small>
              {requests.length} 项请求{unknown ? " · 待核对" : ""}
            </small>
          </button>
        ) : unknown ? (
          <button onClick={() => decide(t.id)}>请求内容待恢复</button>
        ) : (
          <span className="muted">
            {execution(record).includes("失败") ? "展开查看原因" : "—"}
          </span>
        )}
      </div>
      <div className="task-freshness">
        <small>
          {stale || record.error
            ? "状态待确认"
            : record.confirmedAt
              ? "已同步"
              : "正在核对"}
        </small>
        <time title="最后一次状态核对">{clock(record.confirmedAt)}</time>
        <button
          className="pin quiet"
          aria-label={`${pinned ? "取消置顶" : "置顶"} ${threadTitle(t)}`}
          aria-pressed={pinned}
          onClick={() => pin(t.id)}
        >
          {pinned ? "已置顶" : "置顶"}
        </button>
      </div>
    </div>
  );
});

export function MonitorWorkbench({ logout }: { logout: () => void }) {
  const { data, records, online, error: syncError, refresh } = useMonitor();
  const [view, setView] = useState<View>(() =>
    location.pathname.startsWith("/sessions")
      ? "records"
      : location.pathname.startsWith("/settings")
        ? "settings"
        : "overview",
  );
  const [search, setSearch] = useState<string>(
      () => preferences().search || "",
    ),
    [project, setProject] = useState<string>(() => preferences().project || ""),
    [filter, setFilter] = useState<string>(() => preferences().filter || "all");
  const [selected, setSelected] = useState<string>(
      () =>
        new URL(location.href).searchParams.get("thread") ||
        preferences().selected ||
        "",
    ),
    [tab, setTab] = useState("work"),
    [focus, setFocus] = useState(false),
    [nav, setNav] = useState(false);
  const [pins, setPins] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("samaya.pins") || "[]");
    } catch {
      return [];
    }
  });
  const [stopRequested, setStopRequested] = useState<Record<string, string>>(
    {},
  );
  const [dialog, setDialog] = useState<
      "create" | "workspace" | "stop" | "receipts" | null
    >(null),
    [requestTask, setRequestTask] = useState<string | null>(null),
    [requestKey, setRequestKey] = useState<string | null>(null);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [cwd, setCwd] = useState(""),
    [goal, setGoal] = useState(""),
    [newName, setNewName] = useState("");
  const [receipts, setReceipts] = useState(pendingOperations),
    [seen, setSeen] = useState(() =>
      Number(localStorage.getItem("samaya.changes.seen") || 0),
    );
  const [tick, setTick] = useState(() => Date.now()),
    [scroll, setScroll] = useState(() => preferences().scroll || 0),
    [viewport, setViewport] = useState(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
  const narrow = viewport.width < 800;
  const scrollRef = useRef<HTMLDivElement>(null),
    submitting = useRef(new Set<string>());
  const connected = online && data?.connection === "connected";
  const requests = data?.pendingRequests || EMPTY;
  const selectedRecord = records.get(selected);
  const requestsByRoot = useMemo(() => {
    const map = new Map<string, Pending[]>();
    for (const p of requests) {
      const id = rootId(p.params.threadId, records);
      map.set(id, [...(map.get(id) || []), p]);
    }
    return map;
  }, [records, requests]);
  const childMap = useMemo(() => {
    const map = new Map<string, Observation[]>();
    for (const r of records.values()) {
      const id = rootId(r.thread.id, records);
      if (id !== r.thread.id) map.set(id, [...(map.get(id) || []), r]);
    }
    return map;
  }, [records]);
  const ordered = useMemo(
    () =>
      [...records.values()].filter(
        (r) =>
          !r.thread.parentThreadId || !records.has(r.thread.parentThreadId),
      ),
    [records],
  );
  const [recentLimit, setRecentLimit] = useState(() =>
    localStorage.getItem("samaya.recent.limit") === "10" ? 10 : 20,
  );
  const projects = useMemo(
    () =>
      [...new Set([...records.values()].map((r) => r.thread.cwd))]
        .filter(Boolean)
        .sort(),
    [records],
  );
  const unknownRoots = useMemo(() => {
    const ids = new Set<string>();
    for (const r of records.values())
      if (
        waitingUnknown(
          r,
          requests.filter((p) => p.params.threadId === r.thread.id),
        )
      )
        ids.add(rootId(r.thread.id, records));
    return ids;
  }, [records, requests]);
  const waitingCount = [...requestsByRoot.keys()].length,
    unknownCount = unknownRoots.size;
  const matching = ordered.filter((r) => {
    const state = execution(r),
      pending =
        (requestsByRoot.get(r.thread.id)?.length || 0) > 0 ||
        waitingUnknown(r, EMPTY);
    return (
      (!project || r.thread.cwd === project) &&
      (!search ||
        `${threadTitle(r.thread)} ${r.thread.cwd} ${progress(r).text}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (filter === "all" ||
        (filter === "running" && state === "执行中") ||
        (filter === "pending" && pending) ||
        (filter === "ended" && ["本轮已结束", "本轮已中断"].includes(state)) ||
        (filter === "failed" &&
          (state.includes("失败") || state.includes("异常"))) ||
        (filter === "stale" &&
          (!connected ||
            !!r.error ||
            !r.confirmedAt ||
            tick - r.confirmedAt * 1000 > 45000)))
    );
  });
  const recent = useRecentTasks(
    matching,
    JSON.stringify([project, search, filter, recentLimit]),
    recentLimit,
    !!data?.initialized,
  );
  const filtered = (
    view === "pinned"
      ? matching.filter((r) => pins.includes(r.thread.id))
      : recent.ids
          .map((id) => records.get(id))
          .filter((r): r is Observation => !!r)
  ).sort(
    (a, b) =>
      Number(pins.includes(b.thread.id)) - Number(pins.includes(a.thread.id)),
  );
  const outside = requests.filter((p) =>
    view === "attention"
      ? !!project &&
        records.get(rootId(p.params.threadId, records))?.thread.cwd !== project
      : !filtered.some(
          (r) => r.thread.id === rootId(p.params.threadId, records),
        ),
  ).length;
  const rowHeight = narrow ? 124 : viewport.width <= 1150 && selected ? 96 : 64,
    start = Math.max(0, Math.floor(scroll / rowHeight) - 8),
    end = Math.min(
      filtered.length,
      start + Math.ceil(viewport.height / rowHeight) + 16,
    ),
    virtual = filtered.length > 100;
  const unread = data?.changes.filter((c) => c.at > seen) || [];
  useEffect(() => {
    const update = () => setReceipts(pendingOperations());
    window.addEventListener("storage", update);
    window.addEventListener("samaya:receipts", update);
    const resize = () =>
      setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", resize);
    const t = setInterval(() => setTick(Date.now()), 5000);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("samaya:receipts", update);
      window.removeEventListener("resize", resize);
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    sessionStorage.setItem(
      "samaya.monitor.view",
      JSON.stringify({ search, project, filter, scroll, selected }),
    );
  }, [search, project, filter, scroll, selected]);
  useEffect(() => {
    localStorage.setItem("samaya.pins", JSON.stringify(pins));
  }, [pins]);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scroll;
  }, [view, data?.initialized, scroll]);
  const open = useCallback((id: string) => {
    setSelected(id);
    setTab("work");
    const u = new URL(location.href);
    u.searchParams.set("thread", id);
    history.replaceState(null, "", u);
  }, []);
  const closeDetail = () => {
    setSelected("");
    setFocus(false);
    const u = new URL(location.href);
    u.searchParams.delete("thread");
    history.replaceState(null, "", u);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-task-id="${CSS.escape(selected)}"] .task-open`,
        )
        ?.focus(),
    );
  };
  const decide = useCallback((id: string) => {
    setRequestTask(id);
    setRequestKey(null);
  }, []);
  const pin = useCallback(
    (id: string) =>
      setPins((old) =>
        old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
      ),
    [],
  );
  const navigate = (v: View) => {
    setView(v);
    setNav(false);
    history.replaceState(
      null,
      "",
      v === "records" ? "/sessions" : v === "settings" ? "/settings" : "/",
    );
  };
  async function run(action: string, body: Record<string, unknown>) {
    const scope = String(body.requestKey || body.threadId || "create");
    if (submitting.current.has(scope)) return null;
    submitting.current.add(scope);
    setBusy(scope);
    setError("");
    try {
      const result = await operation(action, body);
      if (action === "interrupt")
        setStopRequested((old) => ({
          ...old,
          [String(body.threadId)]: String(body.turnId),
        }));
      setNotice(
        action === "respond"
          ? result.result?.sent
            ? "答复已发送，等待 Codex 确认；是否继续执行以新的活动为准。"
            : "答复已确认；是否继续执行以新的活动为准。"
          : action === "interrupt"
            ? "停止请求已提交；等待轮次中断确认。"
            : action === "terminate"
              ? "终止请求已提交；请根据后台命令列表核对结果。"
              : "操作已确认。",
      );
      await refresh();
      return result;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      submitting.current.delete(scope);
      setBusy("");
    }
  }
  async function create() {
    const created = await run("create", { cwd, name: newName });
    if (!created) return;
    const id = String(created.result?.threadId || "");
    if (!id) return;
    recent.include(id);
    open(id);
    setDialog(null);
    setView("overview");
    if (created.result?.warning) {
      setNotice(String(created.result.warning));
      sessionStorage.setItem("samaya.draft." + id, goal);
      return;
    }
    const sent = await run("send", {
      threadId: id,
      text: goal,
      expectedTurnId: null,
    });
    if (!sent) {
      sessionStorage.setItem("samaya.draft." + id, goal);
      setNotice(
        "任务已创建，但执行提交未确认。目标已保存为该任务的草稿；请核查回执，不要重新创建。",
      );
    } else {
      setGoal("");
      setNewName("");
    }
  }
  const activeRequest = requestKey
    ? requests.find((p) => p.key === requestKey)
    : undefined;
  const taskRequests = requestTask
    ? requestsByRoot.get(requestTask) ||
      requests.filter((p) => p.params.threadId === requestTask)
    : EMPTY;
  return (
    <div
      className={`monitor-shell ${focus ? "focus-mode" : ""} ${selected && ["overview", "pinned", "attention"].includes(view) ? "task-is-open" : ""}`}
    >
      <a className="skip-link" href="#monitor-main">
        跳到任务总览
      </a>
      <aside className="monitor-nav">
        <div className="monitor-brand">
          Samaya <span>工作台</span>
        </div>
        <NavButtons
          view={view}
          navigate={navigate}
          count={waitingCount}
          unknown={unknownCount}
        />
        <div className="nav-projects">
          <span className="eyebrow">项目范围</span>
          <button
            className={!project ? "selected" : ""}
            onClick={() => {
              setProject("");
              setScroll(0);
            }}
          >
            所有项目
          </button>
          {projects.map((p) => (
            <button
              key={p}
              title={p}
              className={project === p ? "selected" : ""}
              onClick={() => {
                setProject(p);
                setScroll(0);
              }}
            >
              {p.split("/").filter(Boolean).at(-1)}
            </button>
          ))}
        </div>
        <div className="nav-bottom">
          <button onClick={() => navigate("records")}>记录管理</button>
          <button onClick={() => navigate("settings")}>设置与连接</button>
          <ThemeSelect />
          <small>{connected ? "已连接 Codex" : "连接待恢复"}</small>
        </div>
      </aside>
      <main id="monitor-main" className="monitor-main">
        <header className="monitor-toolbar">
          <button className="mobile-nav-button" onClick={() => setNav(true)}>
            导航
          </button>
          <h1>
            {
              {
                overview: "最近任务",
                pinned: "置顶任务",
                attention: "待我处理",
                records: "记录管理",
                settings: "设置与连接",
                changes: "最近变化",
              }[view]
            }
          </h1>
          <div className="global-actions">
            <button
              className={waitingCount || unknownCount ? "request-action" : ""}
              onClick={() => navigate("attention")}
            >
              待处理 {waitingCount} 个任务
              {unknownCount ? ` · ${unknownCount} 待核对` : ""}
            </button>
            <button
              className="exception-button"
              onClick={() => {
                navigate("overview");
                setFilter("failed");
                setProject("");
                setScroll(0);
              }}
            >
              异常{" "}
              {ordered.filter((r) => /失败|异常/.test(execution(r))).length}
            </button>
            <button
              className="changes-button"
              onClick={() => navigate("changes")}
            >
              变化 {unread.length || ""}
            </button>
            <button
              className="primary"
              disabled={!connected}
              onClick={() => {
                setCwd(project || projects[0] || "");
                setDialog("create");
              }}
            >
              新建任务
            </button>
          </div>
        </header>
        {(!connected || syncError || data?.catalogError) && (
          <div className="monitor-banner" role="status">
            {syncError ||
              data?.catalogError ||
              "连接已断开或正在恢复。保留最后确认状态，不代表执行已停止。"}
            <button onClick={() => void refresh()}>重新核对</button>
          </div>
        )}
        {(error || notice || receipts.length > 0) && (
          <div className="monitor-feedback" aria-live="polite">
            {error && <span role="alert">{error}</span>}
            {notice && <span>{notice}</span>}
            {receipts.length > 0 && (
              <button onClick={() => setDialog("receipts")}>
                {receipts.length} 项操作待核查
              </button>
            )}
            <button
              className="quiet"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              收起提示
            </button>
          </div>
        )}
        {(view === "overview" || view === "pinned" || view === "attention") && (
          <>
            <div className="monitor-filters">
              <label className="search-label">
                <span className="sr-only">搜索任务与进展</span>
                <input
                  type="search"
                  placeholder="搜索任务与进展"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setScroll(0);
                    if (scrollRef.current) scrollRef.current.scrollTop = 0;
                  }}
                />
              </label>
              <label>
                <span className="sr-only">项目筛选</span>
                <select
                  value={project}
                  onChange={(e) => {
                    setProject(e.target.value);
                    setScroll(0);
                  }}
                >
                  <option value="">所有项目</option>
                  {projects.map((p) => (
                    <option key={p} value={p}>
                      {p.split("/").filter(Boolean).at(-1)} · {p}
                    </option>
                  ))}
                </select>
              </label>
              {view !== "attention" && (
                <label>
                  <span className="sr-only">执行情况筛选</span>
                  <select
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setScroll(0);
                    }}
                  >
                    <option value="all">全部执行情况</option>
                    <option value="running">执行中</option>
                    <option value="pending">待我处理</option>
                    <option value="ended">本轮已结束 / 中断</option>
                    <option value="failed">失败 / 异常</option>
                    <option value="stale">状态待确认</option>
                  </select>
                </label>
              )}
              {view === "overview" && (
                <label>
                  <span className="sr-only">最近任务数量</span>
                  <select
                    aria-label="最近任务数量"
                    value={recentLimit}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setRecentLimit(n);
                      localStorage.setItem("samaya.recent.limit", String(n));
                      setScroll(0);
                    }}
                  >
                    <option value={20}>最近 20 个任务</option>
                    <option value={10}>最近 10 个任务</option>
                  </select>
                </label>
              )}
            </div>
            <div className="recent-scope" role="status">
              <span>
                {view === "attention"
                  ? `${requests.length} 项未解决请求`
                  : view === "pinned"
                    ? `${filtered.length} 个置顶任务`
                    : `最近 ${filtered.length} 个主任务`}
              </span>
              {outside > 0 && (
                <button
                  onClick={() => {
                    setProject("");
                    navigate("attention");
                  }}
                >
                  范围外 {outside} 项请求 · 查看请求
                </button>
              )}
              {view === "overview" && recent.changed && (
                <button onClick={recent.update}>更新最近任务</button>
              )}
            </div>
            <div
              className={`monitor-workspace ${selected ? "has-detail" : ""}`}
            >
              <div
                className="monitor-list"
                ref={scrollRef}
                onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
              >
                {!data?.initialized ? (
                  <div className="empty-state">
                    {syncError || data?.catalogError
                      ? "无法加载任务。请重新核对连接。"
                      : "正在取得全局会话状态…"}
                  </div>
                ) : view === "attention" ? (
                  <div className="attention-list">
                    <p>
                      未解决请求与未读变化分别记录。收起或阅读不会提交决定。
                    </p>
                    {outside > 0 && (
                      <button onClick={() => setProject("")}>
                        查看范围外的 {outside} 项请求
                      </button>
                    )}
                    {requests
                      .filter(
                        (p) =>
                          !project ||
                          records.get(rootId(p.params.threadId, records))
                            ?.thread.cwd === project,
                      )
                      .map((p) => (
                        <section className="decision-row" key={p.key}>
                          <strong>
                            {records.has(p.params.threadId)
                              ? threadTitle(
                                  records.get(p.params.threadId)!.thread,
                                )
                              : p.params.threadId}
                          </strong>
                          <p>
                            {p.params.reason ||
                              p.params.message ||
                              p.params.questions?.[0]?.question ||
                              "Codex 请求你的决定；展开核对具体范围。"}
                          </p>
                          <small>
                            {requestLabel(p)} · 来源{" "}
                            {records.get(p.params.threadId)?.thread
                              .parentThreadId
                              ? "子任务"
                              : "当前任务"}{" "}
                            · 阻塞范围以请求内容为准
                          </small>
                          <button
                            className="request-action"
                            onClick={() => {
                              setRequestTask(
                                rootId(p.params.threadId, records),
                              );
                              setRequestKey(p.key);
                            }}
                          >
                            {p.responseState === "uncertain"
                              ? "结果待确认"
                              : requestLabel(p)}
                          </button>
                        </section>
                      ))}
                    {ordered
                      .filter((r) => unknownRoots.has(r.thread.id))
                      .map((r) => (
                        <section key={r.thread.id} className="decision-row">
                          <strong>{threadTitle(r.thread)}</strong>
                          <p>
                            Codex
                            表示正在等待输入，但本次连接未获得请求内容。不能据此显示为零项待处理。
                          </p>
                          <button onClick={() => open(r.thread.id)}>
                            核对任务
                          </button>
                        </section>
                      ))}
                    {!waitingCount && !unknownCount && (
                      <p className="empty-state">
                        当前连接未观察到未解决请求。断连前请求的可恢复性以 Codex
                        提供的信息为准。
                      </p>
                    )}
                  </div>
                ) : !filtered.length ? (
                  <div className="empty-state">
                    {records.size
                      ? "没有符合筛选条件的任务。"
                      : "暂无可见会话。新建任务后在这里观察进展。"}
                  </div>
                ) : (
                  <div
                    role="list"
                    aria-label="任务列表"
                    style={
                      virtual
                        ? {
                            paddingTop: start * rowHeight,
                            paddingBottom: (filtered.length - end) * rowHeight,
                          }
                        : undefined
                    }
                  >
                    {(virtual ? filtered.slice(start, end) : filtered).map(
                      (r) => (
                        <TaskRow
                          key={r.thread.id}
                          record={r}
                          requests={requestsByRoot.get(r.thread.id) || EMPTY}
                          childrenCount={childMap.get(r.thread.id)?.length || 0}
                          activeChildren={
                            childMap
                              .get(r.thread.id)
                              ?.filter((c) => execution(c) === "执行中")
                              .length || 0
                          }
                          selected={selected === r.thread.id}
                          stale={
                            !connected ||
                            !r.confirmedAt ||
                            tick - r.confirmedAt * 1000 > 45000
                          }
                          pinned={pins.includes(r.thread.id)}
                          unknownRequests={unknownRoots.has(r.thread.id)}
                          stopping={
                            stopRequested[r.thread.id] === r.turn?.id &&
                            r.turn?.status === "inProgress"
                          }
                          open={open}
                          decide={decide}
                          pin={pin}
                        />
                      ),
                    )}
                  </div>
                )}
              </div>
              {selected && (
                <aside className="task-detail" aria-label="任务详情">
                  <div className="detail-top">
                    <button onClick={closeDetail}>返回列表</button>
                    <button onClick={() => setFocus(!focus)}>
                      {focus ? "退出专注" : "专注阅读"}
                    </button>
                  </div>
                  {selectedRecord ? (
                    <>
                      <h2>{threadTitle(selectedRecord.thread)}</h2>
                      <p className="detail-status">
                        {stopRequested[selected] === selectedRecord.turn?.id &&
                        selectedRecord.turn?.status === "inProgress"
                          ? "停止请求处理中"
                          : execution(selectedRecord)}{" "}
                        ·{" "}
                        {connected && !selectedRecord.error
                          ? "已同步"
                          : "状态待确认"}
                      </p>
                      <div className="detail-path">
                        <code>{selectedRecord.thread.cwd}</code>
                        <button
                          disabled={!connected || !!busy}
                          onClick={() => {
                            setCwd(selectedRecord.thread.cwd);
                            setDialog("workspace");
                          }}
                        >
                          切换工作区
                        </button>
                      </div>
                      {view === "overview" &&
                        !filtered.some((r) => r.thread.id === selected) && (
                          <small>此任务在当前最近范围外，详情仍保留。</small>
                        )}
                      <nav className="detail-tabs" aria-label="任务内容">
                        {[
                          ["work", "当前工作"],
                          ["result", "改动与结果"],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            aria-current={tab === key ? "page" : undefined}
                            onClick={() => setTab(key)}
                          >
                            {label}
                          </button>
                        ))}
                      </nav>
                      <div
                        className="detail-scroll"
                        key={selected}
                        hidden={false}
                      >
                        <div hidden={tab !== "work"}>
                          <h3>当前进展</h3>
                          <p>{progress(selectedRecord).text}</p>
                          <small>
                            {progress(selectedRecord).source} · 有效进展观察于{" "}
                            {clock(selectedRecord.progressAt)} · 状态核对于{" "}
                            {clock(selectedRecord.confirmedAt)}
                          </small>
                          {selectedRecord.error && (
                            <p role="status">{selectedRecord.error}</p>
                          )}
                          {selectedRecord.progressAt &&
                            tick - selectedRecord.progressAt * 1000 > 300000 &&
                            execution(selectedRecord) === "执行中" && (
                              <p>较长时间未报告新进展；尚不能据此判断失败。</p>
                            )}
                          {recentFact(selectedRecord) && (
                            <p className="confirmed-fact">
                              已确认：{recentFact(selectedRecord)}
                            </p>
                          )}
                          {(requestsByRoot.get(rootId(selected, records))
                            ?.length ||
                            waitingUnknown(selectedRecord, EMPTY)) && (
                            <button
                              className="request-action"
                              onClick={() => decide(rootId(selected, records))}
                            >
                              处理待决策事项 ·{" "}
                              {requestsByRoot.get(rootId(selected, records))
                                ?.length || "内容待恢复"}
                            </button>
                          )}
                          <details className="related-activities">
                            <summary>
                              关联活动 · {childMap.get(selected)?.length || 0}{" "}
                              个子任务 · {selectedRecord.terminals.length}{" "}
                              个后台命令
                            </summary>
                            {(childMap.get(selected) || []).map((c) => (
                              <button
                                className="child-link"
                                key={c.thread.id}
                                onClick={() => open(c.thread.id)}
                              >
                                {threadTitle(c.thread)} · {execution(c)}
                              </button>
                            ))}
                            {!childMap.get(selected)?.length &&
                              !selectedRecord.terminals.length && (
                                <p>未观察到子任务或后台命令。</p>
                              )}
                            {selectedRecord.thread.parentThreadId && (
                              <button
                                onClick={() =>
                                  open(selectedRecord.thread.parentThreadId!)
                                }
                              >
                                打开父任务
                              </button>
                            )}
                            {selectedRecord.terminals.map((t) => (
                              <section
                                className="terminal-entry"
                                key={t.processId}
                              >
                                <strong>后台命令运行中</strong>
                                <pre>{t.command}</pre>
                                {t.cwd && <code>启动目录：{t.cwd}</code>}
                                <p>轮次结束不代表此进程结束。</p>
                                <details>
                                  <summary>近期输出</summary>
                                  <pre>
                                    {selectedRecord.turn?.items.find(
                                      (i) => i.id === t.itemId,
                                    )?.aggregatedOutput ||
                                      "当前汇总没有可恢复的输出。可在对应轮次的执行记录中核对；没有输出不代表进程已结束。"}
                                  </pre>
                                </details>
                                <button
                                  disabled={!connected || !!busy}
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `终止指定后台命令？\n${t.command}\n只处理进程 ${t.processId}`,
                                      )
                                    )
                                      void run("terminate", {
                                        threadId: selected,
                                        processId: t.processId,
                                      });
                                  }}
                                >
                                  终止此命令
                                </button>
                              </section>
                            ))}
                          </details>
                        </div>
                        <ExecutionHistory
                          key={selected}
                          tid={selected}
                          turnId={selectedRecord.turn?.id}
                          turnStatus={selectedRecord.turn?.status}
                          tab={tab}
                        />
                        <details>
                          <summary>会话摘要与身份</summary>
                          <p>
                            {selectedRecord.thread.preview ||
                              "原生会话未提供摘要"}
                          </p>
                          <code>{selected}</code>
                        </details>
                      </div>
                      <div className="detail-footer">
                        <TaskComposer
                          key={selected}
                          record={selectedRecord}
                          connected={!!connected}
                          busy={
                            busy === selected ||
                            (stopRequested[selected] ===
                              selectedRecord.turn?.id &&
                              selectedRecord.turn?.status === "inProgress")
                          }
                          run={run}
                        />
                        <button
                          className="stop-button"
                          disabled={
                            !connected ||
                            !!busy ||
                            selectedRecord.turn?.status !== "inProgress" ||
                            stopRequested[selected] === selectedRecord.turn?.id
                          }
                          onClick={() => setDialog("stop")}
                        >
                          停止本轮
                        </button>
                      </div>
                    </>
                  ) : (
                    <p>
                      此任务不在当前汇总中，可能已归档或删除。返回列表后可在记录管理中核对。
                    </p>
                  )}
                </aside>
              )}
            </div>
          </>
        )}
        {view === "records" && (
          <Records
            connected={!!connected}
            open={(id) => {
              navigate("overview");
              open(id);
            }}
          />
        )}
        {view === "settings" && <SettingsView logout={logout} />}
        {view === "changes" && (
          <section className="monitor-page">
            <h2>自上次查看后的变化</h2>
            <p>
              记录新的待处理请求、轮次结束和同步异常；普通工具输出不作为提醒。最多保留当前服务进程中的
              100 项。
            </p>
            <button
              onClick={() => {
                const now = Date.now() / 1000;
                setSeen(now);
                localStorage.setItem("samaya.changes.seen", String(now));
              }}
            >
              标为已读
            </button>
            {(data?.changes || [])
              .slice()
              .reverse()
              .map((c) => (
                <button
                  className="change-row"
                  key={c.id}
                  onClick={() => {
                    navigate("overview");
                    open(c.threadId);
                  }}
                >
                  {c.at > seen ? "未读 · " : ""}
                  {records.has(c.threadId)
                    ? threadTitle(records.get(c.threadId)!.thread)
                    : c.threadId}{" "}
                  ·{" "}
                  {(
                    {
                      request: "新增待处理请求",
                      connection: "同步异常",
                      completed: "本轮结束",
                      failed: "本轮失败",
                      interrupted: "本轮中断",
                    } as Record<string, string>
                  )[c.kind] || c.kind}{" "}
                  · {clock(c.at)}
                </button>
              ))}
          </section>
        )}
      </main>
      {nav && (
        <Modal title="导航与全局范围" close={() => setNav(false)}>
          <NavButtons
            view={view}
            navigate={navigate}
            count={waitingCount}
            unknown={unknownCount}
          />
          <button onClick={() => navigate("records")}>记录管理</button>
          <button onClick={() => navigate("settings")}>设置与连接</button>
          <ThemeSelect />
        </Modal>
      )}
      {requestTask && (
        <Modal
          title="处理请求"
          close={() => {
            setRequestTask(null);
            setRequestKey(null);
          }}
        >
          <p>
            {records.has(requestTask)
              ? threadTitle(records.get(requestTask)!.thread)
              : requestTask}
          </p>
          <p>收起不会拒绝或批准。提交确认与任务继续推进分别显示。</p>
          {taskRequests.map((p) => (
            <button
              key={p.key}
              aria-pressed={p.key === requestKey}
              onClick={() => setRequestKey(p.key)}
            >
              {requestLabel(p)} ·{" "}
              {p.params.questions?.[0]?.header ||
                p.params.serverName ||
                p.params.turnId?.slice(0, 8) ||
                "当前请求"}
            </button>
          ))}
          {!activeRequest && requestKey ? (
            <p role="status">
              请求已处理、失效或连接已变化。请核对最新任务状态，不能重复授权。
            </p>
          ) : activeRequest ? (
            <>
              <p>
                请求来源：
                {records.has(activeRequest.params.threadId)
                  ? threadTitle(
                      records.get(activeRequest.params.threadId)!.thread,
                    )
                  : "未恢复身份的任务"}{" "}
                ·{" "}
                {records.get(activeRequest.params.threadId)?.thread
                  .parentThreadId
                  ? "子任务"
                  : "当前任务"}
              </p>
              <details>
                <summary>请求身份</summary>
                <code>
                  {activeRequest.params.threadId} /{" "}
                  {activeRequest.params.turnId || "无轮次标识"}
                </code>
              </details>
              {activeRequest.responseState && (
                <p role="status">
                  {activeRequest.responseState === "uncertain"
                    ? "答复结果待确认；请核对回执。"
                    : "答复已发送；等待服务端消除请求。"}
                </p>
              )}
              <RequestForm
                key={activeRequest.key}
                request={activeRequest}
                busy={
                  !connected ||
                  busy === activeRequest.key ||
                  !!activeRequest.responseState
                }
                respond={(response) =>
                  void run("respond", {
                    threadId: activeRequest.params.threadId,
                    requestKey: activeRequest.key,
                    response,
                  })
                }
              />
            </>
          ) : taskRequests.length ? (
            <p>选择上方请求，核对范围后提交决定。</p>
          ) : (
            <p>
              当前连接未获得可回答的请求内容。请核对 Codex
              状态；不会构造未知请求的授权按钮。
            </p>
          )}
        </Modal>
      )}
      {dialog === "create" && (
        <Modal title="新建任务" close={() => setDialog(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <DirectoryPicker value={cwd} onChange={setCwd} />
            <label>
              工作要求
              <textarea
                rows={5}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                required
                placeholder="说明目标、约束和需要交付的结果"
              />
            </label>
            <details>
              <summary>可选设置</summary>
              <label>
                任务名称
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <p>
                模型沿用 Codex
                默认配置。工作目录写入沙箱，审批按请求交由你处理。
              </p>
            </details>
            <button
              className="primary"
              disabled={!!busy || !connected || !goal.trim()}
            >
              {" "}
              {busy ? "正在派发…" : "派发任务"}
            </button>
          </form>
        </Modal>
      )}
      {dialog === "workspace" && selectedRecord && (
        <Modal title="切换工作区" close={() => setDialog(null)}>
          <p>
            保留本会话历史。下一轮重新加载项目指令；既有后台进程保留启动时的目录。
          </p>
          <DirectoryPicker value={cwd} onChange={setCwd} />
          {selectedRecord.turn?.status === "inProgress" ? (
            <p>请等本轮结束，或返回任务后明确停止本轮再切换。</p>
          ) : (
            <button
              className="primary"
              disabled={!!busy || !connected}
              onClick={async () => {
                const r = await run("workspace", {
                  threadId: selected,
                  cwd,
                  expectedCwd: selectedRecord.thread.cwd,
                });
                if (r) {
                  setDialog(null);
                  setNotice(
                    `服务端已确认目录：${r.result?.cwd}。项目指令在下一轮重载。`,
                  );
                }
              }}
            >
              切换工作区
            </button>
          )}
        </Modal>
      )}
      {dialog === "stop" && selectedRecord && (
        <Modal title="停止当前执行轮次" close={() => setDialog(null)}>
          <p>{threadTitle(selectedRecord.thread)}</p>
          <p>
            只中断此任务本轮，不回滚文件，不会停止其他会话。后台命令须分别终止。
          </p>
          <code>{selectedRecord.turn?.id}</code>
          <button
            className="primary"
            disabled={!!busy || !connected}
            onClick={async () => {
              if (
                await run("interrupt", {
                  threadId: selected,
                  turnId: selectedRecord.turn?.id,
                })
              )
                setDialog(null);
            }}
          >
            停止本轮
          </button>
          <button onClick={() => setDialog(null)}>取消</button>
        </Modal>
      )}
      {dialog === "receipts" && (
        <Modal title="核查操作回执" close={() => setDialog(null)}>
          {receipts.map((r) => (
            <section key={r.operationId}>
              <p>
                {r.action} · {r.threadId || "新建任务"}
              </p>
              <code>{r.operationId}</code>
              <button
                onClick={async () => {
                  try {
                    const result = await api<Receipt>(
                      "/operations/" + r.operationId,
                    );
                    setNotice(
                      `回执：${result.state} ${JSON.stringify(result.result || {})}`,
                    );
                    if (["succeeded", "failed"].includes(result.state))
                      clearOperation(r.operationId);
                    await refresh();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                查询回执
              </button>
              <button
                onClick={() => {
                  if (
                    confirm(
                      "请先核对任务是否已执行。清除此本地提醒不会撤销或重发任务。确认已人工核查？",
                    )
                  )
                    clearOperation(r.operationId);
                }}
              >
                已人工核查
              </button>
            </section>
          ))}
        </Modal>
      )}
    </div>
  );
}
function NavButtons({
  view,
  navigate,
  count,
  unknown,
}: {
  view: View;
  navigate: (v: View) => void;
  count: number;
  unknown: number;
}) {
  return (
    <nav className="monitor-nav-items" aria-label="全局导航">
      <button
        aria-current={view === "overview" ? "page" : undefined}
        onClick={() => navigate("overview")}
      >
        最近任务
      </button>
      <button
        aria-current={view === "pinned" ? "page" : undefined}
        onClick={() => navigate("pinned")}
      >
        置顶
      </button>
      <button
        aria-current={view === "attention" ? "page" : undefined}
        onClick={() => navigate("attention")}
      >
        待我处理 · {count}
        {unknown ? " · 待核对" : ""}
      </button>
    </nav>
  );
}
function TaskComposer({
  record,
  connected,
  busy,
  run,
}: {
  record: Observation;
  connected: boolean;
  busy: boolean;
  run: (a: string, b: Record<string, unknown>) => Promise<Receipt | null>;
}) {
  const id = record.thread.id,
    [draft, setDraft] = useState(
      () => sessionStorage.getItem("samaya.draft." + id) || "",
    );
  const active = record.turn?.status === "inProgress";
  useEffect(() => {
    sessionStorage.setItem("samaya.draft." + id, draft);
  }, [id, draft]);
  return (
    <form
      className="task-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          !draft.trim() ||
          !connected ||
          busy ||
          record.thread.canAcceptDirectInput === false ||
          record.error
        )
          return;
        const r = await run(active ? "steer" : "send", {
          threadId: id,
          text: draft,
          expectedTurnId: record.turn?.id || null,
        });
        if (r) setDraft("");
      }}
    >
      <label>
        补充当前任务
        <textarea
          aria-label="补充当前任务"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="输入补充要求；回车换行"
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              (e.ctrlKey || e.metaKey) &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </label>
      <small>
        Ctrl / ⌘ + Enter 提交 · 草稿保存在此标签页。
        {active
          ? "可追加到当前轮次；没有服务端排队。"
          : "发送将开始新一轮，不保证恢复已退出的进程。"}
      </small>
      <button
        className="primary"
        disabled={
          !connected ||
          busy ||
          !draft.trim() ||
          record.thread.canAcceptDirectInput === false ||
          !!record.error
        }
      >
        {busy ? "提交中…" : active ? "追加到当前轮次" : "发送"}
      </button>
    </form>
  );
}
function SettingsView({ logout }: { logout: () => void }) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void api<Status>("/status")
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <section className="monitor-page">
      <h2>外观与连接</h2>
      <ThemeSelect />
      <p>苍渊 · 白垣，给灰色一点色相。</p>
      {error && <p role="alert">{error}</p>}
      <dl>
        <dt>连接状态</dt>
        <dd>{status?.connection || "正在核对"}</dd>
        <dt>SDK</dt>
        <dd>{status?.sdkVersion || "未知"}</dd>
        <dt>实际运行时</dt>
        <dd>{status?.runtime.userAgent || "未获得"}</dd>
        <dt>允许访问目录</dt>
        <dd>{status?.roots.join("、")}</dd>
      </dl>
      <details>
        <summary>连接详情与数据边界</summary>
        <code>{status?.socket}</code>
        <p>
          Codex 管理会话和执行。Samaya
          只保存操作回执、事件恢复信息与界面偏好。监控汇总保存在内存中；浏览器筛选不改变监控范围。
        </p>
        <p>
          重连无法保证重建此前未收到的授权表单；会保留等待标识，不自动代答。
        </p>
      </details>
      <button
        onClick={async () => {
          try {
            await api("/logout", { method: "POST" });
            logout();
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        退出登录
      </button>
    </section>
  );
}
function Records({
  connected,
  open,
}: {
  connected: boolean;
  open: (id: string) => void;
}) {
  const [now] = useState(() => Date.now());
  const [rows, setRows] = useState<Thread[]>([]),
    [archived, setArchived] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [older, setOlder] = useState(0),
    [preview, setPreview] = useState<
      { id: string; value?: Preview; error?: string }[] | null
    >(null),
    [action, setAction] = useState("archive"),
    [results, setResults] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async (more?: string) => {
      try {
        const r = await api<{ data: Thread[]; nextCursor: string | null }>(
          `/threads?archived=${archived}${more ? "&cursor=" + encodeURIComponent(more) : ""}`,
        );
        setRows((old) => (more ? [...old, ...r.data] : r.data));
        setCursor(r.nextCursor);
        setError("");
      } catch (e) {
        setError(String(e));
      }
    },
    [archived],
  );
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function prepare(a: string) {
    setAction(a);
    setBusy(true);
    const values = [];
    for (const id of selected) {
      try {
        values.push({
          id,
          value: await api<Preview>(
            `/threads/${encodeURIComponent(id)}/cleanup-preview`,
          ),
        });
      } catch (e) {
        values.push({ id, error: String(e) });
      }
    }
    setPreview(values);
    setBusy(false);
  }
  return (
    <section className="monitor-page">
      <p>归档保留历史；删除不可恢复。执行中或仍有后台活动时，清理会被阻止。</p>
      <div className="actions">
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setSelected([]);
            }}
          />
          已归档
        </label>
        <input
          aria-label="搜索记录"
          placeholder="搜索已加载记录"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          最近未活动
          <select
            value={older}
            onChange={(e) => setOlder(Number(e.target.value))}
          >
            <option value={0}>不限</option>
            <option value={7}>7 天</option>
            <option value={30}>30 天</option>
            <option value={90}>90 天</option>
          </select>
        </label>
      </div>
      <p>
        时间只用于筛选，不表示废弃。已加载 {rows.length} 条记录，已选{" "}
        {selected.length} 条。
      </p>
      <div className="actions">
        <button
          disabled={!connected || busy || !selected.length}
          onClick={() => void prepare(archived ? "unarchive" : "archive")}
        >
          {archived ? "恢复归档" : "归档"}
        </button>
        <button
          disabled={!connected || busy || !selected.length}
          onClick={() => void prepare("delete")}
        >
          删除
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {results.map((text, i) => (
        <p key={i}>{text}</p>
      ))}
      <div className="records-table">
        <table>
          <thead>
            <tr>
              <th>选择</th>
              <th>任务 / 目录</th>
              <th>最近活动</th>
              <th>原始状态</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter(
                (t) =>
                  (!search || `${threadTitle(t)} ${t.cwd}`.includes(search)) &&
                  (!older || now / 1000 - t.updatedAt > older * 86400),
              )
              .map((t) => (
                <tr key={t.id}>
                  <td>
                    <input
                      aria-label={`选择 ${threadTitle(t)}`}
                      type="checkbox"
                      checked={selected.includes(t.id)}
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked
                            ? [...old, t.id]
                            : old.filter((id) => id !== t.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button className="quiet" onClick={() => open(t.id)}>
                      {threadTitle(t)}
                    </button>
                    <small>{t.cwd}</small>
                  </td>
                  <td>
                    {new Date(t.updatedAt * 1000).toLocaleDateString("zh-CN")}
                  </td>
                  <td>{connected ? t.status.type : "状态待确认"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button onClick={() => void load(cursor)}>加载更多记录</button>
      )}
      {preview && (
        <Modal
          title={
            action === "delete"
              ? "永久删除确认"
              : action === "archive"
                ? "归档确认"
                : "恢复归档确认"
          }
          close={() => {
            if (!busy) setPreview(null);
          }}
        >
          <p>
            {action === "delete"
              ? "永久删除以下会话及列出的子会话，记录无法恢复。"
              : "仅处理列出的目标。不会自动中断任何执行。"}
          </p>
          {preview.map((p) => (
            <section key={p.id}>
              <code>{p.id}</code>
              {p.error ? (
                <p role="alert">无法核对影响范围：{p.error}</p>
              ) : (
                p.value?.scope.map((t) => (
                  <p key={t.id}>
                    {t.name || t.id}
                    <br />
                    <code>{t.cwd}</code> · {t.status.type}
                  </p>
                ))
              )}
            </section>
          ))}
          <button
            disabled={busy || !connected}
            className="primary"
            onClick={async () => {
              setBusy(true);
              const next = [];
              for (const p of preview) {
                if (p.error || !p.value) {
                  next.push(`${p.id}：未执行，影响范围未确认`);
                  continue;
                }
                try {
                  const r = await operation(action, {
                    threadId: p.id,
                    digest: p.value.digest,
                  });
                  const items = r?.result?.items as
                    { id: string; state: string }[] | undefined;
                  next.push(
                    `${p.id}：${!r ? "失败或结果待确认，请核查回执" : items?.some((i) => i.state !== "succeeded") ? "部分失败：" + items.map((i) => i.id + " " + i.state).join("；") : "已确认"}`,
                  );
                } catch (e) {
                  next.push(`${p.id}：${String(e)}`);
                }
              }
              setResults(next);
              setBusy(false);
              setPreview(null);
              setSelected([]);
              await load();
            }}
          >
            {busy
              ? "逐项处理中…"
              : "确认" +
                (action === "delete"
                  ? "删除"
                  : action === "archive"
                    ? "归档"
                    : "恢复")}
          </button>
          <button disabled={busy} onClick={() => setPreview(null)}>
            取消
          </button>
        </Modal>
      )}
    </section>
  );
}
