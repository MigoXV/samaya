import { useContext, useState } from "react";
import { FileLinkThread, fileDownloadUrl, isLocalFileLink } from "./file-links";

export function MarkdownImage({
  src,
  alt,
  title,
}: {
  src?: string;
  alt?: string;
  title?: string;
}) {
  const threadId = useContext(FileLinkThread);
  const [failed, setFailed] = useState<string>();
  const url =
    src && isLocalFileLink(src) && threadId
      ? fileDownloadUrl(threadId, src).replace(
          "/files/download?",
          "/files/preview?",
        )
      : src;
  return failed === url || !url ? (
    <span role="status">图片无法加载：{alt || "图片"}</span>
  ) : (
    <img
      src={url}
      alt={alt || "图片"}
      title={title}
      loading="lazy"
      onError={() => setFailed(url)}
      style={{ maxWidth: "100%", height: "auto" }}
    />
  );
}
