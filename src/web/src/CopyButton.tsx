import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({
  label,
  getText,
  showLabel = false,
}: {
  label: string;
  getText: () => string;
  showLabel?: boolean;
}) {
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef(0);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      request.current++;
    },
    [],
  );

  async function copy() {
    const current = ++request.current;
    clearTimeout(timer.current);
    setNotice("");
    try {
      await navigator.clipboard.writeText(getText());
      if (current !== request.current) return;
      setNotice("已复制");
      timer.current = setTimeout(() => setNotice(""), 2000);
    } catch {
      if (current === request.current) setNotice("复制失败，请选择正文复制");
    }
  }

  return (
    <div className="copy-control">
      <button
        type="button"
        className="quiet"
        aria-label={label}
        title={notice || label}
        onClick={() => void copy()}
      >
        {notice === "已复制" ? (
          <Check size={18} aria-hidden="true" />
        ) : (
          <Copy size={18} aria-hidden="true" />
        )}
        {showLabel && <span>{notice === "已复制" ? notice : label}</span>}
      </button>
      <small
        className={notice === "已复制" ? "sr-only" : "response-notice"}
        role="status"
      >
        {notice}
      </small>
    </div>
  );
}
