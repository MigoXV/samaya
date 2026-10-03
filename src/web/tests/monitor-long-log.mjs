import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
import { writeFileSync } from "node:fs";
const b = await chromium.launch({ args: ["--no-sandbox"] }),
  c = await b.newContext({ viewport: { width: 1024, height: 900 } }),
  s = fixture(1000);
await install(c, s);
const p = await c.newPage();
await p.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:5175");
await p.getByRole("list").waitFor();
await p.locator('[data-task-id="demo-6"] .task-open').click();
await p.getByRole("button", { name: "当前工作", exact: true }).click();
await p.locator(".tool>summary").first().click();
await p.locator(".tool pre").waitFor();
const r = await p.evaluate(async (s) => {
  const pre = document.querySelector(".tool pre");
  pre.scrollTop = 800;
  const range = document.createRange();
  range.setStart(pre.firstChild, 50);
  range.setEnd(pre.firstChild, 130);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  const selected = getSelection().toString(),
    offset = pre.scrollTop,
    rows = document.querySelectorAll(".task-row").length;
  let revision = s.revision,
    count = 0;
  const started = performance.now();
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      const records = s.records.slice(0, 25);
      for (const r of records)
        window.__emit("message", {
          method: "item/commandExecution/outputDelta",
          params: {
            threadId: r.thread.id,
            turnId: r.turn?.id,
            itemId: "noise",
            delta: "chunk",
          },
        });
      window.__emit("monitor", {
        ...s,
        records,
        revision: ++revision,
        requestKeys: s.pendingRequests.map((p) => p.key),
      });
      count += 25;
      if (count >= 1000) {
        clearInterval(timer);
        resolve();
      }
    }, 250);
  });
  return {
    logCharacters: pre.textContent.length,
    events: count,
    durationMs: performance.now() - started,
    selectedTextPreserved: selected === getSelection().toString(),
    scrollPreserved: pre.scrollTop === offset,
    renderedRows: rows,
    compactRowHeight: document
      .querySelector(".task-row")
      .getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth > innerWidth,
  };
}, s);
writeFileSync(
  "../../.samaya/workflow-v3/long-log.json",
  JSON.stringify(r, null, 2),
);
console.log(JSON.stringify(r));
await b.close();
expect(r.selectedTextPreserved).toBe(true);
expect(r.scrollPreserved).toBe(true);
expect(r.overflow).toBe(false);
expect(r.compactRowHeight).toBe(96);
