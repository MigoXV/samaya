import { useState } from "react";
import type { ReactNode } from "react";
import {
  execution,
  projectName,
  requestLabel,
  rootId,
  threadTitle,
  waitingUnknown,
} from "./monitor";
import type { Observation } from "./monitor";
import type { Pending } from "./types";

export function TaskOverview({
  records,
  requests,
  project,
  initialized,
  summary,
  open,
  decide,
  all,
  attention,
  controls,
  visibleIds,
}: {
  records: Map<string, Observation>;
  requests: Pending[];
  project: string;
  initialized: boolean;
  summary: (r: Observation) => string;
  open: (id: string) => void;
  decide: (id: string, requestKey: string) => void;
  all: () => void;
  attention: () => void;
  controls: ReactNode;
  visibleIds: Set<string>;
}) {
  const roots = [...records.values()].filter(
    (r) =>
      (!r.thread.parentThreadId || !records.has(r.thread.parentThreadId)) &&
      (!project || r.thread.cwd === project) &&
      visibleIds.has(r.thread.id),
  );
  const pending = requests.filter(
    (p) =>
      (!project ||
        records.get(rootId(p.params.threadId, records))?.thread.cwd ===
          project) &&
      visibleIds.has(rootId(p.params.threadId, records)),
  );
  const uncertainRequests = roots.filter((r) =>
    waitingUnknown(
      r,
      requests.filter((p) => p.params.threadId === r.thread.id),
    ),
  );
  const [limits, setLimits] = useState<Record<string, number>>({});
  const activityAt = (r: Observation) =>
    Math.max(r.thread.updatedAt || 0, r.progressAt || 0);
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
          activityAt(b) - activityAt(a) ||
          a.thread.id.localeCompare(b.thread.id),
      ),
      updatedAt: Math.max(...tasks.map(activityAt)),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.cwd.localeCompare(b.cwd));
  const row = (r: Observation) => (
    <button
      className="overview-task"
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
  return (
    <section className="task-overview" aria-label="任务总览">
      <header>
        <h1>任务总览</h1>
      </header>
      {controls}
      {!initialized ? (
        <p role="status">正在读取任务…</p>
      ) : (
        <>
          <section aria-label="待我处理预览">
            <header>
              <h2>待我处理 · {pending.length} 项请求</h2>
              <button className="quiet" onClick={attention}>
                查看全部 →
              </button>
            </header>
            {pending.slice(0, 2).map((p) => {
              const id = rootId(p.params.threadId, records),
                r = records.get(id);
              return (
                <button
                  key={p.key}
                  className="overview-task attention-preview"
                  onClick={() => decide(id, p.key)}
                >
                  <span>
                    <strong>
                      {r ? threadTitle(r.thread) : p.params.threadId}
                    </strong>
                    <small>
                      {r ? projectName(r.thread) + " · " : ""}
                      {requestLabel(p)}
                    </small>
                  </span>
                  <span className="overview-action">处理请求</span>
                </button>
              );
            })}
            {uncertainRequests.length > 0 && (
              <button className="quiet" onClick={attention}>
                另有 {uncertainRequests.length} 个任务的请求待核对 →
              </button>
            )}
            {!pending.length && !uncertainRequests.length && (
              <p className="overview-empty">暂无待处理请求</p>
            )}
          </section>
          <section
            aria-label="最近活跃的工作区"
            className="overview-workspaces"
          >
            <header>
              <h2>最近活跃的工作区</h2>
              <small>{workspaces.length} 个工作区</small>
            </header>
            {workspaces.map(({ cwd, tasks, updatedAt }) => {
              const limit = limits[cwd] || 5;
              const remaining = Math.max(0, tasks.length - limit);
              return (
                <section
                  className="overview-workspace"
                  key={cwd}
                  data-workspace={cwd}
                  aria-label={`${projectName(tasks[0].thread)} 工作区`}
                >
                  <header>
                    <div>
                      <h3>{projectName(tasks[0].thread)}</h3>
                      <small className="workspace-path" title={cwd}>
                        {cwd || "未提供目录"}
                      </small>
                    </div>
                    <small>
                      {tasks.length} 个任务 · 最近活动{" "}
                      {updatedAt
                        ? new Date(updatedAt * 1000).toLocaleString("zh-CN", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "尚未确认"}
                    </small>
                  </header>
                  {tasks.slice(0, limit).map(row)}
                  {remaining > 0 && (
                    <button
                      className="quiet workspace-expand"
                      onClick={() =>
                        setLimits((old) => ({ ...old, [cwd]: limit + 5 }))
                      }
                    >
                      再展开 {Math.min(5, remaining)} 个任务 · 还剩 {remaining}{" "}
                      个
                    </button>
                  )}
                  {limit > 5 && (
                    <button
                      className="quiet workspace-expand"
                      onClick={() => setLimits((old) => ({ ...old, [cwd]: 5 }))}
                    >
                      收起到最近 5 个
                    </button>
                  )}
                </section>
              );
            })}
            {!workspaces.length && (
              <p className="overview-empty">
                当前范围没有任务，可新建任务或调整筛选。
              </p>
            )}
          </section>
        </>
      )}
      <footer>
        <button className="quiet" onClick={all}>
          查看全部任务 →
        </button>
        <small>完整任务与历史记录按需查看</small>
      </footer>
    </section>
  );
}
