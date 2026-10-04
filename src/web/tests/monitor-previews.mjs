import { chromium } from "@playwright/test";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";
import { mkdirSync } from "node:fs";
const b = await chromium.launch({ args: ["--no-sandbox"] }),
  c = await b.newContext({ viewport: { width: 1440, height: 900 } });
await install(c, fixture());
const p = await c.newPage();
await p.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:5175");
await p.getByRole("list").waitFor();
const dir = "../../docs/design/previews/workflow-v3";
mkdirSync(dir, { recursive: true });
for (const theme of ["vallum", "abyssus"]) {
  await p.evaluate((value) => window.samayaTheme.setPreference(value), theme);
  await p.screenshot({ path: `${dir}/desktop-${theme}.png` });
  await p.locator('[data-task-id="demo-0"] .task-open').click();
  await p.screenshot({ path: `${dir}/detail-${theme}.png` });
  await returnToOverview(p);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ path: `${dir}/mobile-${theme}.png` });
  await p
    .locator('[data-task-id="demo-0"]')
    .getByRole("button", { name: /选择方案/ })
    .click();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: /选择方案.*去重范围/ })
    .click();
  await p.screenshot({ path: `${dir}/decision-${theme}.png` });
  await p.keyboard.press("Escape");
  await p.setViewportSize({ width: 1440, height: 900 });
}
await b.close();
console.log("Saved 8 explicitly labeled demo previews.");
