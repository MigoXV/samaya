// Read-only production probe. Supply an existing Playwright storageState file;
// credentials, message bodies and event payloads are never written to the report.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const base = process.env.SAMAYA_RUNTIME_TEST_URL || "https://127.0.0.1:8765";
const tid = process.env.SAMAYA_TEST_THREAD;
if (!tid) throw new Error("Set SAMAYA_TEST_THREAD to an existing conversation");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const p95 = (values) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ??
  null;
const results = [];
try {
  for (const throttled of [false, true]) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: process.env.SAMAYA_TEST_STORAGE_STATE,
      viewport: { width: 1440, height: 900 },
    });
    // No mutation, including accidental keyboard submission, can reach production.
    await context.route("**/api/**", (route) =>
      ["GET", "HEAD"].includes(route.request().method())
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__latency = { long: [], input: [] };
      new PerformanceObserver((list) =>
        window.__latency.long.push(...list.getEntries().map((e) => e.duration)),
      ).observe({ type: "longtask", buffered: true });
      document.addEventListener("input", () => {
        const t = performance.now();
        requestAnimationFrame(() =>
          window.__latency.input.push(performance.now() - t),
        );
      });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    if (throttled)
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 20,
        downloadThroughput: 20_000_000 / 8,
        uploadThroughput: 20_000_000 / 8,
      });
    const sse = { bytes: 0, count: 0, fullCatalogEvents: 0 },
      requests = [],
      errors = [];
    cdp.on("Network.eventSourceMessageReceived", (event) => {
      sse.bytes += Buffer.byteLength(event.data);
      sse.count++;
      try {
        if (JSON.parse(event.data).method === "app/list/updated")
          sse.fullCatalogEvents++;
      } catch {
        /* heartbeat */
      }
    });
    page.on("requestfinished", async (request) => {
      if (new URL(request.url()).pathname !== "/api/monitor") return;
      requests.push({
        ms: request.timing().responseEnd,
        bytes: (await request.sizes()).responseBodySize,
      });
    });
    page.on("pageerror", (e) => errors.push(e.message));
    const started = Date.now();
    await page.goto(`${base}/?thread=${encodeURIComponent(tid)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".model-trigger").waitFor();
    await page.waitForTimeout(8000);
    const clicks = [];
    for (let i = 0; i < 5; i++) {
      const t = Date.now();
      await page.locator(".model-trigger").click();
      clicks.push(Date.now() - t);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
    const textarea = page.locator("textarea").first();
    if ((await textarea.count()) && (await textarea.isEditable())) {
      await textarea.fill("");
      await textarea.pressSequentially("latency probe never submitted", {
        delay: 30,
      });
      await textarea.clear();
    }
    await page.waitForTimeout(5000);
    const perf = await page.evaluate(() => window.__latency);
    const result = {
      throttled,
      elapsedMs: Date.now() - started,
      sse,
      monitorRequests: requests,
      clickP95Ms: p95(clicks),
      clicks,
      inputP95Ms: p95(perf.input),
      inputSamples: perf.input.length,
      longTasks: perf.long.length,
      longTaskTotalMs: perf.long.reduce((a, b) => a + b, 0),
      errors,
    };
    results.push(result);
    console.log(JSON.stringify(result));
    await context.close();
  }
  const out =
    process.env.SAMAYA_LATENCY_REPORT ||
    fileURLToPath(
      new URL(
        "../../../.samaya/latency-audit/after-browser.json",
        import.meta.url,
      ),
    );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
