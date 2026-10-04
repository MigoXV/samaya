import { useEffect, useState } from "react";
import { api } from "./api";
import { Modal } from "./components";
import type { SlashCommand } from "./composer-model";
import type { Preview, Receipt } from "./types";

type Context = {
  description: string;
  fields: {
    name: string;
    label: string;
    options: { value: string; label: string }[] | null;
    value: string;
    type: string;
  }[];
  data: unknown;
  readOnly: boolean;
  expectedTurnId: string | null;
  active: boolean;
};
export function CommandDialog({
  command,
  args: initialArgs,
  tid,
  close,
  run,
  done,
}: {
  command: SlashCommand;
  args: string;
  tid: string;
  close: () => void;
  run: (a: string, b: Record<string, unknown>) => Promise<Receipt | null>;
  done: (r: Receipt) => void;
}) {
  const name = command.alias || command.name;
  const [context, setContext] = useState<Context | null>(null),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<Record<string, unknown> | null>(null),
    [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    let alive = true;
    if (!command.enabled) return;
    const get = async () => {
      try {
        if (name === "archive" || name === "delete") {
          const p = await api<Preview>(
            `/threads/${encodeURIComponent(tid)}/cleanup-preview`,
          );
          if (alive) setPreview(p);
          return;
        }
        const c = await api<Context>(
          `/threads/${encodeURIComponent(tid)}/command-context?command=${encodeURIComponent(name)}`,
        );
        if (alive) {
          setContext(c);
          const v = Object.fromEntries(
            c.fields.map((f) => [
              f.name,
              f.type === "checkbox"
                ? false
                : f.value || f.options?.[0]?.value || "",
            ]),
          );
          if (
            initialArgs &&
            c.fields.some((f) => f.name === "value" && !f.options)
          )
            v.value = initialArgs;
          if (name === "goal" && initialArgs) v.objective = initialArgs;
          setValues(v);
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    void get();
    return () => {
      alive = false;
    };
  }, [name, tid, command.enabled, initialArgs]);
  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await run(
        preview ? name : "command",
        preview
          ? { threadId: tid, digest: preview.digest }
          : {
              threadId: tid,
              command: name,
              args: values,
              expectedTurnId: context?.expectedTurnId ?? null,
            },
      );
      if (r) {
        setResult(r.result || {});
        done(r);
      } else setError("操作未确认，请查看工作区提示或操作回执。");
    } finally {
      setBusy(false);
    }
  }
  const url = result?.authorizationUrl;
  return (
    <Modal title={`/${command.name} · ${command.description}`} close={close}>
      {!command.enabled ? (
        <p role="status">{command.description}</p>
      ) : (
        <>
          {error && <p role="alert">{error}</p>}
          {!context && !preview && !error && <p>正在核对原生能力…</p>}
          {preview && (
            <>
              <p>
                {name === "delete"
                  ? "永久删除以下会话及其后代，无法撤销。"
                  : "归档以下会话与后代。"}
              </p>
              <ul>
                {preview.scope.map((t) => (
                  <li key={t.id}>
                    {t.name || t.id} · {t.cwd}
                  </li>
                ))}
              </ul>
            </>
          )}
          {context && (
            <>
              <p className="command-notice">{context.description}</p>
              {context.active && (
                <p>
                  当前轮次正在运行。设置作用于后续轮次；审查、压缩和分支需要等本轮结束。
                </p>
              )}
              {context.data != null && (
                <details open={context.readOnly || name === "goal"}>
                  <summary>{name === "goal" ? "当前目标" : "查看结果"}</summary>
                  <pre className="command-result">
                    {JSON.stringify(context.data, null, 2)}
                  </pre>
                </details>
              )}
              {!context.readOnly && (
                <form
                  id="command-form"
                  className="command-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  {context.fields.map((f) => (
                    <label key={f.name}>
                      {f.label}
                      {f.options ? (
                        <select
                          value={String(values[f.name] ?? "")}
                          onChange={(e) =>
                            setValues({ ...values, [f.name]: e.target.value })
                          }
                        >
                          {f.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : f.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={values[f.name] === true}
                          onChange={(e) =>
                            setValues({ ...values, [f.name]: e.target.checked })
                          }
                        />
                      ) : (
                        <input
                          type={f.type}
                          value={String(values[f.name] ?? "")}
                          onChange={(e) =>
                            setValues({ ...values, [f.name]: e.target.value })
                          }
                        />
                      )}
                    </label>
                  ))}
                </form>
              )}
            </>
          )}
          {((context && !context.readOnly) || preview) && !result && (
            <button
              className="primary"
              disabled={
                busy ||
                (!!context?.active &&
                  ["compact", "review", "fork", "side"].includes(name))
              }
              onClick={() => void submit()}
            >
              {busy ? "正在提交…" : "确认执行"}
            </button>
          )}
          {result && (
            <div role="status">
              <p>请求已确认；执行进展以任务记录为准。</p>
              {typeof url === "string" && /^https?:\/\//.test(url) && (
                <a href={url} target="_blank" rel="noreferrer">
                  打开外部授权页面
                </a>
              )}
              <details>
                <summary>操作结果</summary>
                <pre className="command-result">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
