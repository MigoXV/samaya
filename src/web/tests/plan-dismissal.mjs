import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext();
  const state = fixture();
  state.pendingRequests = [];
  state.records.find((r) => r.thread.id === "demo-6").thread.collaborationMode =
    { mode: "plan" };
  await install(context, state);
  let reject = true,
    release,
    waiting = false;
  const posts = [];
  await context.route("**/api/operations", (route) => {
    posts.push(route.request().postDataJSON());
    return route.fulfill(
      reject
        ? { status: 409, json: { detail: "发送被拒绝" } }
        : {
            status: 202,
            json: {
              operationId: posts.at(-1).operationId,
              state: "pending",
              result: null,
            },
          },
    );
  });
  await context.route("**/api/threads/*/turns/*/items*", async (route) => {
    if (route.request().url().includes("/late/items")) {
      waiting = true;
      await new Promise((resolve) => (release = resolve));
    }
    await route.fulfill({
      json: {
        data: [{ item: { id: "plan", type: "plan", text: "计划正文" } }],
        nextCursor: null,
      },
    });
  });
  const page = await context.newPage();
  await page.goto(
    (process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788") +
      "/?thread=demo-6",
  );
  const editor = page.getByRole("textbox", {
    name: "补充当前任务",
    exact: true,
  });
  await expect(editor).toBeEditable();
  let seq = 100;
  const emit = (method, id, threadId = "demo-6") =>
    page.evaluate(
      ({ method, id, threadId, seq }) =>
        window.__emit(
          "message",
          {
            method,
            params: {
              threadId,
              turn: {
                id,
                status:
                  method === "turn/completed" ? "completed" : "inProgress",
              },
            },
          },
          seq,
        ),
      { method, id, threadId, seq: seq++ },
    );
  const panel = page.getByRole("region", { name: "计划已完成" });
  await emit("turn/completed", "first");
  await expect(panel).toBeVisible();
  // Editing alone or another thread's activity must not dismiss the choices.
  await editor.fill("继续讨论计划");
  await emit("turn/started", "other", "demo-5");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "开始下一轮", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(panel).toBeVisible();
  reject = false;
  await page.getByRole("button", { name: "开始下一轮", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  await expect(panel).toHaveCount(0);
  // A delayed plan lookup must not resurrect a dismissed previous plan.
  await emit("turn/completed", "late");
  await expect.poll(() => waiting).toBe(true);
  await emit("turn/started", "next");
  const response = page.waitForResponse((r) => r.url().includes("/late/items"));
  release();
  await response;
  await page.waitForTimeout(100);
  await expect(panel).toHaveCount(0);
  // A later completed plan is still eligible. Starting it elsewhere clears it.
  await emit("turn/completed", "fresh");
  await expect(panel).toBeVisible();
  await emit("turn/started", "external");
  await expect(panel).toHaveCount(0);
  await emit("turn/completed", "stay");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "留在计划模式", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await context.close();
  console.log(
    "Plan choices dismiss on accepted input and native start, ignore failures/other threads, reject late results, and allow later plans",
  );
} finally {
  await browser.close();
}
