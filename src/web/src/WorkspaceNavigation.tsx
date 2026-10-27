import { WorkspaceMenu, HiddenWorkspaces } from "./WorkspaceMenu";
import { activityAt, type WorkspaceVisibility } from "./workspace-visibility";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ChevronRight, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { threadTitle } from "./monitor";
import { workspaceActivity } from "./workspace-activity";
import { api } from "./api";
import { rememberPrompt } from "./prompt-history";
import type { Pending, Preview } from "./types";
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
  onAction,
  onDelete,
  onRename,
  manage,
  visibility,
}: {
  visibility: WorkspaceVisibility;
  paths: string[];
  records: Map<string, Observation>;
  requests: Pending[];
  selected: string;
  connected: boolean;
  open: (id: string) => void;
  create: (cwd: string) => void;
  status: (cwd: string) => string;
  onAction: (id: string, action: "archive") => void;
  onDelete: (id: string, digest: string) => Promise<boolean>;
  onRename: (id: string, value: string) => Promise<boolean>;
  manage: (cwd: string) => void;
}) {
  const [menu, setMenu] = useState<{
    id: string;
    x: number;
    y: number;
    anchor: HTMLElement;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const deleteSequence = useRef(0);
  const [deletion, setDeletion] = useState<{
    loading: boolean;
    preview?: Preview;
    error?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rename, setRename] = useState<{
    id: string;
    value: string;
    error?: string;
  } | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const renameLive = useRef<{ id: string; value: string } | null>(null);
  const renameBusy = useRef(false);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    if (rename?.id) {
      renameInput.current?.focus({ preventScroll: true });
      renameInput.current?.select();
    }
  }, [rename?.id]);
  function cancelRename() {
    renameLive.current = null;
    setRename(null);
  }
  async function saveRename() {
    const draft = renameLive.current;
    if (!draft || renameBusy.current) return;
    const value = draft.value.trim();
    if (!value || value.length > 200) {
      setRename({ ...draft, error: "名称需为 1–200 字" });
      return;
    }
    renameBusy.current = true;
    setRenaming(true);
    try {
      if (await onRename(draft.id, value)) {
        const cwd = records.get(draft.id)?.thread.cwd;
        if (cwd) rememberPrompt(cwd, "/rename " + value);
        if (renameLive.current?.id === draft.id) cancelRename();
      }
    } catch (error) {
      if (renameLive.current?.id === draft.id)
        setRename({ ...draft, error: String(error) });
    } finally {
      renameBusy.current = false;
      setRenaming(false);
    }
  }
  const closeMenu = (restore = false) => {
    deleteSequence.current++;
    if (restore) menu?.anchor.focus({ preventScroll: true });
    setMenu(null);
  };
  useEffect(() => {
    if (!menu) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !menu.anchor.contains(event.target as Node)
      )
        setMenu(null);
    };
    const close = () => setMenu(null);
    const scroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", scroll, { capture: true, passive: true });
    window.addEventListener("touchmove", scroll, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", scroll, true);
      window.removeEventListener("touchmove", scroll, true);
    };
  }, [menu]);
  function showMenu(id: string, x: number, y: number, anchor: HTMLElement) {
    deleteSequence.current++;
    setDeletion(null);
    setMenu({
      id,
      x: Math.max(8, Math.min(x, innerWidth - 216)),
      y: Math.max(8, Math.min(y, innerHeight - 120)),
      anchor,
    });
  }
  async function prepareDelete() {
    if (!menu || deleting) return;
    const target = menu.id,
      sequence = ++deleteSequence.current;
    setDeletion({ loading: true });
    try {
      const preview = await api<Preview>(
        `/threads/${encodeURIComponent(target)}/cleanup-preview`,
      );
      if (sequence === deleteSequence.current)
        setDeletion({ loading: false, preview });
    } catch (error) {
      if (sequence === deleteSequence.current)
        setDeletion({ loading: false, error: String(error) });
    }
  }
  async function confirmDelete() {
    if (!menu || deleting || deletion?.loading) return;
    if (!deletion?.preview) {
      void prepareDelete();
      return;
    }
    const target = menu.id,
      sequence = deleteSequence.current;
    setDeleting(true);
    try {
      if (await onDelete(target, deletion.preview.digest)) {
        if (sequence === deleteSequence.current) closeMenu(true);
      }
    } catch (error) {
      if (sequence === deleteSequence.current)
        setDeletion({ loading: false, error: String(error) });
    } finally {
      setDeleting(false);
    }
  }
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
  const orderedPaths = [...new Set(paths)].filter(
    (cwd) => !visibility.hidden.has(cwd),
  );
  return (
    <nav className="nav-workspaces" aria-label="工作区会话">
      <div className="workspace-list-heading">
        <span className="eyebrow">工作区</span>
        <HiddenWorkspaces visibility={visibility} />
      </div>
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
              activityAt(b) - activityAt(a) ||
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
              <WorkspaceMenu
                cwd={cwd}
                manage={manage}
                visibility={visibility}
              />
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
                  <div
                    key={r.thread.id}
                    className={
                      "nav-conversation-row " +
                      (activity.get(cwd)?.running.has(r.thread.id)
                        ? "conversation-running"
                        : "")
                    }
                    onContextMenu={(event) => {
                      if ((event.target as HTMLElement).closest("input"))
                        return;
                      event.preventDefault();
                      showMenu(
                        r.thread.id,
                        event.clientX,
                        event.clientY,
                        event.currentTarget.querySelector("button")!,
                      );
                    }}
                  >
                    {rename?.id === r.thread.id ? (
                      <div className="nav-conversation-edit">
                        <input
                          ref={renameInput}
                          aria-label="对话新名称"
                          value={rename.value}
                          disabled={renaming}
                          onChange={(event) => {
                            const value = event.target.value;
                            renameLive.current = { id: r.thread.id, value };
                            setRename({ id: r.thread.id, value });
                          }}
                          onBlur={() => void saveRename()}
                          onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) return;
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveRename();
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              cancelRename();
                            }
                          }}
                        />
                        {rename.error && (
                          <small role="alert">{rename.error}</small>
                        )}
                      </div>
                    ) : (
                      <button
                        className="nav-conversation"
                        data-conversation-id={r.thread.id}
                        title={threadTitle(r.thread)}
                        aria-current={
                          r.thread.id === selected ? "page" : undefined
                        }
                        onClick={() => open(r.thread.id)}
                      >
                        <span className="nav-conversation-title">
                          {threadTitle(r.thread)}
                        </span>
                        {activity.get(cwd)?.running.has(r.thread.id) && (
                          <small className="nav-conversation-status">
                            运行中
                          </small>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      className="nav-conversation-more"
                      aria-label={`更多操作：${threadTitle(r.thread)}`}
                      aria-haspopup="menu"
                      aria-expanded={menu?.id === r.thread.id}
                      onClick={(event) => {
                        if (menu?.id === r.thread.id) {
                          closeMenu(true);
                          return;
                        }
                        const box = event.currentTarget.getBoundingClientRect();
                        showMenu(
                          r.thread.id,
                          box.right,
                          box.bottom,
                          event.currentTarget,
                        );
                      }}
                    >
                      <Ellipsis size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {!tasks.length && <small>暂无会话</small>}
                {tasks.length > limit && (
                  <button
                    className="nav-show-more"
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
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="对话操作"
            className="conversation-menu"
            style={{
              left: menu.x,
              top: menu.y,
              maxHeight: `calc(100dvh - ${menu.y + 8}px)`,
            }}
            onKeyDown={(event) => {
              const items = Array.from(
                menuRef.current?.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]',
                ) || [],
              );
              const index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                items[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length
                ]?.focus();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeMenu(true);
              }
              if (event.key === "Tab") closeMenu(true);
            }}
          >
            {(
              [
                ["rename", "重命名", Pencil],
                ["archive", "归档", Archive],
                ["delete", "删除", Trash2],
              ] as const
            ).map(([action, label, Icon]) => (
              <button
                key={action}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={
                  !connected ||
                  !records.has(menu.id) ||
                  deleting ||
                  renaming ||
                  (action === "delete" && !!deletion?.loading)
                }
                aria-busy={
                  action === "delete" && (!!deletion?.loading || deleting)
                }
                className={
                  action === "delete" ? "conversation-menu-delete" : undefined
                }
                onClick={() => {
                  const id = menu.id;
                  if (action === "delete") {
                    void (deletion ? confirmDelete() : prepareDelete());
                    return;
                  }
                  closeMenu(true);
                  if (action === "rename") {
                    const value = records.get(id)?.thread.name || "";
                    renameLive.current = { id, value };
                    setRename({ id, value });
                    return;
                  }
                  onAction(id, action);
                }}
              >
                <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                {action === "delete" && deletion ? "确定删除" : label}
              </button>
            ))}
            {deletion?.preview && deletion.preview.scope.length > 1 && (
              <small className="conversation-menu-note">
                将同时删除 {deletion.preview.scope.length}{" "}
                个会话（含子会话），无法撤销。
              </small>
            )}
            {deletion?.error && (
              <small className="conversation-menu-note" role="alert">
                {deletion.error}
              </small>
            )}
          </div>,
          document.body,
        )}
    </nav>
  );
}
