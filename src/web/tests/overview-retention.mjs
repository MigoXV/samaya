import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 700 },
});
const state = fixture(90);
const { calls, broadcast } = await install(context, state);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
const nav = (name) =>
  page.locator(".monitor-nav").getByRole("button", { name, exact: true });
const samaya = page.locator(
  '.overview-workspace[data-workspace="/demo/Samaya"]',
);
const laya = page.locator('.overview-workspace[data-workspace="/demo/Laya"]');
await samaya.getByRole("button", { name: /再展开 5 个任务/ }).click();
await laya.getByRole("button", { name: "折叠 Laya 工作区" }).click();
await page
  .locator(".overview-workspace-scroll")
  .evaluate((el) => (el.scrollTop = 200));
await expect
  .poll(() =>
    page.evaluate(
      () => JSON.parse(sessionStorage.getItem("samaya.overview.groups")).scroll,
    ),
  )
  .toBe(200);
await nav("设置与连接").click();
await nav("任务总览").click();
await expect(samaya.locator(".overview-task")).toHaveCount(10);
await expect(laya.locator(".workspace-tasks")).toBeHidden();
await expect
  .poll(() =>
    page.locator(".overview-workspace-scroll").evaluate((el) => el.scrollTop),
  )
  .toBe(200);
await page.locator(".scope-trigger").first().click();
await page
  .getByRole("region", { name: "选择项目", exact: true })
  .getByRole("button", { name: /Samaya/ })
  .click();
await page.locator(".scope-trigger").nth(1).click();
await page
  .getByRole("group", { name: "选择状态", exact: true })
  .getByRole("button", { name: "运行中", exact: true })
  .click();
for (const name of ["设置与连接", "待我处理", "置顶任务", "记录管理"]) {
  await page
    .locator(".monitor-nav")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
  await nav("任务总览").click();
  await expect(page.locator(".scope-trigger").first()).toContainText("Samaya");
  await expect(page.locator(".scope-trigger").nth(1)).toContainText("运行中");
}
await broadcast();
await expect(page.locator(".scope-trigger").nth(1)).toContainText("运行中");
await page.reload();
await expect(page.locator(".scope-trigger").first()).toContainText("Samaya");
await expect(page.locator(".scope-trigger").nth(1)).toContainText("运行中");
await samaya.locator(".overview-task").first().click();
await nav("任务总览").click();
await expect(page.locator(".scope-trigger").nth(1)).toContainText("运行中");
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await page
  .getByRole("searchbox", { name: "搜索任务与进展", exact: true })
  .fill("验证");
await nav("设置与连接").click();
await nav("任务总览").click();
await expect(page.locator(".task-overview")).toHaveCount(0);
await expect(
  page.getByRole("searchbox", { name: "搜索任务与进展", exact: true }),
).toHaveValue("验证");
await expect(page.getByRole("combobox", { name: "执行情况筛选" })).toHaveValue(
  "running",
);
await page.reload();
await expect(
  page.getByRole("searchbox", { name: "搜索任务与进展", exact: true }),
).toHaveValue("验证");
await expect(page.getByRole("combobox", { name: "执行情况筛选" })).toHaveValue(
  "running",
);
expect(calls).toHaveLength(0);
await page.getByRole("button", { name: "返回工作区总览", exact: true }).click();
await expect(page.locator(".scope-trigger").first()).toContainText("Samaya");
await expect(page.locator(".scope-trigger").nth(1)).toContainText("运行中");
expect(errors).toEqual([]);
await browser.close();
console.log(
  "Overview retention: filters, project, all tasks, search, workspace expansion/collapse, scroll, task navigation, live updates and reload passed.",
);
