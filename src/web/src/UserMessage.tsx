import { useEffect, useId, useRef, useState } from "react";
import type { Item } from "./types";
import { preserveMessagePosition } from "./reading-position";
import "./user-message.css";

export function UserMessage({ item }: { item: Item }) {
  const text =
    item.content?.map((c) => c.text || "").join("\n") || item.text || "";
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const message = useRef<HTMLElement>(null);
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
      setOverflow(node.scrollHeight > lineHeight * 6 + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const frame = requestAnimationFrame(measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [text]);
  return (
    <section ref={message} className="message user">
      <div className="eyebrow">你</div>
      <div
        id={id}
        ref={ref}
        className="prose user-message-text"
        data-collapsed={!expanded}
      >
        {text}
      </div>
      {overflow && (
        <button
          type="button"
          className="user-message-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          aria-label={expanded ? "收起用户消息全文" : "展开用户消息全文"}
          onClick={() => {
            preserveMessagePosition(message.current);
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "收起" : "展开全文"}
          <span
            className="user-message-chevron"
            data-expanded={expanded}
            aria-hidden="true"
          >
            <img
              className="chevron-light"
              src="/figma/workspace-chevron.svg"
              alt=""
            />
            <img
              className="chevron-dark"
              src="/figma/workspace-chevron-dark.svg"
              alt=""
            />
          </span>
        </button>
      )}
    </section>
  );
}
