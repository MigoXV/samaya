import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const tid = JSON.parse(
  readFileSync("../../.samaya/acceptance/thread.json"),
).threadId;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.goto(`http://127.0.0.1:8765/?thread=${tid}`);
await page
  .getByRole("heading", { name: "Samaya 验收 · 可删除 A", exact: true })
  .waitFor();
await page
  .getByLabel("发送任务", { exact: true })
  .fill(
    "Run sleep 60 using exec_command and wait for it to finish, then run pwd and report SAMAYA_RESTART_OK. This checks browser and Python server restarts. Do not modify files.",
  );
await page.getByRole("button", { name: "发送", exact: true }).click();
await page
  .getByRole("button", { name: "停止本轮", exact: true })
  .waitFor({ timeout: 30000 });
await page.reload();
await page
  .getByRole("button", { name: "停止本轮", exact: true })
  .waitFor({ timeout: 15000 });
writeFileSync(
  "../../.samaya/acceptance/browser-recovery.json",
  JSON.stringify({ refreshRunning: true, threadId: tid }),
);
await browser.close();
console.log("Browser closed while real turn is running");
