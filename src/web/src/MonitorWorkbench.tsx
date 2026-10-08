import {
  Search,
  PanelsTopLeft,
  Pin,
  Inbox,
  History,
  Settings as SettingsIcon,
} from "lucide-react";
import { OverviewScope } from "./OverviewScope";
import { shortProject } from "./project-navigation";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api, operation, pendingOperations, clearOperation } from "./api";
import { DirectoryPicker, Modal, RequestForm } from "./components";
import { ExecutionHistory } from "./ExecutionHistory";
import { GoalStatus } from "./GoalStatus";
import { SearchPalette } from "./SearchPalette";
import { ReadingSurface } from "./ReadingSurface";
import { UsageView } from "./UsageView";
import { ThemeSelect } from "./ThemeSelect";
import { useMonitor } from "./useMonitor";
import { TaskOverview } from "./TaskOverview";
import { useRecentTasks } from "./useRecentTasks";
import {
  clock,
  execution,
  progress,
  projectName,
  requestLabel,
  rootId,
  threadTitle,
  waitingUnknown,
} from "./monitor";
import type { Observation } from "./monitor";
import type { Pending, Preview, Receipt, Status, Thread } from "./types";
import "./monitor.css";
import "./workspace-v5.css";
import "./usage.css";
import { ComposerInput } from "./ComposerInput";
import { CommandDialog } from "./CommandDialog";
import { ModelSelector } from "./ModelSelector";
import type { InputReference, SlashCommand } from "./composer-model";
import { rowOffsets, visibleRange } from "./rowGeometry";

