import { useEffect, useRef, useState } from "react";
import { shortProject } from "./project-navigation";

const overviewStates = [
  ["all", "全部状态"],
  ["running", "运行中"],
  ["pending", "待我处理"],
  ["ended", "本轮已结束"],
  ["issues", "异常与待确认"],
] as const;

export function OverviewScope({
  project,
  projects,
  recent,
  status,
  selectProject,
  filter,
  selectFilter,
  openProjects,
  setOpenProjects,
  create,
  connected,
}: {
  project: string;
  projects: string[];
  recent: string[];
  status: (path: string) => string;
  selectProject: (path: string) => void;
  filter: string;
  selectFilter: (value: string) => void;
  openProjects: boolean;
  setOpenProjects: (value: boolean) => void;
  create: () => void;
  connected: boolean;
}) {
  const [query, setQuery] = useState("");
  const [openStatus, setOpenStatus] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const projectTrigger = useRef<HTMLButtonElement>(null);
  const statusTrigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (openProjects) input.current?.focus();
    if (!openProjects && !openStatus) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpenProjects(false);
        setOpenStatus(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      (openProjects ? projectTrigger : statusTrigger).current?.focus();
      setOpenProjects(false);
      setOpenStatus(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [openProjects, openStatus, setOpenProjects]);
  const choose = (path: string) => {
    selectProject(path);
    setOpenProjects(false);
    setQuery("");
    projectTrigger.current?.focus();
  };
  const matches = projects.filter((p) =>
    p.toLowerCase().includes(query.toLowerCase()),
  );
  const option = (path: string) => (
    <button
      type="button"
      key={path}
      title={path}
      aria-pressed={project === path}
      onClick={() => choose(path)}
    >
      <span>{shortProject(path)}</span>
      <small>{project === path ? "✓" : status(path)}</small>
    </button>
  );
  return (
    <div className="overview-scope" ref={ref}>
      <div className="scope-control">
        <button
          className="quiet scope-trigger"
          ref={projectTrigger}
          aria-expanded={openProjects}
          aria-controls="project-scope-popup"
          onClick={() => {
            setOpenProjects(!openProjects);
            setOpenStatus(false);
            setQuery("");
          }}
        >
          {project ? shortProject(project) : "所有项目"}{" "}
          <span aria-hidden="true">⌄</span>
        </button>
        {openProjects && (
          <div
            className="scope-popup project-scope-popup"
            id="project-scope-popup"
            role="region"
            aria-label="选择项目"
          >
            <input
              ref={input}
              aria-label="搜索项目"
              placeholder="搜索项目…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              aria-pressed={!project}
              onClick={() => choose("")}
            >
              <span>所有项目</span>
              <span>{!project ? "✓" : ""}</span>
            </button>
            <div className="scope-options">
              {!query && recent.length > 0 && (
                <>
                  <small className="scope-caption">最近使用</small>
                  {recent.filter((p) => projects.includes(p)).map(option)}
                </>
              )}
              <small className="scope-caption">
                {query ? "搜索结果" : "其他项目"}
              </small>
              {matches.filter((p) => query || !recent.includes(p)).map(option)}
              {query && !matches.length && <p role="status">没有匹配项目</p>}
            </div>
          </div>
        )}
      </div>
      <div className="scope-control">
        <button
          className="quiet scope-trigger"
          ref={statusTrigger}
          aria-expanded={openStatus}
          aria-controls="status-scope-popup"
          onClick={() => {
            setOpenStatus(!openStatus);
            setOpenProjects(false);
          }}
        >
          {overviewStates.find(([value]) => value === filter)?.[1] ||
            "全部状态"}{" "}
          <span aria-hidden="true">⌄</span>
        </button>
        {openStatus && (
          <div
            className="scope-popup status-scope-popup"
            id="status-scope-popup"
            role="group"
            aria-label="选择状态"
          >
            {overviewStates.map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => {
                  selectFilter(value);
                  setOpenStatus(false);
                  statusTrigger.current?.focus();
                }}
              >
                <span>{label}</span>
                <span>{filter === value ? "✓" : ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        className="primary scope-create"
        disabled={!connected}
        onClick={create}
      >
        ＋ 新任务
      </button>
    </div>
  );
}
