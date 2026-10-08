import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixture, install } from "./monitor-fixture.mjs";
const out = fileURLToPath(
  new URL("../../../.samaya/user-message/", import.meta.url),
);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const state = fixture();
state.pendingRequests = [];
await install(context, state);
const longText = Array.from(
  { length: 40 },
  (_, i) =>
    `第 ${i + 1} 条要求：保留真实配置和验证结果，并按任务分批完成检查。`,
).join("\n");
const items = [
  { id: "short-user", type: "userMessage", text: "简短的要求。" },
  { id: "six-user", type: "userMessage", text: "一\n二\n三\n四\n五\n六" },
  { id: "seven-user", type: "userMessage", text: "一\n二\n三\n四\n五\n六\n七" },
  {
    id: "wrapped-user",
    type: "userMessage",
    text: "需要核对配置与记录。".repeat(12),
  },
  {
    id: "long-user",
    type: "userMessage",
    content: [
      { type: "text", text: longText.slice(0, longText.indexOf("\n", 300)) },
      { type: "text", text: longText.slice(longText.indexOf("\n", 300) + 1) },
    ],
  },
  {
    id: "reply",
    type: "agentMessage",
    text: "收到，我会逐项核对并保留验证结果。",
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
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await page.locator('[data-task-id="demo-5"] .task-open').click();
const message = (id) => page.locator(`[data-item-id="${id}"] .message.user`);
const long = message("long-user");
const reader = page.locator(".detail-scroll");
await expect(long.locator(".user-message-toggle")).toHaveAttribute(
  "aria-expanded",
  "false",
);
await expect(message("short-user").locator(".user-message-toggle")).toHaveCount(
  0,
);
await expect(message("six-user").locator(".user-message-toggle")).toHaveCount(
  0,
);
await expect(message("seven-user").locator(".user-message-toggle")).toHaveCount(
  1,
);
expect(await long.locator(".user-message-text").textContent()).toBe(longText);
expect(
  await long.locator(".user-message-text").evaluate((el) => el.clientHeight),
).toBe(168);
const controls = await long.locator("button").getAttribute("aria-controls");
expect(await long.locator(".user-message-text").getAttribute("id")).toBe(
  controls,
);
// The same text becomes long solely because of narrower wrapping.
await expect(
  message("wrapped-user").locator(".user-message-toggle"),
).toHaveCount(0);
await page.setViewportSize({ width: 320, height: 960 });
await expect(
  message("wrapped-user").locator(".user-message-toggle"),
).toHaveCount(1);
await page.setViewportSize({ width: 1440, height: 960 });
await expect(
  message("wrapped-user").locator(".user-message-toggle"),
).toHaveCount(0);
for (const theme of ["vallum", "abyssus"]) {
  await page.evaluate(
    (value) => window.samayaTheme.setPreference(value),
    theme,
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await long.scrollIntoViewIfNeeded();
    await long.locator("button").focus();
    const before = await long.evaluate(
      (el) =>
        el.getBoundingClientRect().top -
        el.closest(".detail-scroll").getBoundingClientRect().top,
    );
    await page.keyboard.press("Enter");
    await expect(long.locator("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect
      .poll(async () =>
        Math.abs(
          (await long.evaluate(
            (el) =>
              el.getBoundingClientRect().top -
              el.closest(".detail-scroll").getBoundingClientRect().top,
          )) - Math.max(0, before),
        ),
      )
      .toBeLessThan(2);
    expect(
      await long
        .locator(".user-message-text")
        .evaluate((el) => el.clientHeight === el.scrollHeight),
    ).toBe(true);
    await long.locator("button").scrollIntoViewIfNeeded();
    await long.locator("button").focus();
    await page.keyboard.press("Space");
    await expect(long.locator("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(long.locator("button")).toBeInViewport();
    expect(await long.locator(".user-message-text").textContent()).toBe(
      longText,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `${out}/${theme}-${width}-collapsed.png` });
  }
  expect(
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
}
// Expansion remains while native state updates and live output arrive.
await long.locator("button").click();
await page.evaluate(() =>
  window.__emit(
    "message",
    {
      method: "item/completed",
      params: {
        threadId: "demo-5",
        turnId: "turn-5",
        item: {
          id: "next-reply",
          type: "agentMessage",
          text: "新增的真实进展。",
        },
      },
    },
    100,
  ),
);
await expect(page.locator('[data-item-id="next-reply"]')).toHaveCount(1);
await expect(long.locator("button")).toHaveAttribute("aria-expanded", "true");
await long.locator("button").click();
await expect(long.locator("button")).toBeInViewport();
await reader.evaluate((el) => (el.scrollTop = el.scrollHeight));
expect(errors).toEqual([]);
await browser.close();
console.log(
  "Long user input: measured six-line threshold, responsive wrapping, full text retention, keyboard disclosure, collapse focus, live-state retention, dual themes, overflow and accessibility passed.",
);
