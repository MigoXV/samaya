import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync } from "node:fs";
const out = "../../.samaya/compact-workspace";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ignoreDefaultArgs: ["--hide-scrollbars"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const { calls } = await install(context, fixture());
const items = [
  { id: "u", type: "userMessage", text: "验证紧凑工具调用与阅读布局。" },
  ...[
    { status: "completed", exitCode: 0 },
    { status: "inProgress" },
    { status: "completed", exitCode: 1 },
    { status: "interrupted" },
    {},
  ].map((state, index) => ({
    id: `cmd-${index}`,
    type: "commandExecution",
    command: index ? "poetry run pytest -q" : "git diff --stat",
    aggregatedOutput: "可核对的原生输出\n".repeat(50),
    ...state,
  })),
  {
    id: "mcp",
    type: "mcpToolCall",
    server: "figma",
    tool: "get_design_context",
    status: "completed",
    result: { content: [{ type: "text", text: "工具结果" }] },
  },
  { id: "a", type: "agentMessage", text: "输出仍需核对。\n\n".repeat(80) },
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
page.setDefaultTimeout(10000);
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await page.locator('[data-task-id="demo-0"] .task-open').click();
await expect(page.locator(".command-record")).toHaveCount(5);
const sequence = page.locator(".tool-sequence");
await expect(sequence).toHaveCount(1);
await expect(sequence).not.toHaveAttribute("open");
await expect(sequence.locator(":scope > summary")).toHaveText(
  "已进行一系列工具调用查看详情",
);
expect(
  await sequence
    .locator(":scope > summary")
    .evaluate((el) => el.getBoundingClientRect().height),
).toBe(32);
await sequence.locator(":scope > summary").click();
await expect(sequence).toHaveAttribute("open");
for (const theme of ["vallum", "abyssus"]) {
  await page.evaluate(
    (value) => window.samayaTheme.setPreference(value),
    theme,
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.locator(".detail-scroll").evaluate((el) => (el.scrollTop = 0));
    const boxes = await page
      .locator(".command-record > summary")
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const b = n.getBoundingClientRect();
          return { y: b.y, h: b.height };
        }),
      );
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].h).toBe(32);
      if (i) expect(boxes[i].y - boxes[i - 1].y).toBe(32);
    }
    await expect(page.locator(".tool-state").nth(1)).toHaveText("运行中");
    await expect(page.locator(".tool-state").nth(2)).toContainText("失败");
    await expect(page.locator(".tool-state").nth(3)).toHaveText("已中断");
    await expect(page.locator(".tool-state").nth(4)).toHaveText("状态待确认");
    const geometry = await page.evaluate(() => {
      const b = (s) => document.querySelector(s).getBoundingClientRect();
      const reader = b(".detail-scroll"),
        workspace = b(".task-detail"),
        footer = b(".detail-footer");
      return {
        readerRight: reader.right,
        workspaceRight: workspace.right,
        readerBottom: reader.bottom,
        footerTop: footer.top,
        toolbar: b(".task-heading").height,
        heading: b(".task-reading-heading").height,
        composer: b(".task-composer").width,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.toolbar).toBe(40);
    expect(geometry.heading).toBe(width < 800 ? 64 : 40);
    expect(geometry.readerRight).toBe(geometry.workspaceRight);
    expect(geometry.readerBottom).toBe(geometry.footerTop);
    expect(geometry.overflow).toBe(false);
    if (width === 1440) expect(geometry.composer).toBe(860);
    await page.screenshot({ path: `${out}/${theme}-${width}.png` });
  }
}
await page.setViewportSize({ width: 1440, height: 960 });
const assets = await page.locator(".tool-chevron").evaluateAll((nodes) =>
  nodes.map((n) => ({
    loaded: n.complete && n.naturalWidth === 14 && n.naturalHeight === 14,
    width: n.getBoundingClientRect().width,
    height: n.getBoundingClientRect().height,
  })),
);
expect(assets.every((a) => a.loaded && a.width === 14 && a.height === 14)).toBe(
  true,
);
expect(
  await page
    .locator(".detail-scroll")
    .evaluate((el) => el.offsetWidth - el.clientWidth),
).toBe(6);
const command = page.locator(".command-record").first();
await command.locator("summary").click();
await expect(command).toHaveAttribute("open");
await expect(command.getByLabel("命令输出")).toContainText("原生输出");
await page.locator(".mcp-tool > summary").click();
await expect(page.locator(".mcp-content")).toContainText("工具结果");
expect(calls).toHaveLength(0);
console.log(
  "compact tools, native states, viewport scrollbar, dual themes and 320/390/1440 layouts passed",
);
await browser.close();
