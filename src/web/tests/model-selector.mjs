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
    failSave = false;
  const selections = [];
  await context.route("**/command-context?command=model", (route) => {
    if (failCatalog)
      return route.fulfill({
        status: 503,
        json: { detail: "模型目录暂不可用" },
      });
    const tid = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/")[3],
    );
    const record = state.records.find((r) => r.thread.id === tid);
    return route.fulfill({
      json: {
        fields: [
          {
            name: "value",
            value: record.thread.model,
            options: [
              { value: "model-a", label: "Model A" },
              { value: "model-b", label: "Model B" },
            ],
          },
        ],
        expectedTurnId: record.turn?.id ?? null,
      },
    });
  });
  await context.route("**/command-context?command=reasoning", (route) => {
    const tid = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/")[3],
    );
    const record = state.records.find((r) => r.thread.id === tid);
    return route.fulfill({
      json: {
        fields: [
          {
            name: "value",
            value: record.thread.reasoningEffort || "low",
            options: ["low", "medium", "high", "xhigh", "max"].map((value) => ({
              value,
              label: value,
            })),
          },
        ],
        defaultValue: "medium",
        expectedTurnId: record.turn?.id ?? null,
      },
    });
  });
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    if (
      op.action !== "command" ||
      !["model", "reasoning"].includes(op.body.command)
    )
      return route.fallback();
    selections.push(op);
    if (failSave)
      return route.fulfill({
        status: 409,
        json: { detail: "选项已变化，请重新选择" },
      });
    state.records.find((r) => r.thread.id === op.body.threadId).thread[
      op.body.command === "model" ? "model" : "reasoningEffort"
    ] = op.body.args.value;
    return route.fulfill({
      json: { operationId: op.operationId, state: "succeeded", result: {} },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
  await page
    .getByRole("button", { name: "查看全部任务 →", exact: true })
    .click();
  await page.locator('[data-task-id="demo-6"] .task-open').click();
  const input = page.getByLabel("补充当前任务", { exact: true });
  const trigger = page.locator(".model-trigger");
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
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(trigger).toContainText("标准");
  expect(selections.at(-1).body.command).toBe("reasoning");
  await slider.focus();
  await page.keyboard.press("End");
  await expect(trigger).toContainText("极深");
  await page.getByRole("button", { name: "重置推理强度", exact: true }).click();
  await expect(trigger).toContainText("标准");
  expect(selections.at(-1).body.args.value).toBe("medium");
  selections.length = 0;
  await page.keyboard.press("Escape");

  await expect(trigger).toContainText("Model A");
  expect((await page.locator(".composer-input").boundingBox()).height).toBe(56);
  expect((await input.boundingBox()).height).toBe(28);
  await input.fill("保留我的草稿");
  await openModels();
  await expect(
    page.getByRole("menuitemradio", { name: "Model A" }),
  ).toHaveAttribute("aria-checked", "true");
  await trigger.press("ArrowDown");
  await expect(
    page.getByRole("menuitemradio", { name: "Model A" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText("Model B");
  await expect(input).toHaveValue("保留我的草稿");
  expect(selections[0].body).toEqual({
    threadId: "demo-6",
    command: "model",
    args: { value: "model-b" },
    expectedTurnId: "turn-6",
  });
  failSave = true;
  await openModels();
  await page.getByRole("menuitemradio", { name: "Model A" }).click();
  await expect(page.locator('.model-menu [role="alert"]')).toBeVisible();
  await expect(trigger).toContainText("Model B");
  await page.keyboard.press("Escape");
  failCatalog = true;
  await openModels();
  await expect(page.locator(".model-menu")).toContainText("模型目录暂不可用");
  failCatalog = false;
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "Model B" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await input.fill("第一行\n第二行");
  expect((await input.boundingBox()).height).toBe(56);
  await input.fill("长文本\n".repeat(30));
  expect((await input.boundingBox()).height).toBe(168);
  expect(await input.evaluate((el) => getComputedStyle(el).overflowY)).toBe(
    "auto",
  );
  await input.fill("");
  expect((await page.locator(".composer-input").boundingBox()).height).toBe(56);
  await expect(
    page.getByRole("button", { name: "开始下一轮", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "收起提示", exact: true }).click();
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
      56,
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
  failSave = false;
  state.records.find((r) => r.thread.id === "demo-6").turn.status =
    "inProgress";
  await broadcast();
  await expect(
    page.getByRole("button", { name: "停止当前轮次", exact: true }),
  ).toBeVisible();
  await openModels();
  await page.getByRole("menuitemradio", { name: "Model A" }).click();
  await expect(trigger).toContainText("Model A");
  expect(selections.at(-1).body.expectedTurnId).toBe("turn-6");
  expect(state.records.find((r) => r.thread.id === "demo-6").turn.status).toBe(
    "inProgress",
  );
  state.records.find((r) => r.thread.id === "demo-6").error = "连接待恢复";
  await broadcast();
  await expect(trigger).toBeDisabled();
  await expect(input).toBeDisabled();
  expect(errors).toEqual([]);
  console.log(
    "Model selection, failure recovery, draft retention, keyboard navigation and responsive composer passed.",
  );
} finally {
  await browser.close();
}
