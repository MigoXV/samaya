import { chromium, expect } from "@playwright/test";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const ctx = await browser.newContext();
  const state = fixture();
  state.pendingRequests = [];
  const { calls, broadcast } = await install(ctx, state);
  let fail = true;
  await ctx.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    if (op.action === "shell" && fail) {
      calls.push(op);
      return route.fulfill({
        json: { state: "failed", result: { message: "命令未接受（测试）" } },
      });
    }
    return route.fallback();
  });
  await ctx.route("**/api/threads/*/turns/*/items*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            item: {
              id: "user-shell",
              type: "commandExecution",
              source: "userShell",
              command: "printf test",
              status: "completed",
              aggregatedOutput: "shell-output",
              exitCode: 7,
            },
          },
        ],
        nextCursor: null,
      },
    }),
  );
  const page = await ctx.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await page.locator('[data-task-id="demo-6"].overview-task').click();
  await expect(page.getByLabel("命令输出")).toContainText("shell-output");
  const input = page.getByRole("textbox", {
    name: "补充当前任务",
    exact: true,
  });
  await input.fill("!");
  await page
    .getByRole("button", { name: "执行 Shell 命令", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "请在 ! 后输入命令" }),
  ).toBeVisible();
  const command = "printf '%s\\n' 'a b' | cat";
  await input.fill("!" + command);
  await page
    .getByRole("button", { name: "执行 Shell 命令", exact: true })
    .click();
  await expect
    .poll(() => calls.filter((x) => x.action === "shell").length)
    .toBe(1);
  await expect(input).toHaveValue("!" + command);
  fail = false;
  await page
    .getByRole("button", { name: "执行 Shell 命令", exact: true })
    .click();
  await expect(input).toHaveValue("");
  const shell = calls.filter((x) => x.action === "shell").at(-1);
  expect(shell.body.command).toBe(command);
  expect(shell.body.expectedCwd).toBe("/demo/Samaya");
  const r = state.records.find((r) => r.thread.id === "demo-6");
  r.turn.status = "inProgress";
  r.thread.status = { type: "active" };
  await broadcast();
  await input.fill("!pwd");
  await page
    .getByRole("button", { name: "执行 Shell 命令", exact: true })
    .click();
  await expect(input).toHaveValue("");
  expect(calls.at(-1).action).toBe("shell");
  expect(calls.some((x) => x.action === "steer")).toBe(false);
  await returnToOverview(page);
  await page
    .locator('.overview-workspace[data-workspace="/demo/Samaya"]')
    .getByRole("button", { name: "在 Samaya 工作区新建会话", exact: true })
    .click();
  const draft = page.locator(".workspace-draft textarea");
  await draft.fill("!pwd");
  await page
    .getByRole("button", { name: "执行 Shell 命令", exact: true })
    .click();
  await expect
    .poll(
      () =>
        calls.filter(
          (x) => x.action === "shell" && x.body.threadId === "demo-created",
        ).length,
    )
    .toBe(1);
  expect(
    calls.some(
      (x) => x.action === "send" && x.body.threadId === "demo-created",
    ),
  ).toBe(false);
  console.log(
    "Shell UI: empty rejection, native output, failed draft retained, idle/active and new conversation routing passed.",
  );
} finally {
  await browser.close();
}
