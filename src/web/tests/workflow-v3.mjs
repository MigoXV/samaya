import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  }),
  state = fixture(32);
state.pendingRequests.push({
  key: "old-request",
  id: 99,
  method: "item/tool/requestUserInput",
  params: {
    threadId: "demo-31",
    turnId: "turn-31",
    questions: [
      { id: "input", header: "历史请求", question: "请补充历史任务要求。" },
    ],
  },
});
await context.addInitScript(() =>
  localStorage.setItem("samaya.pins", JSON.stringify(["demo-31"])),
);
const { calls, broadcast } = await install(context, state),
  page = await context.newPage();
const url = process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:5175";
await page.goto(url);
await expect(page.locator(".task-row")).toHaveCount(20);
await expect(page.locator('[data-task-id="demo-31"]')).toHaveCount(0);
await expect(
  page.getByRole("button", { name: "范围外 1 项请求 · 查看请求" }),
).toBeVisible();
await page.getByRole("button", { name: "置顶", exact: true }).click();
await expect(page.locator(".task-row")).toHaveCount(1);
await expect(page.locator('[data-task-id="demo-31"]')).toBeVisible();
await page.getByRole("button", { name: "最近任务", exact: true }).click();
const before = await page
  .locator(".task-row")
  .evaluateAll((rows) => rows.map((r) => r.dataset.taskId));
state.records.find((r) => r.thread.id === "demo-30").thread.updatedAt =
  Date.now() / 1000 + 100;
state.records.find((r) => r.thread.id === "demo-0").confirmedAt =
  Date.now() / 1000 + 1000;
await broadcast();
await expect(
  page.getByRole("button", { name: "更新最近任务", exact: true }),
).toBeVisible();
expect(
  await page
    .locator(".task-row")
    .evaluateAll((rows) => rows.map((r) => r.dataset.taskId)),
).toEqual(before);
await page.locator('[data-task-id="demo-19"] .task-open').click();
await page.getByLabel("补充当前任务", { exact: true }).fill("草稿保留");
await page.getByRole("button", { name: "更新最近任务", exact: true }).click();
await expect(page.locator('[data-task-id="demo-30"]')).toBeVisible();
await expect(page.locator(".task-detail h2")).toContainText("19");
await expect(page.locator(".task-detail")).toContainText(
  "此任务在当前最近范围外",
);
await expect(page.getByLabel("补充当前任务", { exact: true })).toHaveValue(
  "草稿保留",
);
await page.getByRole("button", { name: "返回列表", exact: true }).click();
await page.getByLabel("最近任务数量").selectOption("10");
await expect(page.locator(".task-row")).toHaveCount(10);
await page.reload();
await expect(page.locator(".task-row")).toHaveCount(10);
await page.getByLabel("项目筛选").selectOption("/demo/Laya");
await expect(page.locator(".task-row")).toHaveCount(10);
expect(await page.locator(".task-row small").allTextContents()).toContain(
  "Laya",
);
await page.getByLabel("搜索任务与进展").fill("历史不存在");
await expect(page.locator(".task-row")).toHaveCount(0);
await page.getByLabel("搜索任务与进展").fill("");
await page.getByLabel("项目筛选").selectOption("");
await page.getByLabel("最近任务数量").selectOption("20");
await page.locator('[data-task-id="demo-0"] .task-open').click();
await expect(
  page.getByRole("button", { name: "当前工作", exact: true }),
).toHaveAttribute("aria-current", "page");
await page.locator(".turn-divider").waitFor();
await page.waitForFunction(
  () => window.__sources.length >= 2 && window.__sources.every((s) => s.ready),
);
await expect(page.locator(".recent-requirement")).toContainText(
  "演示要求：修复重复提交",
);
// One native item keeps its identity through start, streamed text and completion.
await page.evaluate(() => {
  const params = {
    threadId: "demo-0",
    turnId: "turn-0",
    itemId: "stream-once",
  };
  window.__emit("message", {
    method: "item/started",
    params: {
      ...params,
      item: { id: "stream-once", type: "agentMessage", text: "" },
    },
  });
  window.__emit("message", {
    method: "item/agentMessage/delta",
    params: { ...params, delta: "unique-stream-text" },
  });
  window.__emit(
    "message",
    {
      method: "item/agentMessage/delta",
      params: { ...params, delta: "-deduplicated" },
    },
    1002,
  );
  window.__emit(
    "message",
    {
      method: "item/agentMessage/delta",
      params: { ...params, delta: "-deduplicated" },
    },
    1002,
  );
});
await expect(page.locator('[data-item-id="stream-once"]')).toHaveCount(1);
await expect(page.locator('[data-item-id="stream-once"]')).toContainText(
  "unique-stream-text-deduplicated",
);
expect(
  (await page.locator('[data-item-id="stream-once"]').textContent()).match(
    /deduplicated/g,
  ),
).toHaveLength(1);
await page.evaluate(() =>
  window.__emit("message", {
    method: "item/completed",
    params: {
      threadId: "demo-0",
      turnId: "turn-0",
      item: {
        id: "stream-once",
        type: "agentMessage",
        text: "unique-stream-text completed",
      },
    },
  }),
);
await expect(page.locator('[data-item-id="stream-once"]')).toHaveCount(1);
await expect(
  page.locator('[data-item-id="stream-once"] .stream-notice'),
).toHaveCount(0);
await expect(page.locator('[data-item-id="stream-once"]')).toContainText(
  "completed",
);
// Fixed footer remains accessible while reading, and IME composition never submits.
const input = page.getByLabel("补充当前任务", { exact: true });
await input.fill("keyboard instruction");
await input.evaluate((el) =>
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
      bubbles: true,
    }),
  ),
);
expect(calls).toHaveLength(0);
await input.press("Control+Enter");
await expect
  .poll(() => calls.filter((c) => c.action === "steer").length)
  .toBe(1);
await page.screenshot({ path: "../../.samaya/workflow-v3/work-desktop.png" });
const layout = [];
for (const width of [390, 320]) {
  await page.setViewportSize({ width, height: 844 });
  await page.screenshot({
    path: `../../.samaya/workflow-v3/work-mobile-${width}.png`,
  });
  layout.push(
    await page.evaluate(() => ({
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      composerVisible:
        document.querySelector(".detail-footer").getBoundingClientRect()
          .bottom <= innerHeight,
    })),
  );
}
await page
  .getByLabel("补充当前任务", { exact: true })
  .fill("draft after resize");
await page.reload();
await expect(input).toHaveValue("draft after resize");
expect(calls.filter((c) => c.action === "steer")).toHaveLength(1);
const result = {
  demonstration: true,
  projects: 3,
  topLevelTasks: 32,
  checks: [
    "recent20",
    "pin-scope",
    "outside-request",
    "stable-order",
    "manual-update",
    "selected-outside-scope",
    "recent10-persistence",
    "filter-before-limit",
    "continuous-item-identity",
    "completion-replaces-stream",
    "duplicate-event-sequence",
    "IME",
    "keyboard-submit",
    "fixed-footer",
    "refresh-no-resubmit",
  ],
  layout,
};
mkdirSync("../../.samaya/workflow-v3", { recursive: true });
writeFileSync(
  "../../.samaya/workflow-v3/workflow-results.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
expect(layout.every((l) => !l.overflow && l.composerVisible)).toBe(true);
await browser.close();
