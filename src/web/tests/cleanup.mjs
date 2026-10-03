import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const path = "../../.samaya/acceptance/api-report.json";
const report = JSON.parse(readFileSync(path));
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.goto("http://127.0.0.1:8765/sessions");
await page
  .getByRole("checkbox", {
    name: "选择 Samaya 验收 · 后台命令与审批",
    exact: true,
  })
  .check();
await page
  .getByRole("checkbox", { name: "选择 Samaya 验收 · 批量运行中", exact: true })
  .check();
await page.getByRole("button", { name: "归档", exact: true }).click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: "归档", exact: true })
  .click();
await page
  .getByRole("heading", { name: "逐项处理结果 · 成功 1 / 2" })
  .waitFor({ timeout: 30000 });
await page.screenshot({
  path: "../../.samaya/screenshots/partial-cleanup.png",
  fullPage: true,
});
report.browser_batch_partial = { passed: true };
writeFileSync(path, JSON.stringify(report, null, 2));
await browser.close();
console.log("Real bulk archive: one succeeded, running fixture blocked");
