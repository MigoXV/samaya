import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1550, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  const record = state.records.find((r) => r.thread.id === "demo-5");
  record.turn.status = "completed";
  record.thread.status = { type: "idle" };
  const { calls, broadcast } = await install(context, state);
  const items = [
    { id: "u1", type: "userMessage", text: "检查布局" },
    { id: "a1", type: "agentMessage", text: "第一段。\n\n第二段。" },
    {
      id: "c1",
      type: "commandExecution",
      command: "pwd",
      status: "completed",
      exitCode: 0,
      aggregatedOutput: "/demo",
    },
    {
      id: "a2",
      type: "agentMessage",
      text: "```ts\nconst value = 42;\n```\n\n| 项目 | 状态 |\n| --- | --- |\n| 验证 | 完成 |",
    },
    { id: "a3", type: "agentMessage", text: "继续回复。" },
    { id: "u2", type: "userMessage", text: "再检查" },
    { id: "a4", type: "agentMessage", text: "新的回复组。" },
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
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          if (window.__copyFails) throw new Error("copy failed");
          window.__copied = text;
        },
      },
    }),
  );
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
  await page
    .getByRole("button", { name: "查看全部任务 →", exact: true })
    .click();
  await page.locator('[data-task-id="demo-5"] .task-open').click();
  const replies = page.locator(".agent-reply");
  await expect(replies).toHaveCount(4);
  await expect(page.locator(".agent-reply-author")).toHaveCount(2);
  await expect(replies.nth(1).locator("pre")).toContainText(
    "const value = 42;",
  );
  await expect(replies.nth(1).locator("table")).toHaveCount(1);
  await page.mouse.move(0, 0);
  await expect(replies.first().locator(".response-actions")).toHaveCSS(
    "opacity",
    "0",
  );
  await replies.first().hover();
  const copy = replies.first().getByRole("button", { name: "复制这条回复" });
  await expect(replies.first().locator(".response-actions")).toHaveCSS(
    "opacity",
    "1",
  );
  const height = (await replies.first().boundingBox()).height;
  await copy.click();
  expect(await page.evaluate(() => window.__copied)).toBe(items[1].text);
  await expect(copy).toHaveText("✓");
  expect((await replies.first().boundingBox()).height).toBe(height);
  const secondCopy = replies
    .nth(1)
    .getByRole("button", { name: "复制这条回复" });
  await secondCopy.focus();
  await expect(replies.nth(1).locator(".response-actions")).toHaveCSS(
    "opacity",
    "1",
  );
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__copied)).toBe(items[3].text);
  await page.evaluate(() => {
    window.__copyFails = true;
  });
  await copy.click();
  await expect(replies.first().getByRole("status")).toHaveText(
    "复制失败，请选择正文复制",
  );
  expect((await replies.first().boundingBox()).height).toBe(height);
  const input = page.locator(".task-composer textarea");
  const composer = page.locator(".task-composer .composer-input");
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    for (const width of [1550, 1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await input.fill("");
      await expect(composer).toHaveCSS("height", "58px");
      await expect(composer).toHaveCSS("border-radius", "24px");
      await expect(input).toHaveCSS("height", "24px");
      const geometry = await page.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        const c = box(".composer-input"),
          main = box(".task-detail");
        return {
          width: c.width,
          center: (c.left + c.right) / 2,
          mainCenter: (main.left + main.right) / 2,
          heading: box(".task-reading-heading").height,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry.width).toBeLessThanOrEqual(860);
      expect(
        Math.abs(geometry.center - geometry.mainCenter),
      ).toBeLessThanOrEqual(1);
      expect(geometry.heading).toBe(width < 800 ? 64 : 40);
      expect(geometry.overflow).toBe(false);
      if (width === 1550) expect(geometry.width).toBe(860);
      if (width === 320)
        await expect(replies.first().locator(".response-actions")).toHaveCSS(
          "opacity",
          "1",
        );
    }
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    expect(violations).toEqual([]);
  }
  await page.setViewportSize({ width: 1550, height: 960 });
  const idle = await composer.boundingBox();
  await input.fill("第一行\n第二行\n第三行\n第四行");
  await expect(input).toHaveCSS("height", "96px");
  await expect(composer).toHaveCSS("height", "118px");
  const expanded = await composer.boundingBox();
  expect(expanded.y + expanded.height).toBe(idle.y + idle.height);
  await input.fill("很多输入\n".repeat(30));
  await expect(input).toHaveCSS("height", "168px");
  await expect(input).toHaveCSS("overflow-y", "auto");
  await page.setViewportSize({ width: 1550, height: 480 });
  await expect
    .poll(async () =>
      parseFloat(await input.evaluate((el) => getComputedStyle(el).height)),
    )
    .toBeLessThanOrEqual(158.4);
  record.turn.status = "inProgress";
  record.thread.status = { type: "active" };
  await broadcast();
  await page.setViewportSize({ width: 320, height: 844 });
  await input.fill("");
  await expect(
    page.getByRole("button", { name: "停止当前轮次", exact: true }),
  ).toBeVisible();
  const controls = await composer.evaluate((el) => {
    const outer = el.getBoundingClientRect();
    return [
      ...el.querySelectorAll(
        ".composer-add, .model-trigger, .stop-button, .composer-send",
      ),
    ].map((control) => {
      const b = control.getBoundingClientRect();
      return {
        left: b.left,
        right: b.right,
        width: b.width,
        inside: b.left >= outer.left && b.right <= outer.right,
      };
    });
  });
  expect(controls.every((b) => b.inside && b.width > 0)).toBe(true);
  for (let i = 1; i < controls.length; i++)
    expect(controls[i].left).toBeGreaterThanOrEqual(controls[i - 1].right);
  expect(calls).toHaveLength(0);
  console.log(
    "compact chat: author grouping, independent Markdown/copy, keyboard/failure feedback, dual themes, 320–1550 layouts and upwards growth passed",
  );
} finally {
  await browser.close();
}
