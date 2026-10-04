import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const out = "../../.samaya/overview-scope-v7";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const state = fixture(40);
for (let i = 20; i < 30; i++)
  state.records[i].thread.cwd = `/demo/project-${i}`;
const { calls, broadcast } = await install(context, state);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
const projects = page.locator(".nav-projects button[title]");
await expect(projects).toHaveCount(4);
const originalOrder = await projects.evaluateAll((nodes) =>
  nodes.map((n) => n.title),
);
state.records[28].thread.updatedAt += 1000;
await broadcast();
expect(
  await projects.evaluateAll((nodes) => nodes.map((n) => n.title)),
).toEqual(originalOrder);
expect(
  await projects.first().evaluate((n) => n.getBoundingClientRect().height),
).toBe(28);
await expect(page.locator(".monitor-nav svg.lucide")).toHaveCount(6);
const globalCount = await page
  .locator(".monitor-nav-items")
  .getByRole("button", { name: /待我处理/ })
  .innerText();
await page.getByRole("button", { name: "查看全部项目", exact: true }).click();
await expect(
  page.getByRole("textbox", { name: "搜索项目", exact: true }),
).toBeFocused();
await page
  .getByRole("textbox", { name: "搜索项目", exact: true })
  .fill("project-28");
await page
  .getByRole("region", { name: "选择项目", exact: true })
  .getByRole("button", { name: /project-28/ })
  .click();
await expect(page.locator(".scope-trigger").first()).toContainText(
  "project-28",
);
expect(
  await page
    .locator(".monitor-nav-items")
    .getByRole("button", { name: /待我处理/ })
    .innerText(),
).toBe(globalCount);
await expect(page.locator(".nav-projects .selected")).toHaveCount(0);
await page
  .locator(".monitor-nav-items")
  .getByRole("button", { name: "任务总览", exact: true })
  .click();
await expect(page.locator(".scope-trigger").first()).toContainText("所有项目");
await page.locator(".scope-trigger").first().click();
await page.keyboard.press("Escape");
await expect(page.locator(".scope-trigger").first()).toBeFocused();
await page.locator(".scope-trigger").nth(1).click();
await page
  .getByRole("group", { name: "选择状态", exact: true })
  .getByRole("button", { name: "待我处理", exact: true })
  .click();
await expect(page.locator(".attention-preview")).toHaveCount(2);
expect(
  await page.locator(".overview-workspace .overview-task").count(),
).toBeGreaterThan(0);
await expect(
  page.locator('.overview-workspace [data-task-id="demo-0"]'),
).toBeVisible();
await page.locator(".scope-trigger").first().click();
await page
  .getByRole("textbox", { name: "搜索项目", exact: true })
  .fill("Samaya");
await page
  .getByRole("region", { name: "选择项目", exact: true })
  .getByRole("button", { name: /Samaya/ })
  .click();
await expect(page.locator(".scope-trigger").nth(1)).toContainText("待我处理");

await page
  .locator(".monitor-nav-items")
  .getByRole("button", { name: "任务总览", exact: true })
  .click();
for (const theme of ["vallum", "abyssus"]) {
  await page.evaluate(
    (value) => window.samayaTheme.setPreference(value),
    theme,
  );
  await page.mouse.click(1350, 80);
  await page.screenshot({ path: `${out}/overview-${theme}.png` });
  await page.locator(".scope-trigger").first().click();
  await page.screenshot({ path: `${out}/projects-${theme}.png` });
  expect(
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
  await page.keyboard.press("Escape");
}
await page.evaluate(
  (value) => window.samayaTheme.setPreference(value),
  "vallum",
);
for (const width of [768, 390, 320]) {
  await page.setViewportSize({ width, height: 960 });
  await page.locator(".scope-trigger").first().click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${out}/scope-${width}.png` });
  await page.keyboard.press("Escape");
}
await page.setViewportSize({ width: 1440, height: 960 });
await page.pdf({
  path: out + "/print.pdf",
  width: "1440px",
  height: "960px",
  printBackground: true,
});
const sidebarNavigation = await page
  .locator(".monitor-nav-items button, .nav-bottom button")
  .allTextContents();
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await page.locator('[data-task-id="demo-6"] .task-open').click();
await expect(page.locator(".monitor-nav")).toBeVisible();
expect(
  await page
    .locator(".monitor-nav-items button, .nav-bottom button")
    .allTextContents(),
).toEqual(sidebarNavigation);
await expect(page.locator(".monitor-nav svg.lucide")).toHaveCount(6);
await expect(page.locator(".task-navigation")).toHaveCount(0);
for (const height of await projects.evaluateAll((nodes) =>
  nodes.map((n) => n.getBoundingClientRect().height),
))
  expect(height).toBe(28);

const geometry = [];
for (const width of [1440, 768, 390, 320]) {
  await page.setViewportSize({ width, height: 960 });
  const box = await page.locator(".message.user").evaluate((n) => {
    const b = n.getBoundingClientRect(),
      p = document.querySelector(".task-composer").getBoundingClientRect(),
      s = getComputedStyle(n);
    return {
      right: b.right,
      composerRight: p.right,
      paddingTop: s.paddingTop,
      paddingBottom: s.paddingBottom,
    };
  });
  expect(Math.abs(box.right - box.composerRight)).toBeLessThanOrEqual(1);
  expect(box.paddingTop).toBe("10px");
  expect(box.paddingBottom).toBe("10px");
  geometry.push({ width, ...box });
  await page.screenshot({ path: `${out}/message-${width}.png` });
}
await page.setViewportSize({ width: 1440, height: 960 });
await page
  .locator(".monitor-nav-items")
  .getByRole("button", { name: "任务总览", exact: true })
  .click();
for (const width of [1024, 390, 320]) {
  await page.setViewportSize({ width, height: 960 });
  const toggle = page.getByRole("button", { name: "导航", exact: true });
  await toggle.click();
  const sidebar = page.getByRole("dialog", { name: "工作台侧栏", exact: true });
  await expect(sidebar).toBeVisible();
  expect(
    await sidebar
      .locator(".monitor-nav-items button, .nav-bottom button")
      .allTextContents(),
  ).toEqual(sidebarNavigation);
  await page.screenshot({ path: `${out}/shared-sidebar-${width}.png` });
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await sidebar
    .getByRole("button", { name: "搜索任务与项目", exact: true })
    .click();
  await expect(page.getByLabel("统一搜索", { exact: true })).toBeFocused();
  await expect(sidebar).toHaveCount(0);
  await page.keyboard.press("Escape");
}
expect(calls).toHaveLength(0);
expect(errors).toEqual([]);
writeFileSync(
  out + "/report.json",
  JSON.stringify({ geometry, errors, noMutations: true }, null, 2),
);
await browser.close();
console.log(
  "v7 scope, stable recent projects, global pending, icons, themes and right-aligned messages passed",
);
