import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { threadTitle } from "./monitor";
import { workspaceActivity } from "./workspace-activity";
import type { Pending } from "./types";
import type { Observation } from "./monitor";

function saved(): Record<string, boolean> {
  try {
    return JSON.parse(
      sessionStorage.getItem("samaya.sidebar.workspaces") || "{}",
    );
  } catch {
    return {};
  }
}
export function WorkspaceNavigation({
  paths,
  records,
  requests,
  selected,
  connected,
  open,
  create,
  status,
}: {
  paths: string[];
  records: Map<string, Observation>;
  requests: Pending[];
  selected: string;
  connected: boolean;
  open: (id: string) => void;
  create: (cwd: string) => void;
  status: (cwd: string) => string;
}) {
  const [expanded, setExpanded] = useState(saved);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [more, setMore] = useState(false);
  const selectedCwd = records.get(selected)?.thread.cwd;
  const [lastSelection, setLastSelection] = useState("");
  if (lastSelection !== selected) {
    setLastSelection(selected);
    if (selectedCwd) setExpanded((old) => ({ ...old, [selectedCwd]: true }));
  }
  useEffect(() => {
    sessionStorage.setItem(
      "samaya.sidebar.workspaces",
      JSON.stringify(expanded),
    );
  }, [expanded]);
  const activity = workspaceActivity(records, connected, requests);
  const orderedPaths = [
    ...new Set([...(selectedCwd ? [selectedCwd] : []), ...paths]),
  ];
  return (
    <nav className="nav-workspaces" aria-label="工作区会话">
      <span className="eyebrow">工作区</span>
      {(more ? orderedPaths : orderedPaths.slice(0, 4)).map((cwd) => {
        const name = cwd.split("/").filter(Boolean).at(-1) || cwd;
        const tasks = [...records.values()]
          .filter(
            (r) =>
              r.thread.cwd === cwd &&
              !r.thread.parentThreadId &&
              !r.thread.archived,
          )
          .sort(
            (a, b) =>
              b.thread.updatedAt - a.thread.updatedAt ||
              a.thread.id.localeCompare(b.thread.id),
          );
        const count = activity.get(cwd)?.running.size || 0,
          uncertain = activity.get(cwd)?.uncertain.size || 0;
        const limit = limits[cwd] || 10;
        return (
          <section
            key={cwd}
            className={count ? "workspace-running" : ""}
            data-sidebar-workspace={cwd}
          >
            <div className="nav-workspace-heading">
              <button
                title={cwd}
                aria-expanded={!!expanded[cwd]}
                onClick={() =>
                  setExpanded((old) => ({ ...old, [cwd]: !old[cwd] }))
                }
              >
                <ChevronRight
                  className="workspace-disclosure"
                  size={16}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span>{name}</span>
                <small>
                  {count
                    ? `运行中 ${count}`
                    : uncertain
                      ? "待确认"
                      : status(cwd).replace("运行中", "")}
                </small>
              </button>
              <button
                className="nav-workspace-create"
                disabled={!connected}
                aria-label={`在 ${name} 工作区新建会话`}
                onClick={() => create(cwd)}
              >
                ＋
              </button>
            </div>
            {expanded[cwd] && (
              <div className="nav-workspace-threads">
                {tasks.slice(0, limit).map((r) => (
                  <button
                    key={r.thread.id}
                    className={
                      activity.get(cwd)?.running.has(r.thread.id)
                        ? "conversation-running"
                        : undefined
                    }
                    data-conversation-id={r.thread.id}
                    title={threadTitle(r.thread)}
                    aria-current={r.thread.id === selected ? "page" : undefined}
                    onClick={() => open(r.thread.id)}
                  >
                    <span className="nav-conversation-title">
                      {threadTitle(r.thread)}
                    </span>
                    {activity.get(cwd)?.running.has(r.thread.id) && (
                      <small className="nav-conversation-status">运行中</small>
                    )}
                  </button>
                ))}
                {!tasks.length && <small>暂无会话</small>}
                {tasks.length > limit && (
                  <button
                    onClick={() =>
                      setLimits((old) => ({ ...old, [cwd]: limit + 10 }))
                    }
                  >
                    再显示 {Math.min(10, tasks.length - limit)} 个会话
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
      {orderedPaths.length > 4 && (
        <button className="quiet" onClick={() => setMore(!more)}>
          {more ? "收起工作区" : `更多工作区 · ${orderedPaths.length - 4}`}
        </button>
      )}
    </nav>
  );
}
