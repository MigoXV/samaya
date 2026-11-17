import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
mkdirSync("../../.samaya/work-process", { recursive: true });
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  const record = state.records.find((r) => r.thread.id === "demo-5");
  const start = Math.floor(Date.now() / 1000) - 86;
  record.turn.startedAt = start;
  const { broadcast } = await install(context, state);
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (t) => {
          window.__copiedWork = t;
        },
      },
    }),
  );
  let entries = [
    {
      item: { id: "user", type: "userMessage", text: "重排卡片并验证结果。" },
      startedAtMs: start * 1000,
    },
    { item: { id: "reason", type: "reasoning", text: "不可见推理" } },
    {
      item: {
        id: "progress-1",
        type: "agentMessage",
        phase: "commentary",
        text: "先核对已有布局。",
      },
      startedAtMs: (start + 1) * 1000,
    },
    {
      item: {
        id: "cmd",
        type: "commandExecution",
        command: "pnpm run check",
        status: "completed",
        exitCode: 1,
        aggregatedOutput: "检查项异常",
      },
      startedAtMs: (start + 2) * 1000,
      completedAtMs: (start + 3) * 1000,
    },
    {
      item: {
        id: "figma-1",
        type: "mcpToolCall",
        server: "figma",
        tool: "get_metadata",
        appContext: {
          connectorId: "figma",
          appName: "Figma",
          actionName: "核对卡片布局",
        },
        status: "completed",
      },
    },
    {
      item: {
        id: "figma-2",
        type: "mcpToolCall",
        server: "figma",
        tool: "use_figma",
        status: "inProgress",
      },
    },
    {
      item: {
        id: "progress-2",
        type: "agentMessage",
        phase: "commentary",
        text: "布局已调整，正在检查对齐。",
      },
      startedAtMs: (start + 4) * 1000,
    },
  ];
  await context.route("**/api/threads/*/turns/*/items*", (route) =>
    route.fulfill({
      json: { data: entries.toReversed(), nextCursor: null, samayaCursor: 0 },
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "https://127.0.0.1:8765");
  await page.locator('.overview-task[data-task-id="demo-5"]').click();
  const work = page.locator(".work-process");
  const disclosure = work.locator(".work-disclosure");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(work.locator(".is-working")).toHaveText("正在使用 Figma");
  await expect(page.getByText("先核对已有布局。", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("布局已调整，正在检查对齐。", { exact: true }),
  ).toBeVisible();
  await expect(work.locator(".work-anomaly")).toHaveText("1 项工具异常");
  await expect(page.getByText("不可见推理", { exact: true })).toHaveCount(0);
  await expect(page.locator(".conversation-time time")).toHaveAttribute(
    "datetime",
    new Date(start * 1000).toISOString(),
  );
  await expect(work.locator(".work-duration")).toContainText("1分");
  expect(
    await work
      .locator(".is-working")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("work-shimmer");
  await page.screenshot({ path: "../../.samaya/work-process/running.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await work
      .locator(".is-working")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  state.pendingRequests.push({
    key: "work-question",
    id: 99,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "demo-5",
      turnId: "turn-5",
      questions: [{ id: "q", question: "请选择范围。" }],
    },
  });
  await broadcast();
  await expect(work.locator(".is-working")).toHaveCount(0);
  await expect(disclosure).toContainText("等待你的答复");
  await expect(page.getByText("请选择范围。", { exact: true })).toBeVisible();
  state.pendingRequests = [];
  state.connection = "disconnected";
  await broadcast();
  await expect(disclosure).toContainText("连接已断开");
  await expect(work.locator(".is-working")).toHaveCount(0);
  state.connection = "connected";
  record.confirmedAt = Date.now() / 1000 - 90;
  await broadcast();
  await expect(disclosure).toContainText("状态待确认");
  await expect(work.locator(".is-working")).toHaveCount(0);
  record.confirmedAt = Date.now() / 1000;
  await broadcast();
  const compactActivity = work
    .locator(".work-activity")
    .filter({ hasText: "使用 Figma" });
  await compactActivity.locator(":scope > summary").click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(compactActivity.locator(":scope > summary")).toBeFocused();
  await disclosure.click();
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByText("先核对已有布局。", { exact: true }),
  ).toBeVisible();
  const figma = work
    .locator(".work-activity")
    .filter({ hasText: "使用 Figma" });
  await expect(figma.locator(":scope > summary")).toContainText("2 次");
  if ((await figma.getAttribute("open")) === null)
    await figma.locator(":scope > summary").click();
  await expect(figma).toHaveAttribute("open", "");
  entries.push({
    item: {
      id: "partial",
      type: "agentMessage",
      phase: "partial_answer",
      text: "阶段结果。",
    },
  });
  entries.push({
    item: {
      id: "final",
      type: "agentMessage",
      phase: "final_answer",
      text: "卡片布局已完成，结果可供核对。",
    },
  });
  await page.evaluate(
    (item) =>
      window.__emit(
        "message",
        {
          method: "item/completed",
          params: {
            threadId: "demo-5",
            turnId: "turn-5",
            item,
            completedAtMs: Date.now(),
          },
        },
        10,
      ),
    entries.at(-1).item,
  );
  await expect(page.locator('[data-item-id="final"]')).toBeVisible();
  await expect(disclosure).toContainText("正在生成答复");
  record.turn.status = "completed";
  record.turn.completedAt = start + 86;
  record.thread.status = { type: "idle" };
  await broadcast();
  await expect(disclosure).toContainText("本轮已结束");
  await expect(disclosure).toContainText("已用时 1分26秒");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(work.locator(".is-working")).toHaveCount(0);
  await expect(work.locator(".work-history-notice")).toContainText(
    "最终状态未提供",
  );
  await expect(page.locator('[data-item-id="partial"]')).toBeVisible();
  await page
    .locator('[data-item-id="final"]')
    .getByRole("button", { name: "复制本轮回复" })
    .click();
  expect(await page.evaluate(() => window.__copiedWork)).toBe(
    "阶段结果。\n\n卡片布局已完成，结果可供核对。",
  );
  await page.screenshot({
    path: "../../.samaya/work-process/expanded-complete.png",
  });
  await page.reload();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("先核对已有布局。", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('[data-item-id="final"]')).toBeVisible();
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: `../../.samaya/work-process/${theme}-${width}-complete.png`,
      });
    }
  }
  record.turn.status = "failed";
  record.turn.error = { message: "原生轮次错误仍然可见" };
  await broadcast();
  await expect(
    page.getByRole("alert").filter({ hasText: "原生轮次错误仍然可见" }),
  ).toBeVisible();
  entries = [
    { item: { id: "new-user", type: "userMessage", text: "继续核对" } },
    {
      item: {
        id: "new-progress",
        type: "agentMessage",
        phase: "commentary",
        text: "新一轮正在核对。",
      },
    },
  ];
  record.turn = { id: "new-turn", status: "inProgress", items: [] };
  record.thread.status = { type: "active", activeFlags: [] };
  await broadcast();
  const latest = page.locator('[data-turn-id="new-turn"] .work-process');
  await expect(latest.locator(".is-working")).toBeVisible();
  await expect(latest.locator(".work-duration")).toHaveAttribute(
    "title",
    "本次观察时长",
  );
  await expect(latest.locator(".work-duration")).not.toContainText("1分26秒");
  entries.push({
    item: {
      id: "new-answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "这一轮已经核对完毕。",
    },
  });
  record.turn.status = "completed";
  record.turn.completedAt = Date.now() / 1000;
  record.thread.status = { type: "idle" };
  await broadcast();
  await expect(latest.locator(".work-disclosure")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.getByText("新一轮正在核对。", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('[data-item-id="new-answer"]')).toBeVisible();
  await expect(latest.locator(".work-duration")).toHaveText("耗时未提供");
  expect(errors).toEqual([]);
  console.log(
    "Work process: phase-based folding, nested activities, native duration, manual state, copy, reduced motion, waits/disconnection/stale state and error visibility passed",
  );
} finally {
  await browser.close();
}
