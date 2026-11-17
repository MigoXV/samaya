import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await install(context, fixture());
  const text =
    "https://github.com/openai/codex**型号Qwen3\n\nhttps://www.figma.com/design/abc画布\n\nhttps://example.com/page**型号Qwen3\n\nhttps://github.com.evil.example/repo\n\n[中文路径](https://example.com/报告?model=Qwen3#result)\n\n`https://github.com/inside-code`";
  const items = [
    {
      id: "input-links",
      type: "userMessage",
      content: [{ type: "text", text }],
    },
    { id: "output-links", type: "agentMessage", text },
  ];
  await context.route("**/api/threads/*/turns/*/items*", (r) =>
    r.fulfill({
      json: {
        data: items.toReversed().map((item) => ({ item })),
        nextCursor: null,
        samayaCursor: 0,
      },
    }),
  );
  const page = await context.newPage();
  await page.goto("https://127.0.0.1:8765");
  await page.locator('.overview-task[data-task-id="demo-5"]').click();
  for (const id of ["input-links", "output-links"]) {
    const root = page.locator(`[data-item-id="${id}"]`);
    await expect(root.locator("a.platform-link")).toHaveCount(2);
    await expect(
      root.locator('a[href="https://github.com/openai/codex"] svg'),
    ).toHaveCount(1);
    await expect(
      root.locator('a[href="https://www.figma.com/design/abc"] img'),
    ).toHaveCount(1);
    await expect(
      root.locator('a[href="https://example.com/page"]'),
    ).toHaveCount(1);
    await expect(
      root.locator('a[href="https://github.com.evil.example/repo"]'),
    ).not.toHaveClass(/platform-link/);
    await expect(
      root.locator('a[href="https://github.com/inside-code"]'),
    ).toHaveCount(0);
  }
  const url =
    "https://www.figma.com/design/ipSZImft4DhXLzvSNAB4Cg/mina---top-bar?node-id=2966-311&p=f&t=MzQ8uiH6H2nNbu9o-0";
  const input = page.getByRole("textbox", { name: "补充当前任务" });
  await input.fill(url);
  const editor = page.locator(".composer-editor");
  await expect(editor.locator(".composer-inline-link")).toHaveAttribute(
    "data-href",
    url,
  );
  await expect(editor.locator(".composer-link-leading")).toHaveCount(1);
  await expect(editor).toHaveText(url);
  expect(
    await editor
      .locator(".composer-link-leading")
      .evaluate((el) => getComputedStyle(el, "::before").content),
  ).toBe('""');
  await input.fill("没有链接");
  await expect(editor.locator(".composer-inline-link")).toHaveCount(0);
  await input.fill(url);
  await input.press("Control+End");
  await input.press("Shift+Enter");
  await page.keyboard.insertText("https://github.com/openai/codex");
  await expect(editor.locator(".composer-inline-link")).toHaveCount(2);
  await input.press("Control+z");
  await expect(editor.locator(".composer-inline-link")).toHaveCount(1);
  await input.press("Control+Shift+z");
  await expect(editor.locator(".composer-inline-link")).toHaveCount(2);
  expect(await editor.textContent()).toBe(
    url + "\nhttps://github.com/openai/codex",
  );
  const original = await editor.textContent();
  const copied = await editor.evaluate((el) => {
    el.setSelectionRange(0, el.value.length);
    const data = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
    el.setSelectionRange(el.value.length, el.value.length);
    return data.getData("text/plain");
  });
  expect(copied).toBe(original);
  await input.fill("中文输入");
  await input.press("Control+End");
  await editor.evaluate((el, url) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    document.execCommand("insertText", false, url);
  }, url);
  await expect(editor.locator(".composer-inline-link")).toHaveCount(0);
  await editor.dispatchEvent("compositionend", { data: url });
  await expect(editor.locator(".composer-inline-link")).toHaveCount(1);
  await expect(editor).toHaveText("中文输入" + url);
  await input.fill(original);
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: `../../.samaya/platform-links-${theme}-${width}.png`,
      });
    }
  }
  console.log(
    "Input/output platform icons, strict domains, URL boundaries, code literals and responsive checks passed",
  );
} finally {
  await browser.close();
}
