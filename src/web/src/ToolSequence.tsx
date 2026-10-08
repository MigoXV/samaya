import { useRef, useState } from "react";
import type { ReactNode } from "react";

export function ToolSequence({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details
      ref={ref}
      className="tool-sequence"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary aria-label={expanded ? "收起工具调用详情" : "展开工具调用详情"}>
        <span>{count > 1 ? "已进行一系列工具调用" : "已进行工具调用"}</span>
        <span className="tool-sequence-action">
          {expanded ? "收起详情" : "查看详情"}
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
