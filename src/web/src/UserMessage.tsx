import { useEffect, useId, useRef, useState } from "react";
import type { Item } from "./types";
import { FileText } from "lucide-react";
import { fileMessage } from "./file-message";
import { formatFileSize } from "./composer-files";
import { preserveMessagePosition } from "./reading-position";
import { userMessageParts } from "./question-reply";
import { ImagePreview } from "./ImagePreview";
import "./user-message.css";
import { InlineLinks } from "./InlineLinks";

export function UserMessage({ item }: { item: Item }) {
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(
    null,
  );
  const { text, files } = fileMessage(
    item.content?.map((c) => c.text || "").join("\n") || item.text || "",
  );
  const parts = userMessageParts(text);
  const images =
    item.content?.flatMap(({ type, url }) =>
      type === "image" &&
      url &&
      /^data:image\/(png|jpeg|webp|gif);base64,/.test(url)
        ? [url]
        : [],
    ) ?? [];
  return (
    <>
      {!!files.length && (
        <div className="user-message-files" aria-label="已发送文件">
          {files.map((file) => (
            <div className="composer-file" key={file.id}>
              <FileText size={18} aria-hidden="true" />
              <div className="composer-file-info">
                <span className="composer-file-name" title={file.name}>
                  {file.name}
                </span>
                <small>{formatFileSize(file.size)}</small>
              </div>
            </div>
          ))}
        </div>
      )}
      {!!images.length && (
        <div className="user-message-images" aria-label="已发送图片">
          {images.map((src, index) => {
            const alt = `已发送图片 ${index + 1}`;
            return (
              <button
                key={index}
                type="button"
                className="user-message-image-preview"
                aria-label={`放大查看${alt}`}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  setPreview({ src, alt });
                }}
              >
                <img src={src} alt={alt} />
              </button>
            );
          })}
        </div>
      )}
      {preview && <ImagePreview {...preview} close={() => setPreview(null)} />}
      {parts.map((part, index) =>
        part.type === "text" ? (
          <MessageText
            key={index}
            text={
              parts.length > 1
                ? part.text.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, "")
                : part.text
            }
          />
        ) : (
          <section
            className="message question-reply"
            key={index}
            aria-label="提问与回答"
          >
            {part.replies.map((reply, replyIndex) => (
              <div className="question-reply-pair" key={replyIndex}>
                <div className="question-reply-question">
                  <div className="sr-only">Codex 提问</div>
                  <div className="prose">{reply.question}</div>
                </div>
                <MessageText text={reply.answer} label="你 · 已回答" />
              </div>
            ))}
          </section>
        ),
      )}
    </>
  );
}

function MessageText({ text, label = "你" }: { text: string; label?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const message = useRef<HTMLElement>(null);
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
      setOverflow(node.scrollHeight > lineHeight * 6 + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const frame = requestAnimationFrame(measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [text]);
  return (
    <section ref={message} className="message user">
      <div className="sr-only">{label}</div>
      <div
        id={id}
        ref={ref}
        className="prose user-message-text"
        data-collapsed={!expanded}
      >
        <InlineLinks text={text} />
      </div>
      {overflow && (
        <button
          type="button"
          className="user-message-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          aria-label={expanded ? "收起用户消息全文" : "展开用户消息全文"}
          onClick={() => {
            preserveMessagePosition(message.current);
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "收起" : "展开全文"}
          <span
            className="user-message-chevron"
            data-expanded={expanded}
            aria-hidden="true"
          >
            <img
              className="chevron-light"
              src="/figma/workspace-chevron.svg"
              alt=""
            />
            <img
              className="chevron-dark"
              src="/figma/workspace-chevron-dark.svg"
              alt=""
            />
          </span>
        </button>
      )}
    </section>
  );
}
