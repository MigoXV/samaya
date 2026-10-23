import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  const { calls, broadcast } = await install(context, state);
  const record = state.records.find((r) => r.thread.id === "demo-6");
  let fail = false;
  await context.route("**/api/input-catalog?*", (route) =>
    route.fulfill({
      json: {
        cwd: record.thread.cwd,
        references: [],
        prompts: [],
        errors: [],
        commands: [
          {
            name: "rename",
            description: "重命名会话",
            kind: "native",
            enabled: true,
          },
        ],
      },
    }),
  );
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    if (op.body.command !== "rename") return route.fallback();
    calls.push(op);
    if (fail)
      return route.fulfill({
        json: {
          operationId: op.operationId,
          state: "failed",
          result: { message: "重命名失败（测试）" },
        },
      });
    record.thread.name = op.body.args.value;
    await broadcast();
    await route.fulfill({
      json: { operationId: op.operationId, state: "succeeded", result: {} },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await page.locator('[data-task-id="demo-6"].overview-task').click();
  const input = page.getByRole("textbox", {
    name: "补充当前任务",
    exact: true,
  });
  const name = page.getByRole("textbox", { name: "会话新名称", exact: true });
  async function rename() {
    await input.fill("/ren");
    await page.getByRole("option", { name: /\/rename/ }).click();
    await expect(name).toHaveValue(record.thread.name);
    await expect(name).toBeFocused();
    expect(
      await name.evaluate((n) => [n.selectionStart, n.selectionEnd]),
    ).toEqual([0, record.thread.name.length]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await rename();
  await name.press("Escape");
  await expect(input).toHaveValue("");
  expect(calls).toHaveLength(0);
  await rename();
  await name.fill("新的会话名");
  await name.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "新的会话名",
  );
  expect(calls.at(-1).body.args.value).toBe("新的会话名");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("/rename 新的会话名");
  await input.fill("");
  await rename();
  fail = true;
  await name.fill("失败后仍保留的名称");
  await name.press("Enter");
  await expect(page.getByRole("alert")).toContainText("重命名失败（测试）");
  await expect(name).toHaveValue("失败后仍保留的名称");
  fail = false;
  await name.fill("/这是名称而不是命令");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(input).toHaveValue("");
  expect(calls.at(-1).body.args.value).toBe("/这是名称而不是命令");
  await rename();
  await name.fill("!这也只是名称");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "保存名称", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "../../.samaya/inline-rename-mobile.png" });
  await name.press("Enter");
  await expect(input).toHaveValue("");
  expect(
    calls.every((c) => c.action === "command" && c.body.command === "rename"),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "Inline rename: selected name, Enter save, Escape cancel, literal names, failed draft, history and narrow layout passed",
  );
} finally {
  await browser.close();
}
