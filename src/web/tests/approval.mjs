import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const report = JSON.parse(
  readFileSync("../../.samaya/acceptance/api-report.json"),
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.goto(`http://127.0.0.1:8765/?thread=${report.fixture}`);
await page
  .getByRole("heading", { name: "等待审批", exact: true })
  .waitFor({ timeout: 15000 });
await page
  .getByRole("button", { name: "允许本次", exact: true })
  .scrollIntoViewIfNeeded();
await page.screenshot({ path: "../../.samaya/screenshots/approval.png" });
await page.getByRole("button", { name: "允许本次", exact: true }).click();
await page.waitForFunction(() => !document.querySelector(".request-panel"), {
  timeout: 30000,
});
report.browser_approval = { passed: true };
writeFileSync(
  "../../.samaya/acceptance/api-report.json",
  JSON.stringify(report, null, 2),
);
await browser.close();
console.log("Real approval completed through browser");
