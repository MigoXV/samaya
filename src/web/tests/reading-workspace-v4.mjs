import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const out = "../../.samaya/reading-workspace-v4";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const state = fixture(64);
state.records[0].thread.name += " · 长任务名称与回归验证".repeat(12);
const { calls, broadcast } = await install(context, state);
const page = await context.newPage(),
  errors = [],
  layouts = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/threads/*/turns/*/items*", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: [
        {
          item: {
            id: "v4-command",
            type: "commandExecution",
            command:
              '/bin/bash -lc "rg timeout -n src && sed -n 1,200p src/session.py && cat README.md | head -100"',
            status: "completed",
            exitCode: 2,
            aggregatedOutput: "演示：输出待核对\n".repeat(3000),
          },
        },
        {
          item: {
            id: "v4-answer",
            type: "agentMessage",
            text:
              "**演示数据**\n\n" +
              "已检查请求身份的保存路径。接下来核对恢复流程；没有证据证明全部测试通过。\n\n".repeat(
                35,
              ) +
              "```bash\n" +
              "long-command ".repeat(60) +
              "\n```",
          },
        },
        {
          item: {
            id: "v4-user",
            type: "userMessage",
            content: [
              {
                type: "text",
                text: "演示要求：保留上下文并核对长命令输出。".repeat(8),
              },
            ],
          },
        },
      ],
      nextCursor: null,
      samayaCursor: 0,
    }),
  }),
);
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:5175");
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
expect(await page.locator(".task-row").count()).toBeGreaterThan(20);
for (const theme of ["vallum", "abyssus"]) {
  await page.evaluate(
    (value) => window.samayaTheme.setPreference(value),
    theme,
  );
  await page.locator('[data-task-id="demo-0"] .task-open').click();
  await page.locator(".message.user").waitFor();
  await expect(page.locator(".recent-requirement")).toHaveCount(0);
  await expect(page.locator(".command-record")).not.toHaveAttribute("open");
  await expect(page.locator(".command-record .tool-state")).toHaveText(
    "失败 · 退出码 2",
  );
  await expect(page.locator(".command-record .tool-preview")).toContainText(
    "rg timeout -n src",
  );
  const input = page.getByLabel("补充当前任务", { exact: true });
  await input.fill("草稿保留，不提交");
  for (const width of [1440, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ["work", "focus"]) {
      if (mode === "focus")
        await page
          .locator(".task-heading")
          .getByRole("button", { name: "收起任务侧栏", exact: true })
          .click();
      const box = await page.locator(".detail-scroll").boundingBox();
      layouts.push({ theme, width, mode, readingHeight: box.height });
      expect(box.height).toBeGreaterThanOrEqual(580);
      await expect(page.locator(".monitor-toolbar")).toBeHidden();
      if (mode === "focus") {
        await expect(page.locator(".monitor-nav")).toBeHidden();
        await page
          .getByRole("button", { name: "展开任务侧栏", exact: true })
          .click();
      }
    }
  }
  await page.locator(".detail-scroll").evaluate((el) => {
    el.scrollTop = 600;
    el.dataset.probe = "same-reader";
  });
  const scroll = await page
    .locator(".detail-scroll")
    .evaluate((el) => el.scrollTop);
  const sources = await page.evaluate(() => window.__sources.length);
  await page
    .locator(".task-heading")
    .getByRole("button", { name: "收起任务侧栏", exact: true })
    .click();
  await expect(page.locator(".detail-scroll")).toHaveAttribute(
    "data-probe",
    "same-reader",
  );
  expect(await page.evaluate(() => window.__sources.length)).toBe(sources);
  expect(
    Math.abs(
      (await page.locator(".detail-scroll").evaluate((el) => el.scrollTop)) -
        scroll,
    ),
  ).toBeLessThan(2);
  await page.getByRole("button", { name: "展开任务侧栏", exact: true }).click();
  const returnScroll = await page
    .locator(".detail-scroll")
    .evaluate((el) => el.scrollTop);
  await page.getByRole("button", { name: "改动与产物", exact: true }).click();
  await page.getByRole("region", { name: "改动与结果" }).waitFor();
  await page.locator(".detail-scroll").evaluate((el) => {
    el.scrollTop = 240;
  });
  const resultScroll = await page
    .locator(".detail-scroll")
    .evaluate((el) => el.scrollTop);
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await expect
    .poll(() => page.locator(".detail-scroll").evaluate((el) => el.scrollTop))
    .toBe(returnScroll);
  await expect(input).toHaveValue("草稿保留，不提交");
  await page.getByRole("button", { name: "改动与产物", exact: true }).click();
  await expect
    .poll(() => page.locator(".detail-scroll").evaluate((el) => el.scrollTop))
    .toBe(resultScroll);
  await page.getByRole("button", { name: "对话", exact: true }).click();
  for (const id of [6, 0]) {
    await page
      .locator(".monitor-nav")
      .getByRole("button", { name: "搜索任务与项目", exact: true })
      .click();
    await page
      .getByLabel("统一搜索", { exact: true })
      .fill(state.records[id].thread.name);
    await page.locator(".palette-results button").first().click();
  }
  await expect(input).toHaveValue("草稿保留，不提交");
  await expect
    .poll(() =>
      page
        .locator(".detail-scroll")
        .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThan(2);
  await page.locator(".detail-scroll").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: `${out}/work-${theme}.png` });
  await page
    .locator(".task-heading")
    .getByRole("button", { name: "收起任务侧栏", exact: true })
    .click();
  await page.screenshot({ path: `${out}/focus-${theme}.png` });
  await page.getByRole("button", { name: "展开任务侧栏", exact: true }).click();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page
    .getByRole("button", { name: "工作区与状态详情", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("/demo/Samaya");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "工作区与状态详情", exact: true }),
  ).toBeFocused();
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 1024) {
      await page.locator(".task-sidebar-toggle").click();
      await expect(page.locator(".monitor-nav")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".monitor-nav")).toBeHidden();
      await expect(page.locator(".task-sidebar-toggle")).toBeFocused();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const footer = await page.locator(".detail-footer").boundingBox();
    expect(footer.y + footer.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: `${out}/work-${theme}-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 480 });
  await input.focus();
  await input.fill("长草稿\n".repeat(80));
  const footer = await page.locator(".detail-footer").boundingBox();
  expect(footer.y + footer.height).toBeLessThanOrEqual(480);
  await input.fill("草稿保留，不提交");
  state.connection = "disconnected";
  await broadcast();
  await expect(page.locator(".connection-notice")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "追加指令", exact: true }),
  ).toBeDisabled();
  state.connection = "connected";
  await broadcast();
  await page.setViewportSize({ width: 1440, height: 900 });
  await returnToOverview(page);
}
expect(calls).toHaveLength(0);
expect(errors).toEqual([]);
const result = {
  demonstration: true,
  layouts,
  noMutations: true,
  errors,
  checks: [
    "recent-scope-not-monitor-scope",
    "no-duplicate-requirement",
    "command-collapsed",
    "same-reader-and-subscriptions",
    "draft-and-scroll-restore",
    "dialog-focus-return",
    "drawer-escape",
    "dual-theme-axe",
    "320-390-overflow",
    "reduced-viewport-editor",
    "disconnect-no-resubmit",
  ],
};
writeFileSync(`${out}/results.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
