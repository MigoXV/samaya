import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  const { calls, broadcast } = await install(context, state);
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    if (op.action === "command" && op.body.command === "rename") {
      calls.push(op);
      if (op.body.args.value === "失败的名字")
        return route.fulfill({
          json: {
            operationId: op.operationId,
            state: "failed",
            result: { message: "重命名失败" },
          },
        });
      state.records.find((r) => r.thread.id === op.body.threadId).thread.name =
        op.body.args.value;
    } else if (["archive", "delete"].includes(op.action)) {
      calls.push(op);
      const record = state.records.find(
        (r) => r.thread.id === op.body.threadId,
      );
      if (record.turn?.status === "inProgress")
        return route.fulfill({
          json: {
            operationId: op.operationId,
            state: "failed",
            result: { message: "会话正在执行；请等待本轮结束" },
          },
        });
      expect(op.body.digest).toBe("fixture");
      if (op.action === "archive") record.thread.archived = true;
      else state.records = state.records.filter((r) => r !== record);
    } else return route.fallback();
    await broadcast();
    return route.fulfill({
      json: { operationId: op.operationId, state: "succeeded", result: {} },
    });
  });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await p.locator('[data-task-id="demo-6"].overview-task').click();
  const menu = p.getByRole("menu", { name: "对话操作" });
  const nav = p.locator(".nav-workspaces");
  const row = (id) => nav.locator(`[data-conversation-id="${id}"]`);
  await row("demo-6").click({ button: "right" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "重命名",
    "归档",
    "删除",
  ]);
  await expect(p).toHaveURL(/thread=demo-6/);
  expect(calls).toHaveLength(0);
  await p.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(row("demo-6")).toBeFocused();
  await row("demo-6")
    .locator("..")
    .getByRole("button", { name: /更多操作/ })
    .click();
  await p.getByRole("heading", { level: 1 }).click();
  await expect(menu).toHaveCount(0);
  await nav
    .locator(
      '[data-sidebar-workspace="/demo/Laya"] .nav-workspace-heading > button',
    )
    .first()
    .click();
  await row("demo-10").click({ button: "right" });
  await expect(p).toHaveURL(/thread=demo-6/);
  await menu.getByRole("menuitem", { name: "重命名", exact: true }).click();
  const name = p.getByRole("textbox", { name: "对话新名称", exact: true });
  await expect(name).toHaveValue(
    state.records.find((r) => r.thread.id === "demo-10").thread.name,
  );
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(p).toHaveURL(/thread=demo-6/);
  await name.fill("取消的名字");
  await name.press("Escape");
  expect(calls).toHaveLength(0);
  await row("demo-10").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await name.fill("失败的名字");
  await name.press("Enter");
  await expect(nav.getByRole("alert")).toContainText("重命名失败");
  await expect(name).toHaveValue("失败的名字");
  await name.fill("菜单重命名成功");
  await name.press("Enter");
  await expect(row("demo-10")).toContainText("菜单重命名成功");
  await row("demo-10").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await name.fill("失焦保存成功");
  await p.getByRole("heading", { level: 1 }).click();
  await expect(row("demo-10")).toContainText("失焦保存成功");
  await row("demo-6").click();
  await row("demo-10").click();
  await expect(
    p.getByRole("textbox", { name: "补充当前任务", exact: true }),
  ).toBeVisible();
  await row("demo-10").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "归档", exact: true }).click();
  await expect(p.getByRole("dialog")).toContainText("失焦保存成功");
  expect(calls.filter((c) => c.action === "archive")).toHaveLength(0);
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "关闭对话框", exact: true })
    .click();
  await expect(row("demo-10")).toBeVisible();
  await row("demo-10").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "归档", exact: true }).click();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "确认执行", exact: true })
    .click();
  await expect(row("demo-10")).toHaveCount(0);
  expect(calls.at(-1).body.threadId).toBe("demo-10");
  await nav
    .locator(
      '[data-sidebar-workspace="/demo/MeetNote"] .nav-workspace-heading > button',
    )
    .first()
    .click();
  await row("demo-14").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  expect(calls.filter((c) => c.action === "delete")).toHaveLength(0);
  await p.keyboard.press("Escape");
  await row("demo-14").click({ button: "right" });
  const deleteBox = await menu
    .getByRole("menuitem", { name: "删除", exact: true })
    .boundingBox();
  await menu.getByRole("menuitem", { name: "删除", exact: true }).click();
  const confirm = menu.getByRole("menuitem", { name: "确定删除", exact: true });
  await expect(confirm).toBeEnabled();
  expect(await confirm.boundingBox()).toEqual(deleteBox);
  await confirm.click();
  await expect(row("demo-14")).toHaveCount(0);
  expect(calls.at(-1).action).toBe("delete");
  await row("demo-0").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "归档", exact: true }).click();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "确认执行", exact: true })
    .click();
  await expect(p.getByRole("dialog")).toContainText("会话正在执行");
  await expect(row("demo-0")).toBeVisible();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "关闭对话框", exact: true })
    .click();
  await row("demo-0").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "删除", exact: true }).click();
  await menu.getByRole("menuitem", { name: "确定删除", exact: true }).click();
  await expect(menu.getByRole("alert")).toContainText("会话正在执行");
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await expect(row("demo-0")).toBeVisible();
  await p.keyboard.press("Escape");
  for (const theme of ["abyssus", "vallum"]) {
    await p.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    await row("demo-6")
      .locator("..")
      .getByRole("button", { name: /更多操作/ })
      .click();
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
    await p.screenshot({
      path: `../../.samaya/conversation-menu-${theme}.png`,
    });
    await p.keyboard.press("ArrowDown");
    await expect(
      menu.getByRole("menuitem", { name: "归档", exact: true }),
    ).toBeFocused();
    await p.keyboard.press("Escape");
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.getByRole("button", { name: "导航", exact: true }).click();
  await row("demo-6")
    .locator("..")
    .getByRole("button", { name: /更多操作/ })
    .click();
  const mobileBox = await menu.boundingBox();
  expect(mobileBox.x).toBeGreaterThanOrEqual(0);
  expect(mobileBox.x + mobileBox.width).toBeLessThanOrEqual(390);
  await p.screenshot({ path: "../../.samaya/conversation-menu-mobile.png" });
  const accessibility = await new AxeBuilder({ page: p })
    .include(".conversation-menu")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    accessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await menu.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await expect(name).toBeVisible();
  await expect(p).toHaveURL("http://127.0.0.1:8788/");
  await name.press("Escape");
  expect(errors).toEqual([]);
  console.log(
    "Conversation menus: ellipsis/right click, exact actions, focus, targeted rename, archive/delete confirmation, running rejection and themes passed",
  );
} finally {
  await browser.close();
}
