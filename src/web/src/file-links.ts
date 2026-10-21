import { createContext } from "react";
import { defaultUrlTransform } from "react-markdown";

export const FileLinkThread = createContext<string | undefined>(undefined);

export function isLocalFileLink(url: string): boolean {
  const value = url.trim();
  if (!value || /^(?:#|\?|\/\/)/.test(value)) return false;
  if (/^(?:file|sandbox):/i.test(value)) return true;
  // A source filename with a line/column suffix is not a URI scheme.
  if (/^[^/:]+\.[^/:]+:[1-9]\d*(?::[1-9]\d*)?$/.test(value)) return true;
  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

export function fileDownloadUrl(threadId: string, path: string): string {
  return `/api/threads/${encodeURIComponent(threadId)}/files/download?${new URLSearchParams({ path })}`;
}

export function markdownUrlTransform(url: string, key: string): string {
  // Only anchors can use local file references. Keep the original Markdown
  // safety policy for image sources and every other URI scheme.
  return key === "href" && isLocalFileLink(url)
    ? url
    : defaultUrlTransform(url);
}

export function downloadFailure(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return "下载失败：文件路径无效，或目标不是普通文件。";
    case 401:
      return "登录已过期，请重新登录后下载。";
    case 403:
      return "下载失败：没有权限读取此文件。";
    case 404:
      return "下载失败：文件不存在或已移动。请确认文件路径后重试。";
    default:
      return "暂时无法下载，请稍后点击文件链接重试。";
  }
}
