import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const b = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const c = await b.newContext();
  const state = fixture();
  state.pendingRequests = [];
  const { calls } = await install(c, state);
  await c.route("**/api/threads/*/turns/*/items*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            item: {
              id: "prior-prompt",
              type: "userMessage",
              text: "原生历史中的提示词",
            },
          },
        ],
        nextCursor: null,
      },
    }),
  );
  const p = await c.newPage();
  await p.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await p.locator('[data-task-id="demo-6"].overview-task').click();
  await expect(p.locator(".turn-history")).toContainText("原生历史中的提示词");
  const input = p.getByRole("textbox", { name: "补充当前任务", exact: true });
  await input.focus();
  await p.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("原生历史中的提示词");
  await p.keyboard.press("ArrowDown");
  await expect(input).toHaveValue("");
  await input.fill("新的提示词");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  expect(calls.at(-1).body.text).toBe("新的提示词");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("新的提示词");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("原生历史中的提示词");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("新的提示词");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("");
  await input.fill("未发送的草稿");
  await input.evaluate((el) => el.setSelectionRange(0, 0));
  await input.press("ArrowUp");
  await expect(input).toHaveValue("新的提示词");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("未发送的草稿");
  await input.fill("第一行\n第二行");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("第一行\n第二行");
  await input.press("ArrowLeft");
  await expect(p).toHaveURL(/thread=demo-6/);
  await input.evaluate((el) => el.blur());
  await p.keyboard.press("ArrowLeft");
  await expect(p.locator(".task-overview")).toBeVisible();
  await p.keyboard.press("ArrowRight");
  await expect(p).toHaveURL(/thread=demo-6/);
  await expect(input).toHaveValue("第一行\n第二行");
  await input.fill("");
  await p.reload();
  await input.focus();
  await input.press("ArrowUp");
  await expect(input).toHaveValue("新的提示词");
  console.log(
    "Prompt recall: native history, successful sends, reload, older/newer, draft restoration, multiline caret and left/right navigation passed.",
  );
} finally {
  await b.close();
}
