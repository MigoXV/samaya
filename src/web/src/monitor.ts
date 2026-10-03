import type { Pending, Terminal, Thread, Turn } from "./types";
export type Observation = {
  thread: Thread;
  turn: Turn | null;
  terminals: Terminal[];
  confirmedAt: number | null;
  progressAt: number | null;
  eventAt?: number;
  error: string | null;
  requestsUnknown?: number;
  plan?: {
    explanation?: string | null;
    steps: { step: string; status: string }[];
  } | null;
};
export type Change = { id: string; threadId: string; at: number; kind: string };
export type MonitorSnapshot = {
  records: Observation[];
  revision: number;
  generation: string;
  cursor: number;
  connection: string;
  initialized: boolean;
  catalogAt: number;
  catalogError: string | null;
  pendingRequests: Pending[];
  requestKeys?: string[];
  requestStates?: string[];
  removed?: string[];
  changes: Change[];
  requestCoverage: string;
};
export const threadTitle = (t: Thread) =>
  t.name || t.preview?.split("\n")[0].slice(0, 120) || "未命名任务";
export const projectName = (t: Thread) =>
  t.cwd?.split("/").filter(Boolean).at(-1) || "未提供目录";
export const clock = (n?: number | null) =>
  n
    ? new Date(n * 1000).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "尚未确认";
export function execution(r: Observation): string {
  const status = r.thread.status?.type,
    turn = r.turn;
  if (status === "systemError") return "会话异常";
  if (status === "active") return "执行中";
  if (turn?.status === "inProgress")
    return status === "idle" ? "状态待确认" : "执行中";
  if (turn?.status === "completed") return "本轮已结束";
  if (turn?.status === "interrupted") return "本轮已中断";
  if (turn?.status === "failed") return "本轮失败";
  if (turn) return `未映射状态：${turn.status}`;
  if (
    status &&
    !["active", "idle", "notLoaded", "systemError"].includes(status)
  )
    return `状态待确认：${status}`;
  return r.confirmedAt ? "尚无执行轮次" : "状态待确认";
}
export function progress(r: Observation): { text: string; source: string } {
  if (r.turn?.error?.message)
    return { text: r.turn.error.message, source: "Codex 轮次错误" };
  if (r.turn?.status === "interrupted")
    return {
      text: "服务端确认本轮已中断；未提供更具体原因。文件和后台进程未自动回滚或终止。",
      source: "轮次状态",
    };
  if (r.turn?.status === "failed")
    return {
      text: "服务端报告本轮失败，未提供错误说明；请展开执行记录核对。",
      source: "轮次状态",
    };
  const items = r.turn?.items || [];
  const failed = [...items]
    .reverse()
    .find(
      (i) =>
        i.status === "failed" ||
        (i.type === "commandExecution" &&
          i.exitCode != null &&
          i.exitCode !== 0),
    );
  if (failed)
    return {
      text: `${failed.command || failed.type} · ${failed.exitCode != null ? `退出码 ${failed.exitCode}` : "执行失败"}`,
      source: "工具结果",
    };
  const step = r.plan?.steps.find((s) => s.status === "inProgress");
  if (step && r.turn?.status === "inProgress")
    return { text: step.step, source: "原生计划 · 当前步骤" };
  const active = [...items]
    .reverse()
    .find((i) => i.status === "inProgress" && i.type !== "reasoning");
  const last =
    active ||
    [...items].reverse().find((i) => i.type === "agentMessage") ||
    [...items]
      .reverse()
      .find((i) => !["reasoning", "userMessage"].includes(i.type));
  if (last?.type === "agentMessage")
    return {
      text: last.text || "已收到回复；展开查看内容",
      source: "AI 说明 · 非验收结论",
    };
  if (last?.type === "commandExecution")
    return {
      text: `${last.status === "inProgress" ? "命令执行中" : last.exitCode != null ? `命令退出码 ${last.exitCode}` : "命令状态 " + (last.status || "待确认")}：${last.command || "展开执行记录"}`,
      source: "命令事件",
    };
  if (last?.type === "fileChange")
    return {
      text: `文件变更 ${last.changes?.length ?? ""} 项 · ${last.status || "状态待确认"}`,
      source: "文件事件 · 非整个目录归属",
    };
  if (last?.type === "mcpToolCall")
    return {
      text: `工具 ${String(last.tool || last.name || "调用")} · ${last.status || "状态待确认"}`,
      source: "工具事件",
    };
  if (last)
    return {
      text: `活动：${last.type} · ${last.status || "已观察到"}`,
      source: "Codex 事件",
    };
  return {
    text: r.turn ? "当前可观察轮次：" + execution(r) : "尚无可确认的执行进展",
    source: "当前状态",
  };
}
export function recentFact(r: Observation): string | null {
  const item = [...(r.turn?.items || [])]
    .reverse()
    .find(
      (i) =>
        (i.type === "commandExecution" && i.exitCode != null) ||
        (i.type === "fileChange" && i.status === "completed"),
    );
  if (!item) return null;
  return item.type === "commandExecution"
    ? `命令退出码 ${item.exitCode}：${item.command || "命令"}`
    : `已记录 ${item.changes?.length || 0} 项文件变更`;
}
export function rootId(id: string, records: Map<string, Observation>): string {
  const seen = new Set<string>();
  let current = id;
  while (records.get(current)?.thread.parentThreadId && !seen.has(current)) {
    seen.add(current);
    const parent = records.get(current)!.thread.parentThreadId!;
    if (!records.has(parent)) break;
    current = parent;
  }
  return current;
}
export function requestLabel(p: Pending) {
  if (p.responseState === "sent") return "等待答复确认";
  if (p.responseState === "uncertain") return "核查答复";
  if (p.responseState === "submitting") return "正在发送";
  if (p.mcp?.mode === "url") return "处理外部操作";
  return p.params.questions?.some((q) => q.options?.length)
    ? "选择方案"
    : p.params.questions
      ? "补充信息"
      : p.method === "mcpServer/elicitation/request"
        ? "处理 MCP 请求"
        : "处理授权";
}
export function waitingUnknown(r: Observation, requests: Pending[]) {
  return (
    !requests.length &&
    (!!r.requestsUnknown ||
      !!r.thread.status.activeFlags?.some(
        (f) => f === "waitingOnApproval" || f === "waitingOnUserInput",
      ))
  );
}
