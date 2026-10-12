import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixture, install } from "./monitor-fixture.mjs";

const out = fileURLToPath(
  new URL("../../../.samaya/markdown-math/", import.meta.url),
);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  await install(context, state);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          window.__copiedMath = text;
        },
      },
    });
  });
  const equations = [
    String.raw`\mathcal F^{\mu\nu}=F^{\mu\nu}+i\widetilde F^{\mu\nu}.`,
    String.raw`\boxed{\partial_\mu\mathcal F^{\mu\nu}=J^\nu}.`,
    String.raw`\operatorname{Re}:\quad\partial_\mu F^{\mu\nu}=J^\nu,\qquad\operatorname{Im}:\quad\partial_\mu\widetilde F^{\mu\nu}=0.`,
  ];
  const text = [
    "行内 $x^2$ 与 \\(y_1\\)。",
    ...equations.map((eq) => `$$\n${eq}\n$$\n\n\\[${eq}\\]`),
    "```latex\n\\[x\\]\n$$y$$\n```",
    "`\\(z\\)`",
    "[ 普通方括号 ]",
    "| 名称 | 内容 |\n| --- | --- |\n| 能量 | $E=mc^2$ |",
    "[链接](https://example.com)",
    "- 列表条目",
  ].join("\n\n");
  const items = [
    { id: "math", type: "agentMessage", text },
    { id: "math-plan", type: "plan", text: String.raw`计划：\(x^2\)` },
    {
      id: "math-error",
      type: "agentMessage",
      text: "$$\\frac{1}$$\n\n后续正文。",
    },
  ];
  await context.route("**/api/threads/*/turns/*/items*", (route) =>
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
  const failedResources = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) failedResources.push(r.url());
  });
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
  await page.locator('.overview-task[data-task-id="demo-5"]').click();
  const reply = page.locator('[data-item-id="math"]');
  await expect(reply.locator(".katex-display")).toHaveCount(6);
  await expect(reply.locator(".katex")).toHaveCount(9);
  await expect(reply.locator(".katex-error")).toHaveCount(0);
  await expect(reply.locator("pre code")).toHaveText("\\[x\\]\n$$y$$\n");
  await expect(reply.locator("table")).toHaveCount(1);
  await expect(reply.locator("ul")).toHaveCount(1);
  await expect(reply.getByRole("link", { name: "链接" })).toHaveAttribute(
    "href",
    "https://example.com",
  );
  await reply.getByRole("button", { name: "复制这条回复" }).click();
  expect(await page.evaluate(() => window.__copiedMath)).toBe(text);
  const plan = page.locator('[data-item-id="math-plan"]');
  await plan.locator("summary").click();
  await expect(plan.locator(".katex")).toHaveCount(1);
  await expect(
    page.locator('[data-item-id="math-error"] .katex-error'),
  ).toHaveCount(1);
  await expect(page.locator('[data-item-id="math-error"]')).toContainText(
    "后续正文。",
  );

  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate(
      (value) => window.samayaTheme.setPreference(value),
      theme,
    );
    await page.setViewportSize({ width: 320, height: 960 });
    await page.evaluate(() => document.fonts.ready);
    const layout = await reply.evaluate((el) => {
      const formula = el.querySelector(".katex");
      const markdown = el.querySelector(".markdown");
      const box = el.querySelector(".fbox");
      const boxStyle = getComputedStyle(box);
      return {
        foreground: getComputedStyle(formula).color,
        bodyColor: getComputedStyle(markdown).color,
        fontReady: document.fonts.check('16px "KaTeX_Main"'),
        loadedFonts: Array.from(document.fonts).filter(
          (font) => font.family.startsWith("KaTeX") && font.status === "loaded",
        ).length,
        localScroll: Array.from(el.querySelectorAll(".katex-display")).some(
          (block) => block.scrollWidth > block.clientWidth,
        ),
        pageWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        boxWidth: box.getBoundingClientRect().width,
        boxHeight: box.getBoundingClientRect().height,
        boxBorders: ["Top", "Right", "Bottom", "Left"].map((side) =>
          Number.parseFloat(boxStyle[`border${side}Width`]),
        ),
      };
    });
    expect(layout.foreground).toBe(layout.bodyColor);
    expect(layout.fontReady).toBe(true);
    expect(layout.loadedFonts).toBeGreaterThan(0);
    expect(layout.localScroll).toBe(true);
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.boxWidth).toBeGreaterThan(100);
    expect(layout.boxHeight).toBeGreaterThan(15);
    expect(layout.boxBorders.every((width) => width > 0)).toBe(true);
    await reply.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${theme}-narrow.png` });
  }

  await page.setViewportSize({ width: 1440, height: 960 });
  async function emit(method, params, sequence) {
    await page.evaluate(
      ({ method, params, sequence }) =>
        window.__emit(
          "message",
          {
            method,
            params: { threadId: "demo-5", turnId: "turn-5", ...params },
          },
          sequence,
        ),
      { method, params, sequence },
    );
  }
  await emit(
    "item/started",
    { item: { id: "math-stream", type: "agentMessage", text: "" } },
    1,
  );
  await emit(
    "item/agentMessage/delta",
    { itemId: "math-stream", delta: "$$\\frac{1}{2}" },
    2,
  );
  const stream = page.locator('[data-item-id="math-stream"]');
  await expect(stream).toContainText("$$");
  await expect(stream.locator(".katex")).toHaveCount(0);
  await emit(
    "item/agentMessage/delta",
    { itemId: "math-stream", delta: "$$" },
    3,
  );
  await expect(stream.locator(".katex-display")).toHaveCount(1);
  await emit(
    "item/completed",
    {
      item: {
        id: "math-stream",
        type: "agentMessage",
        text: "$$\\frac{1}{2}$$",
      },
    },
    4,
  );
  await expect(stream.locator(".katex-display")).toHaveCount(1);
  expect(errors).toEqual([]);
  expect(failedResources).toEqual([]);
  console.log(
    "公式浏览器验证通过：回复、计划、复制、字体、双主题、窄屏和流式输出。",
  );
} finally {
  await browser.close();
}
