import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { fixture, install } from "./monitor-fixture.mjs";
const out = "../../.samaya/question-reply";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const state = fixture();
state.pendingRequests = [];
const { calls } = await install(context, state);
const question =
  "Figma 连接返回“需要重新授权”。请在连接设置中重新连接 Figma，恢复后告诉我，我会继续补写双色设计稿。";
const envelope = (replies) =>
  `<send_user_message_question_reply>\n${JSON.stringify(replies)}\n</send_user_message_question_reply>`;
const items = [
  {
    id: "question-answer",
    type: "userMessage",
    content: [
      {
        type: "text",
        text:
          envelope([
            {
              question,
              answer: "go on",
              questionItemId: '["request_user_input_async","call_1",0]',
            },
          ]) + "\n\nfigma里面单独追加并同步代码",
      },
    ],
  },
  {
    id: "multiple-answers",
    type: "userMessage",
    text: envelope([
      { question: "要同步哪些页面？", answer: "对话与总览" },
      { question: "补充要求？", answer: "保留真实回答。\n".repeat(12) },
    ]),
  },
  {
    id: "invalid-envelope",
    type: "userMessage",
    text: "<send_user_message_question_reply>bad JSON</send_user_message_question_reply>",
  },
];
await context.route("**/api/threads/*/turns/*/items?*", (route) =>
  route.fulfill({
    json: {
      data: [...items].reverse().map((item) => ({ item })),
      nextCursor: null,
      samayaCursor: 0,
    },
  }),
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(
  (process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765") +
    "/?thread=demo-5",
);
const message = page.locator('[data-item-id="question-answer"]');
await expect(message.locator(".question-reply-question")).toHaveText(
  "Codex 提问" + question,
);
await expect(message.locator(".question-reply .message.user")).toHaveText(
  "你 · 已回答go on",
);
await expect(message.locator(":scope > .message.user")).toContainText(
  "figma里面单独追加并同步代码",
);
expect(await message.textContent()).not.toMatch(
  /send_user_message_question_reply|questionItemId|call_1/,
);
await expect(
  page.locator('[data-item-id="multiple-answers"] .question-reply-pair'),
).toHaveCount(2);
await expect(page.locator('[data-item-id="invalid-envelope"]')).toContainText(
  items[2].text,
);
for (const theme of ["vallum", "abyssus"]) {
  await page.evaluate(
    (value) => window.samayaTheme.setPreference(value),
    theme,
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await message.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `${out}/${theme}-${width}.png` });
  }
  expect(
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
}
await page
  .locator('[data-item-id="multiple-answers"] .user-message-toggle')
  .click();
await expect(
  page.locator('[data-item-id="multiple-answers"] .user-message-toggle'),
).toHaveAttribute("aria-expanded", "true");
expect(calls).toHaveLength(0);
expect(errors).toEqual([]);
await browser.close();
console.log(
  "Question replies: real payload, authorship, mixed text, multiple answers, invalid fallback, long answer, dual themes, mobile and axe passed.",
);
