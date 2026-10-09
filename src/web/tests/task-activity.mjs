import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync } from "node:fs";
const out = "../../.samaya/task-activity";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1550, height: 960 },
  });
  const state = fixture();
  for (const r of state.records) r.thread.status.activeFlags = [];
  state.pendingRequests = state.pendingRequests.filter(
    (p) => p.key === "req-0",
  );
  const waiting = state.records.find((r) => r.thread.id === "demo-0");
  const running = state.records.find((r) => r.thread.id === "demo-3");
  const unknown = state.records.find((r) => r.thread.id === "demo-8");
  unknown.requestsUnknown = 1;
  const { broadcast: publish, calls } = await install(context, state);
  const broadcast = async () => {
    state.requestStates = state.pendingRequests.map(
      (p) => `${p.key}:${p.responseState || ""}`,
    );
    await publish();
  };
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
  const row = (id) => page.locator(`.overview-task[data-task-id="${id}"]`);
  const pending = row("demo-0");
  await expect(pending).toHaveClass(/task-attention-live/);
  await expect(row("demo-3")).toHaveClass(/task-running/);
  await expect(row("demo-8")).toHaveClass(/task-waiting/);
  await expect(row("demo-8")).not.toHaveClass(/task-attention-live/);
  await expect(row("demo-9")).not.toHaveClass(/task-running/);
  await expect(pending.locator(".overview-action")).toHaveText("回答问题");
  const pseudo = (el) => {
    const s = getComputedStyle(el, "::after"),
      own = getComputedStyle(el);
    return {
      border: s.borderTopWidth,
      color: s.borderTopColor,
      animation: s.animationName,
      duration: s.animationDuration,
      pointer: s.pointerEvents,
      background: own.backgroundColor,
      opacity: own.opacity,
    };
  };
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    const background =
      theme === "vallum" ? "rgb(238, 236, 229)" : "rgb(21, 30, 39)";
    await expect(pending).toHaveCSS("background-color", background);
    await expect(row("demo-3")).toHaveCSS("background-color", background);
    const styles = await pending.evaluate(pseudo);
    expect(styles.border).toBe("4px");
    expect(styles.duration).toBe("1.5s");
    expect(styles.pointer).toBe("none");
    expect(styles.background).toBe(
      await row("demo-3").evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      ),
    );
    const samples = await pending.evaluate(async (el) => {
      const a = el
        .getAnimations({ subtree: true })
        .find((a) => a.animationName === "task-attention-breathe");
      a.pause();
      const result = [];
      for (const time of [0, 50, 100, 375, 700, 750, 800, 1125, 1450, 1500]) {
        a.currentTime = time;
        await new Promise(requestAnimationFrame);
        const box = el.getBoundingClientRect();
        result.push({
          time,
          outline: Number(getComputedStyle(el, "::after").opacity),
          background: getComputedStyle(el).backgroundColor,
          own: getComputedStyle(el).opacity,
          text: getComputedStyle(el.querySelector("strong")).opacity,
          width: box.width,
          height: box.height,
        });
      }
      return result;
    });
    for (const sample of samples) {
      expect(sample.outline).toBeCloseTo(
        0.725 + 0.275 * Math.cos((2 * Math.PI * sample.time) / 1500),
        2,
      );
      expect(sample.background).toBe(styles.background);
      expect(sample.own).toBe("1");
      expect(sample.text).toBe("1");
      expect(sample.width).toBe(samples[0].width);
      expect(sample.height).toBe(samples[0].height);
    }
    expect(samples[0].outline).toBe(samples.at(-1).outline);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.screenshot({ path: `${out}/overview.png` });
  await page
    .getByRole("button", { name: "查看全部任务 →", exact: true })
    .click();
  const listRow = page.locator('.task-row[data-task-id="demo-0"]');
  await expect(listRow).toHaveClass(/task-attention-live/);
  expect((await listRow.evaluate(pseudo)).border).toBe("4px");
  await listRow.locator(".task-open").click();
  const panel = page.locator(".inline-decision .decision-request").first();
  await expect(panel).toHaveClass(/task-attention-live/);
  await expect(panel.locator(".decision-status")).toHaveCount(0);
  expect((await panel.evaluate(pseudo)).border).toBe("4px");

  const assets = await panel
    .locator(".decision-option img")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        w: n.naturalWidth,
        h: n.naturalHeight,
        rendered: n.getBoundingClientRect().width,
        loaded: n.complete,
      })),
    );
  expect(
    assets.every(
      (a) => a.loaded && a.w === 18 && a.h === 18 && a.rendered === 18,
    ),
  ).toBe(true);
  await panel.getByRole("radio", { name: /同会话/ }).check();
  await expect(panel.getByRole("button", { name: "确认 →" })).toBeEnabled();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await panel.evaluate((el) => ({
    animation: getComputedStyle(el, "::after").animationName,
    opacity: getComputedStyle(el, "::after").opacity,
  }));
  expect(reduced).toEqual({ animation: "none", opacity: "1" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const width of [1550, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ["vallum", "abyssus"]) {
      await page.evaluate((t) => window.samayaTheme.setPreference(t), theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await panel.evaluate(pseudo)).border).toBe("4px");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 1550, height: 960 });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/question.png` });
  state.pendingRequests[0].responseState = "sent";
  await broadcast();
  await expect(panel).not.toHaveClass(/task-attention-live/);
  await expect(panel.getByRole("button", { name: "确认 →" })).toBeDisabled();
  delete state.pendingRequests[0].responseState;
  state.connection = "disconnected";
  await broadcast();
  await expect(panel).not.toHaveClass(/task-attention-live/);
  state.connection = "connected";
  waiting.confirmedAt = Date.now() / 1000 - 120;
  await broadcast();
  await expect(panel).not.toHaveClass(/task-attention-live/);
  waiting.confirmedAt = Date.now() / 1000;
  await broadcast();
  await expect(panel).toHaveClass(/task-attention-live/);
  state.pendingRequests = [];
  waiting.thread.status = { type: "idle", activeFlags: [] };
  waiting.turn.status = "completed";
  running.thread.status = { type: "idle", activeFlags: [] };
  running.turn.status = "completed";
  await broadcast();
  await expect(panel).toHaveCount(0);
  await page
    .locator(".monitor-nav-items")
    .getByRole("button", { name: "任务总览", exact: true })
    .click();
  await expect(page.locator('[data-task-id="demo-0"]').first()).not.toHaveClass(
    /task-waiting/,
  );
  expect(calls).toHaveLength(0);
  console.log(
    "task activity: 4px border-only sine motion, static running background, real request lifecycle, reduced motion, dual themes, narrow layouts and unchanged interactions passed",
  );
} finally {
  await browser.close();
}
