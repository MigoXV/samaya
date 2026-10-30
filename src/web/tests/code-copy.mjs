import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fixture, install } from "./monitor-fixture.mjs";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  await install(context, state);
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copied = text;
        },
      },
    }),
  );
  const code = '  const text = "<tag> & 中文";\n\n\treturn text;\n';
  const long = "long_value_".repeat(90) + "\n";
  let text = [
    "行内 `inline`",
    "```ts\n" + code + "```",
    "```\n" + long + "```",
    "    indented\n    second",
  ].join("\n\n");
  await context.route("**/api/threads/*/turns/*/items*", (route) =>
    route.fulfill({
      json: {
        data: [{ item: { id: "code-copy", type: "agentMessage", text } }],
        nextCursor: null,
        samayaCursor: 0,
      },
    }),
  );
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
  await page.locator('[data-task-id="demo-5"].overview-task').click();
  const reply = page.locator('[data-item-id="code-copy"]');
  const blocks = reply.locator(".markdown-code-block");
  await expect(blocks).toHaveCount(3);
  const copies = reply.getByRole("button", { name: "复制代码", exact: true });
  for (const [index, expected] of [
    code,
    long,
    "indented\nsecond\n",
  ].entries()) {
    await copies.nth(index).click();
    expect(await page.evaluate(() => window.__copied)).toBe(expected);
    await expect(copies.nth(index)).toHaveText("已复制");
  }
  await expect(blocks.nth(0).locator(".code-block-language")).toHaveText("ts");
  await expect(blocks.nth(1).locator(".code-block-language")).toBeEmpty();
  await expect(reply.locator(".markdown > p code")).toHaveText("inline");
  await expect(reply.getByRole("button", { name: "复制本轮回复" })).toHaveCount(
    1,
  );
  await copies.nth(0).click();
  await expect(copies.nth(0)).toHaveText("已复制");
  await page.waitForTimeout(1100);
  await copies.nth(0).click();
  await page.waitForTimeout(1100);
  await expect(copies.nth(0)).toHaveText("已复制");
  await expect(copies.nth(0)).toHaveText("复制代码", { timeout: 3000 });
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    }),
  );
  await copies.nth(0).click();
  await expect(blocks.nth(0).getByRole("status")).toHaveText(
    "复制失败，请选择正文复制",
  );
  await expect(blocks.nth(1).getByRole("status")).toBeEmpty();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copied = text;
        },
      },
    }),
  );
  await copies.nth(0).focus();
  await page.keyboard.press("Enter");
  await expect(copies.nth(0)).toHaveText("已复制");
  mkdirSync("../../.samaya/copy-verification", { recursive: true });
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate(
      (theme) => window.samayaTheme.setPreference(theme),
      theme,
    );
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(copies.nth(1)).toBeVisible();
      const geometry = await blocks.nth(1).evaluate((block) => {
        const pre = block.querySelector("pre");
        const button = block.querySelector("button");
        const before = button.getBoundingClientRect().x;
        pre.scrollLeft = 300;
        return {
          before,
          after: button.getBoundingClientRect().x,
          scroll: pre.scrollLeft,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry.before).toBe(geometry.after);
      expect(geometry.scroll).toBeGreaterThan(0);
      expect(geometry.overflow).toBe(false);
      const body = await reply.locator(".markdown").boundingBox();
      const actions = await reply.locator(".response-actions").boundingBox();
      expect(actions.y).toBeGreaterThanOrEqual(body.y + body.height + 7);
      expect(actions.x).toBe(body.x);
      if (width !== 390)
        await page.screenshot({
          path: `../../.samaya/copy-verification/${theme}-${width}.png`,
        });
    }
  }
  console.log(
    "code copy: exact text, independent state, retry, missing API, keyboard, timer reset, dual themes and responsive layout passed",
  );
} finally {
  await browser.close();
}
