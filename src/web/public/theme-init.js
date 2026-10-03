/* Blocking, same-origin bootstrap. Shared by React; no palette or business state. */
(() => {
  const key = "samaya.theme";
  const normalize = (value) =>
    ["vallum", "abyssus", "system"].includes(value) ? value : "vallum";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listeners = new Set();
  let preference = "vallum";
  let persistent = true;
  let snapshot;
  try {
    preference = normalize(localStorage.getItem(key));
  } catch {
    persistent = false;
  }
  function updateBrowserColor() {
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg-primary")
      .trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (color && meta) meta.setAttribute("content", color);
  }
  function apply() {
    const resolved =
      preference === "system"
        ? media.matches
          ? "abyssus"
          : "vallum"
        : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme =
      resolved === "abyssus" ? "dark" : "light";
    updateBrowserColor();
    if (
      snapshot &&
      snapshot.preference === preference &&
      snapshot.resolved === resolved &&
      snapshot.persistent === persistent
    )
      return;
    snapshot = Object.freeze({ preference, resolved, persistent });
    listeners.forEach((listener) => listener());
  }
  window.samayaTheme = Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setPreference(value) {
      preference = normalize(value);
      try {
        localStorage.setItem(key, preference);
        persistent = true;
      } catch {
        persistent = false;
      }
      apply();
    },
  });
  media.addEventListener("change", () => {
    if (preference === "system") apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) {
      preference = normalize(event.key === null ? null : event.newValue);
      apply();
    }
  });
  apply();
  document.addEventListener(
    "load",
    (event) => {
      if (
        event.target instanceof HTMLLinkElement &&
        event.target.rel === "stylesheet"
      )
        updateBrowserColor();
    },
    true,
  );
  document.addEventListener("DOMContentLoaded", updateBrowserColor, {
    once: true,
  });
})();
