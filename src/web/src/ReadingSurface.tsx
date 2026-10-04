import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// Position is local to one workspace visit; entering a conversation starts at its tail.
const positions = new Map<string, number>();
export function ReadingSurface({
  tid,
  tab,
  visit,
  children,
}: {
  tid: string;
  tab: string;
  visit: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(false);
  const [away, setAway] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current!;
    const key = `${visit}:${tid}:${tab}`;
    const target = positions.get(key) ?? (tab === "work" ? Infinity : 0);
    let restoring = Number.isFinite(target);
    let prepend: { top: number; height: number } | null = null;
    let frame = 0;
    follow.current = target === Infinity;
    const distance = () =>
      Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
    const updateButton = () =>
      setAway(distance() > Math.max(1200, el.clientHeight * 2));
    const restore = () => {
      if (prepend) {
        el.scrollTop = prepend.top + el.scrollHeight - prepend.height;
        prepend = null;
      } else if (follow.current) {
        el.scrollTop = el.scrollHeight;
      } else if (restoring) {
        el.scrollTop = target;
        if (el.scrollHeight - el.clientHeight >= target) restoring = false;
      }
      updateButton();
    };
    const interact = () => {
      restoring = false;
      follow.current = false;
    };
    const wheel = (e: WheelEvent) => {
      if (e.deltaY < 0) interact();
    };
    const keydown = (e: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(e.key)) interact();
    };
    const scroll = () => {
      if (!restoring && !prepend) {
        follow.current = distance() <= 32;
        positions.set(key, follow.current ? Infinity : el.scrollTop);
      }
      updateButton();
    };
    const preserve = () => {
      interact();
      prepend = { top: el.scrollTop, height: el.scrollHeight };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(restore);
    };
    restore();
    const observer = new ResizeObserver(restore);
    observer.observe(el.firstElementChild!);
    observer.observe(el);
    el.addEventListener("scroll", scroll);
    el.addEventListener("wheel", wheel, { passive: true });
    el.addEventListener("touchstart", interact, { passive: true });
    el.addEventListener("pointerdown", interact);
    el.addEventListener("keydown", keydown);
    el.addEventListener("samaya:prepend-history", preserve);
    return () => {
      positions.set(key, follow.current ? Infinity : el.scrollTop);
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("scroll", scroll);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("touchstart", interact);
      el.removeEventListener("pointerdown", interact);
      el.removeEventListener("keydown", keydown);
      el.removeEventListener("samaya:prepend-history", preserve);
      if (positions.size > 100)
        positions.delete(positions.keys().next().value!);
    };
  }, [tid, tab, visit]);
  return (
    <div className="reading-surface">
      <div
        className="detail-scroll"
        ref={ref}
        tabIndex={0}
        aria-label="任务阅读区"
      >
        <div className="reading-content">{children}</div>
      </div>
      {away && (
        <button
          className="jump-latest"
          onClick={() => {
            follow.current = true;
            ref.current!.scrollTop = ref.current!.scrollHeight;
            setAway(false);
          }}
        >
          返回最新消息
        </button>
      )}
    </div>
  );
}
