import type { Thread } from "./types";
export const statusName = (thread?: Thread) => {
  if (!thread) return "状态未知";
  const state = thread.status?.type;
  if (state === "active")
    return thread.status.activeFlags?.some((f) => /waiting/i.test(f))
      ? "等待输入"
      : "运行中";
  return (
    (
      { idle: "空闲", notLoaded: "未加载", systemError: "异常" } as Record<
        string,
        string
      >
    )[state] || "状态未知"
  );
};
