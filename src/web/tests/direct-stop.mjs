import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext();
  const state = fixture();
  state.pendingRequests = [];
  const { calls } = await install(context, state);
  let fail = true,
    release;
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    if (op.action === "interrupt" && fail) {
      calls.push(op);
      await new Promise((resolve) => {
        release = resolve;
      });
      return route.fulfill({
        json: { state: "failed", result: { message: "停止被拒绝（测试）" } },
      });
    }
    return route.fallback();
  });
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await page.locator('[data-task-id="demo-3"].overview-task').click();
  const stop = page.getByRole("button", { name: "停止当前轮次", exact: true });
  await expect(stop).toBeEnabled();
  await stop.click();
  await expect
    .poll(() => calls.filter((c) => c.action === "interrupt").length)
    .toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(stop).toBeDisabled();
  expect(calls.at(-1).body).toEqual({ threadId: "demo-3", turnId: "turn-3" });
  release();
  await expect(
    page.getByText("停止被拒绝（测试）", { exact: false }).first(),
  ).toBeVisible();
  fail = false;
  await expect(stop).toBeEnabled();
  await stop.click();
  await expect
    .poll(() => calls.filter((c) => c.action === "interrupt").length)
    .toBe(2);
  await expect(stop).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.records.find((r) => r.thread.id === "demo-3").turn.status).toBe(
    "interrupted",
  );
  expect(state.records.find((r) => r.thread.id === "demo-5").turn.status).toBe(
    "inProgress",
  );
  console.log(
    "Direct stop: no modal, scoped turn, pending disabled, failure feedback/retry and completion passed.",
  );
} finally {
  await browser.close();
}
