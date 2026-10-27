import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
import type { Receipt } from "./types";
import "./model-selector.css";

type Option = { value: string; label: string };
type Model = {
  model: string;
  displayName: string;
  isDefault: boolean;
  effortOptions: Option[];
  defaultEffort: string | null;
  serviceTiers: { id: string; name: string; description?: string }[];
};
export type ModelSettings = {
  models: Model[];
  current: {
    model: string | null;
    reasoningEffort: string | null;
    serviceTier: string;
  };
  expectedTurnId: string | null;
  active: boolean;
  editable: boolean;
};
const effortLabels: Record<string, string> = {
  none: "关闭",
  minimal: "极轻",
  low: "轻度",
  medium: "标准",
  high: "深入",
  xhigh: "增强",
  max: "极深",
  ultra: "极致",
};
export function ModelSelector({
  tid,
  cwd,
  onDraftChange,
  onPendingChange,
  model,
  reasoningEffort,
  serviceTier,
  disabled,
  busy,
  run,
  inspectReceipts,
}: {
  tid?: string;
  cwd?: string;
  onDraftChange?: (value: ModelSettings["current"]) => void;
  onPendingChange?: (value: boolean) => void;
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  disabled: boolean;
  busy: boolean;
  run: (
    action: string,
    body: Record<string, unknown>,
  ) => Promise<Receipt | null>;
  inspectReceipts: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"reasoning" | "model">("reasoning");
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [awaitingSync, setAwaitingSync] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const back = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const draftEffort = useRef<string | null>(null);
  const sequence = useRef(0);
  const id = useId();
  const readInFlight = useRef(false);
  const confirmed = useRef<ModelSettings["current"] | null>(null);
  const loadContext = useRef("");
  const draftChoice = useRef<ModelSettings["current"] | null>(null);
  const draftChanged = useRef(onDraftChange);
  useEffect(() => {
    draftChanged.current = onDraftChange;
  }, [onDraftChange]);
  useEffect(() => {
    draftChoice.current = null;
  }, [cwd]);
  useEffect(() => {
    const context = JSON.stringify([tid, cwd, disabled, retry]);
    const known = confirmed.current;
    const unchanged = context === loadContext.current;
    loadContext.current = context;
    if (disabled || (!tid && !cwd)) return;
    // A settings receipt already confirms these values; avoid a second read
    // disabling the slider between consecutive keyboard adjustments.
    if (
      tid &&
      unchanged &&
      !readInFlight.current &&
      known &&
      (!model || model === known.model) &&
      (!reasoningEffort || reasoningEffort === known.reasoningEffort) &&
      (!serviceTier || serviceTier === known.serviceTier)
    )
      return;
    const controller = new AbortController();
    const request = ++sequence.current;
    const load = async () => {
      readInFlight.current = true;
      setLoading(true);
      try {
        const result = await api<ModelSettings>(
          tid
            ? `/threads/${encodeURIComponent(tid)}/model-settings`
            : `/model-settings?cwd=${encodeURIComponent(cwd!)}`,
          { signal: controller.signal },
        );
        if (
          !controller.signal.aborted &&
          request === sequence.current &&
          !pending.current
        ) {
          if (!tid && draftChoice.current) result.current = draftChoice.current;
          confirmed.current = result.current;
          setSettings(result);
          if (!tid) draftChanged.current?.(result.current);
          setAwaitingSync(false);
          setError("");
          setPreview(null);
          draftEffort.current = null;
          setNotice("");
        }
      } catch (e) {
        if (!controller.signal.aborted && request === sequence.current)
          setError(String(e));
      } finally {
        if (!controller.signal.aborted && request === sequence.current) {
          readInFlight.current = false;
          setLoading(false);
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [tid, cwd, model, reasoningEffort, serviceTier, disabled, retry]);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setPreview(null);
      draftEffort.current = null;
    };
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        (returnFocus.current || trigger.current)?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const current = settings?.current;
  const selected = settings?.models.find((m) => m.model === current?.model);
  const modelLabel =
    selected?.displayName || current?.model || model || "选择模型";
  const options = selected?.effortOptions || [];
  const effort = preview ?? current?.reasoningEffort ?? reasoningEffort ?? "";
  const effortLabel =
    effortLabels[effort] ||
    options.find((o) => o.value === effort)?.label ||
    effort ||
    "选择强度";
  const index = options.findIndex((o) => o.value === effort);
  const fastTier = selected?.serviceTiers.find(
    (t) => t.id === "fast" || t.id === "priority",
  );
  const fast =
    (current?.serviceTier ?? serviceTier) === "priority" ||
    (current?.serviceTier ?? serviceTier) === "fast";
  const locked =
    disabled ||
    busy ||
    saving ||
    loading ||
    awaitingSync ||
    !!error ||
    !settings ||
    !settings.editable;
  useEffect(() => {
    onPendingChange?.(
      (loading && !settings) ||
        saving ||
        awaitingSync ||
        (!settings && !!error) ||
        !settings,
    );
  }, [loading, saving, awaitingSync, error, settings, onPendingChange]);
  const canToggleFast = !locked && !!fastTier;
  const updating = !disabled && (loading || saving);
  const fastReason = disabled
    ? "连接或任务状态暂不允许修改设置。"
    : saving || busy
      ? "正在提交操作，请等待确认。"
      : awaitingSync
        ? "设置已提交，结果待确认；请重新读取，勿重复提交。"
        : loading
          ? "正在读取设置…"
          : error
            ? "设置读取或保存失败，请重新读取核对。"
            : !settings
              ? "尚未读取模型设置。"
              : !settings.editable
                ? "当前任务不接受直接修改设置。"
                : !selected
                  ? "当前模型不在可用目录中，请选择模型。"
                  : !fastTier
                    ? "当前模型未提供 Fast 档位。"
                    : "Fast：" +
                      (fast ? "已开启" : "已关闭") +
                      (fastTier.description
                        ? ` · ${fastTier.description}`
                        : "");
  function focusModelView() {
    setView("model");
    requestAnimationFrame(() => {
      const selectedOption = root.current?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"][aria-checked="true"]',
      );
      if (selectedOption) selectedOption.focus();
      else back.current?.focus();
    });
  }
  function focusReasoningView() {
    setView("reasoning");
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(".reasoning-model")
        ?.focus(),
    );
  }
  async function choose(
    command: "model" | "reasoning" | "fast",
    value: string,
  ) {
    if (locked || pending.current || !settings) return;
    const old =
      command === "model"
        ? current?.model
        : command === "reasoning"
          ? current?.reasoningEffort
          : current?.serviceTier;
    if (old === value) {
      draftEffort.current = null;
      setPreview(null);
      return;
    }
    if (!tid) {
      const next = { ...settings.current };
      if (command === "model") {
        const target = settings.models.find((m) => m.model === value)!;
        next.model = value;
        if (!target.effortOptions.some((o) => o.value === next.reasoningEffort))
          next.reasoningEffort = target.defaultEffort;
        if (!target.serviceTiers.some((t) => t.id === next.serviceTier))
          next.serviceTier = "default";
      } else if (command === "reasoning") next.reasoningEffort = value;
      else next.serviceTier = value;
      draftChoice.current = next;
      setSettings({ ...settings, current: next });
      draftChanged.current?.(next);
      setPreview(null);
      if (command === "model") focusReasoningView();
      return;
    }
    pending.current = true;
    ++sequence.current;
    setLoading(false);
    setSaving(true);
    setPendingModel(command === "model" ? value : null);
    setError("");
    setNotice("");
    try {
      const receipt = await run("command", {
        threadId: tid,
        command,
        args: { value },
        expectedTurnId: settings.expectedTurnId,
        expectedModel: current?.model,
      });
      if (!receipt) throw new Error("操作未确认，请查看操作回执。");
      if (receipt.result?.modelSettings) {
        const result = receipt.result.modelSettings as ModelSettings;
        confirmed.current = result.current;
        setSettings(result);
      } else {
        setAwaitingSync(true);
        setOpen(true);
        setNotice("设置已提交，等待同步。请重新读取核对，勿重复提交。");
        setRetry((n) => n + 1);
      }
      if (command === "model") focusReasoningView();
    } catch (e) {
      setError(String(e));
      setOpen(true);
    } finally {
      pending.current = false;
      setSaving(false);
      setPendingModel(null);
      setPreview(null);
      draftEffort.current = null;
    }
  }
  useEffect(() => {
    const scope = root.current?.closest(".task-composer");
    if (!scope) return;
    const keydown = (event: Event) => {
      const e = event as KeyboardEvent;
      if (
        !e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.isComposing ||
        e.repeat ||
        !["Comma", "Period"].includes(e.code)
      )
        return;
      e.preventDefault();
      if (locked || index < 0) return;
      const next = index + (e.code === "Comma" ? -1 : 1);
      if (next >= 0 && next < options.length)
        void choose("reasoning", options[next].value);
    };
    scope.addEventListener("keydown", keydown);
    return () => scope.removeEventListener("keydown", keydown);
  });
  function commit() {
    const value = draftEffort.current;
    draftEffort.current = null;
    if (value !== null) void choose("reasoning", value);
  }
  function fastButton(inPanel = false) {
    return (
      <button
        type="button"
        className={`quiet fast-toggle ${inPanel ? "panel-fast" : ""}`}
        aria-label="Fast 模式"
        disabled={saving}
        aria-pressed={fast}
        title={canToggleFast ? fastReason : `${fastReason} 点击查看状态。`}
        aria-haspopup={canToggleFast ? undefined : "dialog"}
        aria-controls={!canToggleFast && open ? id : undefined}
        onClick={(e) => {
          if (!inPanel) returnFocus.current = e.currentTarget;
          if (canToggleFast) {
            void choose("fast", fast ? "default" : fastTier!.id);
          } else {
            setView("reasoning");
            setOpen(true);
          }
        }}
      >
        <img
          src={
            inPanel
              ? "/figma/reasoning-lightning.svg"
              : "/figma/model-lightning.svg"
          }
          alt=""
        />
      </button>
    );
  }
  return (
    <div
      className="model-selector"
      ref={root}
      onBlur={(e) => {
        if (!pending.current && !e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setPreview(null);
          draftEffort.current = null;
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          setPreview(null);
          draftEffort.current = null;
          (returnFocus.current || trigger.current)?.focus();
        }
        if (
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
                : at < 0
                  ? e.key === "ArrowUp"
                    ? items.length - 1
                    : 0
                  : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                    items.length;
          items[next]?.focus();
        }
      }}
    >
      <div className="model-controls" aria-busy={updating}>
        {fastButton()}
        <button
          ref={trigger}
          className="quiet model-trigger"
          type="button"
          disabled={disabled || busy || saving}
          aria-label={`选择模型与推理强度，当前${modelLabel}，${effortLabel}`}
          title={`${modelLabel} · ${effortLabel}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-busy={updating}
          onClick={() => {
            returnFocus.current = trigger.current;
            setOpen(!open);
            setView("reasoning");
            setError("");
          }}
        >
          <span className="model-name">{modelLabel}</span>
          <span className="model-effort">
            {options.length === 0 && settings && selected ? "" : effortLabel}
          </span>
          <span className="model-indicator">
            {updating ? (
              <ModelSpinner />
            ) : (
              <img src="/figma/model-chevron.svg" alt="" />
            )}
          </span>
        </button>
      </div>
      {updating && (
        <span className="sr-only" role="status">
          {saving ? "正在保存模型设置…" : "正在读取模型设置…"}
        </span>
      )}
      {open && (
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
                {fastButton(true)}
                <button
                  className="reasoning-model"
                  type="button"
                  aria-label="选择模型"
                  disabled={saving}
                  onClick={focusModelView}
                >
                  <span>
                    {options.length || !selected ? effortLabel : "选择模型"} ›
                  </span>
                  <small>{modelLabel}</small>
                </button>
                <button
                  type="button"
                  className="reasoning-reset"
                  aria-label="重置推理强度"
                  title="恢复模型默认强度"
                  disabled={
                    locked ||
                    !selected?.defaultEffort ||
                    !options.some((o) => o.value === selected.defaultEffort) ||
                    selected.defaultEffort === current?.reasoningEffort
                  }
                  onClick={() =>
                    void choose("reasoning", selected!.defaultEffort!)
                  }
                >
                  ↶
                </button>
              </div>
              {options.length > 0 && (
                <div className="reasoning-slider">
                  <div
                    className="effort-progress"
                    aria-hidden="true"
                    style={{
                      width: `calc(12px + ${(Math.max(0, index) / Math.max(1, options.length - 1)) * 100}% - ${(Math.max(0, index) / Math.max(1, options.length - 1)) * 24}px)`,
                    }}
                  />
                  <div className="effort-stops" aria-hidden="true">
                    {options.map((o) => (
                      <span
                        key={o.value}
                        title={effortLabels[o.value] || o.label}
                      >
                        <img src="/figma/effort-stop.svg" alt="" />
                      </span>
                    ))}
                  </div>
                  <input
                    type="range"
                    aria-label="推理强度"
                    aria-valuetext={effortLabel}
                    min={0}
                    max={Math.max(0, options.length - 1)}
                    step={1}
                    value={Math.max(0, index)}
                    disabled={locked || options.length < 2 || index < 0}
                    onChange={(e) => {
                      const value = options[Number(e.target.value)].value;
                      draftEffort.current = value;
                      setPreview(value);
                    }}
                    onPointerUp={commit}
                    onKeyUp={(e) => {
                      if (
                        [
                          "ArrowRight",
                          "ArrowLeft",
                          "ArrowUp",
                          "ArrowDown",
                          "Home",
                          "End",
                          "PageUp",
                          "PageDown",
                        ].includes(e.key)
                      )
                        commit();
                    }}
                    onBlur={commit}
                    onPointerCancel={() => {
                      draftEffort.current = null;
                      setPreview(null);
                    }}
                  />
                </div>
              )}
              {!loading && selected && options.length === 0 && (
                <p>此模型不支持调整推理强度。</p>
              )}
              {!loading && selected && options.length > 0 && index < 0 && (
                <p>当前强度不在支持档位中，请重置为模型默认值。</p>
              )}
              {!loading && !selected && settings && (
                <p>当前模型不在可用目录中，请选择模型。</p>
              )}
              {!loading && !saving && !canToggleFast && (
                <p role="status">{fastReason}</p>
              )}
            </>
          ) : (
            <>
              <div className="model-list-heading">
                <button
                  ref={back}
                  type="button"
                  aria-label="返回强度设置"
                  onClick={focusReasoningView}
                >
                  ‹
                </button>
                <small className="model-list-title">选择模型</small>
              </div>
              <div role="menu" aria-label="选择模型">
                {settings?.models.map((m) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={current?.model === m.model}
                    key={m.model}
                    disabled={locked}
                    onClick={() => {
                      if (current?.model === m.model) focusReasoningView();
                      else void choose("model", m.model);
                    }}
                  >
                    <span>
                      {m.displayName}
                      {m.isDefault && <small>默认模型</small>}
                    </span>
                    <span aria-hidden="true">
                      {pendingModel === m.model ? (
                        <ModelSpinner />
                      ) : current?.model === m.model ? (
                        "✓"
                      ) : (
                        ""
                      )}
                    </span>
                  </button>
                ))}
              </div>
              {!loading && settings?.models.length === 0 && (
                <p>暂无可用模型。</p>
              )}
            </>
          )}
          {disabled && <p role="status">连接或任务状态暂不允许修改设置。</p>}
          {!saving && notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
          {error && busy && (
            <button
              type="button"
              className="settings-retry"
              onClick={inspectReceipts}
            >
              核查操作回执
            </button>
          )}
          {(error || notice.includes("等待同步")) && (
            <button
              type="button"
              className="settings-retry"
              disabled={disabled || saving || busy}
              onClick={() => {
                setError("");
                setRetry((n) => n + 1);
              }}
            >
              重新读取
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ModelSpinner() {
  return (
    <span className="model-spinner" aria-hidden="true">
      <img
        className="model-spinner-light"
        src="/figma/model-spinner.svg"
        alt=""
      />
      <img
        className="model-spinner-dark"
        src="/figma/model-spinner-dark.svg"
        alt=""
      />
    </span>
  );
}
