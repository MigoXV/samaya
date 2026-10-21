import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { inputTrigger, slashInput } from "../src/composer-model.ts";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";

const ordinary = [
  " /fork",
  "\t/fork",
  "\n/fork",
  "\u00a0/fork",
  "\u3000/fork",
  "\ufeff/fork",
  "请执行 /fork",
  "普通文本\n/fork",
  " /unknown",
];
for (const text of ordinary) {
  assert.equal(slashInput(text), null);
  assert.equal(inputTrigger(text, text.length), null);
}
assert.deepEqual(slashInput("/fork"), { name: "fork", args: "" });
assert.equal(inputTrigger("/fork", 5)?.mode, "/");
assert.deepEqual(slashInput("/rename 新名称"), {
  name: "rename",
  args: "新名称",
});

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const state = fixture();
  state.pendingRequests = [];
  const { calls } = await install(context, state);
  let failure = false;
  let contextRequests = 0;
  await context.route("**/command-context?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("command") !== "fork")
      return route.fallback();
    contextRequests++;
    await route.fulfill({
      json: {
        fields: [],
        data: {},
        readOnly: false,
        active: false,
        expectedTurnId: "turn-10",
      },
    });
  });
  await context.route("**/api/input-catalog?*", (route) => {
    const u = new URL(route.request().url());
    const cwd =
      state.records.find((r) => r.thread.id === u.searchParams.get("threadId"))
        ?.thread.cwd || u.searchParams.get("cwd");
    return route.fulfill({
      json: {
        cwd,
        references: [],
        commands: [
          {
            name: "fork",
            description: "分支会话",
            kind: "native",
            enabled: true,
          },
        ],
        prompts: [],
        errors: [],
      },
    });
  });
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    if (op.body.command !== "fork" || op.action !== "command")
      return route.fallback();
    calls.push(op);
    if (failure)
      return route.fulfill({
        json: {
          state: "failed",
          result: { message: "请等待当前轮次结束；此命令未排队" },
        },
      });
    const copy = structuredClone(
      state.records.find((r) => r.thread.id === op.body.threadId),
    );
    copy.thread.id = "forked-" + calls.length;
    copy.thread.name = "分支回归 " + calls.length;
    state.records.unshift(copy);
    await route.fulfill({
      json: {
        operationId: op.operationId,
        state: "succeeded",
        result: { threadId: copy.thread.id },
      },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await page.locator('[data-task-id="demo-10"].overview-task').click();
  const input = page.getByRole("textbox", {
    name: "补充当前任务",
    exact: true,
  });
  for (const text of ordinary) {
    await input.fill(text);
    await expect(page.getByRole("listbox", { name: "命令与技能" })).toHaveCount(
      0,
    );
    const n = calls.length;
    await page.locator(".composer-send").click();
    await expect(input).toHaveValue("");
    expect(calls.length).toBe(n + 1);
    expect(["send", "steer"]).toContain(calls.at(-1).action);
    expect(calls.at(-1).body.text).toBe(text);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  failure = true;
  await input.fill("/fork");
  await input.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "请等待当前轮次结束" }),
  ).toBeVisible();
  await expect(input).toHaveValue("/fork");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  failure = false;
  for (const method of ["send", "enter", "option"]) {
    // Restore a settled source turn, as a native fork requires an idle thread.
    const source = state.records.find((r) => r.thread.id === "demo-10");
    source.turn.status = "completed";
    source.thread.status = { type: "idle" };
    if (method !== "send") {
      await returnToOverview(page);
      await page.locator('[data-task-id="demo-10"].overview-task').click();
      await expect(input).toHaveValue("");
    }
    await input.fill("/fork");
    const n = calls.length;
    if (method === "send") await page.locator(".composer-send").click();
    else if (method === "enter") await input.press("Enter");
    else await page.getByRole("option", { name: /\/fork/ }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("thread"))
      .toBe("forked-" + (n + 1));
    expect(calls.length).toBe(n + 1);
    expect(calls.at(-1).body).toMatchObject({
      threadId: "demo-10",
      command: "fork",
      args: {},
      expectedTurnId: source.turn.id,
    });
    await expect(input).toHaveValue("");
    expect(
      await page.evaluate(() => sessionStorage.getItem("samaya.draft.demo-10")),
    ).toBe("");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  expect(contextRequests).toBe(0);
  expect(errors).toEqual([]);
  console.log(
    "slash commands: strict prefix, literal submissions, direct fork, failure draft, navigation passed",
  );
} finally {
  await browser.close();
}
