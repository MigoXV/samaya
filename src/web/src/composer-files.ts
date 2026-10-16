import { useCallback, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import { api } from "./api";

export type FileDraft = {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  file: File;
  attachmentId?: string;
  error?: string;
};
const MAX_FILES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const drafts = new Map<string, FileDraft[]>();
const empty: FileDraft[] = [];
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
export const fileScope = (cwd: string, tid?: string) =>
  tid ? `thread:${tid}` : `workspace:${cwd}`;
export function setFileDraft(scope: string, files: FileDraft[]) {
  if (files.length) drafts.set(scope, files);
  else drafts.delete(scope);
  listeners.forEach((listener) => listener());
}
export function useFileDraft(scope: string) {
  const files = useSyncExternalStore(
    useCallback((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, []),
    () => drafts.get(scope) || empty,
  );
  const update: Dispatch<SetStateAction<FileDraft[]>> = useCallback(
    (value) => {
      const current = drafts.get(scope) || empty;
      setFileDraft(scope, typeof value === "function" ? value(current) : value);
    },
    [scope],
  );
  return [files, update] as const;
}
export const fileReferences = (files: FileDraft[]) =>
  files.map((file) => ({ id: file.attachmentId! }));
async function upload(
  scope: string,
  entry: FileDraft,
  cwd: string,
  tid?: string,
) {
  const controller = new AbortController();
  controllers.set(entry.id, controller);
  const update = (fields: Partial<FileDraft>) =>
    setFileDraft(
      scope,
      (drafts.get(scope) || empty).map((file) =>
        file.id === entry.id ? { ...file, ...fields } : file,
      ),
    );
  update({ status: "uploading", error: undefined });
  try {
    const query = new URLSearchParams({ cwd, filename: entry.name });
    if (tid) query.set("threadId", tid);
    const result = await api<{ id: string; cwd: string }>(`/uploads?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: entry.file,
      signal: controller.signal,
    });
    if (!/^[a-f0-9]{32}$/.test(result.id))
      throw new Error("工作区已变化，请重新上传文件。");
    if (!controller.signal.aborted)
      update({ status: "ready", attachmentId: result.id });
  } catch (error) {
    if (!controller.signal.aborted)
      update({
        status: "error",
        error: error instanceof Error ? error.message : "文件上传失败",
      });
  } finally {
    if (controllers.get(entry.id) === controller) controllers.delete(entry.id);
  }
}
export function queueFiles(
  scope: string,
  files: File[],
  cwd: string,
  tid?: string,
) {
  const current = drafts.get(scope) || empty;
  if (current.length + files.length > MAX_FILES)
    throw new Error("每条消息最多添加 5 个文件。");
  if (files.some((file) => file.size > MAX_FILE_BYTES))
    throw new Error("单个文件不能超过 20 MB。");
  if (
    [...current, ...files].reduce((sum, file) => sum + file.size, 0) >
    MAX_TOTAL_BYTES
  )
    throw new Error("文件总大小不能超过 50 MB。");
  const added = files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    name: file.name,
    size: file.size,
    status: "uploading" as const,
  }));
  setFileDraft(scope, [...current, ...added]);
  for (const entry of added) void upload(scope, entry, cwd, tid);
}
export function retryFile(
  scope: string,
  entry: FileDraft,
  cwd: string,
  tid?: string,
) {
  if (entry.status === "error") void upload(scope, entry, cwd, tid);
}
export function removeFile(scope: string, id: string) {
  controllers.get(id)?.abort();
  setFileDraft(
    scope,
    (drafts.get(scope) || empty).filter((file) => file.id !== id),
  );
}
export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
