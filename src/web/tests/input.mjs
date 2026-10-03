import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const path = "../../.samaya/acceptance/api-report.json";
const report = JSON.parse(readFileSync(path));
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`http://127.0.0.1:8765/?thread=${report.fixture}`);
await page.getByRole("heading", { name: "Codex 需要你的输入" }).waitFor();
await page.getByLabel("Small (Recommended)", { exact: false }).check();
await page
  .getByRole("button", { name: "提交回答", exact: true })
  .scrollIntoViewIfNeeded();
await page.screenshot({ path: "../../.samaya/screenshots/input-mobile.png" });
await page.getByRole("button", { name: "提交回答", exact: true }).click();
await page.waitForFunction(() => !document.querySelector(".request-panel"), {
  timeout: 30000,
});
report.browser_input = { passed: true };
writeFileSync(path, JSON.stringify(report, null, 2));
await browser.close();
console.log("Real user input completed through browser");
