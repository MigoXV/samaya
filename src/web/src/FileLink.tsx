import { useContext, useEffect, useId, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { defaultUrlTransform } from "react-markdown";
import {
  FileLinkThread,
  downloadFailure,
  fileDownloadUrl,
  isLocalFileLink,
} from "./file-links";

export function FileLink({ href, children, title }: ComponentProps<"a">) {
  const threadId = useContext(FileLinkThread);
  if (!href || !threadId || !isLocalFileLink(href))
    return (
      <a
        href={href ? defaultUrlTransform(href) || undefined : undefined}
        title={title}
      >
        {children}
      </a>
    );
  const url = fileDownloadUrl(threadId, href);
  return (
    <DownloadLink key={url} url={url} title={title}>
      {children}
    </DownloadLink>
  );
}

function DownloadLink({
  url,
  children,
  title,
}: ComponentProps<"a"> & { url: string }) {
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  const request = useRef<AbortController | null>(null);
  const noticeId = useId();
  useEffect(() => () => request.current?.abort(), []);
  return (
    <span className="file-link">
      <a
        href={url}
        download
        title={title ? `${title} · 点击下载` : "点击下载文件"}
        aria-busy={checking || undefined}
        aria-disabled={checking || undefined}
        aria-describedby={notice ? noticeId : undefined}
        onClick={(event) => {
          event.preventDefault();
          if (request.current) return;
          const controller = new AbortController();
          request.current = controller;
          setChecking(true);
          void (async () => {
            try {
              const response = await fetch(url, {
                method: "HEAD",
                credentials: "same-origin",
                signal: controller.signal,
              });
              if (controller.signal.aborted) return;
              if (!response.ok) {
                if (response.status === 401)
                  window.dispatchEvent(new Event("samaya:unauthorized"));
                setNotice(downloadFailure(response.status));
                return;
              }
              // Let the browser stream to disk; never buffer the file as a Blob.
              const link = document.createElement("a");
              link.href = url;
              link.download = "";
              document.body.appendChild(link);
              link.click();
              link.remove();
              setNotice("");
            } catch {
              if (!controller.signal.aborted)
                setNotice("下载失败：无法连接服务器。请点击文件链接重试。");
            } finally {
              if (request.current === controller) request.current = null;
              if (!controller.signal.aborted) setChecking(false);
            }
          })();
        }}
      >
        {children}
      </a>
      {notice && (
        <span id={noticeId} className="file-download-notice" role="status">
          {notice}
        </span>
      )}
    </span>
  );
}
