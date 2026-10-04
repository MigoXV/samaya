import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync } from "node:fs";
const out = "../../.samaya/workspace-overview";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ignoreDefaultArgs: ["--hide-scrollbars"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const state = fixture(45);
// Distinct activity timestamps make ordering observable, independent of statuses.
state.records.forEach((r, i) => {
  r.progressAt = r.thread.updatedAt - 100;
});
const { calls, broadcast } = await install(context, state);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
const groups = page.locator(".overview-workspace");
await expect(groups).toHaveCount(3);
for (const group of await groups.all())
  await expect(group.locator(".overview-task")).toHaveCount(5);
await expect(page.locator(".overview-ended")).toHaveCount(0);
const samaya = page.locator(
  '.overview-workspace[data-workspace="/demo/Samaya"]',
);
await samaya.getByRole("button", { name: /再展开 5 个任务/ }).click();
await expect(samaya.locator(".overview-task")).toHaveCount(10);
await samaya.getByRole("button", { name: /再展开 5 个任务/ }).click();
await expect(samaya.locator(".overview-task")).toHaveCount(15);
await expect(samaya.locator(".workspace-expand")).toHaveCount(1);
// A task ending stays in its workspace and remains immediately accessible.
const stopped = state.records.find((r) => r.thread.id === "demo-3");
stopped.turn.status = "completed";
stopped.thread.status = { type: "idle", activeFlags: [] };
stopped.terminals = [];
state.pendingRequests = state.pendingRequests.filter(
  (p) => p.params.threadId !== "demo-3",
);
await broadcast();
await expect(samaya.locator('[data-task-id="demo-3"]')).toBeVisible();
await expect(samaya.locator('[data-task-id="demo-3"]')).toContainText(
  "本轮已结束",
);
await samaya.getByRole("button", { name: "收起到最近 5 个" }).click();
await expect(samaya.locator(".overview-task")).toHaveCount(5);
const latest = state.records.find((r) => r.thread.id === "demo-44");
latest.progressAt = Date.now() / 1000 + 100;
await broadcast();
await expect(groups.first()).toHaveAttribute(
  "data-workspace",
  "/demo/MeetNote",
);
await expect(groups.first().locator(".overview-task").first()).toHaveAttribute(
  "data-task-id",
  "demo-44",
);
for (const theme of ["vallum", "abyssus"]) {
  await page.evaluate(
    (value) => window.samayaTheme.setPreference(value),
    theme,
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.locator(".task-overview").evaluate((el) => (el.scrollTop = 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(groups).toHaveCount(3);
    await page.screenshot({ path: `${out}/${theme}-${width}.png` });
  }
  expect(
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
}
await page.setViewportSize({ width: 1440, height: 960 });
await groups.first().locator(".overview-task").first().click();
await expect(page.locator(".task-reading-heading")).toContainText(
  latest.thread.name,
);
expect(calls).toHaveLength(0);
expect(errors).toEqual([]);
console.log(
  "Workspace groups, five-at-a-time expansion, completion retention, live activity ordering, navigation, dual themes and mobile accessibility passed.",
);
await browser.close();
