import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  const record = state.records.find((r) => r.thread.id === "demo-5");
  record.thread.collaborationMode = { mode: "plan" };
  await install(context, state);
  const receipts = new Map(),
    posts = [];
  await context.route("**/api/threads/*/turns/*/items*", (route) =>
    route.fulfill({
      json: {
        data: [{ item: { id: "p1", type: "plan", text: "完整计划" } }],
        nextCursor: null,
      },
    }),
  );
  await context.route("**/api/operations/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    return route.fulfill({
      json: receipts.get(id) || { operationId: id, state: "pending" },
    });
  });
  await context.route("**/api/operations", (route) => {
    const body = route.request().postDataJSON();
    posts.push(body);
    const receipt = {
      operationId: body.operationId,
      state: body.action === "plan_execute" ? "succeeded" : "pending",
      result: body.action === "plan_execute" ? { threadId: "demo-5" } : null,
    };
    receipts.set(body.operationId, receipt);
    return route.fulfill({
      status: receipt.state === "pending" ? 202 : 200,
      json: receipt,
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await page.locator('.overview-task[data-task-id="demo-5"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__sources?.some((s) => s.ready)))
    .toBe(true);
  await page.evaluate(() =>
    window.__emit(
      "message",
      {
        method: "turn/completed",
        params: {
          threadId: "demo-5",
          turn: { id: "turn-5", status: "completed" },
        },
      },
      100,
    ),
  );
  await expect(
    page.getByRole("button", { name: "清空上下文执行" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "留在计划模式" }).click();
  await expect(
    page.getByRole("button", { name: "清空上下文执行" }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.__emit(
      "message",
      {
        method: "turn/completed",
        params: {
          threadId: "demo-5",
          turn: { id: "turn-6", status: "completed" },
        },
      },
      101,
    ),
  );
  await page.getByRole("button", { name: "执行", exact: true }).click();
  await expect
    .poll(() => posts.some((x) => x.action === "plan_execute"))
    .toBe(true);
  expect(posts.find((x) => x.action === "plan_execute").body).toMatchObject({
    threadId: "demo-5",
    turnId: "turn-6",
    planItemId: "p1",
    clearContext: false,
  });
  await expect(
    page.getByRole("button", { name: "执行", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.__emit(
      "message",
      {
        method: "turn/completed",
        params: {
          threadId: "demo-5",
          turn: { id: "turn-7", status: "completed" },
        },
      },
      102,
    ),
  );
  await expect(
    page.getByRole("button", { name: "清空上下文执行" }),
  ).toBeVisible();
  const base = process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788";
  await page.goto(base + "/?thread=demo-6");
  await page.goto(base + "/?thread=demo-5");
  await expect(
    page.getByRole("button", { name: "清空上下文执行" }),
  ).toHaveCount(0);
  await page.goto(base + "/?thread=demo-6");
  const editor = page.getByRole("textbox", {
    name: "补充当前任务",
    exact: true,
  });
  const send = page.getByRole("button", { name: "开始下一轮", exact: true });
  await editor.fill("第一条");
  await send.click();
  await expect
    .poll(() => posts.filter((p) => p.action === "send").length)
    .toBe(1);
  await expect(editor).toHaveValue("");
  await editor.fill("第二条");
  await expect(send).toBeEnabled();
  await send.click();
  await expect
    .poll(() => posts.filter((p) => p.action === "send").length)
    .toBe(2);
  await expect(page.getByRole("button", { name: /操作待核查/ })).toHaveCount(0);
  await editor.fill("新的草稿");
  const first = posts.find((p) => p.action === "send").operationId;
  await page.evaluate(
    (operationId) =>
      window.__emit("message", {
        method: "samaya/operation",
        params: {
          operationId,
          threadId: "demo-6",
          action: "send",
          state: "failed",
          result: { message: "发送失败" },
        },
      }),
    first,
  );
  await expect(editor).toHaveValue("新的草稿");
  await page.getByText("查看未发送的内容").click();
  await expect(page.locator(".failed-drafts pre")).toContainText("第一条");
  expect(errors).toEqual([]);
  await context.close();
  console.log("plan completion choices, execution and navigation passed");
} finally {
  await browser.close();
}
