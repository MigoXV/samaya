import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  await install(context, state);
  const receipts = new Map(),
    posts = [];
  let reads = 0,
    holdPost = false,
    releasePost;
  await context.route("**/api/operations/*", (route) => {
    reads++;
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    return receipts.has(id)
      ? route.fulfill({ json: receipts.get(id) })
      : route.fulfill({ status: 404, json: { detail: "尚未找到此请求" } });
  });
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    posts.push(op);
    receipts.set(op.operationId, {
      operationId: op.operationId,
      state: "pending",
      result: {},
    });
    if (holdPost) {
      await new Promise((resolve) => {
        releasePost = resolve;
      });
      return route.fulfill({
        status: 503,
        json: { detail: "确认后的 HTTP 响应丢失" },
      });
    }
    await route.fulfill({ status: 503, json: { detail: "模拟响应丢失" } });
  });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await p.locator('.overview-task[data-task-id="demo-6"]').click();
  const editor = p.getByRole("textbox", { name: "补充当前任务", exact: true });
  const send = p.getByRole("button", { name: "开始下一轮", exact: true });
  await editor.fill("第一条发送内容");
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(p.getByRole("button", { name: /操作待核查/ })).toHaveCount(0);
  await expect(editor).toBeEnabled();
  await editor.fill("用户继续编辑的新草稿");
  await expect(send).toBeEnabled();
  expect(posts).toHaveLength(1);
  const id = posts[0].operationId;
  await p.evaluate(
    ({ id }) =>
      window.__emit("message", {
        method: "samaya/operation",
        params: {
          operationId: id,
          threadId: "demo-6",
          state: "uncertain",
          action: "send",
          result: {},
        },
      }),
    { id },
  );
  await expect(send).toBeEnabled();
  expect(
    await p.evaluate(
      (id) => !!localStorage.getItem("samaya.operation." + id),
      id,
    ),
  ).toBe(true);
  // A terminal SSE receipt recovers the lost HTTP response without resending or discarding the draft.
  receipts.set(id, { operationId: id, state: "succeeded", result: {} });
  await p.evaluate(
    ({ id }) =>
      window.__emit("message", {
        method: "samaya/operation",
        params: {
          operationId: id,
          threadId: "demo-6",
          state: "succeeded",
          action: "send",
          result: {},
        },
      }),
    { id },
  );
  await expect(send).toBeEnabled();
  await expect(editor).toHaveValue("用户继续编辑的新草稿");
  expect(posts).toHaveLength(1);
  await expect(p.locator('.operation-feedback[role="alert"]')).toHaveCount(0);
  // No event replay is needed after reload: fetch and reconcile the persisted operation ID.
  receipts.set("missed-event", {
    operationId: "missed-event",
    state: "succeeded",
    result: {},
  });
  await p.evaluate(() => {
    for (const [id, thread] of [
      ["missed-event", "demo-6"],
      ["unrelated", "demo-0"],
    ])
      localStorage.setItem(
        "samaya.operation." + id,
        JSON.stringify({
          operationId: id,
          action: "send",
          threadId: thread,
          scope: thread,
        }),
      );
  });
  const before = reads;
  await p.reload();
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(editor).toBeEnabled();
  await expect(editor).toHaveValue("用户继续编辑的新草稿");
  await expect(send).toBeEnabled();
  expect(
    await p.evaluate(() =>
      localStorage.getItem("samaya.operation.missed-event"),
    ),
  ).toBe(null);
  expect(
    await p.evaluate(
      () => !!localStorage.getItem("samaya.operation.unrelated"),
    ),
  ).toBe(true);
  expect(posts).toHaveLength(1);
  // Unknown receipts remain protected, but do not freeze editing. Definite failure unlocks and reports the cause.
  await p.evaluate(() => {
    localStorage.setItem(
      "samaya.operation.failure",
      JSON.stringify({
        operationId: "failure",
        action: "send",
        threadId: "demo-6",
        scope: "demo-6",
      }),
    );
    window.dispatchEvent(new Event("samaya:receipts"));
  });
  await expect(send).toBeEnabled();
  await expect(editor).toBeEnabled();
  await editor.fill("失败后保留的草稿");
  await p.evaluate(() =>
    window.__emit("message", {
      method: "samaya/operation",
      params: {
        operationId: "failure",
        threadId: "demo-6",
        state: "failed",
        action: "send",
        result: { message: "模型请求被拒绝" },
      },
    }),
  );
  await expect(send).toBeEnabled();
  await expect(p.locator('.operation-feedback[role="alert"]')).toContainText(
    "模型请求被拒绝",
  );
  await expect(editor).toHaveValue("失败后保留的草稿");
  // Even a genuinely in-flight request allows writing the next draft; completion cannot erase newer text.
  holdPost = true;
  await send.click();
  await expect.poll(() => typeof releasePost).toBe("function");
  await expect(send).toBeDisabled();
  await expect(editor).toBeEnabled();
  await editor.fill("发送过程中编辑的下一条");
  const heldId = posts.at(-1).operationId;
  await p.evaluate(
    (id) =>
      window.__emit("message", {
        method: "samaya/operation",
        params: {
          operationId: id,
          threadId: "demo-6",
          state: "succeeded",
          action: "send",
          result: {},
        },
      }),
    heldId,
  );
  await expect(send).toBeEnabled();
  releasePost();
  await expect(editor).toHaveValue("发送过程中编辑的下一条");
  expect(posts).toHaveLength(2);
  await p.evaluate(() => {
    void navigator.locks.request(
      "samaya:demo-6",
      () =>
        new Promise((resolve) => {
          window.__releaseLock = resolve;
        }),
    );
  });
  await p.waitForFunction(() => typeof window.__releaseLock === "function");
  await send.click();
  await expect(p.locator('.operation-feedback[role="alert"]')).toContainText(
    "其它页面正在提交",
  );
  await expect(editor).toBeEnabled();
  await expect(send).toBeEnabled();
  expect(posts).toHaveLength(2);
  await p.evaluate(() => window.__releaseLock());
  expect(errors).toEqual([]);
  console.log(
    "Receipt recovery: editable drafts, no duplicate writes, terminal SSE, reload reconciliation, unknown protection, failure feedback and in-flight edits passed",
  );
} finally {
  await browser.close();
}
