import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const b = await chromium.launch({ args: ["--no-sandbox"] }),
  c = await b.newContext({ viewport: { width: 1440, height: 900 } });
await install(c, fixture());
const p = await c.newPage();
await p.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:5175");
await p.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await p.getByRole("list").waitFor();
const results = [];
for (const theme of ["vallum", "abyssus"]) {
  await p.evaluate((value) => window.samayaTheme.setPreference(value), theme);
  await p.locator(".task-open").first().click();
  await p.locator(".monitor-nav-items button").first().hover();
  await p.locator(".message.user .prose").waitFor();
  const axe = await new AxeBuilder({ page: p }).analyze();
  const idleBorder = await p
    .locator(".composer-input")
    .evaluate((el) => getComputedStyle(el).borderTopColor);
  await p.getByLabel("补充当前任务", { exact: true }).focus();
  const ratios = await p.evaluate((idleBorder) => {
    const rgb = (s) => s.match(/[\d.]+/g)?.map(Number);
    const bg = (e) => {
      for (let n = e; n; n = n.parentElement) {
        const c = rgb(getComputedStyle(n).backgroundColor);
        if (c && c[3] !== 0) return c.slice(0, 3);
      }
      return [255, 255, 255];
    };
    const lum = (c) =>
      c
        .map((x) => {
          x /= 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        })
        .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) =>
      (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    return {
      text: [
        ".monitor-brand",
        ".task-live-status",
        ".task-reading-heading h1",
        ".history-view .eyebrow",
        ".history-view .tool summary",
        ".message.user .prose",
        ".model-effort",
      ].map((sel) => {
        const e = document.querySelector(sel);
        return {
          selector: sel,
          ratio: ratio(rgb(getComputedStyle(e).color), bg(e)),
        };
      }),
      controls: [".composer-input", ".task-heading .global-pending"].map(
        (sel) => {
          const e = document.querySelector(sel);
          if (
            sel === ".composer-input" &&
            getComputedStyle(e).borderTopColor === idleBorder
          )
            throw new Error("输入器应显示焦点指示");
          return {
            selector: sel,
            ratio: ratio(
              rgb(getComputedStyle(e).borderTopColor),
              bg(e.parentElement),
            ),
          };
        },
      ),
    };
  }, idleBorder);
  results.push({
    theme,
    ratios,
    axe: axe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
  await returnToOverview(p);
}
writeFileSync(
  "../../.samaya/workflow-v3/contrast.json",
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results));
await b.close();
for (const result of results) {
  assert.equal(
    result.axe.length,
    0,
    `${result.theme}: accessibility violations`,
  );
  for (const sample of result.ratios.text)
    assert.ok(
      sample.ratio >= 4.5,
      `${result.theme}: ${sample.selector} text contrast`,
    );
  for (const sample of result.ratios.controls)
    assert.ok(
      sample.ratio >= 3,
      `${result.theme}: ${sample.selector} control contrast`,
    );
}
