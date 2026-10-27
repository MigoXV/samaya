import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture(16);
  state.pendingRequests = [];
  for (const r of state.records) {
    r.thread.status = { type: "idle" };
    r.turn && (r.turn.status = "completed");
    r.confirmedAt = Date.now() / 1000;
  }
  const { broadcast } = await install(context, state);
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  // Workspace titles and controls must stay fixed when expansion introduces a scrollbar.
  const headings = page.locator(".nav-workspace-heading");
  const positions = () =>
    headings.evaluateAll((nodes) =>
      nodes.map((node) => {
        const title = node
          .querySelector("button > span")
          .getBoundingClientRect();
        const create = node
          .querySelector(".nav-workspace-create")
          .getBoundingClientRect();
        return { x: title.x, right: create.right };
      }),
    );
  await expect(headings).toHaveCount(3);
  const before = await positions();
  for (const heading of await headings.all()) {
    await heading.locator("button[aria-expanded]:not([aria-haspopup])").click();
  }
  expect(await positions()).toEqual(before);
  await expect(headings.first().locator(".workspace-disclosure")).toHaveCSS(
    "transform",
    "matrix(0, 1, -1, 0, 0, 0)",
  );
  for (const heading of await headings.all()) {
    await heading.locator("button[aria-expanded]:not([aria-haspopup])").click();
  }
  expect(await positions()).toEqual(before);
  const search = page.getByRole("searchbox", { name: "搜索工作区" });
  await expect(search).toBeVisible();
  await page.locator(".scope-trigger").first().click();
  await page
    .getByRole("region", { name: "选择项目", exact: true })
    .getByRole("button", { name: /MeetNote/ })
    .click();
  await page.locator(".scope-trigger").nth(1).click();
  await page
    .getByRole("group", { name: "选择状态" })
    .getByRole("button", { name: "待我处理", exact: true })
    .click();
  await search.fill("samaya");
  await expect(
    page.locator('.overview-workspace[data-workspace="/demo/Samaya"]'),
  ).toBeVisible();
  await expect(page.locator(".scope-trigger").first()).toContainText(
    "所有项目",
  );
  await expect(page.locator(".scope-trigger").nth(1)).toContainText("全部状态");
  await search.fill("MeetNote");
  await page.locator(".scope-trigger").nth(1).click();
  await page
    .getByRole("group", { name: "选择状态" })
    .getByRole("button", { name: "待我处理", exact: true })
    .click();
  await page
    .getByRole("button", { name: "搜索任务与项目", exact: true })
    .click();
  await page.getByRole("searchbox", { name: "统一搜索" }).fill("samaya");
  await page
    .locator(".palette-results button")
    .filter({ has: page.locator(".palette-type", { hasText: "项目" }) })
    .click();
  await expect(
    page.locator('.overview-workspace[data-workspace="/demo/Samaya"]'),
  ).toBeVisible();
  await expect(search).toHaveValue("");
  await search.fill("lAyA");
  await expect(page.locator(".overview-workspace")).toHaveCount(1);
  await expect(page.locator(".overview-workspace")).toContainText("Laya");
  await search.fill("/demo/MeetNote");
  await expect(page.locator(".overview-workspace")).toHaveCount(1);
  await expect(page.locator(".overview-workspace")).toContainText("MeetNote");
  await search.fill("no-such-workspace");
  await expect(page.locator(".overview-workspace")).toHaveCount(0);
  await search.fill("");
  await expect(page.locator(".workspace-running")).toHaveCount(0);
  const r = state.records.find((r) => r.thread.id === "demo-3");
  r.thread.status = { type: "active" }; // A stale active flag must not override a completed turn.
  await broadcast();
  await expect(page.locator(".workspace-running")).toHaveCount(0);
  r.turn.status = "inProgress";
  r.thread.status.activeFlags = ["waitingOnUserInput"];
  await broadcast();
  await expect(page.locator(".workspace-running")).toHaveCount(0);
  r.thread.status.activeFlags = [];
  state.pendingRequests = [
    {
      key: "pending",
      id: 1,
      method: "item/tool/requestUserInput",
      params: { threadId: r.thread.id, questions: [] },
    },
  ];
  await broadcast();
  await expect(page.locator(".workspace-running")).toHaveCount(0);
  state.pendingRequests = [];
  await broadcast();
  await expect(
    page.locator(".overview-workspace.workspace-running"),
  ).toHaveCount(1);
  r.turn.status = "completed";
  await broadcast();
  await expect(page.locator(".workspace-running")).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(search).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: "../../.samaya/workspace-search.png" });
  console.log("Workspace search and confirmed execution highlighting passed.");
} finally {
  await browser.close();
}
