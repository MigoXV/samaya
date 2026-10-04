import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
import type { Receipt } from "./types";
import "./model-selector.css";

type ModelContext = {
  fields: {
    name: string;
    value: string;
    options: { value: string; label: string }[] | null;
  }[];
  expectedTurnId: string | null;
  defaultValue?: string;
};
const effortLabels: Record<string, string> = {
  none: "关闭",
  minimal: "极轻",
  low: "轻度",
  medium: "标准",
  high: "深入",
  xhigh: "增强",
  max: "极深",
  ultra: "极深",
};
const valueField = (context: ModelContext | null) =>
  context?.fields.find((f) => f.name === "value");
export function ModelSelector({
  tid,
  model,
  disabled,
  run,
  onOpen,
}: {
  tid: string;
  model?: string;
  disabled: boolean;
  run: (
    action: string,
    body: Record<string, unknown>,
  ) => Promise<Receipt | null>;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"reasoning" | "model">("reasoning");
  const [contexts, setContexts] = useState<
    Record<"model" | "reasoning", ModelContext | null>
  >({ model: null, reasoning: null });
  const [errors, setErrors] = useState({ model: "", reasoning: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const id = useId();
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    void Promise.all(
      (["model", "reasoning"] as const).map(async (command) => {
        try {
          const result = await api<ModelContext>(
            `/threads/${encodeURIComponent(tid)}/command-context?command=${command}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            setContexts((old) => ({ ...old, [command]: result }));
            setErrors((old) => ({ ...old, [command]: "" }));
          }
        } catch (e) {
          if (!controller.signal.aborted) {
            setContexts((old) => ({ ...old, [command]: null }));
            setErrors((old) => ({ ...old, [command]: String(e) }));
          }
        }
      }),
    ).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [tid, model, disabled, open, retry]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setPreview(null);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPreview(null);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const models = valueField(contexts.model);
  const reasoning = valueField(contexts.reasoning);
  const current = models?.value || model || "";
  const currentLabel =
    models?.options?.find((o) => o.value === current)?.label ||
    current ||
    "工作区默认";
  const efforts = reasoning?.options || [];
  const effort = preview ?? reasoning?.value ?? "";
  const effortLabel = effortLabels[effort] || effort || "选择强度";
  const index = efforts.findIndex((o) => o.value === effort);
  const reset = contexts.reasoning?.defaultValue;
  async function choose(command: "model" | "reasoning", value: string) {
    const context = contexts[command];
    if (
      disabled ||
      pending.current ||
      !context ||
      value === valueField(context)?.value
    )
      return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const receipt = await run("command", {
        threadId: tid,
        command,
        args: { value },
        expectedTurnId: context.expectedTurnId,
      });
      if (receipt) {
        setContexts((old) => ({
          ...old,
          [command]: {
            ...context,
            fields: context.fields.map((f) =>
              f.name === "value" ? { ...f, value } : f,
            ),
          },
        }));
        setPreview(null);
        if (command === "model") {
          setView("reasoning");
          setLoading(true);
          setRetry((n) => n + 1);
        }
      } else {
        setPreview(null);
        setError("设置未确认，请核对操作回执后重试。");
      }
    } catch (e) {
      setPreview(null);
      setError(String(e));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  function commit() {
    if (preview !== null) {
      void choose("reasoning", preview);
      setPreview(null);
    }
  }
  function close() {
    setOpen(false);
    setPreview(null);
    trigger.current?.focus();
  }
  return (
    <div
      className="model-selector"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setPreview(null);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
        if (
          open &&
          view === "model" &&
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
        ) {
          e.preventDefault();
          const items = [
            ...(root.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitemradio"]:not(:disabled)',
            ) || []),
          ];
          const at = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? items.length - 1
                : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="quiet model-trigger"
        type="button"
        disabled={disabled || saving}
        aria-label={`选择模型与推理强度，当前${currentLabel}，${effortLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? id : undefined}
        onClick={() => {
          setLoading(true);
          setView("reasoning");
          setError("");
          setOpen(!open);
          if (!open) onOpen?.();
        }}
      >
        <img
          className="model-lightning"
          src="/figma/model-lightning.svg"
          alt=""
        />
        <span className="model-name">{currentLabel}</span>
        <span className="model-effort">{effortLabel}</span>
        <img src="/figma/model-chevron.svg" alt="" />
      </button>
      {open && !disabled && (
        <div
          className={`model-menu ${view === "reasoning" ? "reasoning-menu" : "model-list"}`}
          id={id}
          role="dialog"
          aria-label="模型与推理强度"
          aria-busy={loading || saving}
        >
          {view === "reasoning" ? (
            <>
              <div className="reasoning-header">
                <img src="/figma/reasoning-lightning.svg" alt="" />
                <button
                  type="button"
                  className="reasoning-model"
                  aria-label="选择模型"
                  onClick={() => {
                    setView("model");
                    setError("");
                  }}
                >
                  <span>{effortLabel} ›</span>
                  <small>{currentLabel}</small>
                </button>
                <button
                  type="button"
                  className="reasoning-reset"
                  aria-label="重置推理强度"
                  title="恢复模型默认强度"
                  disabled={
                    loading ||
                    saving ||
                    !reset ||
                    !efforts.some((o) => o.value === reset) ||
                    reset === reasoning?.value
                  }
                  onClick={() => void choose("reasoning", reset!)}
                >
                  ↶
                </button>
              </div>
              {!loading && efforts.length > 0 && (
                <div className="reasoning-slider">
                  <div className="effort-stops" aria-hidden="true">
                    {efforts.map((o) => (
                      <span key={o.value}>
                        <img src="/figma/effort-stop.svg" alt="" />
                      </span>
                    ))}
                  </div>
                  <input
                    type="range"
                    aria-label="推理强度"
                    aria-valuetext={effortLabel}
                    min={0}
                    max={Math.max(0, efforts.length - 1)}
                    step={1}
                    value={Math.max(0, index)}
                    disabled={saving || efforts.length < 2}
                    onChange={(e) =>
                      setPreview(efforts[Number(e.target.value)].value)
                    }
                    onPointerUp={commit}
                    onKeyUp={commit}
                    onBlur={commit}
                    onPointerCancel={() => setPreview(null)}
                  />
                </div>
              )}
              {!loading && !errors.reasoning && !efforts.length && (
                <p role="status">此模型不支持调整推理强度</p>
              )}
            </>
          ) : (
            <>
              <small className="model-list-title">选择模型</small>
              <div role="menu" aria-label="选择模型">
                {!loading &&
                  models?.options?.map((option) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={current === option.value}
                      key={option.value}
                      disabled={saving}
                      onClick={() => {
                        if (current === option.value) setView("reasoning");
                        else void choose("model", option.value);
                      }}
                    >
                      <span>{option.label}</span>
                      <span aria-hidden="true">
                        {current === option.value ? "✓" : ""}
                      </span>
                    </button>
                  ))}
              </div>
              {!loading && !errors.model && !models?.options?.length && (
                <p role="status">暂无可用模型</p>
              )}
            </>
          )}
          {loading && <p role="status">正在读取设置…</p>}
          {(error || errors[view]) && (
            <div role="alert">
              <p>{error || errors[view]}</p>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setError("");
                  setLoading(true);
                  setRetry((n) => n + 1);
                }}
              >
                重新读取
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
