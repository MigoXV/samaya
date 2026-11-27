import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, install } from "./monitor-fixture.mjs";
import { mkdirSync } from "node:fs";
const out = "../../.samaya/usage-settings";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture(16);
  const { calls } = await install(context, state);
  await context.route("**/api/input-catalog?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json: {
        cwd:
          state.records.find(
            (item) => item.thread.id === params.get("threadId"),
          )?.thread.cwd || params.get("cwd"),
        commands: [
          {
            name: "usage",
            description: "查看账号用量",
            kind: "native",
            enabled: true,
          },
        ],
        references: [],
        prompts: [],
        errors: [],
      },
    });
  });
  await context.route("**/api/usage/account", (route) =>
    route.fulfill({
      json: {
        account: {
          type: "chatgpt",
          displayName: "林晓",
          username: "linxiao",
          email: "linxiao@example.com",
          planType: "pro",
        },
      },
    }),
  );
  const history = {
    summary: {
      lifetimeTokens: 1_280_000_000,
      peakDailyTokens: 24_500_000,
      longestRunningTurnSec: 9960,
      currentStreakDays: 12,
      longestStreakDays: 38,
    },
    dailyUsageBuckets: [
      { startDate: "2026-11-20", tokens: 250_000 },
      { startDate: "2026-11-26", tokens: 0 },
      { startDate: "2026-11-27", tokens: 24_500_000 },
    ],
    updatedAt: Date.parse("2026-11-27T16:00:00Z") / 1000,
  };
  let historyUnavailable = false;
  await context.route("**/api/usage/history", (route) =>
    route.fulfill(
      historyUnavailable ? { status: 501, json: {} } : { json: history },
    ),
  );
  const data = {
    rateLimits: {
      planType: "pro",
      primary: { usedPercent: 99, windowDurationMins: 300 },
    },
    rateLimitsByLimitId: {
      codex: {
        planType: "pro",
        primary: {
          usedPercent: 32,
          windowDurationMins: 300,
          resetsAt: Date.now() / 1000 + 3600,
        },
        secondary: { usedPercent: 83, windowDurationMins: 10080 },
        credits: { balance: "62500", hasCredits: true, unlimited: false },
      },
    },
    rateLimitResetCredits: { availableCount: 1 },
    updatedAt: Date.now() / 1000,
  };
  let fail = false,
    reads = 0;
  await context.route("**/api/usage", (route) => {
    reads++;
    return route.fulfill(
      fail ? { status: 503, json: { detail: "用量暂不可用" } } : { json: data },
    );
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
  await expect(page.locator(".monitor-nav .theme-control")).toHaveCount(0);
  const logo = page.locator(".monitor-brand img");
  await expect(logo).toHaveAttribute("src", "/figma/samaya-symbol-abyssus.svg");
  await expect(logo).toHaveCSS("background-color", "rgb(17, 24, 32)");
  await expect(logo).toHaveCSS("border-radius", "3px");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/favicon.svg?v=3",
  );
  expect(
    await logo.evaluate((el) => ({
      loaded: el.complete && el.naturalWidth > 0,
      width: el.getBoundingClientRect().width,
      natural: el.naturalWidth,
    })),
  ).toEqual({ loaded: true, width: 24, natural: 24 });
  await page.getByRole("button", { name: "设置与连接", exact: true }).click();
  await expect(page.getByRole("group", { name: "主题" })).toBeVisible();
  await page.getByRole("button", { name: "苍渊", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "abyssus");
  await expect(logo).toHaveCSS("background-color", "rgb(17, 24, 32)");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "苍渊 ✓", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "白垣", exact: true }).click();
  await expect(logo).toHaveCSS("background-color", "rgb(17, 24, 32)");
  await expect
    .poll(() =>
      page
        .locator(".theme-buttons")
        .evaluate((el) => getComputedStyle(el).display),
    )
    .toBe("flex");
  const themeLayout = await page
    .locator(".theme-buttons button")
    .evaluateAll((nodes) => nodes.map((el) => el.getBoundingClientRect().y));
  expect(new Set(themeLayout).size).toBe(1);
  await page.screenshot({ path: out + "/settings.png" });
  await page.getByRole("button", { name: "查看使用情况 →" }).click();
  await expect(page).toHaveURL(/\/settings\/usage$/);
  await expect(page.getByRole("tab", { name: "总览" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("林晓", { exact: true })).toBeVisible();
  await expect(page.getByText("@linxiao · Pro", { exact: true })).toBeVisible();
  await expect(
    page.getByText("linxiao@example.com", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1.28B", { exact: true })).toBeVisible();
  await expect(page.getByText("24.5M", { exact: true })).toBeVisible();
  const calendar = page.getByRole("group", { name: "每日 Token 活动" });
  await calendar.getByRole("button", { name: /11月20日.*250,000 Token/ }).click();
  await expect(page.getByText(/11月20日.*· 250K Token/)).toBeVisible();
  const zeroDay = calendar.getByRole("button", { name: /11月26日.*，0 Token/ });
  await zeroDay.click();
  await expect(page.getByText(/11月26日.*· 0 Token/)).toBeVisible();
  await zeroDay.press("ArrowUp");
  await expect(
    calendar.getByRole("button", { name: /11月25日.*无数据/ }),
  ).toBeFocused();
  await page.getByRole("button", { name: "按周" }).click();
  await expect(page.getByText("每周 Token 总量 · 查看数据")).toBeVisible();
  await page.getByRole("button", { name: "累计" }).click();
  await expect(page.getByText("区间累计 Token · 查看数据")).toBeVisible();
  await page.getByRole("button", { name: "按日" }).click();
  await page.screenshot({ path: out + "/overview-vallum.png" });
  await page.getByRole("tab", { name: "用量", exact: true }).click();
  await page.getByRole("button", { name: "近 30 天" }).click();
  await expect(page.locator(".usage-bar")).toHaveCount(30);
  await page.getByRole("button", { name: "近 7 天" }).click();
  await expect(page.locator(".usage-bar")).toHaveCount(7);
  await expect(page.locator(".usage-plot-ruler span")).toHaveText([
    "27M",
    "18M",
    "9M",
    "0",
  ]);
  await expect(
    page.getByRole("meter", { name: "5 小时额度剩余" }),
  ).toHaveAttribute("aria-valuenow", "68");
  await expect(
    page.getByRole("meter", { name: "每周额度剩余" }),
  ).toHaveAttribute("aria-valuenow", "17");
  await expect(
    page.getByText("余额 62,500 credits", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("可用重置次数 1")).toBeVisible();
  await page.screenshot({ path: out + "/usage-vallum.png" });
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `${out}/usage-${theme}.png` });
    await page.getByRole("tab", { name: "总览" }).click();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `${out}/overview-${theme}.png` });
    await page.getByRole("tab", { name: "用量", exact: true }).click();
  }
  fail = true;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保留上次确认的数据");
  await expect(
    page.getByText("余额 62,500 credits", { exact: true }),
  ).toBeVisible();
  fail = false;
  data.rateLimitsByLimitId.codex.primary.usedPercent = 100;
  data.rateLimitsByLimitId.codex.secondary.usedPercent = null;
  data.rateLimitsByLimitId.codex.credits.balance = "0";
  data.rateLimitResetCredits.availableCount = 0;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    page.getByRole("meter", { name: "5 小时额度剩余" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("meter", { name: "每周额度剩余" })).toHaveCount(
    0,
  );
  await expect(page.getByText("余额 0 credits", { exact: true })).toBeVisible();
  await expect(page.getByText("可用重置次数 0")).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("link", { name: "账户管理 ↗" })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("link", { name: "账户管理 ↗" }),
    ).toBeInViewport();
    await page.screenshot({ path: `${out}/usage-${width}.png` });
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "使用情况", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("linxiao@example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /11月27日.*Token/ }),
  ).toBeInViewport();
  await page.screenshot({ path: out + "/overview-320.png" });
  historyUnavailable = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "当前 Codex 服务不支持读取历史用量",
  );
  await expect(
    page.getByText("linxiao@example.com", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "用量", exact: true }).click();
  await expect(
    page.getByRole("meter", { name: "5 小时额度剩余" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回" }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(new URL("/?thread=demo-10", page.url()).href);
  const input = page.getByRole("textbox", { name: "补充当前任务" });
  await input.fill("保留草稿\n/usage");
  await expect(page.getByRole("option", { name: /\/usage/ })).toBeVisible();
  await input.press("Enter");
  await expect(page).toHaveURL(/\/settings\/usage\?thread=demo-10$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "返回" }).click();
  await expect(page).toHaveURL(/\/\?thread=demo-10$/);
  await expect(input).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("samaya.draft.demo-10")),
    )
    .toBe("保留草稿\n");
  expect(calls).toHaveLength(0);
  expect(reads).toBeGreaterThan(2);
  expect(errors).toEqual([]);
  console.log(
    "Usage dashboard: account identity, day/week/cumulative activity, ranges, stale and unavailable data, two entry points, dual-theme accessibility and mobile layout passed.",
  );
} finally {
  await browser.close();
}
