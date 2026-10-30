import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext();
  const state = fixture();
  state.pendingRequests = [];
  const thread = state.records.find((r) => r.thread.id === "demo-6");
  thread.thread.collaborationMode = { mode: "plan" };
  await install(context, state);
  let hold = false,
    release,
    held = false,
    fail = false,
    uncertain = false;
  const calls = [];
  await context.route("**/api/threads/*/turns/*/items*", async (route) => {
    if (hold) {
      held = true;
      await new Promise((r) => (release = r));
      hold = false;
    }
    await route.fulfill({
      json: {
        data: [{ item: { id: "plan", type: "plan", text: "新的修复计划" } }],
        nextCursor: null,
      },
    });
  });
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    calls.push(op);
    if (fail) {
      fail = false;
      return route.fulfill({ status: 409, json: { detail: "模拟模式冲突" } });
    }
    thread.thread.collaborationMode = { mode: op.body.args.value };
    await route.fulfill({
      json: {
        operationId: op.operationId,
        state: "succeeded",
        result: uncertain
          ? { settingsPending: true }
          : { mode: op.body.args.value },
      },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    (process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788") +
      "/?thread=demo-6",
  );
  const button = page.getByRole("button", { name: /切换计划模式/ });
  const panel = page.getByRole("region", { name: "计划已完成" });
  await expect(button).toBeEnabled();
  let seq = 100;
  const complete = async (id) =>
    page.evaluate(
      ({ id, seq }) =>
        window.__emit(
          "message",
          {
            method: "turn/completed",
            params: { threadId: "demo-6", turn: { id, status: "completed" } },
          },
          seq,
        ),
      { id, seq: seq++ },
    );
  await complete("one");
  await expect(panel).toBeVisible();
  await button.click();
  await expect(panel).toHaveCount(0);
  await expect(button).toHaveText("默认");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveText("计划");
  await expect(button).toBeEnabled();
  await expect(panel).toHaveCount(0);
  await complete("two");
  await expect(panel).toBeVisible();
  // In-flight plan response cannot resurrect an old choice after leaving and returning.
  hold = true;
  await complete("late");
  await expect.poll(() => held).toBe(true);
  await button.click();
  await expect(button).toHaveText("默认");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveText("计划");
  await expect(button).toBeEnabled();
  release();
  await page.waitForTimeout(100);
  await expect(panel).toHaveCount(0);
  // Failed save and acknowledged-but-unconfirmed save both recover without another POST.
  fail = true;
  await button.click();
  await expect.poll(() => calls.length).toBe(5);
  await expect(button).toBeEnabled();
  await expect(button).toHaveText("计划");
  uncertain = true;
  await button.click();
  await expect(button).toHaveText("默认");
  await expect(button).toBeEnabled();
  expect(calls.length).toBe(6);
  uncertain = false;
  await button.click();
  await expect(button).toHaveText("计划");
  await expect(button).toBeEnabled();
  await complete("fresh");
  await expect(panel).toBeVisible();
  thread.thread.collaborationMode = { mode: "default" };
  await page.evaluate(
    (seq) =>
      window.__emit(
        "message",
        {
          method: "thread/settings/updated",
          params: { threadId: "demo-6", mode: "default" },
        },
        seq,
      ),
    seq++,
  );
  await expect(panel).toHaveCount(0);
  await expect(button).toHaveText("默认");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveText("计划");
  await expect(button).toBeEnabled();
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "mode lifecycle: toggle, dismissal, stale reads, save failures, pending confirmation and external updates passed",
  );
} finally {
  await browser.close();
}
