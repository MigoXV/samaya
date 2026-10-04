import type { Item } from "./types";

// Only native item state and exit codes establish execution status.
function toolState(item: Item) {
  if (item.status === "inProgress") return { mark: "◌", label: "运行中" };
  if (item.status === "interrupted") return { mark: "!", label: "已中断" };
  if (
    item.status === "failed" ||
    (item.exitCode != null && item.exitCode !== 0)
  )
    return { mark: "!", label: "失败" };
  if (item.status === "completed" || item.exitCode === 0)
    return { mark: "✓", label: "已完成" };
  return { mark: "?", label: "状态待确认" };
}
export function ToolSummary({ item, label }: { item: Item; label: string }) {
  const state = toolState(item);
  return (
    <>
      <img className="tool-chevron" src="/figma/tool-chevron.svg" alt="" />
      <span className="tool-state-mark" aria-hidden="true">
        {state.mark}
      </span>
      <span className="tool-preview" title={label}>
        {label}
      </span>
      <span className="tool-state">
        {state.label}
        {item.exitCode != null && (
          <span className="tool-exit"> · 退出码 {item.exitCode}</span>
        )}
      </span>
    </>
  );
}
