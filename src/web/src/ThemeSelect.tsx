import { useId, useSyncExternalStore } from "react";

type ThemePreference = "vallum" | "abyssus" | "system";
type ThemeSnapshot = {
  preference: ThemePreference;
  resolved: Exclude<ThemePreference, "system">;
  persistent: boolean;
};
declare global {
  interface Window {
    samayaTheme: {
      getSnapshot: () => ThemeSnapshot;
      subscribe: (listener: () => void) => () => void;
      setPreference: (preference: ThemePreference) => void;
    };
  }
}

export function ThemeSelect({ segmented = false }: { segmented?: boolean }) {
  const id = useId();
  const theme = useSyncExternalStore(
    window.samayaTheme.subscribe,
    window.samayaTheme.getSnapshot,
  );
  return (
    <div className="theme-control">
      {segmented ? (
        <div className="theme-setting-row">
          <span id={id}>主题</span>
          <div role="group" aria-labelledby={id} className="theme-buttons">
            {(
              [
                ["vallum", "白垣"],
                ["abyssus", "苍渊"],
                ["system", "跟随系统"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme.preference === value}
                onClick={() => window.samayaTheme.setPreference(value)}
              >
                {label}
                {theme.preference === value ? " ✓" : ""}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <label htmlFor={id}>界面主题</label>
          <select
            id={id}
            value={theme.preference}
            aria-describedby={`${id}-status`}
            onChange={(event) =>
              window.samayaTheme.setPreference(
                event.target.value as ThemePreference,
              )
            }
          >
            <option value="vallum">白垣</option>
            <option value="abyssus">苍渊</option>
            <option value="system">跟随系统</option>
          </select>
        </>
      )}
      <small
        id={`${id}-status`}
        role="status"
        className={
          theme.persistent && theme.preference !== "system"
            ? "sr-only"
            : undefined
        }
      >
        {!theme.persistent
          ? "仅本页生效，浏览器无法保存外观偏好。"
          : theme.preference === "system"
            ? `当前：${theme.resolved === "abyssus" ? "苍渊" : "白垣"}`
            : `已选择${theme.resolved === "abyssus" ? "苍渊" : "白垣"}`}
      </small>
    </div>
  );
}
