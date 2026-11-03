import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { fixture, install } from "./monitor-fixture.mjs";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  const { calls } = await install(context, state);
  await context.addInitScript(() => {
    if (sessionStorage.getItem("recovery-fixture")) return;
    sessionStorage.setItem("recovery-fixture", "1");
    sessionStorage.setItem(
      "samaya.pendingDraft.waiting",
      "待确认的文字\n".repeat(40),
    );
    localStorage.setItem(
      "samaya.operation.waiting",
      JSON.stringify({
        operationId: "waiting",
        action: "send",
        threadId: "demo-6",
        scope: "demo-6",
        accepted: true,
      }),
    );
    sessionStorage.setItem("samaya.failedDraft.demo-6.failed", "未发送的文字");
  });
  await context.route("**/api/operations/waiting", (route) =>
    route.fulfill({
      json: { operationId: "waiting", state: "uncertain", result: null },
    }),
  );
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
  await page.locator('[data-task-id="demo-6"].overview-task').click();
  const editor = page.getByRole("textbox", {
    name: "补充当前任务",
    exact: true,
  });
  const trigger = page.getByRole("button", {
    name: "暂存内容，2 条",
    exact: true,
  });
  const panel = page.getByRole("region", { name: "暂存内容", exact: true });
  const composer = page.locator(".task-composer .composer-input");
  mkdirSync("../../.samaya/draft-recovery", { recursive: true });
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate(
      (theme) => window.samayaTheme.setPreference(theme),
      theme,
    );
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(trigger).toBeVisible();
      await expect(panel).toBeHidden();
      const before = await composer.boundingBox();
      await trigger.click();
      await expect(panel).toBeVisible();
      expect(await composer.boundingBox()).toEqual(before);
      const box = await panel.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(16);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 15);
      expect(box.y + box.height).toBeLessThanOrEqual(
        before.y + before.height - 32,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: `../../.samaya/draft-recovery/${theme}-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(await composer.boundingBox()).toEqual(before);
    }
    await trigger.click();
    await expect(
      new AxeBuilder({ page }).analyze().then((r) => r.violations),
    ).resolves.toEqual([]);
    await page.getByRole("heading", { level: 1 }).click();
    await expect(panel).toBeHidden();
  }
  await editor.fill("当前正在编辑的草稿");
  await trigger.click();
  const failed = panel
    .locator(".recovery-item")
    .filter({ hasText: "未发送的文字" });
  await failed.locator("summary").click();
  await expect(
    failed.getByRole("button", { name: "继续编辑", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await editor.fill("");
  await trigger.click();
  await failed.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(editor).toHaveValue("未发送的文字");
  await expect(editor).toBeFocused();
  await expect(panel).toBeHidden();
  await page
    .getByRole("button", { name: "暂存内容，1 条", exact: true })
    .click();
  await panel.locator("summary").click();
  await panel.getByRole("button", { name: "移除暂存", exact: true }).click();
  await expect(page.locator(".recovery-trigger")).toHaveCount(0);
  await expect(editor).toBeFocused();
  expect(
    await page.evaluate(
      () => !!localStorage.getItem("samaya.operation.waiting"),
    ),
  ).toBe(true);
  expect(calls).toHaveLength(0);
  console.log(
    "Draft recovery: compact toolbar, stable composer, dual themes, mobile bounds, escape/outside dismissal, accessibility, protected draft restore and no replay passed",
  );
} finally {
  await browser.close();
}
