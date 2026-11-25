import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const path = "../../.samaya/acceptance/api-report.json";
const report = JSON.parse(readFileSync(path));
const { a: cwd } = JSON.parse(
  readFileSync("../../.samaya/acceptance/thread.json"),
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.goto(`http://127.0.0.1:8765/workspaces/manage?cwd=${encodeURIComponent(cwd)}`);
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
  .getByText("已归档 1 个对话 · 1 个未处理", { exact: true })
  .waitFor({ timeout: 30000 });
await page.screenshot({
  path: "../../.samaya/screenshots/partial-cleanup.png",
  fullPage: true,
});
report.browser_batch_partial = { passed: true };
writeFileSync(path, JSON.stringify(report, null, 2));
await browser.close();
console.log("Real bulk archive: one succeeded, running fixture blocked");
