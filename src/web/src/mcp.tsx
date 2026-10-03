import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Item, Pending } from "./types";
import { options, validateField } from "./mcp-schema";
import type { McpValue } from "./mcp-schema";

function webUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function McpRequest({
  request,
  busy,
  respond,
}: {
  request: Pending;
  busy: boolean;
  respond: (r: Record<string, unknown>) => void;
}) {
  const view = request.mcp;
  const schema = view?.mode === "form" ? view.schema : null;
  const approval = view?.mode === "form" && view.toolApproval;
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(
    () => () => {
      if (panel.current?.contains(document.activeElement))
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLTextAreaElement>(".composer textarea")
            ?.focus(),
        );
    },
    [],
  );
  const prefix = useId();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Record<string, McpValue>>(() =>
    Object.fromEntries(
      Object.entries(schema?.properties || {})
        .filter(([, f]) => f.default !== undefined)
        .map(([k, f]) => [k, f.default!]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const disabled = busy || !!request.responseState;
  const change = (key: string, value: McpValue | undefined) => {
    setValues((old) => {
      const next = { ...old };
      if (value === undefined) delete next[key];
      else
        Object.defineProperty(next, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      return next;
    });
    setErrors((old) => ({ ...old, [key]: "" }));
  };
  const decision = (action: string) => {
    if (!disabled) respond({ action, content: null });
  };
  return (
    <section
      className="request-panel mcp-request"
      ref={panel}
      aria-label="MCP 等待你的输入"
    >
      <h3>
        {view?.mode === "url"
          ? "需要外部操作"
          : approval
            ? "等待工具审批"
            : "等待你的输入"}{" "}
        · {request.params.serverName || "MCP 服务"}
      </h3>
      {request.params.message && (
        <p className="prose">{request.params.message}</p>
      )}
      {request.responseState && (
        <p role="status">
          {request.responseState === "uncertain"
            ? "响应已提交，结果尚未确认。请查询操作回执，勿重复提交。"
            : request.responseState === "sent"
              ? "答复已发送，等待 Codex 确认。"
              : "正在提交…"}
        </p>
      )}
      {schema ? (
        <form
          ref={form}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (disabled) return;
            const found = Object.fromEntries(
              Object.entries(schema.properties)
                .map(([k, f]) => [
                  k,
                  validateField(
                    f,
                    Object.hasOwn(values, k) ? values[k] : undefined,
                    schema.required?.includes(k) || false,
                  ),
                ])
                .filter(([, v]) => v),
            );
            setErrors(found);
            if (Object.keys(found).length) {
              requestAnimationFrame(() =>
                form.current
                  ?.querySelector<HTMLElement>('[aria-invalid="true"]')
                  ?.focus(),
              );
              return;
            }
            respond({ action: "accept", content: values });
          }}
        >
          <p className="muted">
            {approval
              ? "允许后将调用上述工具。此决定仅针对当前请求。"
              : "填写的信息将发送给此 MCP 服务。"}
          </p>
          {approval && (
            <details>
              <summary>查看工具参数</summary>
              <pre tabIndex={0}>{JSON.stringify(view.arguments, null, 2)}</pre>
            </details>
          )}
          {Object.entries(schema.properties).map(([key, field], i) => {
            const id = `${prefix}-${i}`,
              required = schema.required?.includes(key),
              choices = options(field);
            const value = Object.hasOwn(values, key) ? values[key] : undefined;
            const common = {
              id,
              disabled,
              "aria-invalid": !!errors[key],
              "aria-describedby": `${id}-help ${id}-error`,
              "aria-required": !!required,
            };
            return (
              <div className="mcp-field" key={key}>
                {field.type === "array" ? (
                  <fieldset aria-describedby={`${id}-help ${id}-error`}>
                    <legend>
                      {field.title || key} · {required ? "必填" : "可选"}
                    </legend>
                    {choices?.map((o, index) => (
                      <label className="option" key={o.value}>
                        <input
                          {...common}
                          id={`${id}-${index}`}
                          type="checkbox"
                          checked={
                            Array.isArray(value) && value.includes(o.value)
                          }
                          onChange={(e) =>
                            change(
                              key,
                              e.target.checked
                                ? [
                                    ...(Array.isArray(value) ? value : []),
                                    o.value,
                                  ]
                                : (Array.isArray(value) ? value : []).filter(
                                    (v) => v !== o.value,
                                  ),
                            )
                          }
                        />
                        {o.label}
                      </label>
                    ))}
                    {!required && value !== undefined && (
                      <button
                        type="button"
                        className="quiet"
                        disabled={disabled}
                        onClick={() => change(key, undefined)}
                      >
                        不提供此字段
                      </button>
                    )}
                  </fieldset>
                ) : (
                  <>
                    <label htmlFor={id}>
                      {field.title || key} · {required ? "必填" : "可选"}
                    </label>
                    {field.type === "boolean" ? (
                      <select
                        {...common}
                        value={value === undefined ? "" : String(value)}
                        onChange={(e) =>
                          change(
                            key,
                            e.target.value === ""
                              ? undefined
                              : e.target.value === "true",
                          )
                        }
                      >
                        <option value="">未选择</option>
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    ) : choices ? (
                      <select
                        {...common}
                        value={value === undefined ? "" : `v:${value}`}
                        onChange={(e) =>
                          change(
                            key,
                            e.target.value === ""
                              ? undefined
                              : e.target.value.slice(2),
                          )
                        }
                      >
                        <option value="">请选择</option>
                        {choices.map((o) => (
                          <option key={o.value} value={`v:${o.value}`}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        {...common}
                        type={
                          field.type === "number" || field.type === "integer"
                            ? "number"
                            : "text"
                        }
                        step={field.type === "integer" ? 1 : "any"}
                        value={value === undefined ? "" : String(value)}
                        placeholder={
                          field.format === "date-time"
                            ? "2026-10-03T12:00:00Z"
                            : field.format === "date"
                              ? "YYYY-MM-DD"
                              : undefined
                        }
                        onChange={(e) =>
                          change(
                            key,
                            field.type === "number" || field.type === "integer"
                              ? e.target.value === ""
                                ? undefined
                                : Number(e.target.value)
                              : e.target.value,
                          )
                        }
                      />
                    )}
                    {!required && value !== undefined && (
                      <button
                        type="button"
                        className="quiet mcp-omit"
                        disabled={disabled}
                        onClick={() => change(key, undefined)}
                      >
                        不提供此字段
                      </button>
                    )}
                  </>
                )}
                <small id={`${id}-help`} className="muted">
                  {field.description}
                </small>
                <p
                  id={`${id}-error`}
                  className="mcp-field-error"
                  role={errors[key] ? "alert" : undefined}
                >
                  {errors[key]}
                </p>
              </div>
            );
          })}
          <div className="actions">
            <button className="primary" disabled={disabled}>
              {request.responseState === "submitting"
                ? "正在提交…"
                : approval
                  ? "允许本次"
                  : "提交回答"}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => decision("decline")}
            >
              拒绝
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => decision("cancel")}
            >
              取消
            </button>
          </div>
        </form>
      ) : (
        <>
          {view?.mode === "url" && webUrl(view.url) ? (
            <div className="mcp-url">
              <p>
                目标网站：<strong>{view.host}</strong>
              </p>
              {!disabled && (
                <a
                  className="button primary"
                  href={webUrl(view.url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  打开授权页面
                </a>
              )}
              <button disabled={disabled} onClick={() => decision("accept")}>
                同意继续
              </button>
              <p className="muted">
                同意继续仅确认进入流程。完成状态以工具返回结果为准。
              </p>
            </div>
          ) : (
            <p>
              {view?.mode === "unsupported"
                ? view.reason
                : "此请求暂不支持在网页处理。可拒绝或取消。"}
            </p>
          )}
          <div className="actions">
            <button disabled={disabled} onClick={() => decision("decline")}>
              拒绝
            </button>
            <button disabled={disabled} onClick={() => decision("cancel")}>
              取消
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function Content({ value }: { value: unknown }) {
  const c = record(value);
  if (c.type === "text" && typeof c.text === "string")
    return <div className="prose">{c.text}</div>;
  if (c.type === "resource" || c.type === "resource_link") {
    const r = c.type === "resource" ? record(c.resource) : c,
      uri = webUrl(r.uri);
    return (
      <div className="mcp-resource">
        <p>
          资源：{String(r.title || r.name || r.uri || "未命名资源")}{" "}
          {typeof r.mimeType === "string" && `（${r.mimeType}）`}
        </p>
        {uri && (
          <a
            href={uri}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            打开资源
          </a>
        )}
        {typeof r.text === "string" && <pre tabIndex={0}>{r.text}</pre>}
        {typeof r.blob === "string" && (
          <p className="muted">此资源为二进制内容，暂不预览。</p>
        )}
      </div>
    );
  }
  return (
    <p className="muted">
      {c.type === "image"
        ? "图片"
        : c.type === "audio"
          ? "音频"
          : `未知内容类型：${String(c.type || "未提供")}`}{" "}
      · 暂不预览
    </p>
  );
}
export function McpTool({ item, progress }: { item: Item; progress?: string }) {
  const result = record(item.result),
    error = record(item.error);
  return (
    <details className="tool mcp-tool">
      <summary>
        <span>MCP</span>
        <code>
          {String(item.server || "未知服务")} /{" "}
          {String(item.tool || "未知工具")}
        </code>
        <small>
          {(
            {
              inProgress: "执行中",
              completed: "已完成",
              failed: "失败",
            } as Record<string, string>
          )[item.status || ""] || "状态未知"}
        </small>
      </summary>
      {progress && <p role="status">{progress}</p>}
      {typeof error.message === "string" && (
        <p role="alert">工具失败：{error.message}</p>
      )}
      <details>
        <summary>输入参数</summary>
        <pre tabIndex={0}>
          {JSON.stringify(item.arguments, null, 2) || "未提供"}
        </pre>
      </details>
      {Array.isArray(result.content) && (
        <div className="mcp-content">
          {result.content.map((c, i) => (
            <Content key={i} value={c} />
          ))}
        </div>
      )}
      {result.structuredContent !== undefined && (
        <details>
          <summary>结构化结果</summary>
          <pre tabIndex={0}>
            {JSON.stringify(result.structuredContent, null, 2)}
          </pre>
        </details>
      )}
      {!item.result && !item.error && <p className="muted">尚无可用结果</p>}
    </details>
  );
}
