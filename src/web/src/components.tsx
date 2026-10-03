import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";
import type { Item, Pending } from "./types";
import { McpRequest, McpTool } from "./mcp";

export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="dialog-title"
    >
      <header className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button className="quiet" onClick={close} aria-label="关闭对话框">
          关闭
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function DirectoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [listing, setListing] = useState<{
    parent?: string;
    data: { name: string; path: string }[];
  }>({ data: [] });
  const [error, setError] = useState("");
  async function browse(path?: string) {
    try {
      setListing(
        await api(
          `/directories${path ? `?path=${encodeURIComponent(path)}` : ""}`,
        ),
      );
      setError("");
      if (path) onChange(path);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void api<typeof listing>("/directories")
      .then(setListing)
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <div className="directory-picker">
      <label>
        服务器目录
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/workspace/项目目录"
        />
      </label>
      <div className="actions">
        <button type="button" onClick={() => void browse(value)}>
          浏览目录
        </button>
        {listing.parent && (
          <button type="button" onClick={() => void browse(listing.parent)}>
            上一级
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="directory-list">
        {listing.data.map((d) => (
          <button
            type="button"
            className="quiet"
            key={d.path}
            onClick={() => void browse(d.path)}
          >
            {d.name}
            <span aria-hidden> ›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
export function ItemView({
  item,
  progress,
}: {
  item: Item;
  progress?: string;
}) {
  if (item.type === "mcpToolCall")
    return <McpTool item={item} progress={progress} />;
  if (item.type === "userMessage")
    return (
      <section className="message user">
        <div className="eyebrow">你</div>
        <div className="prose">
          {item.content?.map((c) => c.text || "").join("\n")}
        </div>
      </section>
    );
  if (item.type === "agentMessage")
    return (
      <section className="message">
        <div className="eyebrow">Codex</div>
        <div className="markdown">
          <Markdown remarkPlugins={[remarkGfm]}>{item.text || ""}</Markdown>
        </div>
      </section>
    );
  if (item.type === "reasoning") return null;
  if (item.type === "commandExecution")
    return (
      <details
        className="tool"
        open={
          item.status === "inProgress" ||
          (item.exitCode != null && item.exitCode !== 0)
            ? true
            : undefined
        }
      >
        <summary>
          <span>命令</span>
          <code>{item.command}</code>
          <small>
            {item.status === "inProgress"
              ? "执行中"
              : item.exitCode === 0
                ? "已完成"
                : item.status || "状态未知"}
          </small>
        </summary>
        <p className="muted">{item.cwd}</p>
        <pre>{item.aggregatedOutput || "尚无可用输出"}</pre>
      </details>
    );
  if (item.type === "fileChange")
    return (
      <details className="tool">
        <summary>代码变更 · {item.changes?.length || 0} 个文件</summary>
        {item.changes?.map((c) => (
          <div key={c.path}>
            <p>{c.path}</p>
            <pre>{c.diff || "服务端未提供结构化差异"}</pre>
          </div>
        ))}
      </details>
    );
  if (item.type === "plan")
    return (
      <details className="tool">
        <summary>执行计划</summary>
        <div className="markdown">
          <Markdown remarkPlugins={[remarkGfm]}>{item.text || ""}</Markdown>
        </div>
      </details>
    );
  if (/collab|agent/i.test(item.type))
    return (
      <details className="tool">
        <summary>子智能体 · {String(item.status || "执行事件")}</summary>
        <p>
          {String(item.prompt || item.tool || "在详情面板查看关联会话与输出")}
        </p>
      </details>
    );
  return (
    <details className="tool">
      <summary>
        {(
          {
            webSearch: "网页搜索",
            mcpToolCall: "外部工具",
            contextCompaction: "上下文整理",
            imageView: "查看图片",
          } as Record<string, string>
        )[item.type] || "工具活动"}{" "}
        · {item.status || item.type}
      </summary>
      <div className="prose">
        {String(
          item.text || item.query || item.tool || "此事件没有可显示的文本内容",
        )}
      </div>
    </details>
  );
}
export function RequestForm({
  request,
  busy,
  respond,
}: {
  request: Pending;
  busy: boolean;
  respond: (response: Record<string, unknown>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (request.method === "mcpServer/elicitation/request")
    return <McpRequest request={request} busy={busy} respond={respond} />;
  const questions = request.params.questions;
  const permissions = request.method === "item/permissions/requestApproval";
  const supported =
    permissions ||
    [
      "item/tool/requestUserInput",
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
    ].includes(request.method);
  return (
    <section className="request-panel" aria-label="等待你的输入">
      <h3>{questions ? "Codex 需要你的输入" : "等待审批"}</h3>
      {request.params.reason && <p>{request.params.reason}</p>}
      {request.params.command && <pre>{request.params.command}</pre>}
      {request.params.cwd && <p className="muted">{request.params.cwd}</p>}
      {questions ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            respond({
              answers: Object.fromEntries(
                questions.map((q) => [
                  q.id,
                  { answers: [answers[q.id] || ""] },
                ]),
              ),
            });
          }}
        >
          {questions.map((q) => (
            <fieldset key={q.id} disabled={busy}>
              <legend>{q.question}</legend>
              {q.options?.map((o) => (
                <label className="option" key={o.label}>
                  <input
                    type="radio"
                    name={q.id}
                    checked={answers[q.id] === o.label}
                    onChange={() => setAnswers({ ...answers, [q.id]: o.label })}
                  />
                  <span>
                    {o.label}
                    <small>{o.description}</small>
                  </span>
                </label>
              ))}
              <label>
                你的回答
                <input
                  type={q.isSecret ? "password" : "text"}
                  value={answers[q.id] || ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [q.id]: e.target.value })
                  }
                  required
                />
              </label>
            </fieldset>
          ))}
          <button className="primary" disabled={busy}>
            提交回答
          </button>
        </form>
      ) : supported ? (
        <>
          <p>
            {permissions
              ? "申请本轮额外权限。请展开核对具体范围。"
              : "允许后会执行上述操作。此决定仅针对当前请求。"}
          </p>
          {permissions && (
            <details>
              <summary>查看申请的权限范围</summary>
              <pre>{JSON.stringify(request.params.permissions, null, 2)}</pre>
            </details>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                respond(
                  permissions
                    ? { permissions: request.params.permissions, scope: "turn" }
                    : { decision: "accept" },
                )
              }
            >
              允许本次
            </button>
            <button
              disabled={busy}
              onClick={() =>
                respond(
                  permissions
                    ? { permissions: {}, scope: "turn" }
                    : { decision: "decline" },
                )
              }
            >
              拒绝
            </button>
          </div>
        </>
      ) : (
        <p>
          该请求类型尚未适配（{request.method}）。请在 Codex
          客户端处理，或停止当前轮次。
        </p>
      )}
    </section>
  );
}
