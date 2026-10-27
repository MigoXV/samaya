import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync } from "node:fs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.records.forEach((r) => {
    r.thread.recencyAt = r.thread.updatedAt;
    r.lastActivityId = 1;
  });
  const { broadcast } = await install(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788";
  await page.goto(url);
  const nav = page.locator(".nav-workspaces");
  const order = () =>
    nav
      .locator("[data-sidebar-workspace]")
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.sidebarWorkspace));
  await expect(nav.locator("[data-sidebar-workspace]")).toHaveCount(3);
  const before = await order();
  const old = "/demo/MeetNote";
  const group = nav.locator(`[data-sidebar-workspace="${old}"]`);
  await group.locator(".nav-workspace-heading > button").first().click();
  await group.locator('[data-conversation-id="demo-8"]').click();
  const draft = page.locator("textarea").first();
  await draft.fill("保留这条未发送的草稿");
  expect(await order()).toEqual(before);
  const route = page.url();
  await group.getByRole("button", { name: "MeetNote 工作区菜单" }).click();
  await page.getByRole("menuitem", { name: "暂时隐藏" }).click();
  await expect(group).toHaveCount(0);
  expect(page.url()).toBe(route);
  await expect(draft).toHaveValue("保留这条未发送的草稿");
  await page.reload();
  await expect(group).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "已隐藏 1" })).toBeVisible();
  state.records.forEach((r) => {
    r.confirmedAt = Date.now() / 1000;
    r.eventAt = Date.now() / 1000;
    r.thread.updatedAt = Date.now() / 1000;
  });
  await broadcast();
  await expect(group).toHaveCount(0);
  const second = await context.newPage();
  await second.goto(url);
  await expect(second.locator(`[data-sidebar-workspace="${old}"]`)).toHaveCount(
    0,
  );
  const active = state.records.find((r) => r.thread.cwd === old);
  active.lastActivityId = 2;
  active.lastActivityAt = Date.now() / 1000 + 1;
  state.cursor = 2;
  await broadcast();
  await expect(group).toHaveCount(1);
  await expect(second.locator(`[data-sidebar-workspace="${old}"]`)).toHaveCount(
    1,
  );
  expect((await order())[0]).toBe(old);
  await page.getByRole("button", { name: "任务总览", exact: true }).click();
  const overview = page.locator(
    '.overview-workspace[data-workspace="/demo/Laya"]',
  );
  await overview.locator("header").click({ button: "right" });
  await page.getByRole("menuitem", { name: "暂时隐藏" }).click();
  await expect(overview).toHaveCount(0);
  await expect(
    nav.locator('[data-sidebar-workspace="/demo/Laya"]'),
  ).toHaveCount(0);
  await nav.getByRole("button", { name: "已隐藏 1" }).click();
  await nav.getByRole("button", { name: "恢复 Laya", exact: true }).click();
  await expect(overview).toHaveCount(1);
  expect((await order())[0]).toBe(old);
  // Hidden workspaces remain searchable; viewing a result restores without reordering.
  await nav.getByRole("button", { name: "Laya 工作区菜单" }).click();
  await page.getByRole("menuitem", { name: "暂时隐藏" }).click();
  await page
    .getByRole("searchbox", { name: "搜索工作区", exact: true })
    .fill("Laya");
  await expect(overview).toHaveCount(1);
  await expect(
    nav.locator('[data-sidebar-workspace="/demo/Laya"]'),
  ).toHaveCount(0);
  await overview.locator(".overview-task").first().click();
  await expect(
    nav.locator('[data-sidebar-workspace="/demo/Laya"]'),
  ).toHaveCount(1);
  expect((await order())[0]).toBe(old);
  await page.getByRole("button", { name: "任务总览", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "搜索工作区", exact: true })
    .fill("");
  await nav.getByRole("button", { name: "Samaya 工作区菜单" }).click();
  await page.getByRole("menuitem", { name: "暂时隐藏" }).click();
  const child = state.records.find((r) => r.thread.id === "child-0");
  child.thread.cwd = "/other/child";
  child.lastActivityId = 3;
  child.lastActivityAt = Date.now() / 1000 + 2;
  state.cursor = 3;
  await broadcast();
  await expect(
    nav.locator('[data-sidebar-workspace="/demo/Samaya"]'),
  ).toHaveCount(1);
  await nav.getByRole("button", { name: "Samaya 工作区菜单" }).click();
  mkdirSync("../../.samaya/workspace-hide", { recursive: true });
  await page.screenshot({ path: "../../.samaya/workspace-hide/menu.png" });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "abyssus"),
  );
  await page.screenshot({ path: "../../.samaya/workspace-hide/menu-dark.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "workspace hide: browsing order, persistence, tabs, activity, child mapping, restore and menus passed",
  );
} finally {
  await browser.close();
}
