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

export function ThemeSelect() {
  const id = useId();
  const theme = useSyncExternalStore(
    window.samayaTheme.subscribe,
    window.samayaTheme.getSnapshot,
  );
  return (
    <div className="theme-control">
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
