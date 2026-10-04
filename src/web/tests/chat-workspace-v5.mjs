import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  inputTrigger,
  hasReference,
  slashInput,
} from "../src/composer-model.ts";
import { rowOffsets, visibleRange } from "../src/rowGeometry.ts";
assert.equal(inputTrigger("cost $20", 8), null);
assert.equal(inputTrigger("```\n$skill", 10), null);
assert.equal(inputTrigger("`$skill", 7), null);
assert.equal(inputTrigger("hello /model", 12), null);
assert.equal(slashInput("/workspace/apps"), null);
assert.equal(hasReference("$training", "train"), false);
assert.equal(hasReference("$train", "train"), true);
assert.deepEqual(rowOffsets([40, 60, 40]), [0, 40, 100, 140]);
assert.deepEqual(visibleRange(rowOffsets([40, 60, 40]), 50, 20, 0), [1, 2]);
const out = "../../.samaya/chat-workspace-v5";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const state = fixture(1000),
  { calls, broadcast } = await install(context, state);
const refs = [
  {
    type: "skill",
    name: "train",
    path: "/demo/.agents/skills/train/SKILL.md",
    label: "训练技能",
    source: "repo",
    description: "测试技能",
    enabled: true,
  },
  {
    type: "mention",
    name: "sample-app",
    path: "app://sample",
    label: "示例应用",
    source: "app",
    description: "测试应用",
    enabled: true,
  },
];
const commands = [
  { name: "rename", description: "重命名任务", kind: "native", enabled: true },
  { name: "skills", description: "浏览技能", kind: "ui", enabled: true },
  { name: "apps", description: "浏览应用", kind: "ui", enabled: true },
  {
    name: "cloud",
    description: "当前未连接云执行接口",
    kind: "unavailable",
    enabled: false,
  },
];
await context.route("**/api/input-catalog?*", (route) => {
  const u = new URL(route.request().url());
  const cwd =
    state.records.find((r) => r.thread.id === u.searchParams.get("threadId"))
      ?.thread.cwd || u.searchParams.get("cwd");
  return route.fulfill({
    json: { cwd, references: refs, commands, prompts: [], errors: [] },
  });
});
await context.route("**/command-context?*", (route) => {
  const c = new URL(route.request().url()).searchParams.get("command");
  return route.fulfill({
    json: {
      description: c,
      fields:
        c === "rename"
          ? [
              {
                name: "value",
                label: "新名称",
                value: "",
                type: "text",
                options: null,
              },
            ]
          : [],
      data: { goal: null },
      readOnly: false,
      active: false,
      expectedTurnId: "turn-10",
    },
  });
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await page.locator('[data-task-id="demo-10"] .task-open').click();
await expect(page.locator(".message.user")).toBeVisible();
const input = page.getByRole("textbox", { name: "补充当前任务" });
await input.fill("$tr");
await expect(page.getByRole("option", { name: /\$train/ })).toBeVisible();
await input.press("Enter");
await expect(input).toHaveValue("$train ");
expect(calls).toHaveLength(0);
await input.press("Shift+Enter");
await input.press("a");
await expect(input).toHaveValue("$train \na");
await input.press("Enter");
await expect.poll(() => calls.length).toBe(1);
expect(calls[0].action).toBe("send");
expect(calls[0].body.references[0].path).toBe(refs[0].path);
await expect(input).toHaveValue("");
await input.fill("$");
await input.press("ArrowDown");
await input.press("Tab");
await expect(input).toHaveValue("$sample-app ");
await page.locator(".composer-references summary").click();
await page.getByRole("button", { name: "移除 示例应用" }).click();
await expect(page.locator(".composer-references")).toHaveCount(0);
await input.fill("/skills");
await input.press("Enter");
await expect(page.getByRole("listbox", { name: "技能与应用" })).toBeVisible();
await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1);
await input.press("Escape");
await input.fill("/rename");
await input.press("Enter");
await expect(page.getByRole("dialog")).toBeVisible();
expect(calls).toHaveLength(1);
await page.getByLabel("新名称").fill("新的任务名");
await page.getByRole("button", { name: "确认执行" }).click();
await expect.poll(() => calls.length).toBe(2);
expect(calls[1].body.command).toBe("rename");
expect(calls[1].body.args.value).toBe("新的任务名");
await expect(
  page.getByText("请求已确认；执行进展以任务记录为准。"),
).toBeVisible();
await page.getByRole("dialog").press("Escape");
await input.fill("/unknown");
await input.press("Enter");
await expect(
  page.getByRole("button", { name: "按普通文本发送" }),
).toBeVisible();
expect(calls).toHaveLength(2);
await page.getByRole("button", { name: "按普通文本发送" }).click();
await input.press("Enter");
await expect.poll(() => calls.length).toBe(3);
expect(calls[2].body.text).toBe("/unknown");
expect(calls[2].action).toBe("steer");
await expect(input).toHaveValue("");
await input.fill("中文输入");
await input.dispatchEvent("keydown", {
  key: "Enter",
  code: "Enter",
  isComposing: true,
});
expect(calls).toHaveLength(3);
await page.getByRole("button", { name: "改动与产物", exact: true }).click();
await expect(page.getByRole("region", { name: "改动与结果" })).toBeVisible();
await page.getByRole("button", { name: "对话", exact: true }).click();
await expect(input).toHaveValue("中文输入");
// Live monitoring must survive compact navigation and closed sidebar.
state.records[10].terminals = [
  { processId: "background", command: "sleep", cwd: "/demo/Laya" },
];
state.records[10].turn.status = "completed";
await broadcast();
await expect(page.locator(".task-live-status")).toContainText("后台");
const dimensions = await page
  .locator(".nav-projects button[title]")
  .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
expect(dimensions.length).toBeGreaterThan(0);
for (const height of dimensions) expect(height).toBe(28);
await page
  .locator(".task-heading")
  .getByRole("button", { name: "收起任务侧栏", exact: true })
  .click();
await expect(page.locator(".monitor-nav")).toBeHidden();
await expect(page.locator(".global-pending")).toBeVisible();
await input.fill("$");
await page.screenshot({ path: out + "/desktop-skills.png", fullPage: true });
await input.press("Escape");
for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 900 });
  await expect(input).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: out + `/workspace-${width}.png`,
    fullPage: true,
  });
}
const accessibility = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa"])
  .analyze();
writeFileSync(
  out + "/report.json",
  JSON.stringify(
    {
      errors,
      dimensions,
      violations: accessibility.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        targets: v.nodes.map((n) => n.target),
      })),
      operationCount: calls.length,
    },
    null,
    2,
  ),
);
expect(errors).toEqual([]);
expect(
  accessibility.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  ),
).toEqual([]);
await context.close();
await browser.close();
console.log(
  "v5 geometry, references, commands, keyboard, responsive and accessibility passed",
);
