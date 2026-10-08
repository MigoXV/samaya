import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync } from "node:fs";

const out = "../../.samaya/execution-display";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const state = fixture();
const record = state.records.find((r) => r.thread.id === "demo-5");
record.turn.startedAt = Math.floor(Date.now() / 1000) - 42;
const { calls, broadcast } = await install(context, state);
const items = [
  { id: "u", type: "userMessage", text: "验证执行计时与工具调用折叠。" },
  {
    id: "cmd-0",
    type: "commandExecution",
    command: "git diff --stat",
    status: "completed",
    exitCode: 0,
    aggregatedOutput: "检查完成",
  },
  { id: "reasoning", type: "reasoning", text: "不显示的推理" },
  {
    id: "cmd-1",
    type: "commandExecution",
    command: "python check.py",
    status: "failed",
    exitCode: 1,
    aggregatedOutput: "失败原因仍可查看",
  },
  {
    id: "file",
    type: "fileChange",
    status: "completed",
    changes: [{ path: "src/check.py", kind: "update", diff: "+check()" }],
  },
  { id: "a", type: "agentMessage", text: "配置已核对，正在继续验证导出结果。" },
  {
    id: "mcp",
    type: "mcpToolCall",
    server: "figma",
    tool: "get_metadata",
    status: "inProgress",
  },
];
await context.route("**/api/threads/*/turns/*/items*", (route) =>
  route.fulfill({
    json: {
      data: [...items].reverse().map((item) => ({ item })),
      nextCursor: null,
      samayaCursor: 0,
    },
  }),
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
await page.locator('.overview-task[data-task-id="demo-5"]').click();
const sequences = page.locator(".tool-sequence");
await expect(sequences).toHaveCount(2);
await expect(sequences.first()).not.toHaveAttribute("open");
await expect(page.locator(".working-status")).toHaveAttribute(
  "title",
  "本轮持续时间",
);
const seconds = () =>
  page
    .locator(".working-status time")
    .innerText()
    .then((text) => Number.parseInt(text));
const initialSeconds = await seconds();
expect(initialSeconds).toBeGreaterThanOrEqual(42);
await expect.poll(seconds).toBeGreaterThan(initialSeconds);

await sequences.first().locator(":scope > summary").focus();
await page.keyboard.press("Enter");
await expect(sequences.first()).toHaveAttribute("open");
await page.locator(".command-record").nth(1).locator("summary").click();
await expect(page.getByLabel("命令输出").nth(1)).toContainText(
  "失败原因仍可查看",
);
await page.evaluate(() =>
  window.__emit(
    "message",
    {
      method: "item/mcpToolCall/progress",
      params: {
        threadId: "demo-5",
        turnId: "turn-5",
        itemId: "mcp",
        message: "正在读取工作区",
      },
    },
    1,
  ),
);
await expect(sequences).toHaveCount(2);
await expect(sequences.first()).toHaveAttribute("open");
expect(await seconds()).toBeGreaterThanOrEqual(initialSeconds);
await sequences
  .first()
  .getByRole("button", { name: "收起详情", exact: true })
  .click();
await expect(sequences.first()).not.toHaveAttribute("open");
await expect(sequences.first().locator(":scope > summary")).toBeFocused();

for (const theme of ["vallum", "abyssus"]) {
  await page.evaluate(
    (value) => window.samayaTheme.setPreference(value),
    theme,
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(sequences.first()).not.toHaveAttribute("open");
    await page.screenshot({ path: `${out}/${theme}-${width}.png` });
  }
  expect(
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
}
await page.getByRole("button", { name: "改动与产物", exact: true }).click();
await expect(sequences).toHaveCount(0);
await expect(page.locator(".working-status")).toHaveCount(0);
await expect(
  page
    .locator(".file-index")
    .getByRole("button", { name: "src/check.py", exact: true }),
).toBeVisible();
await page.getByRole("button", { name: "对话", exact: true }).click();
await expect(sequences).toHaveCount(2);
expect(await seconds()).toBeGreaterThanOrEqual(initialSeconds);

state.pendingRequests.push({
  key: "timer-request",
  id: 99,
  method: "item/tool/requestUserInput",
  params: {
    threadId: "demo-5",
    turnId: "turn-5",
    questions: [{ id: "scope", question: "请选择验证范围。" }],
  },
});
await broadcast();
await expect(page.locator(".working-status")).toHaveCount(0);
state.pendingRequests = state.pendingRequests.filter(
  (p) => p.key !== "timer-request",
);
await broadcast();
await expect(page.locator(".working-status")).toBeVisible();
state.connection = "disconnected";
await broadcast();
await expect(page.locator(".working-status")).toHaveCount(0);
state.connection = "connected";
// A late thread-level active flag must not keep an ended turn's timer alive.
record.thread.status = { type: "active", activeFlags: [] };
for (const status of ["completed", "interrupted", "failed"]) {
  record.turn.status = status;
  await broadcast();
  await expect(page.locator(".working-status")).toHaveCount(0);
}
record.turn = {
  id: "timer-new-turn",
  status: "inProgress",
  startedAt: Math.floor(Date.now() / 1000),
  items: [],
};
record.thread.status = { type: "active", activeFlags: [] };
await broadcast();
await expect(
  page.locator('.turn-history[data-turn-id="timer-new-turn"] .working-status'),
).toBeVisible();
expect(await seconds()).toBeLessThan(5);
record.turn = {
  id: "timer-unknown-turn",
  status: "inProgress",
  startedAt: null,
  items: [],
};
await broadcast();
await expect(page.locator(".working-status")).toHaveAttribute(
  "title",
  "本次观察时长",
);
expect(calls).toHaveLength(0);
expect(errors).toEqual([]);
await browser.close();
console.log(
  "Folded tool batches, retained details and streaming, native timer, waiting/offline/completion lifecycle, new-turn reset, results tab, keyboard, dual themes and mobile accessibility passed.",
);
