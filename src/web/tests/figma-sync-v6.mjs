import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const out = "../../.samaya/figma-sync-v6";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const state = fixture(40),
  { calls, broadcast } = await install(context, state);
const refs = Array.from({ length: 12 }, (_, i) => ({
  type: "skill",
  name: i === 0 ? "dl-train" : i === 1 ? "python-poetry" : "skill-" + i,
  label: "技能 " + i,
  path: `/demo/.agents/skills/${i}/SKILL.md`,
  description: i === 0 ? "训练框架与配置规范" : "工程规范与验证",
  source: "user",
  enabled: true,
}));
await context.route("**/api/input-catalog?*", (route) =>
  route.fulfill({
    json: {
      cwd: "/demo/Samaya",
      references: refs,
      commands: [
        {
          name: "permissions",
          description: "权限范围",
          kind: "native",
          enabled: true,
        },
        {
          name: "cloud",
          description: "当前未连接云执行接口",
          kind: "unavailable",
          enabled: false,
        },
      ],
      prompts: [],
      errors: [],
    },
  }),
);
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
await expect(page.locator(".attention-preview")).toHaveCount(2);
await expect(page.locator(".overview-workspace")).toHaveCount(3);
for (const group of await page.locator(".overview-workspace").all())
  await expect(group.locator(".overview-task")).toHaveCount(5);
await expect(page.locator(".overview-ended")).toHaveCount(0);
await page.locator(".attention-preview").first().click();
await expect(
  page.getByRole("button", { name: "确认 →", exact: true }),
).toBeVisible();
await page.getByRole("dialog").press("Escape");
state.records[30].thread.updatedAt = Date.now() / 1000 + 100;
state.records[30].terminals = [{ processId: "outside", command: "background" }];
await broadcast();
await expect(
  page
    .locator(
      '.overview-workspace[data-workspace="/demo/Samaya"] .overview-task',
    )
    .first(),
).toHaveAttribute("data-task-id", "demo-30");
await page.screenshot({ path: out + "/overview-vallum.png" });
for (const theme of ["vallum", "abyssus"]) {
  await page.evaluate(
    (value) => window.samayaTheme.setPreference(value),
    theme,
  );
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    axe.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
await page.screenshot({ path: out + "/overview-abyssus.png" });
await page.evaluate(
  (value) => window.samayaTheme.setPreference(value),
  "vallum",
);
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await expect(page.locator('[data-task-id="demo-30"]')).toContainText("后台");
await page.locator('[data-task-id="demo-6"] .task-open').click();
await expect(page.locator(".message.user")).toBeVisible();
await expect(page.locator(".task-live-status")).toContainText("后台运行 1");
const axis = await page.evaluate(() => {
  const box = (s) => {
    const b = document.querySelector(s).getBoundingClientRect();
    return { x: b.x, width: b.width };
  };
  return {
    title: box(".task-title-status"),
    body: box(".history-view .message:not(.user)"),
    composer: box(".task-composer"),
  };
});
expect(axis.title.width).toBe(880);
expect(axis.body.x).toBe(axis.title.x);
expect(axis.composer.x).toBe(axis.title.x);
expect(axis.composer.width).toBe(880);
const input = page.getByLabel("补充当前任务", { exact: true });
await input.fill("草稿保持");
await page.getByRole("button", { name: "改动与产物", exact: true }).click();
await expect(page.getByRole("region", { name: "改动与结果" })).toBeVisible();
await expect(input).toHaveValue("草稿保持");
await page.getByRole("button", { name: "对话", exact: true }).click();
await expect(input).toHaveValue("草稿保持");
const assets = await page.locator('img[src^="/figma/"]').evaluateAll((nodes) =>
  nodes.map((n) => ({
    src: n.getAttribute("src"),
    loaded: n.complete && n.naturalWidth > 0,
    width: n.getBoundingClientRect().width,
    natural: n.naturalWidth,
  })),
);
expect(assets.every((a) => a.loaded && Math.abs(a.width - a.natural) < 1)).toBe(
  true,
);
await input.fill("$");
await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(12);
const menu = await page.locator(".composer-popup").boundingBox(),
  composer = await page.locator(".task-composer").boundingBox();
expect(menu.height).toBe(234);
expect(menu.width).toBe(composer.width);
expect(composer.y - menu.y - menu.height).toBe(4);
expect(
  await page
    .getByRole("listbox")
    .getByRole("option")
    .first()
    .evaluate((el) => el.getBoundingClientRect().height),
).toBe(28);
await page.screenshot({ path: out + "/skills-vallum.png" });
await input.press("ArrowDown");
await input.press("Enter");
await expect(input).toHaveValue("$python-poetry ");
await input.fill("$python-poetry $");
await input.press("Enter");
await expect(page.locator(".composer-references summary")).toContainText("＋1");
await page.locator(".composer-references summary").click();
await expect(page.getByRole("button", { name: "移除 技能 0" })).toBeVisible();
await page.getByRole("button", { name: "移除 技能 0" }).click();
await page.locator(".composer-references summary").click();
await input.fill("/");
await page.screenshot({ path: out + "/commands-vallum.png" });
await input.press("Escape");
await input.fill("");
for (const width of [1440, 768, 390, 320]) {
  await page.setViewportSize({ width, height: 960 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${out}/workspace-${width}.png` });
}
await page.setViewportSize({ width: 390, height: 480 });
await input.fill("长文本\n".repeat(40));
expect((await input.boundingBox()).height).toBeLessThanOrEqual(160);
expect(
  (await page.locator(".detail-footer").boundingBox()).y +
    (await page.locator(".detail-footer").boundingBox()).height,
).toBeLessThanOrEqual(480);
state.connection = "disconnected";
await broadcast();
await expect(input).toBeDisabled();
await expect(page.locator(".task-live-status")).toContainText("待确认");
expect(calls).toHaveLength(0);
expect(errors).toEqual([]);
writeFileSync(
  out + "/report.json",
  JSON.stringify(
    { axis, menu, composer, assets, errors, noMutations: true },
    null,
    2,
  ),
);
await browser.close();
console.log(
  "v6 overview, monitoring, axis, tabs, compact menus and responsive checks passed",
);
