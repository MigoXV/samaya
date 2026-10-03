import { chromium, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
const b = await chromium.launch({ args: ["--no-sandbox"] }),
  p = await b.newPage({ viewport: { width: 1440, height: 900 } });
let mutations = 0;
p.on("request", (r) => {
  if (r.url().includes("/api/operations")) mutations++;
});
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(process.env.SAMAYA_RUNTIME_TEST_URL || "http://127.0.0.1:8772");
await p.getByRole("list", { name: "任务列表" }).waitFor();
const data = await p.evaluate(() =>
  fetch("/api/monitor").then((r) => r.json()),
);
await p.locator(".task-open").first().click();
await p.locator(".task-detail h2").waitFor();
const selected = await p.locator(".task-detail h2").textContent();
await p.getByRole("button", { name: "当前工作", exact: true }).click();
await p.locator(".history-view .message").first().waitFor();
await p.reload();
await p.locator(".task-detail h2").waitFor();
expect(await p.locator(".task-detail h2").textContent()).toBe(selected);
await p.locator(".history-view .message").first().waitFor();
await p.screenshot({ path: "../../.samaya/workflow-v3/runtime-desktop.png" });
const result = {
  realRuntime: true,
  connection: data.connection,
  records: data.records.length,
  confirmed: data.records.filter((r) => r.confirmedAt && !r.error).length,
  nativeParentLinks: data.records.filter((r) => r.thread.parentThreadId).length,
  historyVisible: true,
  selectionRestored: true,
  operationsSubmitted: mutations,
  errors,
};
writeFileSync(
  "../../.samaya/workflow-v3/runtime-browser.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
await b.close();
expect(mutations).toBe(0);
expect(errors).toEqual([]);
