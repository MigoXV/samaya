import { useEffect, useRef, useState } from "react";
import { projectName, threadTitle, rootId } from "./monitor";
import type { Observation } from "./monitor";
const preference = "samaya.notifications.enabled";
const seenKey = "samaya.notifications.seen";
const supported = () => "Notification" in window && window.isSecureContext;
const permission = () =>
  supported() ? Notification.permission : "unsupported";
async function withTimeout<T>(pending: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(seenKey) || "[]");
  } catch {
    return [];
  }
}
export function NotificationSettings() {
  const [allowed, setAllowed] = useState(permission);
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem(preference) === "true",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => {
      setAllowed(permission());
      setEnabled(localStorage.getItem(preference) === "true");
    };
    window.addEventListener("focus", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  async function toggle() {
    if (busy) return;
    if (enabled && allowed === "granted") {
      localStorage.setItem(preference, "false");
      setEnabled(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result =
        Notification.permission === "granted"
          ? "granted"
          : await withTimeout(
              Notification.requestPermission(),
              15000,
              "通知权限申请未完成，请检查浏览器地址栏的权限提示和网站通知设置后重试。自签名 HTTPS 证书需要先被浏览器信任。",
            );
      setAllowed(result);
      if (result === "granted") {
        if ("serviceWorker" in navigator) {
          try {
            await withTimeout(
              navigator.serviceWorker.register("/notifications-sw.js"),
              5000,
              "通知服务注册超时",
            );
          } catch {
            setError(
              "通知服务未能注册，将尝试页面通知。请确认浏览器已信任 HTTPS 证书；部分浏览器需要通知服务才能发送系统通知。",
            );
          }
        }
        localStorage.setItem(preference, "true");
        setEnabled(true);
      } else {
        localStorage.setItem(preference, "false");
        setEnabled(false);
        if (result === "default")
          setError("尚未允许通知，请在浏览器权限提示中选择允许后重试。");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section notification-settings">
      <h3>任务通知</h3>
      <div className="usage-row">
        <span>任务完成时通知我</span>
        <button
          type="button"
          className="quiet"
          disabled={allowed === "unsupported" || allowed === "denied" || busy}
          onClick={() => void toggle()}
        >
          {busy
            ? "等待浏览器授权…"
            : allowed === "denied"
              ? "未允许"
              : enabled && allowed === "granted"
                ? "已开启 · 关闭"
                : "开启浏览器通知"}
        </button>
      </div>
      <p className="usage-caption">
        {allowed === "unsupported"
          ? "当前页面无法使用浏览器通知，请通过 HTTPS 或 localhost 访问支持通知的浏览器。"
          : allowed === "denied"
            ? "请在浏览器的网站设置中允许通知，然后重新开启。"
            : enabled && allowed === "granted"
              ? "任务完成时提醒；通知显示工作区和任务名称，点击返回对应任务。"
              : "开启后，任务完成会通过系统通知提醒你。"}
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function useTaskNotifications(
  records: Map<string, Observation>,
  open: (id: string) => void,
) {
  const latest = useRef({ records, open });
  useEffect(() => {
    latest.current = { records, open };
  }, [records, open]);
  useEffect(() => {
    let alive = true;
    const completed = (event: Event) => {
      const { threadId, turn } = (event as CustomEvent).detail;
      if (
        !alive ||
        !supported() ||
        Notification.permission !== "granted" ||
        localStorage.getItem(preference) !== "true" ||
        turn?.status !== "completed" ||
        !turn.id ||
        !latest.current.records.has(threadId)
      )
        return;
      const key = `${threadId}:${turn.id}`;
      const deliver = async () => {
        if (
          !alive ||
          localStorage.getItem(preference) !== "true" ||
          readSeen().includes(key)
        )
          return;
        // Claim synchronously before asynchronous delivery; Web Locks serialize tabs.
        localStorage.setItem(
          seenKey,
          JSON.stringify([...readSeen(), key].slice(-256)),
        );
        const record = latest.current.records.get(threadId)!;
        const background =
          record.terminals.length +
          [...latest.current.records.values()].filter(
            (r) =>
              r.thread.id !== threadId &&
              rootId(r.thread.id, latest.current.records) === threadId &&
              r.turn?.status === "inProgress",
          ).length;
        const nextTurn =
          record.turn?.id !== turn.id && record.turn?.status === "inProgress";
        const title = `${projectName(record.thread)} · ${threadTitle(record.thread)}`;
        const options = {
          body: nextTurn
            ? "本轮已结束 · 下一轮正在运行"
            : background
              ? `本轮已结束 · 后台仍运行 ${background} 项`
              : "任务已完成，查看结果。",
          tag: `samaya-${key}`,
          data: { threadId },
          icon: "/figma/samaya-symbol.svg",
        };
        try {
          const registration =
            "serviceWorker" in navigator
              ? await navigator.serviceWorker
                  .getRegistration()
                  .catch(() => undefined)
              : undefined;
          if (registration?.active)
            await registration.showNotification(title, options);
          else {
            const notification = new Notification(title, options);
            notification.onclick = () => {
              notification.close();
              window.focus();
              latest.current.open(threadId);
            };
          }
        } catch {
          localStorage.setItem(
            seenKey,
            JSON.stringify(readSeen().filter((id) => id !== key)),
          );
        }
      };
      void (
        navigator.locks
          ? navigator.locks.request(`samaya-notify-${key}`, deliver)
          : deliver()
      ).catch(() => {});
    };
    const activate = (event: MessageEvent) => {
      if (
        event.data?.type === "samaya:open-thread" &&
        typeof event.data.threadId === "string"
      ) {
        window.focus();
        latest.current.open(event.data.threadId);
      }
    };
    window.addEventListener("samaya:turn-completed", completed);
    navigator.serviceWorker?.addEventListener("message", activate);
    return () => {
      alive = false;
      window.removeEventListener("samaya:turn-completed", completed);
      navigator.serviceWorker?.removeEventListener("message", activate);
    };
  }, []);
}
