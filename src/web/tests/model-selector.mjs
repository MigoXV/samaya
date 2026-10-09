import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync } from "node:fs";
const out = "../../.samaya/model-selector";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture(16);
  state.records.forEach((r) => (r.thread.model = "model-a"));
  const { broadcast } = await install(context, state);
  let failCatalog = false,
    failSave = false,
    pendingRead = false;
  let saveStatus = 409;
  let holdSave = false,
    holdCatalog = true,
    holdMonitor = false,
    waitingMonitorReads = 0,
    releaseSave,
    releaseCatalog,
    releaseMonitor;
  const selections = [];
  const models = [
    {
      model: "model-a",
      displayName: "Model A",
      isDefault: true,
      effortOptions: ["low", "medium", "high", "xhigh", "max", "ultra"].map(
        (value) => ({ value, label: value }),
      ),
      defaultEffort: "medium",
      serviceTiers: [{ id: "priority", name: "Fast" }],
    },
    {
      model: "model-b",
      displayName: "Model B",
      isDefault: false,
      effortOptions: ["low", "medium"].map((value) => ({
        value,
        label: value,
      })),
      defaultEffort: "medium",
      serviceTiers: [],
    },
  ];
  function settings(record) {
    return {
      models,
      current: {
        model: record.thread.model,
        reasoningEffort: record.thread.reasoningEffort || "low",
        serviceTier: record.thread.serviceTier || "default",
      },
      expectedTurnId: record.turn?.id ?? null,
      active: false,
      editable: true,
    };
  }
  await context.route("**/model-settings", async (route) => {
    if (holdCatalog)
      await new Promise((resolve) => {
        releaseCatalog = resolve;
      });
    if (failCatalog)
      return route.fulfill({
        status: 503,
        json: { detail: "模型目录暂不可用" },
      });
    const tid = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/")[3],
    );
    return route.fulfill({
      json: settings(state.records.find((r) => r.thread.id === tid)),
    });
  });
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    if (
      op.action !== "command" ||
      !["model", "reasoning", "fast"].includes(op.body.command)
    )
      return route.fallback();
    selections.push(op);
    if (failSave)
      return route.fulfill({
        status: saveStatus,
        json: { detail: "选项已变化，请重新选择" },
      });
    const record = state.records.find((r) => r.thread.id === op.body.threadId);
    if (op.body.command === "model") {
      record.thread.model = op.body.args.value;
      const m = models.find((m) => m.model === record.thread.model);
      if (
        !m.effortOptions.some((o) => o.value === record.thread.reasoningEffort)
      )
        record.thread.reasoningEffort = m.defaultEffort;
      if (!m.serviceTiers.length) record.thread.serviceTier = "default";
    } else
      record.thread[
        op.body.command === "fast" ? "serviceTier" : "reasoningEffort"
      ] = op.body.args.value;
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (holdSave)
      await new Promise((resolve) => {
        releaseSave = resolve;
      });
    return route.fulfill({
      json: {
        operationId: op.operationId,
        state: "succeeded",
        result: pendingRead
          ? { settingsPending: true }
          : { modelSettings: settings(record) },
      },
    });
  });
  const page = await context.newPage();
  await context.route("**/api/monitor", async (route) => {
    if (!holdMonitor) return route.fallback();
    waitingMonitorReads++;
    await new Promise((resolve) => {
      releaseMonitor = resolve;
    });
    return route.fulfill({ json: state });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
  await page
    .getByRole("button", { name: "查看全部任务 →", exact: true })
    .click();
  await page.locator('[data-task-id="demo-6"] .task-open').click();
  const input = page.getByLabel("补充当前任务", { exact: true });
  const trigger = page.locator(".model-trigger");
  await expect(trigger.locator(".model-spinner")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  const loadingBounds = await page.evaluate(() => {
    const trigger = document
      .querySelector(".model-trigger")
      .getBoundingClientRect();
    const indicator = document
      .querySelector(".model-indicator")
      .getBoundingClientRect();
    return { right: trigger.right, indicatorRight: indicator.right };
  });
  expect(loadingBounds.indicatorRight).toBeLessThanOrEqual(loadingBounds.right);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await trigger
      .locator(".model-spinner")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(
    await trigger
      .locator(".model-spinner")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("model-spinner-rotate");
  await expect(page.locator(".monitor-feedback")).toHaveCount(0);
  await page.screenshot({ path: out + "/loading-mobile.png" });
  holdCatalog = false;
  await expect.poll(() => typeof releaseCatalog).toBe("function");
  releaseCatalog();
  await expect(trigger.locator(".model-spinner")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 960 });
  async function openModels() {
    if ((await trigger.getAttribute("aria-expanded")) !== "true")
      await trigger.click();
    if (await page.locator(".reasoning-model").isVisible())
      await page.locator(".reasoning-model").click();
  }
  await expect(page.locator(".composer-input .model-trigger")).toBeVisible();
  expect(
    await trigger.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  await trigger.hover();
  expect(
    await trigger.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  await trigger.click();
  expect(
    await trigger.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  const slider = page.getByRole("slider", { name: "推理强度" });
  await expect(slider).toHaveValue("0");
  const panel = await page.locator(".reasoning-menu").boundingBox();
  const composerBox = await page.locator(".composer-input").boundingBox();
  expect(panel.width).toBe(260);
  expect(composerBox.y - panel.y - panel.height).toBe(8);
  const assets = await page
    .locator(".model-selector img")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        loaded: n.complete && n.naturalWidth > 0,
        w: n.getBoundingClientRect().width,
        natural: n.naturalWidth,
      })),
    );
  expect(assets.every((a) => a.loaded && Math.abs(a.w - a.natural) < 1)).toBe(
    true,
  );
  await page.screenshot({ path: out + "/reasoning.png" });
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(trigger).toContainText("标准");
  await expect.poll(() => selections.at(-1)?.body.command).toBe("reasoning");
  await expect(trigger).toBeEnabled();
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press("End");
  await expect(trigger).toContainText("极致");
  await expect(trigger).toBeEnabled();
  await expect(page.locator(".model-menu")).toBeVisible();
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(trigger).toContainText("极深");
  await expect(trigger).toBeEnabled();
  await page.getByRole("button", { name: "重置推理强度", exact: true }).click();
  await expect(trigger).toContainText("标准");
  expect(selections.at(-1).body.args.value).toBe("medium");
  await expect(page.locator(".panel-fast")).toBeEnabled();
  await page.locator(".panel-fast").click();
  await expect(page.locator(".panel-fast")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(selections.at(-1).body.command).toBe("fast");
  await expect(trigger).toBeEnabled();
  selections.length = 0;
  await page.keyboard.press("Escape");

  await expect(trigger).toContainText("Model A");
  expect((await page.locator(".composer-input").boundingBox()).height).toBe(58);
  expect((await input.boundingBox()).height).toBe(24);
  await input.fill("保留我的草稿");
  await openModels();
  await expect(
    page.getByRole("menuitemradio", { name: /Model A/ }),
  ).toHaveAttribute("aria-checked", "true");
  await trigger.press("ArrowDown");
  await expect(
    page.getByRole("menuitemradio", { name: /Model A/ }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  holdSave = true;
  holdMonitor = true;
  const composerBeforeSwitch = await page
    .locator(".composer-input")
    .boundingBox();
  await page.keyboard.press("Enter");
  await expect(trigger.locator(".model-spinner")).toBeVisible();
  await expect(
    page
      .getByRole("menuitemradio", { name: /Model B/ })
      .locator(".model-spinner"),
  ).toBeVisible();
  await expect(trigger).toContainText("Model A");
  await expect(trigger).toBeDisabled();
  await expect(page.locator(".monitor-feedback")).toHaveCount(0);
  await expect(page.locator(".operation-receipts")).toHaveCount(0);
  const spinnerAssets = await page
    .locator(".model-spinner img")
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => n.getBoundingClientRect().width > 0)
        .map((n) => ({
          loaded: n.complete,
          width: n.naturalWidth,
          height: n.naturalHeight,
          rendered: n.offsetWidth,
        })),
    );
  expect(
    spinnerAssets.every(
      (a) => a.loaded && a.width === 12 && a.height === 12 && a.rendered === 12,
    ),
  ).toBe(true);
  await page.screenshot({ path: out + "/switching.png" });
  await page.keyboard.press("Escape");
  await expect(trigger.locator(".model-spinner")).toBeVisible();
  expect((await page.locator(".composer-input").boundingBox()).height).toBe(
    composerBeforeSwitch.height,
  );
  await expect.poll(() => typeof releaseSave).toBe("function");
  releaseSave();
  holdSave = false;
  await expect(trigger).toContainText("Model B");
  await expect(trigger).toBeEnabled();
  await expect(trigger.locator(".model-spinner")).toHaveCount(0);
  // The local receipt updates the picker even when global monitoring is slow.
  await expect.poll(() => waitingMonitorReads).toBeGreaterThan(0);
  holdMonitor = false;
  releaseMonitor();
  await expect(page.getByText("操作已确认。", { exact: true })).toHaveCount(0);
  // An unavailable tier remains inspectable and never submits a setting change.
  await page.keyboard.press("Escape");
  const fastEntry = page.locator(".fast-toggle").first();
  await expect(fastEntry).toBeEnabled();
  const beforeUnsupported = selections.length;
  await fastEntry.click();
  await expect(page.locator(".model-menu")).toContainText(
    "当前模型未提供 Fast 档位",
  );
  await page.locator(".panel-fast").click();
  expect(selections.length).toBe(beforeUnsupported);
  await page.keyboard.press("Escape");
  await expect(fastEntry).toBeFocused();
  await expect(input).toHaveValue("保留我的草稿");
  expect(selections[0].body).toEqual({
    threadId: "demo-6",
    command: "model",
    args: { value: "model-b" },
    expectedTurnId: "turn-6",
    expectedModel: "model-a",
  });
  failSave = true;
  await openModels();
  await page.getByRole("menuitemradio", { name: /Model A/ }).click();
  await expect(page.locator('.model-menu [role="alert"]')).toBeVisible();
  await expect(page.locator(".monitor-feedback")).toHaveCount(0);
  await expect(page.locator(".operation-feedback[role='alert']")).toHaveCount(
    0,
  );
  await expect(trigger).toContainText("Model B");
  await page.keyboard.press("Escape");
  failCatalog = true;
  await fastEntry.click();
  await expect(page.locator(".model-menu")).toContainText("模型目录暂不可用");
  const beforeReadFailure = selections.length;
  await page.locator(".panel-fast").click();
  expect(selections.length).toBe(beforeReadFailure);
  await expect(fastEntry).not.toHaveAttribute("title", /正在读取/);
  failCatalog = false;
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.locator(".model-menu")).toContainText(
    "当前模型未提供 Fast 档位",
  );
  await page.keyboard.press("Escape");
  await input.fill("第一行\n第二行");
  expect((await input.boundingBox()).height).toBe(48);
  await input.fill("长文本\n".repeat(30));
  expect((await input.boundingBox()).height).toBe(168);
  expect(await input.evaluate((el) => getComputedStyle(el).overflowY)).toBe(
    "auto",
  );
  await input.fill("");
  expect((await page.locator(".composer-input").boundingBox()).height).toBe(58);
  await expect(
    page.getByRole("button", { name: "开始下一轮", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "收起提示", exact: true }),
  ).toHaveCount(0);
  await input.blur();
  await page.screenshot({ path: out + "/desktop.png" });
  await page.evaluate(
    (value) => window.samayaTheme.setPreference(value),
    "abyssus",
  );
  await openModels();
  await expect(
    page.getByRole("menuitemradio", { name: "Model B" }),
  ).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .include(".model-selector")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    axe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({ path: out + "/dark-menu.png" });
  await page.keyboard.press("Escape");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await page.locator(".composer-input").boundingBox()).height).toBe(
      58,
    );
    const modelBox = await trigger.boundingBox();
    const inputBox = await input.boundingBox();
    expect(inputBox.width).toBeGreaterThan(40);
    expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(modelBox.x);
    expect(modelBox.x + modelBox.width).toBeLessThanOrEqual(width);

    await openModels();
    const box = await page.locator(".model-menu").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: out + "/mobile-" + width + ".png" });
    await page.keyboard.press("Escape");
  }
  await trigger.click();
  await expect(page.locator(".panel-fast")).toBeVisible();
  await expect(page.locator(".model-controls > .fast-toggle")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 960 });
  failSave = false;
  state.records.find((r) => r.thread.id === "demo-6").turn.status =
    "inProgress";
  await broadcast();
  await expect(
    page.getByRole("button", { name: "停止当前轮次", exact: true }),
  ).toBeVisible();
  await openModels();
  await page.getByRole("menuitemradio", { name: /Model A/ }).click();
  await expect(trigger).toContainText("Model A");
  expect(selections.at(-1).body.expectedTurnId).toBe("turn-6");
  expect(state.records.find((r) => r.thread.id === "demo-6").turn.status).toBe(
    "inProgress",
  );
  pendingRead = true;
  failCatalog = true;
  await expect(page.locator(".fast-toggle").first()).toBeEnabled();
  const beforePending = selections.length;
  await page.locator(".fast-toggle").first().click();
  await expect(page.locator(".model-menu")).toContainText("等待同步");
  await expect(page.locator(".panel-fast")).toBeEnabled();
  await page.locator(".panel-fast").click();
  expect(selections.length).toBe(beforePending + 1);
  failCatalog = false;
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.locator(".panel-fast")).toBeEnabled();
  expect(selections.length).toBe(beforePending + 1);
  await page.keyboard.press("Escape");
  state.records.find((r) => r.thread.id === "demo-6").error = "连接待恢复";
  await broadcast();
  await expect(trigger).toBeDisabled();
  await expect(input).toBeDisabled();
  const beforeDisconnected = selections.length;
  await fastEntry.click();
  await expect(page.locator(".model-menu")).toContainText(
    "连接或任务状态暂不允许修改设置",
  );
  expect(selections.length).toBe(beforeDisconnected);
  state.records.find((r) => r.thread.id === "demo-6").error = null;
  await broadcast();
  await expect(trigger).toBeEnabled();
  saveStatus = 503;
  failSave = true;
  await openModels();
  const beforeUncertain = selections.length;
  await page.getByRole("menuitemradio", { name: /Model B/ }).click();
  await expect(page.locator('.model-menu [role="alert"]')).toContainText(
    "提交结果待确认",
  );
  await expect(trigger).toContainText("Model A");
  await expect(trigger.locator(".model-spinner")).toHaveCount(0);
  await expect(page.locator(".monitor-feedback")).toHaveCount(0);
  await expect(
    page.locator(".model-menu").getByRole("button", { name: "核查操作回执" }),
  ).toBeVisible();
  await context.route("**/api/operations/*", (route) =>
    route.fulfill({
      json: { state: "failed", result: { message: "演示：切换未执行" } },
    }),
  );
  await page
    .locator(".model-menu")
    .getByRole("button", { name: "核查操作回执" })
    .click();
  const receiptDialog = page.getByRole("dialog", { name: "核查操作回执" });
  await receiptDialog
    .getByRole("button", { name: "查询回执", exact: true })
    .click();
  await expect(receiptDialog).toContainText("切换未执行");
  await expect(page.locator(".operation-receipts")).toHaveCount(0);
  await receiptDialog.press("Escape");
  expect(selections.length).toBe(beforeUncertain + 1);
  expect(errors).toEqual([]);
  console.log(
    "Model selection, failure recovery, draft retention, keyboard navigation and responsive composer passed.",
  );
} finally {
  await browser.close();
}
