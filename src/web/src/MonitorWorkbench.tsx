import {
  Search,
  PanelsTopLeft,
  Pin,
  Inbox,
  History,
  Settings as SettingsIcon,
} from "lucide-react";
import { WorkspaceManagement } from "./WorkspaceManagement";
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
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  api,
  operation,
  pendingOperations,
  clearOperation,
  reconcileOperations,
  acceptOperationReceipt,
} from "./api";
import { DirectoryPicker, Modal, RequestForm } from "./components";
import { printStatus } from "./inline-status-store";
import { ExecutionHistory } from "./ExecutionHistory";
import { PlanActions } from "./PlanActions";
import { GoalStatus } from "./GoalStatus";
import { SearchPalette } from "./SearchPalette";
import { ReadingSurface } from "./ReadingSurface";
import { UsageView } from "./UsageView";
import { ThemeSelect } from "./ThemeSelect";
import { useMonitor } from "./useMonitor";
import { TaskOverview } from "./TaskOverview";
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
import "./task-activity.css";
import "./usage.css";
import { ComposerInput } from "./ComposerInput";
import { setImageDraft, useImageDraft } from "./composer-images";
import {
  fileReferences,
  fileScope,
  setFileDraft,
  useFileDraft,
} from "./composer-files";
import type { InputImage } from "./composer-images";
import { CommandDialog } from "./CommandDialog";
import { WorkspaceNavigation } from "./WorkspaceNavigation";
import { ModelSelector, type ModelSettings } from "./ModelSelector";
import { usePlanMode } from "./PlanMode";
import {
  NotificationSettings,
  useTaskNotifications,
} from "./task-notifications";
import type { InputReference, SlashCommand } from "./composer-model";
import { shellInput } from "./composer-model";
import { rememberPrompt } from "./prompt-history";
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
const overviewPreferences = () => preferences().overview || preferences();
const workspaceFromUrl = () =>
  new URL(location.href).searchParams.get("workspace") || "";
