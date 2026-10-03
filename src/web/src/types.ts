import type { McpPresentation } from "./mcp-schema";
export type Item = {
  id: string;
  type: string;
  text?: string;
  content?: { type: string; text?: string }[];
  command?: string;
  cwd?: string;
  status?: string;
  aggregatedOutput?: string;
  exitCode?: number;
  changes?: { path: string; kind: unknown; diff?: string }[];
  [key: string]: unknown;
};
export type Turn = {
  id: string;
  status: string;
  items: Item[];
  error?: { message: string };
};
export type Thread = {
  id: string;
  name?: string;
  preview: string;
  cwd: string;
  updatedAt: number;
  status: { type: string; activeFlags?: string[] };
  parentThreadId?: string;
  turns?: Turn[];
  canAcceptDirectInput?: boolean;
  archived?: boolean;
  model?: string;
};
export type Pending = {
  key: string;
  id: string | number;
  method: string;
  mcp?: McpPresentation;
  responseState?: "submitting" | "sent" | "uncertain";
  params: {
    threadId: string;
    turnId?: string | null;
    serverName?: string;
    message?: string;
    command?: string;
    cwd?: string;
    reason?: string;
    permissions?: Record<string, unknown>;
    questions?: {
      id: string;
      header: string;
      question: string;
      options?: { label: string; description: string }[];
      isSecret?: boolean;
    }[];
  };
};
export type Snapshot = {
  thread: Thread;
  pendingRequests: Pending[];
  cursor: number;
  historyNotice?: string;
  subscriptionNotice?: string;
  toolProgress?: Record<string, string>;
};
export type Terminal = {
  itemId: string;
  processId: string;
  command: string;
  cwd?: string;
  osPid?: number;
};
export type Status = {
  connection: string;
  error?: string;
  cursor: number;
  roots: string[];
  socket: string;
  sdkVersion: string;
  runtime: { userAgent?: string };
};
export type Receipt = {
  operationId: string;
  state: "pending" | "succeeded" | "failed" | "uncertain";
  result?: Record<string, unknown>;
};
export type Preview = {
  digest: string;
  scope: { id: string; name: string; cwd: string; status: { type: string } }[];
};
