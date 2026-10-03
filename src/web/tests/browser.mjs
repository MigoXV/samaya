import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
const tid = JSON.parse(
  readFileSync("../../.samaya/acceptance/thread.json"),
).threadId;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:8765/?thread=${tid}`);
await page
  .getByRole("heading", { name: "Samaya 验收 · 可删除 A", exact: true })
  .waitFor();
await page.waitForTimeout(1500);
mkdirSync("../../.samaya/screenshots", { recursive: true });
await page.screenshot({
  path: "../../.samaya/screenshots/desktop.png",
  fullPage: true,
});
await page.getByRole("button", { name: "切换工作区", exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.keyboard.press("Escape");
const focus = await page.evaluate(() => document.activeElement.textContent);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "../../.samaya/screenshots/mobile.png",
  fullPage: true,
});
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
await page.getByRole("button", { name: "项目与会话", exact: true }).click();
await page.getByRole("button", { name: "会话管理", exact: true }).click();
await page.getByRole("heading", { name: "整理会话", exact: true }).waitFor();
await page.screenshot({
  path: "../../.samaya/screenshots/sessions-mobile.png",
  fullPage: true,
});
console.log(JSON.stringify({ errors, focusReturned: focus, overflow }));
await browser.close();