const readWorkspaceDraft = (cwd: string) => {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem("samaya.new-draft." + cwd) || "{}",
    );
    return saved.text?.startsWith("/")
      ? { ...saved, text: "", references: [] }
      : saved;
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
  activity = "",
}: {
  compact?: boolean;
  summary?: string;
  activity?: string;
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
        className={`task-row compact-task ${activity} ${summary ? "has-status" : ""} ${selected ? "is-selected" : ""}`}
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
          {summary && (
            <small>{summary.replace(/^(运行中|待你处理) · /, "")}</small>
          )}
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
      className={`task-row ${activity} ${selected ? "is-selected" : ""}`}
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
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [search, setSearch] = useState<string>(
      () => overviewPreferences().search || "",
    ),
    [project, setProject] = useState<string>(
      () => overviewPreferences().project || "",
    ),
    [filter, setFilter] = useState<string>(
      () => overviewPreferences().filter || "all",
    );
  const [selected, setSelected] = useState<string>(
      () =>
        new URL(location.href).searchParams.get("thread") ||
        preferences().selected ||
        "",
    ),
    [focus, setFocus] = useState(false);
  const [managedWorkspace, setManagedWorkspace] = useState(() =>
    location.pathname.startsWith("/sessions")
      ? new URL(location.href).searchParams.get("cwd") || ""
      : "",
  );
  const [taskTab, setTaskTab] = useState("work");
  const [readerVisit, setReaderVisit] = useState(0);
  const [sidebarCommand, setSidebarCommand] = useState<{
    id: string;
    action: "archive";
  } | null>(null);
  const savedOverview = useRef({
    search,
    project,
    filter,
    scroll: overviewPreferences().scroll || 0,
  });
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
  const [draftWorkspace, setDraftWorkspace] = useState(
    () => new URL(location.href).searchParams.get("workspace") || "",
  );
  const [draftMode, setDraftMode] = useState(
    () => readWorkspaceDraft(workspaceFromUrl()).mode || "default",
  );
  const workMode =
    !!(selected || draftWorkspace) && ["overview", "pinned"].includes(view);
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
      "create" | "workspace" | "context" | "receipts" | "agents" | null
    >(null),
    [requestTask, setRequestTask] = useState<string | null>(null),
    [requestKey, setRequestKey] = useState<string | null>(null);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [feedbackThread, setFeedbackThread] = useState(""),
    [busy, setBusy] = useState(""),
    [cwd, setCwd] = useState(workspaceFromUrl),
    [goal, setGoal] = useState(
      () => readWorkspaceDraft(workspaceFromUrl()).text || "",
    ),
    [newName, setNewName] = useState("");
  const [confirmedCwd, setConfirmedCwd] = useState("");
  const [newImages, setNewImages] = useImageDraft(
    draftWorkspace ? "workspace:" + draftWorkspace : "create",
  );
  const [newFiles, setNewFiles] = useFileDraft(
    fileScope(draftWorkspace || cwd),
  );
  const [newReferences, setNewReferences] = useState<InputReference[]>(
    () => readWorkspaceDraft(workspaceFromUrl()).references || [],
  );
  const [receipts, setReceipts] = useState(pendingOperations),
    [seen, setSeen] = useState(() =>
      Number(localStorage.getItem("samaya.changes.seen") || 0),
    );
  const [tick, setTick] = useState(() => Date.now()),
    [scroll, setScroll] = useState(() => overviewPreferences().scroll || 0),
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
  const overviewMode = view === "overview" && !workMode;
  const matching = ordered.filter((r) => {
    const state = execution(r),
      pending =
        (requestsByRoot.get(r.thread.id)?.length || 0) > 0 ||
        waitingUnknown(r, EMPTY);
    return (
      (!project || r.thread.cwd === project) &&
      (!overviewMode ||
        r.thread.cwd
          .toLowerCase()
          .includes(workspaceQuery.trim().toLowerCase())) &&
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
  const filtered = matching
    .filter((r) => view !== "pinned" || pins.includes(r.thread.id))
    .sort(
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
  const activityClass = (r: Observation) => {
    const pending = requestsByRoot.get(r.thread.id) || EMPTY;
    const fresh = (record: Observation) =>
      connected &&
      !record.error &&
      !!record.confirmedAt &&
      tick - record.confirmedAt * 1000 <= 45000;
    if (pending.length || unknownRoots.has(r.thread.id))
      return `task-activity task-waiting ${
        fresh(r) && pending.some((p) => !p.responseState && busy !== p.key)
          ? "task-attention-live"
          : ""
      }`;
    const running =
      fresh(r) &&
      (execution(r) === "执行中" ||
        childMap
          .get(r.thread.id)
          ?.some((c) => fresh(c) && execution(c) === "执行中"));
    return `task-activity ${running ? "task-running" : ""}`;
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
    if (view === "overview")
      savedOverview.current = { search, project, filter, scroll };
    sessionStorage.setItem(
      "samaya.monitor.view",
      JSON.stringify({
        ...savedOverview.current,
        selected,
        overview: savedOverview.current,
      }),
    );
  }, [view, search, project, filter, scroll, selected]);
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
      setDraftWorkspace("");
      setSelected(id);
      setTaskNav(false);
      if (view !== "overview") {
        const saved = savedOverview.current;
        setProject(saved.project);
        setFilter(saved.filter);
        setSearch(saved.search);

        setScroll(saved.scroll);
      }
      setView("overview");
      const u = new URL(location.href);
      u.searchParams.delete("workspace");
      u.searchParams.set("thread", id);
      history.replaceState(null, "", u);
    },
    [records, visitProject, view],
  );
  const closeDetail = () => {
    setDraftWorkspace("");
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
    setManagedWorkspace("");
    setDraftWorkspace("");
    setError("");
    setNotice("");
    setFeedbackThread("");
    setView(v);
    if (v === "pinned") setSelected("");
    if (v === "overview") {
      setSelected("");
      const saved = savedOverview.current;

      setProject(saved.project);
      setFilter(saved.filter);
      setSearch(saved.search);
      setScroll(saved.scroll);
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
  const lastConversation = useRef("");
  useEffect(() => {
    if (selected && records.has(selected)) lastConversation.current = selected;
  }, [selected, records]);
  useEffect(() => {
    const navigateWithArrows = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'input,textarea,select,button,summary,a,[contenteditable="true"],[role="slider"],[role="listbox"],[role="menu"],[role="tablist"]',
        ) ||
        document.querySelector("dialog[open]") ||
        window.getSelection()?.toString()
      )
        return;
      if (event.key === "ArrowLeft" && workMode && selected) {
        event.preventDefault();
        lastConversation.current = selected;
        navigate("overview");
      } else if (
        event.key === "ArrowRight" &&
        view === "overview" &&
        !workMode &&
        records.has(lastConversation.current)
      ) {
        event.preventDefault();
        open(lastConversation.current);
      }
    };
    document.addEventListener("keydown", navigateWithArrows);
    return () => document.removeEventListener("keydown", navigateWithArrows);
  });
  const [inFlightScopes, setInFlightScopes] = useState<string[]>([]);
  const operationError = useRef("");
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
    operationError.current = "";
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      submitting.current.delete(scope);
      setInFlightScopes((old) => old.filter((value) => value !== scope));
      setBusy((old) => (old === scope ? "" : old));
    };
    try {
      const result = await operation(action, body, release);
      if (action === "interrupt")
        setStopRequested((old) => ({
          ...old,
          [String(body.threadId)]: String(body.turnId),
        }));
      if (!options?.localFeedback) {
        setFeedbackThread(String(body.threadId || ""));
        setNotice(
          action === "interrupt"
            ? "停止请求已提交；等待轮次中断确认。"
            : action === "terminate"
              ? "终止请求已提交；请根据后台命令列表核对结果。"
              : "",
        );
      }
      if (options?.localFeedback || result.state === "pending") {
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
      operationError.current = String(e);
      if (!options?.localFeedback) {
        setFeedbackThread(String(body.threadId || ""));
        setError(String(e));
      }
      if (options?.throwOnError) throw e;
      return null;
    } finally {
      release();
    }
  }
  useEffect(() => {
    const entries = receipts;
    if (!entries.length) return;
    const recover = () => {
      void reconcileOperations(entries);
    };
    const visible = () => {
      if (document.visibilityState === "visible") recover();
    };
    void reconcileOperations(
      entries.filter((r) => !inFlightScopes.includes(r.scope)),
    );
    const timer = setInterval(recover, 8000);
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [receipts, inFlightScopes]);
  useEffect(() => {
    const resolved = (event: Event) => {
      const { entry, receipt } = (
        event as CustomEvent<{
          entry: { scope: string; threadId?: string };
          receipt: Receipt;
        }>
      ).detail;
      if (submitting.current.has(entry.scope)) return;
      if (receipt.state === "failed") {
        setFeedbackThread(entry.threadId || "");
        setError(
          "操作失败：" + String(receipt.result?.message || "请核对操作结果"),
        );
      } else if (feedbackThread === entry.threadId) {
        setError((old) =>
          old.includes("结果待确认") || old.includes("后台核对") ? "" : old,
        );
      }
    };
    window.addEventListener("samaya:receipt-resolved", resolved);
    return () =>
      window.removeEventListener("samaya:receipt-resolved", resolved);
  }, [feedbackThread]);
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
  const [draftModel, setDraftModel] = useState<ModelSettings["current"] | null>(
    null,
  );
  const [draftModelPending, setDraftModelPending] = useState(true);
  const creating = useRef(false);
  const [creatingNow, setCreatingNow] = useState(false);
  const [draftScope, setDraftScope] = useState(cwd + "|" + draftWorkspace);
  if (draftScope !== cwd + "|" + draftWorkspace) {
    setDraftScope(cwd + "|" + draftWorkspace);
    setDraftModel(null);
    setDraftModelPending(true);
  }
  async function create() {
    if (creating.current || draftModelPending || !draftModel) return;
    if (
      (!goal.trim() && !newImages.length && !newFiles.length) ||
      newFiles.some((file) => file.status !== "ready") ||
      busy ||
      !connected
    )
      return;
    if (dialog === "create" && (!confirmedCwd || confirmedCwd !== cwd)) {
      setError("请先点击“浏览目录”确认工作目录。");
      return;
    }
    const shell = shellInput(goal);
    if (
      shell !== null &&
      (!shell || newImages.length || newFiles.length || newReferences.length)
    ) {
      setError(
        !shell ? "请在 ! 后输入命令" : "Shell 命令不能同时附带图片、文件或引用",
      );
      return;
    }
    creating.current = true;
    setCreatingNow(true);
    try {
      const created = await run("create", {
        cwd,
        name: newName,
        modelSettings: draftModel,
      });
      if (!created) return;
      const id = String(created.result?.threadId || "");
      if (!id) return;
      setImageDraft("thread:" + id, newImages);
      setFileDraft("thread:" + id, newFiles);
      sessionStorage.setItem("samaya.draft." + id, goal);
      sessionStorage.setItem(
        "samaya.references." + id,
        JSON.stringify(newReferences),
      );
      const finish = () => {
        if (draftWorkspace)
          sessionStorage.removeItem("samaya.new-draft." + draftWorkspace);
        setGoal("");
        setNewReferences([]);
        setNewImages([]);
        setNewFiles([]);
        const failure = operationError.current;
        open(id);
        if (failure) setError(failure);
        setDialog(null);
        setView("overview");
      };
      if (created.result?.warning) {
        finish();
        setNotice(String(created.result.warning));
        return;
      }
      if (shell === null && draftWorkspace && draftMode === "plan") {
        const configured = await run("command", {
          threadId: id,
          command: "plan",
          args: { value: "plan" },
          expectedTurnId: null,
        });
        if (
          !configured ||
          configured.result?.settingsPending ||
          configured.result?.mode !== "plan"
        ) {
          finish();
          setNotice(
            "会话已创建，计划模式尚未确认；消息保留在草稿中，请先核对模式或回执。",
          );
          return;
        }
      }
      const sent = await run(shell !== null ? "shell" : "send", {
        command: shell,
        threadId: id,
        text: goal,
        references: newReferences,
        images: newImages.map(({ url }) => ({ url })),
        files: fileReferences(newFiles),
        expectedCwd: cwd,
        expectedTurnId: null,
      });
      finish();
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
        rememberPrompt(cwd, goal);
        setGoal("");
        setNewReferences([]);
        setNewImages([]);
        setNewFiles([]);
        setFileDraft("thread:" + id, []);
        setImageDraft("thread:" + id, []);
        setNewName("");
        sessionStorage.setItem("samaya.draft." + id, "");
        sessionStorage.setItem("samaya.references." + id, "[]");
        if (draftWorkspace)
          sessionStorage.removeItem("samaya.new-draft." + draftWorkspace);
      }
    } finally {
      creating.current = false;
      setCreatingNow(false);
    }
  }
  const startWorkspaceDraft = (path: string) => {
    let saved: { text?: string; references?: InputReference[]; mode?: string } =
      {};
    try {
      saved = readWorkspaceDraft(path);
    } catch {
      /* Start an empty draft when local preferences are unreadable. */
    }
    setGoal(saved.text || "");
    setNewReferences(saved.references || []);
    setDraftMode(saved.mode || "default");
    setCwd(path);
    setNewName("");
    setSelected("");
    setDraftWorkspace(path);
    setTaskTab("work");
    setFocus(false);
    setView("overview");
    setTaskNav(false);
    setError("");
    setNotice("");
    visitProject(path);
    const url = new URL(location.href);
    url.searchParams.delete("thread");
    url.searchParams.set("workspace", path);
    history.replaceState(null, "", url);
  };
  useEffect(() => {
    if (draftWorkspace)
      sessionStorage.setItem(
        "samaya.new-draft." + draftWorkspace,
        JSON.stringify({
          text: goal,
          references: newReferences,
          mode: draftMode,
        }),
      );
  }, [draftWorkspace, goal, newReferences, draftMode]);
  useEffect(
    () => () => {
      if (!draftWorkspace) return;
      const key = "samaya.new-draft." + draftWorkspace;
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || "{}");
        if (saved.text?.startsWith("/")) {
          sessionStorage.setItem(
            key,
            JSON.stringify({ ...saved, text: "", references: [] }),
          );
        }
      } catch {
        /* An invalid draft is ignored when this workspace is opened again. */
      }
    },
    [draftWorkspace],
  );
  useEffect(() => {
    document.title =
      workMode && draftWorkspace
        ? `新会话 · ${shortProject(draftWorkspace)} — Samaya`
        : workMode && selectedRecord
          ? `${threadTitle(selectedRecord.thread)} · ${projectName(selectedRecord.thread)} — Samaya`
          : `${{ overview: "任务总览", pinned: "置顶任务", attention: "待我处理", settings: "设置与连接", usage: "使用情况", records: "会话记录", changes: "最近变化" }[view]} — Samaya`;
  }, [view, workMode, draftWorkspace, selectedRecord]);
  useTaskNotifications(records, open);
  const recentProjects = [
    ...new Set([
      ...projectVisits.filter((p) => projects.includes(p)),
      ...projects,
    ]),
  ].slice(0, 4);
  const selectOverviewProject = (path: string) => {
    const currentFilter = savedOverview.current.filter;
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
      className={`monitor-shell ${focus ? "focus-mode" : ""} ${workMode ? "task-is-open" : ""} ${taskNav ? "task-nav-open" : ""} ${overviewMode || (view === "records" && managedWorkspace) ? "overview-mode" : ""} ${view === "records" && managedWorkspace ? "workspace-management-mode" : ""} ${["settings", "usage"].includes(view) ? "settings-mode" : ""} `}
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
          (focus && viewport.width >= 1100) ||
          (viewport.width < 1100 && !taskNav)
        }
      >
        <div className="monitor-brand">
          <img src="/figma/samaya-symbol.svg" alt="" />
          Samaya
          <button
            type="button"
            className="quiet nav-collapse"
            aria-label={workMode ? "收起任务侧栏" : "收起工作台侧栏"}
            onClick={() => {
              if (viewport.width < 1100) setTaskNav(false);
              else {
                setFocus(true);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLElement>(
                      workMode ? ".task-sidebar-toggle" : ".mobile-nav-button",
                    )
                    ?.focus(),
                );
              }
            }}
          >
            ☰
          </button>
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
        <WorkspaceNavigation
          requests={requests}
          paths={[...projectVisits, ...projects]}
          records={records}
          selected={selected}
          connected={!!connected}
          open={open}
          create={startWorkspaceDraft}
          status={projectStatus}
          onAction={(id, action) => {
            setTaskNav(false);
            setSidebarCommand({ id, action });
          }}
          manage={(cwd) => {
            navigate("records");
            setManagedWorkspace(cwd);
            history.replaceState(
              null,
              "",
              "/sessions?cwd=" + encodeURIComponent(cwd),
            );
          }}
          onRename={async (id, value) =>
            !!(await run(
              "command",
              {
                threadId: id,
                command: "rename",
                args: { value },
                expectedTurnId: records.get(id)?.turn?.id || null,
              },
              { localFeedback: true, throwOnError: true },
            ))
          }
          onDelete={async (id, digest) => {
            const result = await run(
              "delete",
              { threadId: id, digest },
              { localFeedback: true, throwOnError: true },
            );
            if (!result) return false;
            if (selected === id) closeDetail();
            return true;
          }}
        />
        <div className="nav-bottom">
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
      {sidebarCommand && (
        <CommandDialog
          key={sidebarCommand.id + sidebarCommand.action}
          command={{
            name: sidebarCommand.action,
            description: "归档会话",
            kind: "native",
            enabled: true,
          }}
          args=""
          tid={sidebarCommand.id}
          run={(action, body) =>
            run(action, body, { localFeedback: true, throwOnError: true })
          }
          onRead={() => {}}
          close={() => setSidebarCommand(null)}
          done={() => {
            if (selected === sidebarCommand.id) closeDetail();
            setSidebarCommand(null);
          }}
        />
      )}
      <main
        id="monitor-main"
        className="monitor-main"
        inert={taskNav && viewport.width < 1100}
      >
        <header className="monitor-toolbar">
          <button
            className="mobile-nav-button"
            onClick={() => {
              if (viewport.width >= 1100) setFocus(false);
              else setTaskNav(true);
            }}
          >
            {focus ? "展开工作台侧栏" : "导航"}
          </button>
          <h1>
            {
              {
                overview: "全部任务",
                pinned: "置顶任务",
                attention: "待我处理",
                records: managedWorkspace
                  ? `${shortProject(managedWorkspace)} · 工作区管理`
                  : "记录管理",
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
                workspaceQuery={workspaceQuery}
                setWorkspaceQuery={(value) => {
                  setWorkspaceQuery(value);
                  if (value.trim()) {
                    setProject("");
                    setFilter("all");
                  }
                }}
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
            create={startWorkspaceDraft}
            connected={!!connected}
            visibleIds={new Set(matching.map((r) => r.thread.id))}
            records={records}
            requests={requests}
            project={project}
            initialized={!!data?.initialized}
            summary={sidebarSummary}
            activityClass={activityClass}
            open={open}
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
                    <div className="recent-scope">
                      <span>
                        {view === "attention"
                          ? `${requests.length} 项未解决请求`
                          : view === "pinned"
                            ? `${filtered.length} 个置顶任务`
                            : `${filtered.length} 个主任务`}
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
                              activity={activityClass(r)}
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
                    <div className="task-reading-heading">
                      <div className="task-title-status">
                        <h1
                          title={
                            draftWorkspace
                              ? `${shortProject(draftWorkspace)} / 新会话`
                              : selectedRecord
                                ? threadTitle(selectedRecord.thread)
                                : "正在载入任务…"
                          }
                        >
                          {draftWorkspace
                            ? `${shortProject(draftWorkspace)} / 新会话`
                            : selectedRecord
                              ? threadTitle(selectedRecord.thread)
                              : "正在载入任务…"}
                        </h1>
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
                        {!draftWorkspace && selectedRecord && (
                          <div
                            className="task-live-status"
                            role="status"
                            title={[
                              sidebarSummary(selectedRecord) ||
                                execution(selectedRecord),
                              execution(selectedRecord) === "执行中" &&
                              connected &&
                              selectedRecord.progressAt
                                ? `最近进展 ${clock(selectedRecord.progressAt)}`
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
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
                        )}
                      </div>
                    </div>

                    {error && !feedbackForCurrentTask && (
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
                      <img src="/figma/bell.svg" alt="" /> 待处理 {waitingCount}
                      {unknownCount ? ` · ${unknownCount} 待核对` : ""}
                    </button>
                    <button
                      className="quiet workspace-exceptions"
                      onClick={() => {
                        navigate("overview");
                        closeDetail();

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
                  {draftWorkspace ? (
                    <WorkspaceDraft
                      cwd={draftWorkspace}
                      value={goal}
                      change={setGoal}
                      references={newReferences}
                      onReferences={setNewReferences}
                      images={newImages}
                      onImages={setNewImages}
                      mode={draftMode}
                      onMode={setDraftMode}
                      disabled={!connected || !!busy || creatingNow}
                      modelSelector={
                        <ModelSelector
                          key={draftWorkspace}
                          cwd={draftWorkspace}
                          disabled={!connected || creatingNow}
                          busy={!!busy}
                          run={run}
                          inspectReceipts={() => setDialog("receipts")}
                          onDraftChange={setDraftModel}
                          onPendingChange={setDraftModelPending}
                        />
                      }
                      modelPending={draftModelPending}
                      submit={() => void create()}
                      tab={taskTab}
                      feedback={operationFeedback}
                    />
                  ) : selectedRecord ? (
                    <>
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
                              {selectedRecord.thread.historyNotice && (
                                <p role="status">
                                  {selectedRecord.thread.historyNotice}
                                </p>
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
                        {selectedRecord.thread.canAcceptDirectInput === false &&
                          selectedRecord.thread.parentThreadId && (
                            <button
                              className="quiet"
                              onClick={() =>
                                open(selectedRecord.thread.parentThreadId!)
                              }
                            >
                              此子任务为只读 · 返回主对话
                            </button>
                          )}
                        {taskTab === "work" && (
                          <PlanActions
                            key={selected}
                            tid={selected}
                            editable={
                              selectedRecord.thread.canAcceptDirectInput !==
                              false
                            }
                            run={run}
                            open={open}
                          />
                        )}
                        {taskTab === "work" &&
                          (
                            requestsByRoot.get(rootId(selected, records)) ||
                            EMPTY
                          ).map((p) => (
                            <div key={p.key} className="inline-decision">
                              {p.params.threadId !== selected && (
                                <p className="muted">
                                  {records.has(p.params.threadId)
                                    ? threadTitle(
                                        records.get(p.params.threadId)!.thread,
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
                                attentionActive={activityClass(
                                  selectedRecord,
                                ).includes("task-attention-live")}
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
                      </ReadingSurface>
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
                          submissionBlocked={false}
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
                          stop={() => {
                            if (
                              !connected ||
                              !selectedRecord.turn ||
                              selectedRecord.turn.status !== "inProgress"
                            )
                              return;
                            void run("interrupt", {
                              threadId: selectedRecord.thread.id,
                              turnId: selectedRecord.turn.id,
                            });
                          }}
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
        {view === "records" &&
          (managedWorkspace ? (
            <WorkspaceManagement
              key={managedWorkspace}
              cwd={managedWorkspace}
              connected={!!connected}
              records={records}
              back={() => navigate("overview")}
              create={() => {
                navigate("overview");
                startWorkspaceDraft(managedWorkspace);
              }}
              open={(id) => {
                navigate("overview");
                open(id);
              }}
            />
          ) : (
            <Records
              cwd=""
              connected={!!connected}
              open={(id) => {
                navigate("overview");
                open(id);
              }}
            />
          ))}
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
          project={(path) => {
            selectOverviewProject(path);
            setFilter("all");
            setWorkspaceQuery("");
          }}
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
                attentionActive={(() => {
                  const record = records.get(
                    rootId(activeRequest.params.threadId, records),
                  );
                  return (
                    !!record &&
                    activityClass(record).includes("task-attention-live")
                  );
                })()}
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
            <DirectoryPicker
              value={cwd}
              onChange={setCwd}
              onValidated={setConfirmedCwd}
            />
            <div className="task-composer">
              <ComposerInput
                modelSelector={
                  <ModelSelector
                    key={cwd}
                    cwd={confirmedCwd === cwd ? cwd : ""}
                    disabled={!connected || creatingNow || confirmedCwd !== cwd}
                    busy={!!busy}
                    run={run}
                    inspectReceipts={() => setDialog("receipts")}
                    onDraftChange={setDraftModel}
                    onPendingChange={setDraftModelPending}
                  />
                }
                submitDisabled={draftModelPending || creatingNow}
                label="工作要求"
                value={goal}
                onChange={setGoal}
                references={newReferences}
                onReferences={setNewReferences}
                images={newImages}
                onImages={setNewImages}
                cwd={confirmedCwd === cwd ? cwd : ""}
                disabled={!!busy || !connected || !cwd || confirmedCwd !== cwd}
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
                新会话默认读取当前工作目录的 Codex
                配置，可在输入框中调整。工作目录写入沙箱，审批按请求交由你处理。
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
                    acceptOperationReceipt(result);
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
        <span>待我处理</span>
        <span className="nav-pending-count">
          {count}
          {unknown ? " · 待核对" : ""}
        </span>
      </button>
    </nav>
  );
}
function TaskComposer({
  record,
  connected,
  busy,
  submissionBlocked,
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
  submissionBlocked: boolean;
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
  const [images, setImages] = useImageDraft("thread:" + id);
  const [files, setFiles] = useFileDraft("thread:" + id);
  const [draft, setDraft] = useState(() => {
    const saved = sessionStorage.getItem("samaya.draft." + id) || "";
    return saved.startsWith("/") ? "" : saved;
  });
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
    finish: () => void;
  } | null>(null);
  const [rename, setRename] = useState<{ value: string } | null>(null);
  const [modelPending, setModelPending] = useState(true);
  const [localError, setLocalError] = useState("");
  const [goalRefresh, setGoalRefresh] = useState(0);
  const failedDrafts = useCallback(
    () =>
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith("samaya.failedDraft." + id + "."))
        .map((key) => ({ key, text: sessionStorage.getItem(key) || "" })),
    [id],
  );
  const [failed, setFailed] = useState(failedDrafts);
  useEffect(() => {
    const restore = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          entry: { threadId?: string };
          receipt: Receipt;
          draft: string | null;
        }>
      ).detail;
      if (
        detail.entry.threadId === id &&
        detail.receipt.state === "failed" &&
        detail.draft
      ) {
        setDraft((current) => current || detail.draft || "");
        setFailed(failedDrafts());
      }
    };
    window.addEventListener("samaya:receipt-resolved", restore);
    return () => window.removeEventListener("samaya:receipt-resolved", restore);
  }, [id, failedDrafts]);
  const active = record.turn?.status === "inProgress";
  const mode = usePlanMode({
    tid: id,
    turnId: record.turn?.id,
    disabled:
      !connected ||
      record.thread.canAcceptDirectInput === false ||
      record.thread.historyAvailable === false ||
      !!record.error,
    busy,
    run: runSettings,
  });
  useEffect(() => {
    sessionStorage.setItem("samaya.draft." + id, draft);
    sessionStorage.setItem(
      "samaya.references." + id,
      JSON.stringify(references),
    );
  }, [id, draft, references]);
  useEffect(
    () => () => {
      if (sessionStorage.getItem("samaya.draft." + id)?.startsWith("/")) {
        sessionStorage.setItem("samaya.draft." + id, "");
        sessionStorage.setItem("samaya.references." + id, "[]");
      }
    },
    [id],
  );
  const cancelRename = () => {
    setRename(null);
    setLocalError("");
  };
  const saveRename = async () => {
    if (!rename || busy) return;
    const value = rename.value.trim();
    if (!value || value.length > 200) {
      setLocalError("名称需为 1–200 字");
      return;
    }
    setLocalError("");
    const result = await run("command", {
      threadId: id,
      command: "rename",
      args: { value },
      expectedTurnId: record.turn?.id || null,
    });
    if (result) {
      rememberPrompt(record.thread.cwd, "/rename " + value);
      setRename(null);
    }
  };
  const submit = async () => {
    if (
      busy ||
      submissionBlocked ||
      files.some((file) => file.status !== "ready")
    )
      return;
    const shell = shellInput(draft);
    if (
      shell !== null &&
      (!shell || images.length || files.length || references.length)
    ) {
      setLocalError(
        !shell ? "请在 ! 后输入命令" : "Shell 命令不能同时附带图片、文件或引用",
      );
      return;
    }
    setLocalError("");
    const submitted = draft;
    const r = await run(shell !== null ? "shell" : "send", {
      command: shell,
      threadId: id,
      text: draft,
      references,
      images: images.map(({ url }) => ({ url })),
      files: fileReferences(files),
      expectedCwd: record.thread.cwd,
      expectedTurnId: record.turn?.id || null,
      reconcileLatest: true,
    });
    if (r) {
      rememberPrompt(record.thread.cwd, submitted);
      setFiles((current) => current.filter((file) => !files.includes(file)));
      setDraft((current) => (current === submitted ? "" : current));
      setReferences((current) =>
        current.filter((r) => !references.includes(r)),
      );
      setImages((current) =>
        current.filter((image) => !images.includes(image)),
      );
    }
  };
  function consumeCommandDraft(source = draft, refs = references) {
    if (
      !source.startsWith("/") ||
      sessionStorage.getItem("samaya.draft." + id) !== source
    )
      return;
    sessionStorage.setItem("samaya.draft." + id, "");
    sessionStorage.setItem("samaya.references." + id, "[]");
    setDraft((current) => (current === source ? "" : current));
    setReferences((current) => current.filter((r) => !refs.includes(r)));
  }
  function invoke(item: SlashCommand, args: string) {
    const name = item.alias || item.name;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      rememberPrompt(
        record.thread.cwd,
        "/" + item.name + (args ? " " + args : ""),
      );
      consumeCommandDraft();
    };
    if (name === "rename" && item.enabled) {
      consumeCommandDraft();
      setLocalError("");
      setRename({ value: args || record.thread.name || "" });
      return;
    }
    if (name === "fork" && item.enabled) {
      setLocalError("");
      void run("command", {
        threadId: id,
        command: "fork",
        args: {},
        expectedTurnId: record.turn?.id || null,
      }).then((result) => {
        if (!result) return;
        finish();
        if (typeof result.result?.threadId === "string")
          open(result.result.threadId);
      });
      return;
    }
    if (name === "status") {
      void printStatus(id, record.turn?.id || null).then((success) => {
        if (success) finish();
      });
      return;
    }
    if (name === "init") {
      finish();
      setDraft(
        "检查当前项目，生成或完善根目录 AGENTS.md，保留已有有效约定。" +
          (args ? "\n" + args : ""),
      );
      return;
    }
    if (name === "copy") {
      void (async () => {
        try {
          if (!record.turn) throw new Error("当前没有可复制的回复");
          let cursor: string | null = null;
          do {
            const page: {
              data: { item: { type: string; text?: string } }[];
              nextCursor: string | null;
            } = await api(
              `/threads/${encodeURIComponent(id)}/turns/${encodeURIComponent(record.turn.id)}/items?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
            );
            const message = page.data.find(
              ({ item }) => item.type === "agentMessage" && item.text,
            );
            if (message?.item.text) {
              await navigator.clipboard.writeText(message.item.text);
              finish();
              return;
            }
            cursor = page.nextCursor;
          } while (cursor);
          setLocalError("当前轮次没有可复制的回复。");
        } catch {
          setLocalError("复制失败，请在正文复制。");
        }
      })();
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
      finish();
      navigateCommand(name);
      return;
    }
    setCommand({ item, args, finish });
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
      {failed.length > 0 && (
        <details className="failed-drafts">
          <summary>查看未发送的内容</summary>
          {failed.map((item) => (
            <div key={item.key}>
              <pre>{item.text}</pre>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.removeItem(item.key);
                  setFailed(failedDrafts());
                }}
              >
                移除
              </button>
            </div>
          ))}
        </details>
      )}
      {!command && feedback}
      <ComposerInput
        value={rename ? rename.value : draft}
        onChange={rename ? (value) => setRename({ value }) : setDraft}
        references={rename ? [] : references}
        onReferences={setReferences}
        images={rename ? [] : images}
        onImages={setImages}
        cwd={record.thread.cwd}
        threadId={id}
        modelSelector={
          !rename && (
            <ModelSelector
              key={id}
              tid={id}
              onPendingChange={setModelPending}
              model={record.thread.model}
              reasoningEffort={record.thread.reasoningEffort}
              serviceTier={record.thread.serviceTier}
              busy={busy}
              disabled={
                !connected ||
                record.thread.canAcceptDirectInput === false ||
                record.thread.historyAvailable === false ||
                !!record.error
              }
              run={runSettings}
              inspectReceipts={inspectReceipts}
            />
          )
        }
        stopDisabled={busy || submissionBlocked}
        submitDisabled={
          busy ||
          submissionBlocked ||
          (!rename && (mode.pending || modelPending))
        }
        modeControl={
          rename ? (
            <>
              <span>重命名会话</span>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={cancelRename}
              >
                取消
              </button>
            </>
          ) : (
            mode.control
          )
        }
        onToggleMode={rename ? undefined : () => void mode.toggle()}
        active={!rename && active}
        textOnly={!!rename}
        onCancel={cancelRename}
        submitLabel={rename ? "保存名称" : undefined}
        label={rename ? "会话新名称" : "补充当前任务"}
        placeholder={
          rename
            ? "输入会话名称…"
            : !connected || record.error
              ? "等待连接恢复…"
              : undefined
        }
        disabled={
          !connected ||
          (!!rename && busy) ||
          record.thread.canAcceptDirectInput === false ||
          record.thread.historyAvailable === false ||
          !!record.error
        }
        onSubmit={() => void (rename ? saveRename() : submit())}
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
          onRead={command.finish}
          done={(r) => {
            setGoalRefresh((n) => n + 1);
            if ((command.item.alias || command.item.name) === "plan")
              window.dispatchEvent(new Event("focus"));
            command.finish();
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
      <p className="usage-caption">管理界面外观、通知和连接状态</p>
      <section className="settings-section">
        <h3>界面外观</h3>
        <ThemeSelect segmented />
      </section>
      <NotificationSettings />
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
  cwd,
}: {
  connected: boolean;
  open: (id: string) => void;
  cwd: string;
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
  const loadVersion = useRef(0);
  const load = useCallback(
    async (more?: string) => {
      const version = ++loadVersion.current;
      try {
        const r = await api<{ data: Thread[]; nextCursor: string | null }>(
          `/threads?archived=${archived}${cwd ? "&cwd=" + encodeURIComponent(cwd) : ""}${more ? "&cursor=" + encodeURIComponent(more) : ""}`,
        );
        if (version !== loadVersion.current) return;
        const data = cwd
          ? r.data.filter((t) => t.cwd === cwd && !t.parentThreadId)
          : r.data;
        setRows((old) => (more ? [...old, ...data] : data));
        setCursor(r.nextCursor);
        setError("");
      } catch (e) {
        if (version === loadVersion.current) setError(String(e));
      }
    },
    [archived, cwd],
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
  const visibleRows = rows.filter(
    (t) =>
      (!search ||
        `${threadTitle(t)} ${t.cwd}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!older || now / 1000 - t.updatedAt > older * 86400),
  );
  return (
    <section className="monitor-page workspace-management">
      {cwd && <p className="workspace-management-path">{cwd}</p>}
      <p>归档保留历史；删除不可恢复。执行中或仍有后台活动时，清理会被阻止。</p>
      <div className="actions">
        <label>
          <input
            type="checkbox"
            disabled={busy || !!preview}
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setSelected([]);
            }}
          />
          已归档
        </label>
        <input
          disabled={busy || !!preview}
          aria-label="搜索记录"
          placeholder="搜索已加载记录"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelected([]);
          }}
        />
        <label>
          最近未活动
          <select
            disabled={busy || !!preview}
            value={older}
            onChange={(e) => {
              setOlder(Number(e.target.value));
              setSelected([]);
            }}
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
        {cwd && (
          <label>
            <input
              type="checkbox"
              aria-label="全选当前列表"
              disabled={busy || !!preview || !visibleRows.length}
              checked={
                !!visibleRows.length &&
                visibleRows.every((t) => selected.includes(t.id))
              }
              onChange={(e) =>
                setSelected(
                  e.target.checked ? visibleRows.map((t) => t.id) : [],
                )
              }
            />
            全选
          </label>
        )}
        <button
          disabled={!connected || busy || !!preview || !selected.length}
          onClick={() => void prepare(archived ? "unarchive" : "archive")}
        >
          {archived ? "恢复归档" : "归档"}
        </button>
        <button
          disabled={!connected || busy || !!preview || !selected.length}
          onClick={() => void prepare("delete")}
        >
          删除
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {results.map((text, i) => (
        <p className="workspace-operation-result" key={i}>
          {text}
        </p>
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
            {visibleRows.map((t) => (
              <tr key={t.id}>
                <td>
                  <input
                    aria-label={`选择 ${threadTitle(t)}`}
                    type="checkbox"
                    disabled={busy || !!preview}
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
      {!visibleRows.length && <p>没有符合条件的对话</p>}
      {cursor && (
        <button disabled={busy || !!preview} onClick={() => void load(cursor)}>
          加载更多记录
        </button>
      )}
      {preview && (
        <RecordsConfirmation
          inline={!!cwd}
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
              {p.error ? (
                <p role="alert">
                  {p.id}：无法核对影响范围：{p.error}
                </p>
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
                const label = rows.find((t) => t.id === p.id)
                  ? threadTitle(rows.find((t) => t.id === p.id)!)
                  : p.id;
                if (p.error || !p.value) {
                  next.push(`${label}：未执行，影响范围未确认`);
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
                    `${label}：${!r ? "失败或结果待确认，请核查回执" : items?.some((i) => i.state !== "succeeded") ? "部分失败：" + items.map((i) => i.id + " " + i.state).join("；") : "已确认"}`,
                  );
                } catch (e) {
                  next.push(`${label}：${String(e)}`);
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
        </RecordsConfirmation>
      )}
    </section>
  );
}

function RecordsConfirmation({
  inline,
  title,
  close,
  children,
}: {
  inline: boolean;
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return inline ? (
    <section className="records-confirmation" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  ) : (
    <Modal title={title} close={close}>
      {children}
    </Modal>
  );
}

function WorkspaceDraft({
  cwd,
  value,
  change,
  references,
  onReferences,
  images,
  onImages,
  mode,
  onMode,
  disabled,
  submit,
  tab,
  feedback,
  modelSelector,
  modelPending,
}: {
  cwd: string;
  value: string;
  change: (value: string) => void;
  references: InputReference[];
  onReferences: (value: InputReference[]) => void;
  images: InputImage[];
  onImages: Dispatch<SetStateAction<InputImage[]>>;
  mode: string;
  onMode: (value: string) => void;
  disabled: boolean;
  submit: () => void;
  tab: string;
  feedback: ReactNode;
  modelSelector: ReactNode;
  modelPending: boolean;
}) {
  const [commandError, setCommandError] = useState("");
  const plan = usePlanMode({
    disabled,
    busy: false,
    value: mode,
    onChange: onMode,
  });
  return (
    <div className="workspace-draft">
      <div className="draft-introduction">
        {tab === "work" ? (
          <>
            <h2>新会话 · {shortProject(cwd)}</h2>
            <p>写下这次要做的事。</p>
            <small>{cwd}</small>
          </>
        ) : (
          <section aria-label="改动与结果">
            <p>发送工作要求创建会话后，这里显示改动与产物。</p>
          </section>
        )}
      </div>
      <footer className="detail-footer">
        <div className="task-composer">
          {feedback}
          {commandError && <p role="alert">{commandError}</p>}
          <ComposerInput
            label="新会话工作要求"
            value={value}
            onChange={change}
            references={references}
            onReferences={onReferences}
            images={images}
            onImages={onImages}
            cwd={cwd}
            disabled={disabled}
            modelSelector={modelSelector}
            submitDisabled={plan.pending || modelPending}
            placeholder={`在 ${shortProject(cwd)} 中发送消息…`}
            modeControl={plan.control}
            onToggleMode={() => void plan.toggle()}
            onSubmit={submit}
            onCommand={() =>
              setCommandError(
                "先发送工作要求创建会话，再使用会话命令；计划模式可直接在输入框内切换。",
              )
            }
          />
        </div>
      </footer>
    </div>
  );
}
