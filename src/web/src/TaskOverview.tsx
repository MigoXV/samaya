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
  open,
  all,
  controls,
  visibleIds,
}: {
  records: Map<string, Observation>;
  requests: Pending[];
  project: string;
  initialized: boolean;
  summary: (r: Observation) => string;
  open: (id: string) => void;
  all: () => void;
  controls: ReactNode;
  visibleIds: Set<string>;
}) {
  const allRoots = [...records.values()].filter(
    (r) => !r.thread.parentThreadId || !records.has(r.thread.parentThreadId),
  );
  const roots = allRoots.filter(
    (r) =>
      (!r.thread.parentThreadId || !records.has(r.thread.parentThreadId)) &&
      (!project || r.thread.cwd === project) &&
      visibleIds.has(r.thread.id),
  );
  const pendingIds = new Set(
    requests.map((p) => rootId(p.params.threadId, records)),
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
  const activityAt = (r: Observation) =>
    r.thread.recencyAt ?? r.thread.updatedAt ?? 0;
  const workspaceRecency = new Map<string, number>();
  for (const r of allRoots)
    workspaceRecency.set(
      r.thread.cwd || "",
      Math.max(workspaceRecency.get(r.thread.cwd || "") || 0, activityAt(r)),
    );
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
          Number(pendingIds.has(b.thread.id)) -
            Number(pendingIds.has(a.thread.id)) ||
          activityAt(b) - activityAt(a) ||
          a.thread.id.localeCompare(b.thread.id),
      ),
      updatedAt: workspaceRecency.get(cwd) || 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.cwd.localeCompare(b.cwd));
  const row = (r: Observation) => (
    <button
      className={`overview-task${pendingIds.has(r.thread.id) ? " needs-attention" : ""}`}
      key={r.thread.id}
      data-task-id={r.thread.id}
      onClick={() => open(r.thread.id)}
    >
      <span>
        <strong>{threadTitle(r.thread)}</strong>
        <small>
          {projectName(r.thread)} · {summary(r) || execution(r)}
        </small>
      </span>
      <span className="overview-action">进入对话</span>
    </button>
  );
  const footer = (
    <footer>
      <button className="quiet" onClick={all}>
        查看全部任务 →
      </button>
      <small>完整任务与历史记录按需查看</small>
    </footer>
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
          {footer}
        </>
      ) : (
        <>
          <section
            aria-label="最近活跃的工作区"
            className="overview-workspaces"
          >
            <header>
              <h2>最近活跃的工作区</h2>
              <small>{workspaces.length} 个工作区</small>
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
                    className="overview-workspace"
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
              {footer}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
