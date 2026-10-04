import { useEffect, useRef, useState } from "react";
import { execution, progress, projectName, threadTitle } from "./monitor";
import type { Observation } from "./monitor";
import "./search-palette.css";

function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  return at < 0 ? (
    text
  ) : (
    <>
      {text.slice(0, at)}
      <strong>{text.slice(at, at + query.length)}</strong>
      {text.slice(at + query.length)}
    </>
  );
}
export function SearchPalette({
  records,
  recent,
  close,
  open,
  project,
  file,
}: {
  records: Observation[];
  recent: string[];
  close: () => void;
  open: (id: string) => void;
  project: (path: string) => void;
  file: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const rows = useRef<HTMLButtonElement[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current!;
    el.showModal();
    input.current?.focus();
    return () => {
      el.close();
      previous?.focus();
    };
  }, []);
  const q = query.trim();
  const matches = (text: string) =>
    text.toLowerCase().includes(q.toLowerCase());
  const tasks = q
    ? records.filter((r) =>
        matches(
          [threadTitle(r.thread), r.thread.cwd, progress(r).text].join(" "),
        ),
      )
    : recent.length
      ? recent
          .map((id) => records.find((r) => r.thread.id === id))
          .filter((r): r is Observation => !!r)
      : records.slice(0, 3);
  const results = tasks.map((r) => ({
    key: r.thread.id,
    title: threadTitle(r.thread),
    meta: `${projectName(r.thread)} · ${execution(r)}`,
    type: "任务",
    icon: "clock",
    action: () => open(r.thread.id),
  }));
  if (q) {
    for (const path of new Set(records.map((r) => r.thread.cwd))) {
      if (path && matches(path))
        results.push({
          key: `project:${path}`,
          title: path.split("/").filter(Boolean).at(-1) || path,
          meta: path,
          type: "项目",
          icon: "folder",
          action: () => project(path),
        });
    }
    const seen = new Set<string>();
    for (const r of records)
      for (const item of r.turn?.items || [])
        for (const change of item.changes || []) {
          const key = `${r.thread.id}:${change.path}`;
          if (!seen.has(key) && matches(change.path)) {
            seen.add(key);
            results.push({
              key,
              title: change.path.split("/").at(-1) || change.path,
              meta: `${projectName(r.thread)} · ${change.path}`,
              type: "文件",
              icon: "file",
              action: () => file(r.thread.id),
            });
          }
        }
  }
  const visible = results.slice(0, 50);
  const choose = (index: number) => {
    visible[index]?.action();
    close();
  };
  return (
    <dialog
      ref={dialog}
      className="search-palette"
      aria-label="搜索任务与项目"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const b = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < b.left ||
            e.clientX > b.right ||
            e.clientY < b.top ||
            e.clientY > b.bottom
          )
            close();
        }
      }}
    >
      <div className="search-field">
        <img src="/figma/search.svg" alt="" />
        <input
          ref={input}
          type="search"
          aria-label="统一搜索"
          placeholder="搜索任务、项目和已记录的文件"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (["ArrowDown", "ArrowUp"].includes(e.key) && visible.length) {
              e.preventDefault();
              const next =
                (active + (e.key === "ArrowDown" ? 1 : -1) + visible.length) %
                visible.length;
              setActive(next);
              rows.current[next]?.scrollIntoView({ block: "nearest" });
            } else if (e.key === "Enter" && visible.length) {
              e.preventDefault();
              choose(active);
            }
          }}
        />
        <button aria-label="关闭对话框" onClick={close}>
          <img src="/figma/search-close.svg" alt="" />
        </button>
      </div>
      {!q && <p className="search-recent">最近</p>}
      <div className="palette-results" aria-label="搜索结果">
        {visible.map((r, i) => (
          <button
            key={r.key}
            ref={(el) => {
              if (el) rows.current[i] = el;
            }}
            className={i === active ? "active" : ""}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(i)}
          >
            <img src={`/figma/search-${r.icon}.svg`} alt="" />
            <span className="palette-text">
              <span>
                <Highlight text={r.title} query={q} />
              </span>
              <small>
                <Highlight text={r.meta} query={q} />
              </small>
            </span>
            <span className="palette-type">{r.type}</span>
          </button>
        ))}
        {!visible.length && (
          <p className="search-empty" role="status">
            没有找到匹配结果
          </p>
        )}
      </div>
      <footer>↑ ↓ 选择 Enter 打开 Esc 关闭</footer>
    </dialog>
  );
}
