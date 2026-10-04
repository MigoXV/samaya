import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  }),
  state = fixture(1000);
state.pendingRequests = [];
state.records.forEach((r) => (r.thread.status.activeFlags = []));
const { calls } = await install(context, state),
  page = await context.newPage();
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:5175");
await page.getByRole("list", { name: "任务列表" }).waitFor();
await page.locator('[data-task-id="demo-0"] .task-open').click();
await page
  .getByLabel("补充当前任务", { exact: true })
  .fill("压力测试期间保留草稿");
await page.locator(".message.user .prose").waitFor();
const sampling = page.evaluate(async (base) => {
  const latency = [],
    longTasks = [];
  new PerformanceObserver((list) =>
    longTasks.push(...list.getEntries().map((e) => e.duration)),
  ).observe({ entryTypes: ["longtask"] });
  const log = document.querySelector(".message.user .prose"),
    range = document.createRange();
  range.selectNodeContents(log);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const selectedText = selection.toString();
  const list = document.querySelector(".monitor-list");
  list.scrollTop = 720;
  const scroll = list.scrollTop;
  let seq = base.revision,
    events = 0,
    batches = 0;
  const started = performance.now();
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      const changed = [];
      for (let j = 0; j < 25; j++) {
        const index = (events + j) % 1000;
        const record = structuredClone(base.records[index]);
        record.confirmedAt = Date.now() / 1000;
        changed.push(record);
        window.__emit("message", {
          method: "item/commandExecution/outputDelta",
          params: {
            threadId: record.thread.id,
            turnId: record.turn?.id,
            itemId: "noise",
            delta: "log chunk",
          },
        });
      }
      events += 25;
      batches++;
      if (batches % 4 === 0) {
        const record = structuredClone(base.records[0]);
        const label = "阶段依据 " + batches;
        record.turn.items = [
          { id: "progress", type: "agentMessage", text: label },
        ];
        changed.push(record);
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (
            document
              .querySelector('[data-task-id="demo-0"] .fact')
              ?.textContent.includes(label)
          ) {
            requestAnimationFrame(() =>
              latency.push(performance.now() - start),
            );
            observer.disconnect();
          }
        });
        observer.observe(document.querySelector(".monitor-list"), {
          subtree: true,
          childList: true,
          characterData: true,
        });
      }
      window.__emit("monitor", {
        ...base,
        records: changed,
        revision: ++seq,
        pendingRequests: undefined,
        requestKeys: [],
        requestStates: [],
      });
      if (performance.now() - started >= 60000) {
        clearInterval(timer);
        setTimeout(resolve, 100);
      }
    }, 250);
  });
  return {
    durationMs: performance.now() - started,
    rawEvents: events,
    patchBatches: batches,
    latency,
    longTasks,
    selectionPreserved: getSelection().toString() === selectedText,
    scrollBefore: scroll,
    scrollAfter: list.scrollTop,
    draft: document.querySelector(".task-composer textarea").value,
    renderedRows: document.querySelectorAll(".task-row").length,
    selectedTask: document.querySelector(".task-heading h1").textContent,
  };
}, state);
await page.waitForTimeout(40000);
const selectionBeforeTyping = await page.evaluate(
  () =>
    getSelection().toString() ===
    document.querySelector(".message.user .prose").textContent,
);
await page.evaluate(() => {
  window.__inputLatencies = [];
  document
    .querySelector(".task-composer textarea")
    .addEventListener("input", () => {
      const t = performance.now();
      requestAnimationFrame(() =>
        window.__inputLatencies.push(performance.now() - t),
      );
    });
});
await page.getByLabel("补充当前任务", { exact: true }).click();
await page
  .getByLabel("补充当前任务", { exact: true })
  .pressSequentially(" keyboard responsiveness", { delay: 20 });
const result = await sampling;
result.selectionPreserved = selectionBeforeTyping;
result.selectionCheckedAfterMs = 40000;
result.inputMeasuredDuringLoad = true;
result.inputLatencies = await page.evaluate(() => window.__inputLatencies);
const p95 = (a) =>
  a.length ? [...a].sort((a, b) => a - b)[Math.floor(a.length * 0.95)] : null;
result.keyEventP95Ms = p95(result.latency);
result.inputP95Ms = p95(result.inputLatencies);
result.longTaskCount = result.longTasks.length;
result.maxLongTaskMs = Math.max(0, ...result.longTasks);
result.productionData = false;
result.submissions = calls.length;
const out = "../../.samaya/workflow-v3";
mkdirSync(out, { recursive: true });
writeFileSync(out + "/performance.json", JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    ...result,
    latency: undefined,
    inputLatencies: undefined,
    longTasks: undefined,
  }),
);
await browser.close();
expect(result.keyEventP95Ms).toBeLessThan(1000);
expect(result.selectionPreserved).toBe(true);
expect(result.scrollAfter).toBe(result.scrollBefore);
expect(calls).toHaveLength(0);
