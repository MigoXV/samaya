import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ellipsis, EyeOff, Settings2 } from "lucide-react";
import type { WorkspaceVisibility } from "./workspace-visibility";

export function WorkspaceMenu({
  cwd,
  manage,
  visibility,
}: {
  cwd: string;
  manage: (cwd: string) => void;
  visibility: WorkspaceVisibility;
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const name = cwd.split("/").filter(Boolean).at(-1) || cwd;
  useEffect(() => {
    const row = anchor.current?.closest(
      ".nav-workspace-heading, .overview-workspace > header",
    );
    if (!row) return;
    const show = (e: Event) => {
      const event = e as MouseEvent;
      event.preventDefault();
      setPoint({ x: event.clientX, y: event.clientY });
    };
    row.addEventListener("contextmenu", show);
    return () => row.removeEventListener("contextmenu", show);
  }, []);
  useLayoutEffect(() => {
    if (!point || !menu.current) return;
    const box = menu.current.getBoundingClientRect();
    menu.current.style.left = `${Math.max(8, Math.min(point.x, innerWidth - box.width - 8))}px`;
    menu.current.style.top = `${Math.max(8, Math.min(point.y, innerHeight - box.height - 8))}px`;
    menu.current.querySelector<HTMLButtonElement>("button")?.focus();
  }, [point]);
  useEffect(() => {
    if (!point) return;
    const outside = (e: Event) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !anchor.current?.contains(e.target as Node)
      )
        setPoint(null);
    };
    const close = () => setPoint(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    document.addEventListener("wheel", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      document.removeEventListener("wheel", outside, true);
    };
  }, [point]);
  return (
    <>
      <button
        ref={anchor}
        className="nav-workspace-manage"
        aria-label={`${name} 工作区菜单`}
        aria-haspopup="menu"
        aria-expanded={!!point}
        onClick={() => {
          const box = anchor.current!.getBoundingClientRect();
          setPoint(point ? null : { x: box.left, y: box.bottom + 4 });
        }}
      >
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {point &&
        createPortal(
          <div
            ref={menu}
            className="conversation-menu workspace-menu"
            role="menu"
            aria-label={`${name} 工作区操作`}
            style={{ left: point.x, top: point.y }}
            onKeyDown={(e) => {
              const buttons = [...e.currentTarget.querySelectorAll("button")];
              if (e.key === "Escape") {
                setPoint(null);
                anchor.current?.focus();
              }
              if (e.key === "Tab") setPoint(null);
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                buttons[
                  (buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  ) +
                    (e.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                    buttons.length
                ]?.focus();
              }
            }}
          >
            <button
              role="menuitem"
              onClick={() => {
                setPoint(null);
                manage(cwd);
              }}
            >
              <Settings2 size={16} />
              工作区管理
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setPoint(null);
                visibility.hide(cwd);
              }}
            >
              <EyeOff size={16} />
              暂时隐藏
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

export function HiddenWorkspaces({
  visibility,
}: {
  visibility: WorkspaceVisibility;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  if (!visibility.hidden.size) return null;
  return (
    <div
      ref={root}
      className="hidden-workspaces"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        className="quiet"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        已隐藏 {visibility.hidden.size}
      </button>
      {open && (
        <div className="hidden-workspace-list" aria-label="恢复隐藏工作区">
          {[...visibility.hidden].map((cwd) => (
            <button
              className="quiet"
              key={cwd}
              title={cwd}
              onClick={() => visibility.restore(cwd)}
            >
              恢复 {cwd.split("/").filter(Boolean).at(-1) || cwd}
            </button>
          ))}
          <button
            className="quiet"
            onClick={() => {
              visibility.restore();
              setOpen(false);
            }}
          >
            全部恢复
          </button>
        </div>
      )}
    </div>
  );
}
