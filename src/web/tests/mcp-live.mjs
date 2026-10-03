import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const base = "../../.samaya/acceptance/mcp";
const fixture = JSON.parse(readFileSync(`${base}/fixture.json`));
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const report = { threadId: fixture.threadId };
const panel = page.getByRole("region", { name: "MCP 等待你的输入" });
await page.goto(fixture.url);
await panel.waitFor();
if (
  await panel
    .getByText("Allow the samaya_acceptance MCP server", { exact: false })
    .count()
)
  await panel.getByRole("button", { name: /提交回答|允许本次/ }).click();
await page
  .getByLabel("报告名称 · 必填", { exact: true })
  .waitFor({ timeout: 60000 });
await page.getByRole("button", { name: "提交回答", exact: true }).click();
await expect(page.locator('[aria-invalid="true"]').first()).toBeFocused();
report.invalidFocus = true;
async function fill() {
  await page
    .getByLabel("报告名称 · 必填", { exact: true })
    .fill("MCP 真实验收");
  await page.getByLabel("最多条数 · 必填", { exact: true }).fill("0");
  await page
    .getByLabel("包含归档 · 必填", { exact: true })
    .selectOption("false");
  await page.getByLabel("摘要", { exact: true }).check();
}
const axe = async () =>
  (
    await new AxeBuilder({ page })
      .include(".mcp-request")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()
  ).violations;
await fill();
report.desktopAxe = await axe();
mkdirSync("../../.samaya/screenshots", { recursive: true });
await panel.screenshot({
  path: "../../.samaya/screenshots/mcp-form-desktop.png",
});
await page.reload();
await page.getByLabel("报告名称 · 必填", { exact: true }).waitFor();
report.refreshPending = true;
await page.setViewportSize({ width: 390, height: 844 });
await fill();
report.mobileAxe = await axe();
report.mobileOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
await panel.screenshot({
  path: "../../.samaya/screenshots/mcp-form-mobile.png",
});
const second = await context.newPage();
await second.goto(fixture.url);
await second.getByLabel("报告名称 · 必填", { exact: true }).waitFor();
await page.getByRole("button", { name: "提交回答", exact: true }).click();
await expect(second.locator(".mcp-request")).toHaveCount(0, { timeout: 15000 });
report.multiPageResolved = true;
await page.waitForFunction(
  () =>
    document.querySelector(".mcp-tool summary")?.textContent.includes("已完成"),
  null,
  { timeout: 60000 },
);
await page.locator(".mcp-tool > summary").click();
await expect(page.locator(".mcp-content")).toContainText("MCP_REAL_RESULT");
await page
  .locator(".mcp-tool")
  .screenshot({ path: "../../.samaya/screenshots/mcp-result-mobile.png" });
report.formResult = true;
await page
  .locator(".composer textarea")
  .fill(
    "Call samaya_acceptance collect once with mode url. Wait for the test authorization flow and report its result. Do not use other tools.",
  );
await expect(
  page.getByRole("button", { name: "发送", exact: true }),
).toBeEnabled({ timeout: 60000 });
await page.getByRole("button", { name: "发送", exact: true }).click();
await panel.waitFor({ timeout: 60000 });
if (
  await panel
    .getByText("Allow the samaya_acceptance MCP server", { exact: false })
    .count()
)
  await panel.getByRole("button", { name: /提交回答|允许本次/ }).click();
await page
  .getByRole("link", { name: "打开授权页面" })
  .waitFor({ timeout: 60000 });
report.urlAxe = await axe();
await panel.screenshot({
  path: "../../.samaya/screenshots/mcp-url-mobile.png",
});
const popupWait = page.waitForEvent("popup");
await page.getByRole("link", { name: "打开授权页面" }).click();
const popup = await popupWait;
await expect(page.getByRole("button", { name: "同意继续" })).toBeVisible();
report.openNotComplete = true;
await popup.getByRole("button", { name: "完成测试授权" }).click();
await popup.close();
await page.getByRole("button", { name: "同意继续" }).click();
await expect(page.locator(".mcp-request")).toHaveCount(0);
await page.waitForFunction(
  () =>
    [...document.querySelectorAll(".mcp-tool summary")].filter((e) =>
      e.textContent.includes("已完成"),
    ).length >= 2,
  null,
  { timeout: 60000 },
);
report.urlResult = true;
report.errors = errors;
writeFileSync(`${base}/browser-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (
  errors.length ||
  report.mobileOverflow ||
  report.desktopAxe.length ||
  report.mobileAxe.length ||
  report.urlAxe.length
)
  process.exitCode = 1;
