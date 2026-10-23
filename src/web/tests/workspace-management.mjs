import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture(25);
  state.pendingRequests = [];
  state.records.find((r) => r.thread.id === "demo-22").thread.name =
    "我怀疑现在这份代码存在问题，前端与后端托管的构建可能不一致，需要重新核对。这是一条很长的对话标题。";
  const { calls, broadcast } = await install(context, state);
  const count = state.records.filter(
    (r) => r.thread.cwd === "/demo/Laya" && !r.thread.parentThreadId,
  ).length;
  const queries = [];
  let failNextList = false;
  await context.route("**/api/threads?**", (route) => {
    const u = new URL(route.request().url());
    queries.push(u.searchParams.get("cwd"));
    if (failNextList) {
      failNextList = false;
      return route.fulfill({
        status: 503,
        json: { detail: "列表同步暂时失败" },
      });
    }
    return route.fulfill({
      json: {
        data: state.records
          .filter(
            (r) =>
              r.thread.cwd === u.searchParams.get("cwd") &&
              !!r.thread.archived ===
                (u.searchParams.get("archived") === "true"),
          )
          .map((r) => r.thread),
        nextCursor: null,
      },
    });
  });
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    calls.push(op);
    const r = state.records.find((r) => r.thread.id === op.body.threadId);
    expect(r.thread.cwd).toBe("/demo/Laya");
    expect(op.body.digest).toBe("fixture");
    if (op.action === "delete" && op.body.threadId === "demo-7")
      return route.fulfill({
        json: {
          operationId: op.operationId,
          state: "failed",
          result: { message: "会话正在执行；请等待本轮结束" },
        },
      });
    if (op.action === "archive") r.thread.archived = true;
    else if (op.action === "unarchive") r.thread.archived = false;
    else if (op.action === "delete")
      state.records = state.records.filter((x) => x !== r);
    await broadcast();
    await route.fulfill({
      json: { operationId: op.operationId, state: "succeeded", result: {} },
    });
  });
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await p
    .getByRole("button", { name: "管理 Laya 工作区", exact: true })
    .click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("工作区管理");
  await expect(p.locator(".workspace-management-path")).toHaveText(
    "/demo/Laya",
  );
  await p.reload();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("工作区管理");
  const rows = p.locator(".wm-conversation");
  await expect(rows).toHaveCount(count);
  const headingBox = await p.locator(".wm-heading").boundingBox();
  expect(headingBox.x).toBe(400);
  expect(headingBox.width).toBe(912);
  const searchBox = await p.locator(".wm-search").boundingBox();
  const inputBox = await p
    .getByRole("textbox", { name: "搜索对话" })
    .boundingBox();
  expect(searchBox.height).toBe(40);
  expect(searchBox.width).toBe(320);
  expect(
    Math.abs(
      searchBox.y + searchBox.height / 2 - (inputBox.y + inputBox.height / 2),
    ),
  ).toBeLessThan(2);
  for (const name of [
    "left",
    "search",
    "down",
    "plus",
    "check",
    "trash",
    "archive",
  ]) {
    const r = await p.request.get(
      new URL(`/figma/workspace-management/${name}.svg`, p.url()).href,
    );
    expect(r.status()).toBe(200);
    expect((await r.body()).length).toBeGreaterThan(100);
  }
  const desktopLong = p.locator(
    '[data-workspace-thread="demo-22"] .wm-conversation-title',
  );
  expect((await desktopLong.boundingBox()).width).toBeLessThanOrEqual(620);
  expect(await desktopLong.evaluate((n) => n.scrollWidth > n.clientWidth)).toBe(
    true,
  );
  const title = state.records.find((r) => r.thread.id === "demo-10").thread
    .name;
  await p.getByRole("textbox", { name: "搜索对话" }).fill(title);
  await expect(rows).toHaveCount(1);
  await p.getByRole("checkbox", { name: "全选当前列表" }).check();
  const before = await p.locator(".wm-list").boundingBox();
  await p.getByRole("button", { name: "删除", exact: true }).click();
  const confirm = p.getByRole("button", { name: /^确定删除/ });
  await expect(confirm).toBeEnabled();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  expect(calls).toHaveLength(0);
  expect(await p.locator(".wm-list").boundingBox()).toEqual(before);
  await p.getByRole("button", { name: "取消", exact: true }).click();
  await p.getByRole("button", { name: "归档", exact: true }).click();
  await expect(rows).toHaveCount(0);
  expect(calls).toHaveLength(1);
  await p.getByRole("textbox", { name: "搜索对话" }).fill("");
  await p.getByRole("combobox", { name: "对话范围" }).selectOption("archived");
  await expect(rows).toHaveCount(1);
  await p.getByRole("checkbox", { name: "全选当前列表" }).check();
  await p.getByRole("button", { name: "恢复归档", exact: true }).click();
  await expect(rows).toHaveCount(0);
  await p.getByRole("combobox", { name: "对话范围" }).selectOption("current");
  await expect(rows).toHaveCount(count);
  await p.getByRole("combobox", { name: "对话状态" }).selectOption("running");
  expect(await rows.count()).toBeGreaterThan(0);
  expect(await rows.count()).toBeLessThan(count);
  await p.getByRole("combobox", { name: "对话状态" }).selectOption("all");
  for (const theme of ["abyssus", "vallum"]) {
    await p.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    await p.waitForTimeout(350);
    await p.screenshot({
      path: `../../.samaya/workspace-management-${theme}.png`,
    });
  }
  const a11y = await new AxeBuilder({ page: p })
    .include(".workspace-manager")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    a11y.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await p.getByRole("checkbox", { name: "全选当前列表" }).check();
  await p.getByRole("button", { name: "删除", exact: true }).click();
  await expect(confirm).toBeEnabled();
  await p.screenshot({
    path: "../../.samaya/workspace-management-confirm.png",
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ path: "../../.samaya/workspace-management-mobile.png" });
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  const long = rows
    .filter({ hasText: "我怀疑现在这份代码" })
    .locator(".wm-conversation-title");
  await long.scrollIntoViewIfNeeded();
  expect((await long.boundingBox()).height).toBeLessThanOrEqual(40);
  failNextList = true;
  await confirm.click();
  await expect(rows).toHaveCount(1);
  await expect(p.locator(".wm-feedback")).toContainText("1 个未处理");
  await expect(p.locator(".wm-feedback")).toContainText("列表同步失败");
  await p.getByRole("button", { name: "重新读取" }).click();
  await expect(p.locator(".wm-feedback")).not.toContainText("列表同步失败");
  await p.getByRole("button", { name: "查看原因" }).click();
  await expect(p.locator(".wm-details")).toContainText("会话正在执行");
  expect(calls.filter((c) => c.action === "delete")).toHaveLength(count);
  expect(queries.every((cwd) => cwd === "/demo/Laya")).toBe(true);
  await p.getByRole("button", { name: "返回", exact: true }).click();
  await expect(p.locator(".workspace-manager")).toHaveCount(0);
  await p.setViewportSize({ width: 1440, height: 960 });
  await p
    .getByRole("button", { name: "管理 Laya 工作区", exact: true })
    .click();
  await p.getByRole("button", { name: "新建对话", exact: true }).click();
  expect(new URL(p.url()).pathname).toBe("/");
  expect(new URL(p.url()).searchParams.get("workspace")).toBe("/demo/Laya");
  await expect(p.locator(".workspace-manager")).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "Workspace management: Figma layout, scope, search/filter, archive/restore, fixed confirmation, failure summary, mobile and accessibility passed",
  );
} finally {
  await browser.close();
}
