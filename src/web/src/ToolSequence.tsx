import { useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Item } from "./types";

export function ToolSequence({
  items,
  children,
}: {
  items: Item[];
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  const completed = items.every(
    (item) =>
      !["inProgress", "interrupted", "failed"].includes(item.status ?? "") &&
      (item.exitCode == null || item.exitCode === 0) &&
      (item.status === "completed" || item.exitCode === 0),
  );
  const running = items.some((item) => item.status === "inProgress");
  return (
    <details
      ref={ref}
      className="tool-sequence"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary aria-label={expanded ? "收起工具调用详情" : "展开工具调用详情"}>
        <span className="tool-sequence-state" aria-hidden="true">
          {completed ? (
            <>
              <img
                className="tool-icon-light"
                src="/figma/tool-completed.svg"
                alt=""
              />
              <img
                className="tool-icon-dark"
                src="/figma/tool-completed-dark.svg"
                alt=""
              />
            </>
          ) : (
            <span>{running ? "◌" : "!"}</span>
          )}
        </span>
        <span className="tool-sequence-label">
          {completed ? "完成" : running ? "正在进行" : "已进行"} {items.length}{" "}
          次工具调用
        </span>
        <span className="tool-sequence-disclosure" aria-hidden="true">
          <img
            className="tool-icon-light"
            src="/figma/tool-disclosure.svg"
            alt=""
          />
          <img
            className="tool-icon-dark"
            src="/figma/tool-disclosure-dark.svg"
            alt=""
          />
        </span>
      </summary>
      <div className="tool-sequence-details">
        {children}
        <button
          type="button"
          className="quiet tool-sequence-close"
          onClick={() => {
            setExpanded(false);
            ref.current?.querySelector("summary")?.focus();
          }}
        >
          收起详情
        </button>
      </div>
    </details>
  );
}
