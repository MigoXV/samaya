import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Receipt } from "./types";
import "./workspace-features.css";
type Settings = {
  current: string;
  modes: { value: string; label: string }[];
  expectedTurnId: string | null;
  editable: boolean;
};
export function usePlanMode({
  tid,
  turnId,
  disabled,
  busy,
  value = "default",
  onChange,
  run,
}: {
  tid?: string;
  turnId?: string;
  disabled: boolean;
  busy: boolean;
  value?: string;
  onChange?: (value: string) => void;
  run?: (
    action: string,
    body: Record<string, unknown>,
  ) => Promise<Receipt | null>;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const queued = useRef(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    const load = async () => {
      const request = ++sequence.current;
      setLoading(true);
      try {
        const result = tid
          ? await api<Settings>(
              `/threads/${encodeURIComponent(tid)}/mode-settings`,
              { signal: controller.signal },
            )
          : await api<{ data: { mode: string }[] }>("/collaboration-modes", {
              signal: controller.signal,
            }).then((r) => ({
              current: "default",
              modes: r.data.map((m) => ({ value: m.mode, label: m.mode })),
              expectedTurnId: null,
              editable: true,
            }));
        if (
          !controller.signal.aborted &&
          request === sequence.current &&
          !pending.current
        ) {
          setSettings(result);
          setError("");
          setUncertain(false);
        }
      } catch (e) {
        if (!controller.signal.aborted && request === sequence.current) {
          queued.current = false;
          setError(String(e));
        }
      } finally {
        if (!controller.signal.aborted && request === sequence.current)
          setLoading(false);
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      controller.abort();
      window.removeEventListener("focus", load);
    };
  }, [tid, disabled, revision]);
  const current = tid ? settings?.current : value;
  const supported =
    settings?.modes.some((m) => m.value === "plan") &&
    settings.modes.some((m) => m.value === "default");
  const toggle = useCallback(async () => {
    if (loading && !disabled && !busy && !pending.current) {
      queued.current = !queued.current;
      return;
    }
    if (
      disabled ||
      busy ||
      loading ||
      uncertain ||
      error ||
      !supported ||
      !settings?.editable ||
      pending.current
    )
      return;
    const target = current === "plan" ? "default" : "plan";
    if (!tid) {
      onChange?.(target);
      return;
    }
    sequence.current++;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await run?.("command", {
        threadId: tid,
        command: "plan",
        args: { value: target },
        expectedTurnId: turnId ?? settings.expectedTurnId,
        expectedMode: current,
      });
      if (!alive.current) return;
      if (!result) throw new Error("模式更新未确认，请核查操作回执。");
      if (result.result?.settingsPending || result.result?.mode !== target) {
        setUncertain(true);
        setError("设置已提交，尚未确认；请重新读取，勿重复提交。");
      } else setSettings((old) => (old ? { ...old, current: target } : old));
    } catch (e) {
      if (alive.current) {
        setError(String(e));
        if (/待确认|回执/.test(String(e))) setUncertain(true);
      }
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  }, [
    tid,
    turnId,
    current,
    settings,
    supported,
    disabled,
    busy,
    loading,
    uncertain,
    error,
    onChange,
    run,
  ]);
  useEffect(() => {
    if (queued.current && !loading && !disabled && !error) {
      queued.current = false;
      queueMicrotask(() => void toggle());
    }
  }, [loading, disabled, error, toggle]);
  const control = (
    <div className="plan-mode">
      <button
        type="button"
        className="plan-mode-button"
        aria-label={`切换计划模式，当前${current === "plan" ? "计划" : current === "default" ? "默认" : "未确认"}`}
        aria-pressed={current === "plan"}
        aria-busy={loading || saving}
        disabled={
          disabled ||
          busy ||
          loading ||
          saving ||
          uncertain ||
          !!error ||
          !supported ||
          !settings?.editable
        }
        title="切换默认/计划模式 · Shift+Tab（输入框内）"
        onClick={() => void toggle()}
      >
        {current === "plan" ? "计划" : current === "default" ? "默认" : "模式"}
        <span className="plan-shortcut">⇧Tab</span>
        <span
          className={
            loading || saving ? "plan-indicator is-loading" : "plan-indicator"
          }
          aria-hidden="true"
        >
          <svg
            width="12"
            height="12"
            viewBox={loading || saving ? "0 0 12 12" : "0 0 16 16"}
            fill="none"
          >
            <path
              d={
                loading || saving
                  ? "M10.5 6C10.5 6.89002 10.2361 7.76004 9.74161 8.50007C9.24715 9.24009 8.54434 9.81686 7.72208 10.1575C6.89981 10.4981 5.99501 10.5872 5.12209 10.4135C4.24918 10.2399 3.44736 9.81132 2.81802 9.18198C2.18868 8.55264 1.7601 7.75082 1.58647 6.87791C1.41283 6.00499 1.50195 5.10019 1.84254 4.27792C2.18314 3.45566 2.75991 2.75285 3.49993 2.25839C4.23996 1.76392 5.10998 1.5 6 1.5"
                  : "M4 6L8 10L12 6"
              }
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {error && (
        <div className="plan-mode-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => setRevision((n) => n + 1)}
            disabled={saving || busy}
          >
            重新读取
          </button>
        </div>
      )}
    </div>
  );
  return { control, toggle, pending: saving || uncertain, mode: current };
}
