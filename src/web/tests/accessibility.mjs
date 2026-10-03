import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync } from "node:fs";
const tid = JSON.parse(
  readFileSync("../../.samaya/acceptance/thread.json"),
).threadId;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();
await page.goto(`http://127.0.0.1:8765/?thread=${tid}`);
await page
  .getByRole("heading", { name: "Samaya 验收 · 可删除 A", exact: true })
  .waitFor();
const results = {};
results.desktop = (
  await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze()
).violations;
results.contrast = await page.evaluate(() => {
  const toRgb = (s) => s.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
  const luminance = (s) =>
    toRgb(s)
      .slice(0, 3)
      .map((c) => {
        c /= 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const background = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const v = getComputedStyle(n).backgroundColor;
      if (toRgb(v)[3] !== 0) return v;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  return [
    ".brand",
    ".session-row.selected strong",
    ".session-row.selected small",
    ".muted",
    ".composer-bottom small",
    "button.primary",
    ".workspace-path code",
  ]
    .map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el),
        bg = background(el),
        a = luminance(style.color),
        b = luminance(bg);
      return {
        selector,
        foreground: style.color,
        background: bg,
        ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
      };
    })
    .filter(Boolean);
});
await page.getByRole("button", { name: "切换工作区", exact: true }).click();
await page
  .getByLabel("服务器目录")
  .fill("/workspace/" + "long-name/".repeat(50));
results.dialog = (
  await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze()
).violations;
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "项目与会话", exact: true }).click();
await page.keyboard.press("Escape");
results.drawerFocus = await page.evaluate(
  () => document.activeElement.textContent,
);
await page.getByRole("button", { name: "项目与会话", exact: true }).click();
await page.getByRole("button", { name: "会话管理", exact: true }).click();
results.sessions = (
  await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze()
).violations;
results.overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
await page.goto("http://127.0.0.1:8765/settings");
results.settings = (
  await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze()
).violations;
writeFileSync(
  "../../.samaya/acceptance/accessibility.json",
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results));
await browser.close();