type View =
  | "pinned"
  | "overview"
  | "attention"
  | "records"
  | "settings"
  | "usage"
  | "changes";
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
  compact = false,
  summary = "",
}: {
  compact?: boolean;
  summary?: string;
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
  if (compact)
    return (
      <div
        className={`task-row compact-task ${summary ? "has-status" : ""} ${selected ? "is-selected" : ""}`}
        role="listitem"
        data-task-id={t.id}
      >
        <button
          className="task-open"
          aria-pressed={selected}
          title={threadTitle(t) + (summary ? " · " + summary : "")}
          onClick={() => open(t.id)}
        >
          <strong>
            {pinned ? "· " : ""}
            {threadTitle(t)}
          </strong>
          {summary && <small>{summary}</small>}
        </button>
        {(requests.length > 0 || unknown) && (
          <button
            className="compact-request quiet"
            aria-label={`${threadTitle(t)} · ${requests.length ? requestLabel(requests[0]) : "请求待恢复"}`}
            onClick={() => decide(t.id)}
          >
            !
          </button>
        )}
        <button
          className="compact-pin quiet"
          aria-label={`${pinned ? "取消置顶" : "置顶"} ${threadTitle(t)}`}
          onClick={() => pin(t.id)}
        >
          {pinned ? "−" : "+"}
        </button>
      </div>
    );
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
              ? ""
              : "正在核对"}
        </small>
        <time title="最近有效活动时间">{clock(record.progressAt)}</time>
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
  const {
    data,
    records,
    online,
    disconnected,
    error: syncError,
    refresh,
  } = useMonitor();
  const [view, setView] = useState<View>(() =>
    location.pathname.startsWith("/sessions")
      ? "records"
      : location.pathname.startsWith("/settings/usage")
        ? "usage"
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
    [focus, setFocus] = useState(false);
  const [taskTab, setTaskTab] = useState("work");
  const [readerVisit, setReaderVisit] = useState(0);
  const [allTasks, setAllTasks] = useState(false);
  const [opened, setOpened] = useState<string[]>([]);
  const [projectMenu, setProjectMenu] = useState(false);
  const [projectVisits, setProjectVisits] = useState<string[]>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("samaya.projectVisits") || "[]",
      );
      return Array.isArray(value)
        ? value.filter((p): p is string => typeof p === "string")
        : [];
    } catch {
      return [];
    }
  });
  const visitProject = useCallback((path: string) => {
    if (path)
      setProjectVisits((old) =>
        [path, ...old.filter((p) => p !== path)].slice(0, 30),
      );
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "samaya.projectVisits",
        JSON.stringify(projectVisits),
      );
    } catch {
      /* Navigation remains available without storage. */
    }
  }, [projectVisits]);
  const [taskNav, setTaskNav] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarScroll, setSidebarScroll] = useState(0);
  const workMode = !!selected && ["overview", "pinned"].includes(view);
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
      "create" | "workspace" | "context" | "stop" | "receipts" | "agents" | null
    >(null),
    [requestTask, setRequestTask] = useState<string | null>(null),
    [requestKey, setRequestKey] = useState<string | null>(null);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [feedbackThread, setFeedbackThread] = useState(""),
    [busy, setBusy] = useState(""),
    [cwd, setCwd] = useState(""),
    [goal, setGoal] = useState(""),
    [newName, setNewName] = useState("");
  const [newReferences, setNewReferences] = useState<InputReference[]>([]);
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
  useEffect(() => {
    if (!taskNav || viewport.width >= 1100) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.querySelector<HTMLElement>(".monitor-nav");
    const controls = () =>
      [
        ...(panel?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, select",
        ) || []),
      ].filter((e) => e.getClientRects().length);
    controls()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setTaskNav(false);
      }
      if (event.key === "Tab") {
        const list = controls(),
          first = list[0],
          last = list.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [taskNav, viewport.width]);
  const connected = online && data?.connection === "connected";
  const connectionInterrupted =
    disconnected || data?.connection === "disconnected";
  const connectionLabel = connected
    ? "已连接 Codex"
    : connectionInterrupted
      ? "连接待恢复"
      : "正在连接…";
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
  useEffect(() => {
    if (!data?.initialized || projectVisits.length || !ordered.length) return;
    // Seed once from observed activity; subsequent stream updates never reorder shortcuts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjectVisits(
      [
        ...new Set(
          [...ordered]
            .sort((a, b) => b.thread.updatedAt - a.thread.updatedAt)
            .map((r) => r.thread.cwd),
        ),
      ]
        .filter(Boolean)
        .slice(0, 30),
    );
  }, [data?.initialized, ordered, projectVisits.length]);
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
  const overviewMode = view === "overview" && !workMode && !allTasks;
  const matching = ordered.filter((r) => {
    const state = execution(r),
      pending =
        (requestsByRoot.get(r.thread.id)?.length || 0) > 0 ||
        waitingUnknown(r, EMPTY);
    return (
      (!project || r.thread.cwd === project) &&
      (overviewMode ||
        !search ||
        `${threadTitle(r.thread)} ${r.thread.cwd} ${progress(r).text}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (filter === "all" ||
        (filter === "running" &&
          (state === "执行中" ||
            r.terminals.length > 0 ||
            childMap
              .get(r.thread.id)
              ?.some((c) => execution(c) === "执行中"))) ||
        (filter === "pending" && pending) ||
        (filter === "ended" && ["本轮已结束", "本轮已中断"].includes(state)) ||
        (filter === "failed" &&
          (state.includes("失败") || state.includes("异常"))) ||
        (filter === "issues" &&
          (state.includes("失败") ||
            state.includes("异常") ||
            !connected ||
            !!r.error ||
            !r.confirmedAt ||
            tick - r.confirmedAt * 1000 > 45000)) ||
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
      : allTasks || filter === "running"
        ? matching
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
  const sidebarSummary = (r: Observation) => {
    const pending = requestsByRoot.get(r.thread.id) || EMPTY;
    const state = execution(r);
    const uncertain =
      !connected ||
      !!r.error ||
      !r.confirmedAt ||
      tick - r.confirmedAt * 1000 > 45000;
    if (uncertain) return "状态待确认 · " + state;
    if (pending.length) return "待你处理 · " + requestLabel(pending[0]);
    if (unknownRoots.has(r.thread.id)) return "等待输入 · 请求待恢复";
    if (r.terminals.length) return state + ` · 后台运行 ${r.terminals.length}`;
    const children =
      childMap.get(r.thread.id)?.filter((c) => execution(c) === "执行中")
        .length || 0;
    if (children) return state + ` · 子任务运行 ${children}`;
    if (state === "执行中") return "运行中 · " + progress(r).text;
    if (/失败|异常|未知|待确认|未映射/.test(state)) return state;
    return "";
  };
  const offsets = rowOffsets(
    filtered.map((r) =>
      workMode ? (sidebarSummary(r) ? 60 : 40) : narrow ? 124 : 64,
    ),
  );
  const [start, end] = visibleRange(
    offsets,
    workMode ? sidebarScroll : scroll,
    viewport.height,
    8,
  );
  const virtual = filtered.length > 100;
  const rowAnchor = useRef<{ id: string; offset: number } | null>(null);
  const geometryKey = JSON.stringify([
    workMode,
    filtered.map((r, i) => [r.thread.id, offsets[i]]),
  ]);
  useLayoutEffect(() => {
    const el = scrollRef.current,
      anchor = rowAnchor.current;
    if (!el || !anchor || !workMode) return;
    const index = filtered.findIndex((r) => r.thread.id === anchor.id);
    if (index >= 0) {
      el.scrollTop = offsets[index] + anchor.offset;
    }
    // Geometry is the dependency; streamed message text must not move the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey]);
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
    if (scrollRef.current)
      scrollRef.current.scrollTop = workMode ? sidebarScroll : scroll;
  }, [view, data?.initialized, workMode, sidebarScroll, scroll]);
  const open = useCallback(
    (id: string) => {
      setError("");
      setNotice("");
      setFeedbackThread("");
      visitProject(records.get(id)?.thread.cwd || "");
      setOpened((old) => [id, ...old.filter((x) => x !== id)].slice(0, 30));
      setTaskTab("work");
      setReaderVisit((n) => n + 1);
      setSelected(id);
      setTaskNav(false);
      setView("overview");
      const u = new URL(location.href);
      u.searchParams.set("thread", id);
      history.replaceState(null, "", u);
    },
    [records, visitProject],
  );
  const closeDetail = () => {
    setAllTasks(false);
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
    setError("");
    setNotice("");
    setFeedbackThread("");
    setView(v);
    if (v === "overview") {
      setSelected("");
      setAllTasks(false);
      setProject("");
      setFilter("all");
      setSearch("");
    }
    if (v === "attention") setProject("");
    setProjectMenu(false);
    setTaskNav(false);
    setFocus(false);
    history.replaceState(
      null,
      "",
      v === "records"
        ? "/sessions"
        : v === "usage"
          ? "/settings/usage"
          : v === "settings"
            ? "/settings"
            : "/",
    );
  };
  const [inFlightScopes, setInFlightScopes] = useState<string[]>([]);
  async function run(
    action: string,
    body: Record<string, unknown>,
    options?: { throwOnError?: boolean; localFeedback?: boolean },
  ) {
    const scope = String(body.requestKey || body.threadId || "create");
    if (submitting.current.has(scope)) return null;
    submitting.current.add(scope);
    setInFlightScopes((old) => [...old, scope]);
    setBusy(scope);
    if (!options?.localFeedback) {
      setError("");
      setNotice("");
    }
    try {
      const result = await operation(action, body);
      if (action === "interrupt")
        setStopRequested((old) => ({
          ...old,
          [String(body.threadId)]: String(body.turnId),
        }));
      if (!options?.localFeedback) {
        setFeedbackThread(String(body.threadId || ""));
        setNotice(
          action === "respond"
            ? result.result?.sent
              ? "答复已发送，等待 Codex 确认；是否继续执行以新的活动为准。"
              : "答复已确认；是否继续执行以新的活动为准。"
            : action === "interrupt"
              ? "停止请求已提交；等待轮次中断确认。"
              : action === "terminate"
                ? "终止请求已提交；请根据后台命令列表核对结果。"
                : "",
        );
      }
      if (options?.localFeedback) {
        // The settings receipt already contains the authoritative selected values.
        // Global monitoring reconciles separately from the local saving indicator.
        void refresh().catch(() => {});
      } else {
        try {
          await refresh();
        } catch {
          setFeedbackThread(String(body.threadId || ""));
          setNotice("操作结果已确认，任务状态仍在同步。");
        }
      }
      return result;
    } catch (e) {
      if (!options?.localFeedback) {
        setFeedbackThread(String(body.threadId || ""));
        setError(String(e));
      }
      if (options?.throwOnError) throw e;
      return null;
    } finally {
      submitting.current.delete(scope);
      setInFlightScopes((old) => old.filter((value) => value !== scope));
      setBusy("");
    }
  }
  const unresolvedReceipts = receipts.filter(
    (r) => !inFlightScopes.includes(r.scope),
  );
  const receiptEntry = unresolvedReceipts.length > 0 && (
    <button
      className="quiet operation-receipts"
      onClick={() => setDialog("receipts")}
      aria-label={`${unresolvedReceipts.length} 项操作待核查`}
      title={`${unresolvedReceipts.length} 项操作待核查`}
    >
      {narrow
        ? `${unresolvedReceipts.length} 回执`
        : `${unresolvedReceipts.length} 项操作待核查`}
    </button>
  );
  const operationFeedback = (
    <>
      {error && (
        <p className="operation-feedback" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="operation-feedback" role="status">
          {notice}
        </p>
      )}
    </>
  );
  const feedbackForCurrentTask =
    !feedbackThread ||
    rootId(feedbackThread, records) === rootId(selected, records);
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
      sessionStorage.setItem(
        "samaya.references." + id,
        JSON.stringify(newReferences),
      );
      return;
    }
    const sent = await run("send", {
      threadId: id,
      text: goal,
      references: newReferences,
      expectedCwd: cwd,
      expectedTurnId: null,
    });
    if (!sent) {
      sessionStorage.setItem("samaya.draft." + id, goal);
      sessionStorage.setItem(
        "samaya.references." + id,
        JSON.stringify(newReferences),
      );
      setNotice(
        "任务已创建，但执行提交未确认。目标已保存为该任务的草稿；请核查回执，不要重新创建。",
      );
    } else {
      setGoal("");
      setNewReferences([]);
      setNewName("");
    }
  }
  const recentProjects = [
    ...new Set([
      ...projectVisits.filter((p) => projects.includes(p)),
      ...projects,
    ]),
  ].slice(0, 4);
  const selectOverviewProject = (path: string) => {
    const currentFilter = filter;
    navigate("overview");
    setFilter(currentFilter);
    setProject(path);
    setScroll(0);
    visitProject(path);
  };
  const projectStatus = (path: string) => {
    const pending = requests.filter(
      (p) =>
        records.get(rootId(p.params.threadId, records))?.thread.cwd === path,
    ).length;
    if (pending) return `待处理 ${pending}`;
    const rows = [...records.values()].filter((r) => r.thread.cwd === path);
    if (
      rows.some(
        (r) =>
          !connected ||
          r.error ||
          !r.confirmedAt ||
          tick - r.confirmedAt * 1000 > 45000,
      )
    )
      return "待确认";
    return rows.some((r) => execution(r) === "执行中" || r.terminals.length > 0)
      ? "运行中"
      : "";
  };
  const activeRequest = requestKey
    ? requests.find((p) => p.key === requestKey)
    : undefined;
  const taskRequests = requestTask
    ? requestsByRoot.get(requestTask) ||
      requests.filter((p) => p.params.threadId === requestTask)
    : EMPTY;
  return (
    <div
      className={`monitor-shell ${focus && workMode ? "focus-mode" : ""} ${workMode ? "task-is-open" : ""} ${taskNav ? "task-nav-open" : ""} ${overviewMode ? "overview-mode" : ""} ${["settings", "usage"].includes(view) ? "settings-mode" : ""} `}
    >
      <a className="skip-link" href="#monitor-main">
        跳到任务总览
      </a>
      {taskNav && viewport.width < 1100 && (
        <button
          className="task-nav-backdrop"
          aria-label="关闭任务侧栏"
          onClick={() => setTaskNav(false)}
        />
      )}
      <aside
        className="monitor-nav"
        aria-label="工作台侧栏"
        role={taskNav && viewport.width < 1100 ? "dialog" : undefined}
        aria-modal={taskNav && viewport.width < 1100 ? true : undefined}
        inert={
          (workMode && focus && viewport.width >= 1100) ||
          (viewport.width < 1100 && !taskNav)
        }
      >
        <div className="monitor-brand">
          <img src="/figma/samaya-symbol.svg" alt="" />
          Samaya
        </div>
        <button
          className="quiet"
          onClick={() => {
            setTaskNav(false);
            setSearchOpen(true);
          }}
        >
          <Search
            size={16}
            strokeWidth={1.5}
            absoluteStrokeWidth
            aria-hidden="true"
          />
          搜索任务与项目
        </button>
        <NavButtons
          view={view}
          navigate={navigate}
          count={waitingCount}
          unknown={unknownCount}
        />
        <div className="nav-projects" aria-label="最近项目">
          <span className="eyebrow">最近项目</span>
          {recentProjects.map((p) => (
            <button key={p} title={p} onClick={() => selectOverviewProject(p)}>
              <span>{shortProject(p)}</span>
              <small>{projectStatus(p)}</small>
            </button>
          ))}
          <button
            onClick={() => {
              navigate("overview");
              setProjectMenu(true);
            }}
          >
            查看全部项目
          </button>
        </div>
        <div className="nav-bottom">
          {!workMode && receiptEntry}
          {!workMode && !dialog && !requestTask && (error || notice) && (
            <button className="quiet" onClick={() => setDialog("receipts")}>
              查看操作反馈
            </button>
          )}
          <button onClick={() => navigate("records")}>
            <History
              size={16}
              strokeWidth={1.5}
              absoluteStrokeWidth
              aria-hidden="true"
            />
            记录管理
          </button>
          <button onClick={() => navigate("settings")}>
            <SettingsIcon
              size={16}
              strokeWidth={1.5}
              absoluteStrokeWidth
              aria-hidden="true"
            />
            设置与连接
          </button>
          <small role="status">{connectionLabel}</small>
        </div>
      </aside>
      <main
        id="monitor-main"
        className="monitor-main"
        inert={taskNav && viewport.width < 1100}
      >
        <header className="monitor-toolbar">
          <button
            className="mobile-nav-button"
            onClick={() => setTaskNav(true)}
          >
            导航
          </button>
          <h1>
            {
              {
                overview: "全部任务",
                pinned: "置顶任务",
                attention: "待我处理",
                records: "记录管理",
                settings: "设置与连接",
                usage: "使用情况",
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
                setAllTasks(true);
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
        {(connectionInterrupted || syncError || data?.catalogError) && (
          <div className="connection-notice" role="status">
            {syncError || data?.catalogError ? (
              <span>{syncError || data?.catalogError}</span>
            ) : (
              <details>
                <summary>连接待恢复</summary>
                <p>
                  连接已断开或正在恢复。保留最后确认状态，不代表执行已停止。
                </p>
              </details>
            )}
            <button className="quiet" onClick={() => void refresh()}>
              重新核对
            </button>
          </div>
        )}
        {overviewMode && (
          <TaskOverview
            controls={
              <OverviewScope
                project={project}
                projects={projects}
                recent={recentProjects}
                status={projectStatus}
                selectProject={selectOverviewProject}
                filter={filter}
                selectFilter={setFilter}
                openProjects={projectMenu}
                setOpenProjects={setProjectMenu}
                connected={!!connected}
                create={() => {
                  setCwd(project || projects[0] || "");
                  setDialog("create");
                }}
              />
            }
            visibleIds={new Set(matching.map((r) => r.thread.id))}
            records={records}
            requests={requests}
            project={project}
            initialized={!!data?.initialized}
            summary={sidebarSummary}
            open={open}
            all={() => {
              setAllTasks(true);
              setSearch("");
            }}
          />
        )}
        {!overviewMode &&
          (view === "overview" ||
            view === "pinned" ||
            view === "attention") && (
            <div
              className={`monitor-workspace ${workMode ? "has-detail" : ""}`}
            >
              {!workMode && (
                <section className="task-navigation" aria-label="任务导航">
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
                          if (scrollRef.current)
                            scrollRef.current.scrollTop = 0;
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
                          <option value="issues">异常 / 状态待确认</option>
                          <option value="stale">状态待确认</option>
                        </select>
                      </label>
                    )}
                    {view === "overview" && !allTasks && (
                      <label>
                        <span className="sr-only">最近任务数量</span>
                        <select
                          aria-label="最近任务数量"
                          value={recentLimit}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            setRecentLimit(n);
                            localStorage.setItem(
                              "samaya.recent.limit",
                              String(n),
                            );
                            setScroll(0);
                          }}
                        >
                          <option value={20}>最近 20 个任务</option>
                          <option value={10}>最近 10 个任务</option>
                        </select>
                      </label>
                    )}
                    <div className="recent-scope">
                      <span>
                        {view === "attention"
                          ? `${requests.length} 项未解决请求`
                          : view === "pinned"
                            ? `${filtered.length} 个置顶任务`
                            : `${allTasks ? "全部" : "最近"} ${filtered.length} 个主任务`}
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
                      {view === "overview" &&
                        filter !== "running" &&
                        ordered.some(
                          (r) =>
                            !filtered.some(
                              (f) => f.thread.id === r.thread.id,
                            ) &&
                            (execution(r) === "执行中" ||
                              r.terminals.length ||
                              childMap
                                .get(r.thread.id)
                                ?.some((c) => execution(c) === "执行中")),
                        ) && (
                          <button
                            onClick={() => {
                              setSearch("");
                              setProject("");
                              setAllTasks(true);
                              setFilter("running");
                            }}
                          >
                            查看全部活动任务
                          </button>
                        )}
                      {view === "overview" && recent.changed && (
                        <button onClick={recent.update}>更新最近任务</button>
                      )}
                    </div>
                  </div>
                  <div
                    className="monitor-list"
                    ref={scrollRef}
                    onScroll={(e) =>
                      (() => {
                        const top = e.currentTarget.scrollTop;
                        (workMode ? setSidebarScroll : setScroll)(top);
                        const [index] = visibleRange(offsets, top, 0, 0);
                        if (filtered[index])
                          rowAnchor.current = {
                            id: filtered[index].thread.id,
                            offset: top - offsets[index],
                          };
                      })()
                    }
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
                            当前连接未观察到未解决请求。断连前请求的可恢复性以
                            Codex 提供的信息为准。
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
                                paddingTop: offsets[start],
                                paddingBottom:
                                  offsets[filtered.length] - offsets[end],
                              }
                            : undefined
                        }
                      >
                        {(virtual ? filtered.slice(start, end) : filtered).map(
                          (r) => (
                            <TaskRow
                              key={r.thread.id}
                              compact={workMode}
                              summary={sidebarSummary(r)}
                              record={r}
                              requests={
                                requestsByRoot.get(r.thread.id) || EMPTY
                              }
                              childrenCount={
                                childMap.get(r.thread.id)?.length || 0
                              }
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
                </section>
              )}
              {workMode && (
                <aside
                  className="task-detail"
                  aria-label="任务详情"
                  inert={taskNav && viewport.width < 1100}
                >
                  {selectedRecord ? (
                    <>
                      <header className="task-heading">
                        <button
                          className="quiet task-sidebar-toggle"
                          aria-label={
                            focus || (viewport.width < 1100 && !taskNav)
                              ? "展开任务侧栏"
                              : "收起任务侧栏"
                          }
                          onClick={() => {
                            if (viewport.width < 1100) {
                              setFocus(false);
                              setTaskNav(!taskNav);
                            } else {
                              setTaskNav(false);
                              setFocus(!focus);
                            }
                          }}
                        >
                          ☰
                        </button>
                        <span className="toolbar-space" />
                        {receiptEntry}
                        {error &&
                          !feedbackForCurrentTask &&
                          !unresolvedReceipts.length && (
                            <button
                              className="quiet operation-receipts"
                              onClick={() => setDialog("receipts")}
                              aria-label="查看操作反馈"
                              title="查看操作反馈"
                            >
                              {narrow ? "反馈" : "查看操作反馈"}
                            </button>
                          )}

                        <button
                          className={
                            waitingCount || unknownCount
                              ? "request-action global-pending"
                              : "quiet global-pending"
                          }
                          onClick={() => navigate("attention")}
                        >
                          <img src="/figma/bell.svg" alt="" /> 待处理{" "}
                          {waitingCount}
                          {unknownCount ? ` · ${unknownCount} 待核对` : ""}
                        </button>
                        <button
                          className="quiet workspace-exceptions"
                          onClick={() => {
                            navigate("overview");
                            closeDetail();
                            setAllTasks(true);
                            setFilter("issues");
                            setProject("");
                          }}
                        >
                          <img src="/figma/alert.svg" alt="" />{" "}
                          <span className="sr-only">异常</span>{" "}
                          {
                            ordered.filter(
                              (r) =>
                                /失败|异常/.test(execution(r)) ||
                                !connected ||
                                !!r.error ||
                                !r.confirmedAt ||
                                tick - r.confirmedAt * 1000 > 45000,
                            ).length
                          }
                        </button>
                        <button
                          className="quiet project-context"
                          onClick={() => setDialog("context")}
                          aria-label="工作区与状态详情"
                        >
                          <img src="/figma/more.svg" alt="" />
                        </button>
                      </header>
                      <div className="task-reading-heading">
                        <div className="task-title-status">
                          <h1 title={threadTitle(selectedRecord.thread)}>
                            {threadTitle(selectedRecord.thread)}
                          </h1>
                          <div
                            className="task-live-status"
                            role="status"
                            title={
                              sidebarSummary(selectedRecord) ||
                              execution(selectedRecord)
                            }
                          >
                            <span>
                              {sidebarSummary(selectedRecord) ||
                                execution(selectedRecord)}
                            </span>
                            {execution(selectedRecord) === "执行中" &&
                              connected &&
                              selectedRecord.progressAt && (
                                <time>
                                  最近进展 {clock(selectedRecord.progressAt)}
                                </time>
                              )}
                          </div>
                        </div>
                        <nav className="detail-tabs" aria-label="任务内容">
                          {[
                            ["work", "对话"],
                            ["result", "改动与产物"],
                          ].map(([tab, label]) => (
                            <button
                              key={tab}
                              className="quiet"
                              aria-current={
                                taskTab === tab ? "page" : undefined
                              }
                              onClick={() => setTaskTab(tab)}
                            >
                              {label}
                            </button>
                          ))}
                        </nav>
                      </div>
                      <ReadingSurface
                        key={selected + taskTab + readerVisit}
                        visit={readerVisit}
                        tid={selected}
                        tab={taskTab}
                      >
                        {taskTab === "work" && (
                          <>
                            <div className="task-context">
                              {selectedRecord.error && (
                                <p role="status">{selectedRecord.error}</p>
                              )}
                              {selectedRecord.turn?.error?.message && (
                                <details className="task-error">
                                  <summary>本轮失败 · 查看原因</summary>
                                  <p>{selectedRecord.turn.error.message}</p>
                                </details>
                              )}
                              {selectedRecord.progressAt &&
                                tick - selectedRecord.progressAt * 1000 >
                                  300000 &&
                                execution(selectedRecord) === "执行中" && (
                                  <p>
                                    较长时间未报告新进展；尚不能据此判断失败。
                                  </p>
                                )}
                              {!!(
                                requestsByRoot.get(rootId(selected, records))
                                  ?.length ||
                                waitingUnknown(selectedRecord, EMPTY)
                              ) && (
                                <button
                                  className="request-action"
                                  onClick={() =>
                                    decide(rootId(selected, records))
                                  }
                                >
                                  处理待决策事项 ·{" "}
                                  {requestsByRoot.get(rootId(selected, records))
                                    ?.length || "内容待恢复"}
                                </button>
                              )}
                              {!!(
                                childMap.get(selected)?.length ||
                                selectedRecord.terminals.length ||
                                selectedRecord.thread.parentThreadId
                              ) && (
                                <details className="related-activities">
                                  <summary>
                                    关联活动 ·{" "}
                                    {childMap.get(selected)?.length || 0}{" "}
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
                                        open(
                                          selectedRecord.thread.parentThreadId!,
                                        )
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
                              )}
                            </div>
                          </>
                        )}
                        <ExecutionHistory
                          key={selected}
                          tid={selected}
                          turnId={selectedRecord.turn?.id}
                          turnStatus={selectedRecord.turn?.status}
                          turnStartedAt={selectedRecord.turn?.startedAt}
                          working={
                            !!connected &&
                            selectedRecord.turn?.status === "inProgress" &&
                            execution(selectedRecord) === "执行中" &&
                            !(
                              requestsByRoot.get(rootId(selected, records))
                                ?.length ||
                              waitingUnknown(selectedRecord, EMPTY)
                            )
                          }
                          tab={taskTab}
                        />
                        {taskTab === "work" &&
                          (
                            requestsByRoot.get(rootId(selected, records)) ||
                            EMPTY
                          )
                            .filter(
                              (p) =>
                                p.method === "item/tool/requestUserInput" &&
                                p.params.questions?.length,
                            )
                            .map((p) => (
                              <div key={p.key} className="inline-decision">
                                {p.params.threadId !== selected && (
                                  <p className="muted">
                                    {records.has(p.params.threadId)
                                      ? threadTitle(
                                          records.get(p.params.threadId)!
                                            .thread,
                                        )
                                      : "子任务"}
                                  </p>
                                )}
                                {p.responseState && (
                                  <p role="status">
                                    {p.responseState === "uncertain"
                                      ? "答复结果待确认；请核对回执。"
                                      : "答复已发送；等待服务端确认。"}
                                  </p>
                                )}
                                <RequestForm
                                  request={p}
                                  busy={
                                    !connected ||
                                    busy === p.key ||
                                    !!p.responseState
                                  }
                                  respond={(response) =>
                                    void run("respond", {
                                      threadId: p.params.threadId,
                                      requestKey: p.key,
                                      response,
                                    })
                                  }
                                />
                              </div>
                            ))}
                        <details>
                          <summary>会话摘要与身份</summary>
                          <p>
                            {selectedRecord.thread.preview ||
                              "原生会话未提供摘要"}
                          </p>
                          <code>{selected}</code>
                        </details>
                      </ReadingSurface>
                      <div className="detail-footer">
                        <TaskComposer
                          key={selected}
                          record={selectedRecord}
                          connected={!!connected}
                          busy={
                            busy === selected ||
                            receipts.some(
                              (receipt) => receipt.scope === selected,
                            ) ||
                            (stopRequested[selected] ===
                              selectedRecord.turn?.id &&
                              selectedRecord.turn?.status === "inProgress")
                          }
                          run={run}
                          runSettings={(action, body) =>
                            run(action, body, {
                              throwOnError: true,
                              localFeedback: true,
                            })
                          }
                          inspectReceipts={() => setDialog("receipts")}
                          feedback={
                            !dialog && !requestTask && feedbackForCurrentTask
                              ? operationFeedback
                              : null
                          }
                          stop={() => setDialog("stop")}
                          open={open}
                          navigateCommand={(name) => {
                            if (name === "new") {
                              setCwd(project || selectedRecord.thread.cwd);
                              setDialog("create");
                            } else if (name === "resume") setSearchOpen(true);
                            else if (name === "theme") navigate("settings");
                            else if (name === "agent" || name === "subagents")
                              setDialog("agents");
                            else {
                              setCwd(selectedRecord.thread.cwd);
                              setDialog("workspace");
                            }
                          }}
                        />
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
        {view === "settings" && (
          <SettingsView logout={logout} usage={() => navigate("usage")} />
        )}
        {view === "usage" && (
          <UsageView
            connected={!!connected}
            settings={() => navigate("settings")}
          />
        )}
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
      {dialog === "agents" && selectedRecord && (
        <Modal title="关联子任务" close={() => setDialog(null)}>
          {(childMap.get(selected) || []).map((child) => (
            <button
              key={child.thread.id}
              onClick={() => {
                setDialog(null);
                open(child.thread.id);
              }}
            >
              {threadTitle(child.thread)} · {execution(child)}
            </button>
          ))}
          {!childMap.get(selected)?.length && (
            <p>当前任务没有已发现的子任务。</p>
          )}
        </Modal>
      )}
      {dialog === "context" && selectedRecord && (
        <Modal title="工作区与状态" close={() => setDialog(null)}>
          <p>{threadTitle(selectedRecord.thread)}</p>
          <code className="workspace-full-path">
            {selectedRecord.thread.cwd}
          </code>
          <div className="actions">
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(selectedRecord.thread.cwd)
                  .then(() => {
                    setFeedbackThread(selected);
                    setNotice("工作目录已复制");
                  })
                  .catch(() => {
                    setFeedbackThread(selected);
                    setError("复制失败，请选择路径手动复制。");
                  })
              }
            >
              复制目录
            </button>
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
          <p>
            {execution(selectedRecord)} ·{" "}
            {connected && !selectedRecord.error ? "已同步" : "状态待确认"}
          </p>
          <p>
            {progress(selectedRecord).source}：{progress(selectedRecord).text}
          </p>
          <p>
            有效进展观察于 {clock(selectedRecord.progressAt)} · 状态核对于{" "}
            {clock(selectedRecord.confirmedAt)}
          </p>
          <p>导航不会修改工作目录。已启动的进程保留原工作目录。</p>
          {operationFeedback}
        </Modal>
      )}
      {searchOpen && (
        <SearchPalette
          records={ordered}
          recent={opened}
          close={() => setSearchOpen(false)}
          open={open}
          project={selectOverviewProject}
          file={(id) => {
            open(id);
            setTaskTab("result");
          }}
        />
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
          {operationFeedback}
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
            <div className="task-composer">
              <ComposerInput
                label="工作要求"
                value={goal}
                onChange={setGoal}
                references={newReferences}
                onReferences={setNewReferences}
                cwd={cwd}
                disabled={!!busy || !connected || !cwd}
                onSubmit={() => void create()}
                onCommand={() =>
                  setError("先创建任务，再使用会话命令；技能与应用可直接选择。")
                }
              />
            </div>
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
          </form>
          {operationFeedback}
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
          {operationFeedback}
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
          {operationFeedback}
        </Modal>
      )}
      {dialog === "receipts" && (
        <Modal title="核查操作回执" close={() => setDialog(null)}>
          {feedbackThread && !feedbackForCurrentTask && (
            <p>
              {records.has(feedbackThread)
                ? threadTitle(records.get(feedbackThread)!.thread)
                : feedbackThread}
            </p>
          )}
          {operationFeedback}
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
                    setFeedbackThread(r.threadId || "");
                    setNotice(
                      `回执：${result.state} ${JSON.stringify(result.result || {})}`,
                    );
                    if (["succeeded", "failed"].includes(result.state))
                      clearOperation(r.operationId);
                    await refresh();
                  } catch (e) {
                    setFeedbackThread(r.threadId || "");
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
        <PanelsTopLeft
          size={16}
          strokeWidth={1.5}
          absoluteStrokeWidth
          aria-hidden="true"
        />
        任务总览
      </button>
      <button
        aria-current={view === "pinned" ? "page" : undefined}
        onClick={() => navigate("pinned")}
      >
        <Pin
          size={16}
          strokeWidth={1.5}
          absoluteStrokeWidth
          aria-hidden="true"
        />
        置顶任务
      </button>
      <button
        aria-current={view === "attention" ? "page" : undefined}
        onClick={() => navigate("attention")}
      >
        <Inbox
          size={16}
          strokeWidth={1.5}
          absoluteStrokeWidth
          aria-hidden="true"
        />
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
  runSettings,
  inspectReceipts,
  feedback,
  stop,
  open,
  navigateCommand,
}: {
  record: Observation;
  connected: boolean;
  busy: boolean;
  run: (a: string, b: Record<string, unknown>) => Promise<Receipt | null>;
  runSettings: (
    a: string,
    b: Record<string, unknown>,
  ) => Promise<Receipt | null>;
  inspectReceipts: () => void;
  feedback: ReactNode;
  stop: () => void;
  open: (id: string) => void;
  navigateCommand: (name: string) => void;
}) {
  const id = record.thread.id;
  const [draft, setDraft] = useState(
    () => sessionStorage.getItem("samaya.draft." + id) || "",
  );
  const [references, setReferences] = useState<InputReference[]>(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem("samaya.references." + id) || "[]",
      );
    } catch {
      return [];
    }
  });
  const [command, setCommand] = useState<{
    item: SlashCommand;
    args: string;
  } | null>(null);
  const [localError, setLocalError] = useState("");
  const [goalRefresh, setGoalRefresh] = useState(0);
  const active = record.turn?.status === "inProgress";
  useEffect(() => {
    sessionStorage.setItem("samaya.draft." + id, draft);
    sessionStorage.setItem(
      "samaya.references." + id,
      JSON.stringify(references),
    );
  }, [id, draft, references]);
  const submit = async () => {
    const submitted = draft;
    const r = await run(active ? "steer" : "send", {
      threadId: id,
      text: draft,
      references,
      expectedCwd: record.thread.cwd,
      expectedTurnId: record.turn?.id || null,
    });
    if (r) {
      setDraft((current) => (current === submitted ? "" : current));
      setReferences((current) =>
        current.filter((r) => !references.includes(r)),
      );
    }
  };
  function invoke(item: SlashCommand, args: string) {
    const name = item.alias || item.name;
    if (name === "init") {
      setDraft(
        "检查当前项目，生成或完善根目录 AGENTS.md，保留已有有效约定。" +
          (args ? "\n" + args : ""),
      );
      return;
    }
    if (name === "copy") {
      const message = [...(record.turn?.items || [])]
        .reverse()
        .find((i) => i.type === "agentMessage");
      if (message?.text)
        void navigator.clipboard
          .writeText(message.text)
          .catch(() => setLocalError("复制失败，请手动选择回复。"));
      else setLocalError("当前汇总没有完整回复，请在正文复制。");
      return;
    }
    if (
      [
        "new",
        "resume",
        "project",
        "local",
        "theme",
        "agent",
        "subagents",
      ].includes(name)
    ) {
      navigateCommand(name);
      return;
    }
    setCommand({ item, args });
  }
  return (
    <div className="task-composer">
      <GoalStatus
        tid={id}
        refresh={goalRefresh}
        edit={() =>
          invoke(
            {
              name: "goal",
              description: "持续目标",
              kind: "native",
              enabled: true,
            },
            "",
          )
        }
      />
      {localError && <small role="alert">{localError}</small>}
      {!command && feedback}
      <ComposerInput
        value={draft}
        onChange={setDraft}
        references={references}
        onReferences={setReferences}
        cwd={record.thread.cwd}
        threadId={id}
        modelSelector={
          <ModelSelector
            key={id}
            tid={id}
            model={record.thread.model}
            reasoningEffort={record.thread.reasoningEffort}
            serviceTier={record.thread.serviceTier}
            busy={busy}
            disabled={
              !connected ||
              record.thread.canAcceptDirectInput === false ||
              !!record.error
            }
            run={runSettings}
            inspectReceipts={inspectReceipts}
          />
        }
        active={active}
        placeholder={!connected || record.error ? "等待连接恢复…" : undefined}
        disabled={
          !connected ||
          busy ||
          record.thread.canAcceptDirectInput === false ||
          !!record.error
        }
        onSubmit={() => void submit()}
        onStop={stop}
        onCommand={invoke}
      />
      {command && (
        <CommandDialog
          command={command.item}
          args={command.args}
          tid={id}
          close={() => setCommand(null)}
          run={run}
          done={(r) => {
            setGoalRefresh((n) => n + 1);
            if (draft.trim().startsWith("/")) {
              setDraft((current) => (current === draft ? "" : current));
              setReferences((current) =>
                current.filter((r) => !references.includes(r)),
              );
            }
            if (
              typeof r.result?.threadId === "string" &&
              r.result.threadId !== id
            ) {
              setCommand(null);
              open(r.result.threadId);
            }
          }}
        />
      )}
    </div>
  );
}
function SettingsView({
  logout,
  usage,
}: {
  logout: () => void;
  usage: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void api<Status>("/status")
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <section className="monitor-page settings-page">
      <h2>设置与连接</h2>
      <p className="usage-caption">管理界面外观和连接状态</p>
      <section className="settings-section">
        <h3>界面外观</h3>
        <ThemeSelect segmented />
      </section>
      <section className="settings-section">
        <h3>连接</h3>
        {error && <p role="alert">{error}</p>}
        <p className="usage-caption">
          {status?.connection === "connected"
            ? "已连接 Codex"
            : status?.connection || "正在核对"}
        </p>
        <details className="settings-connection">
          <summary>连接详情与数据边界</summary>
          <dl>
            <dt>SDK</dt>
            <dd>{status?.sdkVersion || "未知"}</dd>
            <dt>实际运行时</dt>
            <dd>{status?.runtime.userAgent || "未获得"}</dd>
            <dt>常用目录</dt>
            <dd>{status?.roots.join("、")}</dd>
          </dl>
          <code>{status?.socket}</code>
          <p>
            Codex 管理会话和执行。Samaya
            只保存操作回执、事件恢复信息与界面偏好。监控汇总保存在内存中；浏览器筛选不改变监控范围。
          </p>
          <p>
            重连无法保证重建此前未收到的授权表单；会保留等待标识，不自动代答。
          </p>
        </details>
      </section>
      <section className="settings-section">
        <h3>使用情况</h3>
        <div className="usage-row">
          <span className="usage-caption">查看套餐、剩余额度和重置时间</span>
          <button className="usage-link" onClick={usage}>
            查看使用情况 →
          </button>
        </div>
      </section>
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
