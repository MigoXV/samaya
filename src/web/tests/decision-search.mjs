import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync } from "node:fs";
const out = "../../.samaya/decision-search";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture(16);
  state.records[6].turn.items.push({
    id: "file-6",
    type: "fileChange",
    changes: [
      { path: "framework-adaptation.md", kind: "update", diff: "test" },
    ],
  });
  const calls = await install(context, state);
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
  await page
    .getByRole("button", { name: "查看全部任务 →", exact: true })
    .click();
  await page.locator('[data-task-id="demo-0"] .task-open').click();
  const decision = page
    .locator(".inline-decision")
    .filter({ hasText: "希望采用哪种去重方案？" });
  await expect(decision).toBeVisible();
  await expect(decision.getByRole("button", { name: "确认 →" })).toBeDisabled();
  await decision.getByRole("radio", { name: /同会话/ }).check();
  expect(calls.calls).toHaveLength(0);
  await page.screenshot({ path: out + "/decision.png" });
  await decision.getByRole("button", { name: "确认 →" }).click();
  await expect.poll(() => calls.calls.length).toBe(1);
  expect(calls.calls[0].body.requestKey).toBe("req-0");
  expect(calls.calls[0].body.response.answers.scope.answers).toEqual([
    "同会话",
  ]);
  await page
    .getByRole("button", { name: "搜索任务与项目", exact: true })
    .click();
  const search = page.getByLabel("统一搜索", { exact: true });
  await expect(search).toBeFocused();
  await search.fill("Samaya");
  await expect(
    page.locator(".palette-type").filter({ hasText: "项目" }),
  ).toHaveCount(1);
  await search.fill("framework");
  await expect(page.locator(".palette-type")).toHaveText(["文件"]);
  await expect(page.locator(".palette-text strong").first()).toHaveText(
    "framework",
  );
  const b = await page.getByRole("dialog").boundingBox();
  expect(b.height).toBeLessThan(200);
  await page.screenshot({ path: out + "/search.png" });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator('.detail-tabs button[aria-current="page"]'),
  ).toHaveText("改动与产物");
  await page
    .getByRole("button", { name: "搜索任务与项目", exact: true })
    .click();
  await expect(page.getByText("最近", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "搜索任务与项目", exact: true }),
  ).toBeFocused();
  console.log(
    "Inline confirmation, actual project/file results, compact search, focus recovery and accessibility passed.",
  );
} finally {
  await browser.close();
}
