import { WorkspaceMenu, HiddenWorkspaces } from "./WorkspaceMenu";
import {
  orderAt,
  workspaceOrder,
  workspaceRecency,
  type WorkspaceVisibility,
} from "./workspace-visibility";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  execution,
  projectName,
  rootId,
  threadTitle,
  waitingUnknown,
} from "./monitor";
import type { Observation } from "./monitor";
import { workspaceActivity } from "./workspace-activity";
import type { Pending } from "./types";

function groupPreferences() {
  try {
    return JSON.parse(sessionStorage.getItem("samaya.overview.groups") || "{}");
  } catch {
    return {};
  }
}

export function TaskOverview({
  records,
  requests,
  project,
  initialized,
  summary,
  activityClass,
  open,
  controls,
  visibleIds,
  create,
  connected,
  visibility,
  manage,
  searching,
}: {
  records: Map<string, Observation>;
  requests: Pending[];
  project: string;
  initialized: boolean;
  summary: (r: Observation) => string;
  activityClass: (r: Observation) => string;
  open: (id: string) => void;
  controls: ReactNode;
  visibleIds: Set<string>;
  create: (cwd: string) => void;
  searching: boolean;
  connected: boolean;
  visibility: WorkspaceVisibility;
  manage: (cwd: string) => void;
}) {
  const activity = workspaceActivity(records, connected, requests);
  const allRoots = [...records.values()].filter(
    (r) => !r.thread.parentThreadId || !records.has(r.thread.parentThreadId),
  );
  const roots = allRoots.filter(
    (r) =>
      (!r.thread.parentThreadId || !records.has(r.thread.parentThreadId)) &&
      (!project || r.thread.cwd === project) &&
      visibleIds.has(r.thread.id) &&
      (searching || !visibility.hidden.has(r.thread.cwd)),
  );
  const pendingIds = new Set(
    requests.map((p) => rootId(p.params.threadId, records)),
  );
  const questionIds = new Set(
    requests
      .filter((p) => p.params.questions?.length && !p.responseState)
      .map((p) => rootId(p.params.threadId, records)),
  );
  for (const r of records.values())
    if (
      waitingUnknown(
        r,
        requests.filter((p) => p.params.threadId === r.thread.id),
      )
    )
      pendingIds.add(rootId(r.thread.id, records));
  const [limits, setLimits] = useState<Record<string, number>>(
    () => groupPreferences().limits || {},
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    () => groupPreferences().collapsed || {},
  );
  const list = useRef<HTMLDivElement>(null);
  const position = useRef(groupPreferences().scroll || 0);
  useEffect(() => {
    sessionStorage.setItem(
      "samaya.overview.groups",
      JSON.stringify({ limits, collapsed, scroll: position.current }),
    );
  }, [limits, collapsed]);
  useLayoutEffect(() => {
    if (initialized && list.current) list.current.scrollTop = position.current;
  }, [initialized]);
  const prefix = useId();
  const recency = workspaceRecency(records);
  const ordering = workspaceOrder(records);
  const byWorkspace = new Map<string, Observation[]>();
  for (const r of roots) {
    const key = r.thread.cwd || "";
    const tasks = byWorkspace.get(key) || [];
    tasks.push(r);
    byWorkspace.set(key, tasks);
  }
  const workspaces = [...byWorkspace]
    .map(([cwd, tasks]) => ({
      cwd,
      tasks: tasks.sort(
        (a, b) =>
          orderAt(b) - orderAt(a) || a.thread.id.localeCompare(b.thread.id),
      ),
      updatedAt: recency.get(cwd) || 0,
    }))
    .sort(
      (a, b) =>
        (ordering.get(b.cwd) || 0) - (ordering.get(a.cwd) || 0) ||
        a.cwd.localeCompare(b.cwd),
    );
  const row = (r: Observation) => (
    <button
      className={`overview-task ${pendingIds.has(r.thread.id) ? "needs-attention" : ""} ${activityClass(r)}`}
      key={r.thread.id}
      data-task-id={r.thread.id}
      aria-label={`${threadTitle(r.thread)} · ${summary(r) || execution(r)}`}
      onClick={() => open(r.thread.id)}
    >
      <span>
        <strong>{threadTitle(r.thread)}</strong>
        <small>
          {projectName(r.thread)} ·{" "}
          {(summary(r) || execution(r)).replace(/^(运行中|待你处理) · /, "")}
        </small>
      </span>
      <span className="overview-action">
        {questionIds.has(r.thread.id) &&
        activityClass(r).includes("task-attention-live")
          ? "回答问题"
          : "进入对话"}
      </span>
    </button>
  );
  return (
    <section className="task-overview" aria-label="任务总览">
      <header>
        <h1>任务总览</h1>
      </header>
      {controls}
      {!initialized ? (
        <>
          <p role="status">正在读取任务…</p>
        </>
      ) : (
        <>
          <section
            aria-label="最近活跃的工作区"
            className="overview-workspaces"
          >
            <header>
              <h2>最近活跃的工作区</h2>
              <div className="workspace-list-heading">
                <HiddenWorkspaces visibility={visibility} />
                <small>{workspaces.length} 个工作区</small>
              </div>
            </header>
            <div
              ref={list}
              onScroll={(e) => {
                position.current = e.currentTarget.scrollTop;
                sessionStorage.setItem(
                  "samaya.overview.groups",
                  JSON.stringify({
                    limits,
                    collapsed,
                    scroll: position.current,
                  }),
                );
              }}
              className="overview-workspace-scroll"
              tabIndex={0}
              role="region"
              aria-label="工作区列表"
            >
              {workspaces.map(({ cwd, tasks, updatedAt }) => {
                const limit = limits[cwd] || 5;
                const remaining = Math.max(0, tasks.length - limit);
                const name = projectName(tasks[0].thread);
                const bodyId = `${prefix}-${encodeURIComponent(cwd)}`;
                const pendingCount = tasks.filter((r) =>
                  pendingIds.has(r.thread.id),
                ).length;
                return (
                  <section
                    className={`overview-workspace ${(activity.get(cwd)?.running.size || 0) > 0 ? "workspace-running" : ""}`}
                    key={cwd}
                    data-workspace={cwd}
                    aria-label={`${name} 工作区`}
                  >
                    <header>
                      <h3>
                        <button
                          type="button"
                          className="workspace-toggle"
                          aria-expanded={!collapsed[cwd]}
                          aria-controls={bodyId}
                          aria-label={`${collapsed[cwd] ? "展开" : "折叠"} ${name} 工作区`}
                          onClick={() =>
                            setCollapsed((old) => ({
                              ...old,
                              [cwd]: !old[cwd],
                            }))
                          }
                        >
                          <span className="workspace-identity">
                            <img
                              className="workspace-chevron-light"
                              src="/figma/workspace-chevron.svg"
                              alt=""
                            />
                            <img
                              className="workspace-chevron-dark"
                              src="/figma/workspace-chevron-dark.svg"
                              alt=""
                            />
                            <span>
                              <span className="workspace-name">{name}</span>
                              <small className="workspace-path" title={cwd}>
                                {cwd || "未提供目录"}
                              </small>
                            </span>
                          </span>
                          <small className="workspace-metadata">
                            {tasks.length} 个任务
                            {!!activity.get(cwd)?.running.size &&
                              ` · 运行中 ${activity.get(cwd)!.running.size}`}
                            {!!activity.get(cwd)?.uncertain.size &&
                              " · 状态待确认"}
                            {pendingCount > 0 && ` · 待处理 ${pendingCount}`} ·
                            最近活动{" "}
                            {updatedAt
                              ? new Date(updatedAt * 1000).toLocaleString(
                                  "zh-CN",
                                  {
                                    month: "numeric",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )
                              : "尚未确认"}
                          </small>
                        </button>
                      </h3>
                      <button
                        type="button"
                        className="workspace-create"
                        disabled={!connected || !cwd}
                        aria-label={`在 ${name} 工作区新建会话`}
                        title={`在 ${name} 工作区新建会话`}
                        onClick={() => create(cwd)}
                      >
                        <span aria-hidden="true">＋</span>
                        <span className="workspace-create-label">新建会话</span>
                      </button>
                      <WorkspaceMenu
                        cwd={cwd}
                        manage={manage}
                        visibility={visibility}
                      />
                    </header>
                    <div
                      id={bodyId}
                      className="workspace-tasks"
                      hidden={!!collapsed[cwd]}
                    >
                      {tasks.slice(0, limit).map(row)}
                      {remaining > 0 && (
                        <button
                          className="quiet workspace-expand"
                          onClick={() =>
                            setLimits((old) => ({ ...old, [cwd]: limit + 5 }))
                          }
                        >
                          再展开 {Math.min(5, remaining)} 个任务 · 还剩{" "}
                          {remaining} 个
                        </button>
                      )}
                      {limit > 5 && (
                        <button
                          className="quiet workspace-expand"
                          onClick={() =>
                            setLimits((old) => ({ ...old, [cwd]: 5 }))
                          }
                        >
                          收起到最近 5 个
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
              {!workspaces.length && (
                <p className="overview-empty">
                  当前范围没有任务，可新建任务或调整筛选。
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
