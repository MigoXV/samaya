import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  const record = state.records.find((r) => r.thread.id === "demo-5");
  const { broadcast } = await install(context, state);
  const user = {
    id: "plan-user",
    type: "userMessage",
    text: "先给出执行计划，再等待我确认。",
  };
  let items = [user],
    reads = 0;
  await context.route("**/api/threads/*/turns/*/items*", (route) => {
    reads++;
    return route.fulfill({
      json: {
        data: [...items].reverse().map((item) => ({ item })),
        nextCursor: null,
        samayaCursor: 0,
      },
    });
  });
  const p = await context.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await p.locator('.overview-task[data-task-id="demo-5"]').click();
  await expect(p.locator('[data-item-id="plan-user"]')).toBeVisible();
  await expect
    .poll(() =>
      p.evaluate(
        () =>
          window.__sources.length >= 2 &&
          window.__sources.every((s) => s.ready),
      ),
    )
    .toBe(true);
  let seq = 0;
  const emit = async (method, params, sequence = ++seq) =>
    p.evaluate(
      ({ method, params, sequence }) =>
        window.__emit("message", { method, params }, sequence),
      {
        method,
        params: { threadId: "demo-5", turnId: "turn-5", ...params },
        sequence,
      },
    );
  const delta = (text, extra = {}) =>
    emit("item/plan/delta", { itemId: "stream-plan", delta: text, ...extra });
  const plan = p.locator('[data-item-id="stream-plan"]');
  // A delta may arrive before item/started; native identity must still render it.
  await delta("## 执行方案\n\n1. 核对当前配置。");
  await expect(plan.locator("details")).toHaveAttribute("open");
  await expect(plan).toContainText("核对当前配置");
  await expect(plan).not.toContainText("验证识别结果");
  await delta("错误工作区片段", { threadId: "other-thread" });
  await delta("错误轮次片段", { turnId: "other-turn" });
  await delta("\n2. 验证识别结果。");
  await emit(
    "item/plan/delta",
    { itemId: "stream-plan", delta: "重复片段不应出现" },
    seq,
  );
  await expect(plan).toContainText("验证识别结果");
  await expect(plan).not.toContainText("重复片段");
  await expect(plan).not.toContainText("错误");
  items = [user, { id: "stream-plan", type: "plan", text: "" }];
  await emit("item/started", { item: items[1] });
  // Snapshot refresh still has an empty persisted item. It must not erase observed text.
  const before = reads;
  await p.evaluate(() => window.__emit("snapshot", {}));
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(plan).toContainText("验证识别结果");
  await delta("\n3. 补充回归测试。");
  await expect(plan).toContainText("补充回归测试");
  await plan.locator("summary").click();
  await expect(plan.locator("details")).not.toHaveAttribute("open");
  await delta("\n4. 汇报验证结论。");
  await expect(plan).toContainText("汇报验证结论");
  await expect(plan.locator("details")).not.toHaveAttribute("open");
  await plan.locator("summary").click();
  const final = {
    id: "stream-plan",
    type: "plan",
    text: "## 最终执行方案\n\n1. 核对配置并完成回归验证。\n2. 汇报最终结论。",
  };
  await emit("item/completed", { item: final });
  await expect(plan).toContainText("最终执行方案");
  await expect(plan).not.toContainText("补充回归测试");
  await delta("完成后到达的旧片段");
  await expect(plan).not.toContainText("旧片段");
  // Reconnection and a stale history response cannot resurrect a completed stream.
  await p.evaluate(() => window.__emit("snapshot", {}));
  await expect(plan).toContainText("最终执行方案");
  await expect(p.locator(".execution-plan")).toHaveCount(1);
  await emit("item/plan/delta", {
    itemId: "second-plan",
    delta: "第二个计划正在生成，已收到的内容需要保留。",
  });
  const second = p.locator('[data-item-id="second-plan"]');
  await expect(second).toBeVisible();
  await emit("turn/completed", { turn: { id: "turn-5", status: "completed" } });
  await expect(second).toContainText("正在生成");
  // If item/completed was missed, the authoritative final turn read replaces the draft.
  items = [
    user,
    final,
    { id: "second-plan", type: "plan", text: "第二个计划的完整最终内容。" },
  ];
  record.turn.status = "completed";
  record.thread.status = { type: "idle" };
  await broadcast();
  await expect(second).toContainText("完整最终内容");
  await expect(second).not.toContainText("正在生成");
  await expect(p.locator(".execution-plan")).toHaveCount(2);
  await p.getByRole("button", { name: "改动与产物", exact: true }).click();
  await expect(plan).toBeVisible();
  await expect(second).toBeVisible();
  await p.getByRole("button", { name: "对话", exact: true }).click();
  for (const theme of ["abyssus", "vallum"]) {
    await p.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    await p.waitForTimeout(350);
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: 960 });
      await expect(plan.locator("details")).toHaveAttribute("open");
      expect(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await p.screenshot({
        path: `../../.samaya/plan-output-${theme}-${width}.png`,
      });
    }
  }
  const accessibility = await new AxeBuilder({ page: p })
    .include(".execution-plan")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    "Plan output: expanded default, incremental text, native identity, scope/sequence checks, reconnect, final replacement, manual collapse, themes and mobile passed",
  );
} finally {
  await browser.close();
}
