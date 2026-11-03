import { useEffect, useId, useRef, useState } from "react";
import { History, X } from "lucide-react";
import "./draft-recovery.css";

export type RecoverableDraft = {
  key: string;
  text: string;
  pending: boolean;
};

export function DraftRecovery({
  items,
  hasDraft,
  restore,
  remove,
  inspect,
}: {
  items: RecoverableDraft[];
  hasDraft: boolean;
  restore: (item: RecoverableDraft) => void;
  remove: (item: RecoverableDraft) => void;
  inspect: () => void;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const closeOnResize = () => panel.current?.hidePopover();
    window.addEventListener("resize", closeOnResize);
    return () => window.removeEventListener("resize", closeOnResize);
  }, [open]);

  function close() {
    panel.current?.hidePopover();
  }

  return (
    <div className="draft-recovery">
      <button
        ref={trigger}
        type="button"
        className="quiet recovery-trigger"
        aria-label={`暂存内容，${items.length} 条`}
        title="暂存内容"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (!panel.current || !trigger.current) return;
          const box = trigger.current.getBoundingClientRect();
          panel.current.style.left = `${Math.max(16, Math.min(box.left, innerWidth - Math.min(360, innerWidth - 32) - 16))}px`;
          panel.current.style.bottom = `${innerHeight - box.top + 8}px`;
          panel.current.style.maxHeight = `${Math.min(360, Math.max(0, box.top - 24))}px`;
          panel.current.togglePopover();
        }}
      >
        <History size={18} aria-hidden="true" />
        <span className="recovery-count" aria-hidden="true">
          {items.length > 9 ? "9+" : items.length}
        </span>
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className="recovery-panel"
        role="region"
        aria-label="暂存内容"
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        <header>
          <strong>暂存内容</strong>
          <button
            type="button"
            className="quiet"
            aria-label="关闭暂存内容"
            onClick={() => {
              close();
              trigger.current?.focus();
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="recovery-list">
          {items.map((item) => (
            <details key={item.key} className="recovery-item">
              <summary>
                <span className="recovery-state">
                  {item.pending ? "待确认" : "未发送"}
                </span>
                <span className="recovery-preview">{item.text}</span>
              </summary>
              <p className="recovery-text">{item.text}</p>
              {item.pending && (
                <p className="recovery-hint">
                  发送结果尚未确认，请核对会话后再重发。
                </p>
              )}
              <div className="recovery-actions">
                <button
                  type="button"
                  className="quiet"
                  disabled={hasDraft}
                  title={
                    hasDraft ? "请先处理当前草稿" : "放回草稿，不会自动发送"
                  }
                  onClick={() => {
                    restore(item);
                    close();
                  }}
                >
                  继续编辑
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    remove(item);
                    requestAnimationFrame(() =>
                      panel.current
                        ?.querySelector<HTMLButtonElement>("header button")
                        ?.focus(),
                    );
                  }}
                >
                  移除暂存
                </button>
              </div>
            </details>
          ))}
        </div>
        <footer>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              close();
              inspect();
            }}
          >
            查看操作记录
          </button>
        </footer>
      </div>
    </div>
  );
}
