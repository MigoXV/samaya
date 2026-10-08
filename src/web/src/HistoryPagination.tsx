import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export type HistoryPage = {
  ready: boolean;
  cursor: string | null;
  error: string;
  load: () => Promise<number>;
  retry: () => Promise<number>;
};

// One reader-facing boundary owns both native pagination levels.
export function HistoryPagination({
  region,
  pages,
  hasEarlierTurns,
  loadEarlierTurns,
  error,
  retryTurns,
}: {
  region: RefObject<HTMLElement | null>;
  pages: (HistoryPage | undefined)[];
  hasEarlierTurns: boolean;
  loadEarlierTurns: () => Promise<number>;
  error: string;
  retryTurns: () => Promise<unknown>;
}) {
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const busy = useRef(false);
  const initialDone = useRef(false);
  const armed = useRef(false);
  const batch = useRef<{ height: number; requests: number } | null>(null);
  const pageError = pages.find((p) => p?.error);
  const failure = error || pageError?.error;
  const ready = pages.every((p) => p?.ready);
  const more = hasEarlierTurns || pages.some((p) => p?.cursor);

  useEffect(() => {
    const reader = region.current?.closest<HTMLElement>(".detail-scroll");
    if (!reader) return;
    let active = true;
    let previousTop = reader.scrollTop;
    let touchY = 0;
    const check = () => {
      if (!active || busy.current || failure || !ready) return;
      if (!more) {
        batch.current = null;
        initialDone.current = true;
        return;
      }
      // Decision panels elsewhere in the reader do not count as recovered conversation.
      const height = region.current?.scrollHeight || reader.scrollHeight;
      const target = reader.clientHeight * 2;
      if (!batch.current) {
        if (!initialDone.current && height >= target)
          initialDone.current = true;
        if (initialDone.current && !(armed.current && reader.scrollTop <= 240))
          return;
        batch.current = { height, requests: 0 };
      }
      const incomplete = pages.find((p) => p?.cursor);
      if (
        batch.current.requests + (incomplete ? 1 : 2) > 6 ||
        height - batch.current.height >= target
      ) {
        batch.current = null;
        initialDone.current = true;
        armed.current = false;
        return;
      }
      const action = incomplete ? incomplete.load : loadEarlierTurns;
      busy.current = true;
      setLoading(true);
      void action()
        .then((requests) => {
          if (batch.current) batch.current.requests += requests;
        })
        .finally(() => {
          busy.current = false;
          setLoading(false);
          setRevision((n) => n + 1);
        });
    };
    const scroll = () => {
      if (reader.scrollTop < previousTop) armed.current = true;
      previousTop = reader.scrollTop;
      check();
    };
    const wheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        armed.current = true;
        check();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
        armed.current = true;
        check();
      }
    };
    const touchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY || 0;
    };
    const touchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY || 0;
      if (y > touchY) {
        armed.current = true;
        check();
      }
      touchY = y;
    };
    reader.addEventListener("scroll", scroll);
    reader.addEventListener("wheel", wheel, { passive: true });
    reader.addEventListener("keydown", key);
    reader.addEventListener("touchstart", touchStart, { passive: true });
    reader.addEventListener("touchmove", touchMove, { passive: true });
    // Commit/layout and the child's paging report must settle before choosing the next cursor.
    const frame = requestAnimationFrame(check);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      reader.removeEventListener("scroll", scroll);
      reader.removeEventListener("wheel", wheel);
      reader.removeEventListener("keydown", key);
      reader.removeEventListener("touchstart", touchStart);
      reader.removeEventListener("touchmove", touchMove);
    };
  }, [region, pages, ready, more, failure, loadEarlierTurns, revision]);

  async function retry() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    batch.current = null;
    armed.current = true;
    initialDone.current = false;
    try {
      await (error ? retryTurns() : pageError?.retry());
    } finally {
      busy.current = false;
      setLoading(false);
      setRevision((n) => n + 1);
    }
  }

  return (
    <div className="history-pagination">
      {failure ? (
        <span role="alert" title={failure}>
          更早对话加载失败{" "}
          <button onClick={() => void retry()} disabled={loading}>
            重试
          </button>
        </span>
      ) : loading || !ready ? (
        <span role="status">
          <span className="history-loading-icon" aria-hidden="true">
            ◌
          </span>{" "}
          正在载入更早对话…
        </span>
      ) : !more ? (
        <span>已到对话起点</span>
      ) : null}
    </div>
  );
}
