import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  }),
  state = fixture(),
  { calls, broadcast } = await install(context, state),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const out = "../../.samaya/workflow-v3";
mkdirSync(out, { recursive: true });
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:5175");
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await page.getByRole("list", { name: "任务列表" }).waitFor();
await expect(page.locator(".task-row")).toHaveCount(16);
await expect(
  page.getByRole("button", { name: "待处理 4 个任务", exact: true }),
).toBeVisible();
const visible = await page
  .locator(".task-row")
  .evaluateAll(
    (rows) =>
      rows.filter((r) => r.getBoundingClientRect().bottom <= innerHeight)
        .length,
  );
await page.screenshot({ path: out + "/desktop-white.png" });
let axe = await new AxeBuilder({ page }).analyze();
await page
  .locator(".task-row")
  .first()
  .getByRole("button", { name: /选择方案/ })
  .click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: /选择方案.*去重范围/ })
  .click();
await page.getByRole("radio", { name: /同会话/ }).check();
await page.getByRole("button", { name: "确认 →", exact: true }).click();
await expect(
  page.getByText(
    "请求已处理、失效或连接已变化。请核对最新任务状态，不能重复授权。",
  ),
).toBeVisible();
await page.keyboard.press("Escape");
await page.locator(".task-row").first().locator(".task-open").click();
await page
  .getByLabel("补充当前任务", { exact: true })
  .fill("演示：增加边界测试");
await page.getByRole("button", { name: "追加指令" }).click();
await expect
  .poll(() => calls.filter((c) => c.action === "steer").length)
  .toBe(1);
await page.getByRole("button", { name: "停止当前轮次", exact: true }).click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: "停止本轮", exact: true })
  .click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await expect(
  page.getByRole("button", { name: "停止当前轮次", exact: true }),
).toHaveCount(0);
await returnToOverview(page);
await page.locator('[data-task-id="demo-6"] .task-open').click();
await expect(page.locator(".task-detail")).toContainText("1 个后台命令");
await page.getByRole("button", { name: "改动与产物", exact: true }).click();
await page
  .getByRole("region", { name: "改动与结果" })
  .getByText("演示结果：检查结束；不代表真实运行时验收。")
  .waitFor();
await returnToOverview(page);
await page.getByRole("button", { name: "新建任务", exact: true }).click();
await page.getByLabel("服务器目录").fill("/demo/Samaya");
await page.getByLabel("工作要求").fill("演示：新任务目标");
await page.getByRole("button", { name: "派发任务", exact: true }).click();
await expect(page.locator(".task-reading-heading h1")).toContainText("新任务");
await expect
  .poll(() => calls.filter((c) => c.action === "create").length)
  .toBe(1);
await expect
  .poll(() => calls.filter((c) => c.action === "send").length)
  .toBe(1);
await returnToOverview(page);
// Cross-tab resolution of the same request disables the old form.
const other = await context.newPage();
await other.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:5175");
await other
  .getByRole("button", { name: "查看全部任务 →", exact: true })
  .click();
await other.getByRole("list", { name: "任务列表" }).waitFor();
await page
  .locator('[data-task-id="demo-2"]')
  .getByRole("button", { name: /处理授权/ })
  .click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: /处理授权.*turn-2/ })
  .click();
state.pendingRequests = state.pendingRequests.filter((p) => p.key !== "req-2");
await broadcast();
await expect(
  page.getByText(
    "请求已处理、失效或连接已变化。请核对最新任务状态，不能重复授权。",
  ),
).toBeVisible();
await page.keyboard.press("Escape");
await other.close();
await page.evaluate(() => window.samayaTheme.setPreference("abyssus"));
await page.screenshot({ path: out + "/desktop-dark.png" });
const darkAxe = await new AxeBuilder({ page }).analyze();
await page.setViewportSize({ width: 1366, height: 768 });
const visible1366 = await page
  .locator(".task-row")
  .evaluateAll(
    (rows) =>
      rows.filter((r) => r.getBoundingClientRect().bottom <= innerHeight)
        .length,
  );
const layouts = [];
for (const width of [390, 320]) {
  await page.setViewportSize({ width, height: 844 });
  await page.screenshot({ path: out + `/mobile-${width}.png` });
  layouts.push({
    width,
    overflow: await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  });
  await page.locator(".task-row").first().locator(".task-open").click();
  await page.getByLabel("补充当前任务", { exact: true }).fill("草稿保留");
  await returnToOverview(page);
}
// Restore while keeping the current state: no submission may be replayed.
const before = calls.length;
await page.reload();
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await page.getByRole("list", { name: "任务列表" }).waitFor();
expect(calls.length).toBe(before);
const result = {
  demo: true,
  errors,
  visible1440: visible,
  visible1366,
  layouts,
  operations: calls.map((c) => c.action),
  axe: axe.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target),
  })),
  darkAxe: darkAxe.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target),
  })),
};
writeFileSync(out + "/browser-results.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
expect(errors).toEqual([]);
expect(result.axe).toEqual([]);
expect(result.darkAxe).toEqual([]);
expect(visible).toBeGreaterThanOrEqual(10);
expect(visible1366).toBeGreaterThanOrEqual(8);
expect(layouts.every((l) => !l.overflow)).toBe(true);
