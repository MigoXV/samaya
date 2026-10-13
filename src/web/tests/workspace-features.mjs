import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  serviceWorkers: "block",
  viewport: { width: 1440, height: 960 },
});
const state = fixture();
state.pendingRequests = [];
const { calls } = await install(context, state);
await context.addInitScript(() => {
  window.__notifications = [];
  window.__permissionRequests = 0;
  class FakeNotification {
    static permission = "default";
    static async requestPermission() {
      window.__permissionRequests++;
      this.permission = "granted";
      return "granted";
    }
    constructor(title, options) {
      this.title = title;
      this.options = options;
      window.__notifications.push(this);
    }
    close() {}
  }
  window.Notification = FakeNotification;
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
await expect(page).toHaveTitle("任务总览 — Samaya");
const group = page.locator('[data-workspace="/demo/Laya"]');
await group.locator(".workspace-toggle").click();
await expect(group.locator(".workspace-create")).toBeVisible();
await group.locator(".workspace-create").click();
await expect(page.locator(".task-reading-heading h1")).toHaveText(
  "Laya / 新会话",
);
await expect(page).toHaveTitle("新会话 · Laya — Samaya");
expect(calls).toHaveLength(0);
const input = page.getByRole("textbox", {
  name: "新会话工作要求",
  exact: true,
});
await expect(page.locator(".global-pending")).toBeVisible();
await expect(page.locator(".task-heading")).toHaveCSS("height", "40px");
await expect(page.locator(".task-reading-heading")).toHaveCSS("height", "40px");
await input.fill("页签切换保留草稿");
await page.getByRole("button", { name: "改动与产物", exact: true }).click();
await expect(page.getByRole("region", { name: "改动与结果" })).toContainText(
  "发送工作要求创建会话后",
);
await expect(input).toHaveValue("页签切换保留草稿");
await page.getByRole("button", { name: "对话", exact: true }).click();
await expect(page.locator(".draft-introduction h2")).toHaveText(
  "新会话 · Laya",
);
await page.getByRole("button", { name: "收起任务侧栏", exact: true }).click();
await expect(page.locator(".monitor-nav")).toBeHidden();
await expect(
  page.getByRole("button", { name: "展开任务侧栏", exact: true }),
).toBeFocused();
await page.getByRole("button", { name: "展开任务侧栏", exact: true }).click();
await expect(page.locator(".monitor-nav")).toBeVisible();
await expect(page.locator(".plan-mode-button")).toBeEnabled();
await input.fill("工作区草稿与引用需要保留。");
await input.press("Shift+Tab");
await expect(page.locator(".plan-mode-button")).toHaveAttribute(
  "aria-pressed",
  "true",
);
await expect(input).toBeFocused();
await expect(input).toHaveValue("工作区草稿与引用需要保留。");
await page.reload();
await expect(input).toHaveValue("工作区草稿与引用需要保留。");
await expect(page.locator(".plan-mode-button")).toHaveAttribute(
  "aria-pressed",
  "true",
);
await expect(input).toBeEnabled();
await expect(page.locator(".plan-mode-button")).toBeEnabled();
await input.press("Enter");
await expect
  .poll(() => calls.map((c) => c.action).join(","))
  .toBe("create,command,send");
expect(calls[0].body.cwd).toBe("/demo/Laya");
expect(calls[1].body.args.value).toBe("plan");
expect(calls[2].body.expectedCwd).toBe("/demo/Laya");
await expect(page.locator('[data-turn-id="new-turn"]')).toHaveCount(1);
await expect(page).toHaveTitle(/新任务 · Laya — Samaya/);
// A known task switches through the native command receipt without dialog or lost caret.
const knownInput = page.getByRole("textbox", {
  name: "补充当前任务",
  exact: true,
});
await expect(page.locator(".plan-mode-button")).toHaveAttribute(
  "aria-pressed",
  "true",
);
await knownInput.fill("继续核对。");
await knownInput.evaluate((el) => el.setSelectionRange(2, 2));
await knownInput.press("Shift+Tab");
await expect(knownInput).toBeFocused();
await expect(knownInput).toHaveValue("继续核对。");
await expect(page.locator(".plan-mode-button")).toHaveAttribute(
  "aria-pressed",
  "false",
);
expect(await knownInput.evaluate((el) => el.selectionStart)).toBe(2);
await expect(page.getByRole("dialog")).toHaveCount(0);
// Configuration is opt-in; snapshots and replayed event IDs never alert.
expect(await page.evaluate(() => window.__permissionRequests)).toBe(0);
await page.getByRole("button", { name: "设置与连接", exact: true }).click();
await page.getByRole("button", { name: "开启浏览器通知", exact: true }).click();
await expect(
  page.getByRole("button", { name: "已开启 · 关闭", exact: true }),
).toBeVisible();
const emit = (seq, status = "completed") =>
  page.evaluate(
    ({ seq, status }) =>
      window.__emit(
        "message",
        {
          method: "turn/completed",
          params: {
            threadId: "demo-created",
            turn: { id: "new-turn", status },
          },
        },
        seq,
      ),
    { seq, status },
  );
await emit(0);
await emit(100, "failed");
expect(await page.evaluate(() => window.__notifications.length)).toBe(0);
await emit(101);
await expect
  .poll(() => page.evaluate(() => window.__notifications.length))
  .toBe(1);
await emit(102);
expect(await page.evaluate(() => window.__notifications.length)).toBe(1);
await page.evaluate(() => window.__notifications[0].onclick());
await expect(page).toHaveTitle(/新任务 · Laya — Samaya/);
// A second tab shares notification permission/preferences and the dedup lock.
const other = await context.newPage();
await other.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
await expect(other.locator(".workspace-create").first()).toBeVisible();
await other.evaluate(() => {
  window.Notification.permission = "granted";
});
await Promise.all(
  [page, other].map((p) =>
    p.evaluate(() =>
      window.__emit(
        "message",
        {
          method: "turn/completed",
          params: {
            threadId: "demo-3",
            turn: { id: "dedup-turn", status: "completed" },
          },
        },
        200,
      ),
    ),
  ),
);
await expect
  .poll(
    async () =>
      (await page.evaluate(() => window.__notifications.length)) +
      (await other.evaluate(() => window.__notifications.length)),
  )
  .toBe(2);
await other.close();
for (const theme of ["vallum", "abyssus"]) {
  await page.evaluate((t) => window.samayaTheme.setPreference(t), theme);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(knownInput).toBeVisible();
  }
  expect(
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
}
expect(errors).toEqual([]);
await browser.close();
console.log(
  "Workspace-scoped drafts, native plan shortcut/caret, tab titles, opt-in completion notifications, replay suppression, navigation, cross-tab dedup and responsive accessibility passed.",
);
