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
  const { calls } = await install(context, fixture(16));
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
  await page.reload();
  await expect(
    page.getByRole("button", { name: "苍渊 ✓", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "白垣", exact: true }).click();
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
  await expect(
    page.getByRole("meter", { name: "5 小时额度剩余" }),
  ).toHaveAttribute("aria-valuenow", "68");
  await expect(
    page.getByRole("meter", { name: "每周额度剩余" }),
  ).toHaveAttribute("aria-valuenow", "17");
  await expect(page.getByText("62,500 credits", { exact: true })).toBeVisible();
  await expect(page.getByText("可用重置次数 1")).toBeVisible();
  await page.screenshot({ path: out + "/usage-vallum.png" });
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `${out}/usage-${theme}.png` });
  }
  fail = true;
  await page.getByRole("button", { name: "刷新 ↻" }).click();
  await expect(page.getByRole("alert")).toContainText("保留上次确认的数据");
  await expect(page.getByText("62,500 credits", { exact: true })).toBeVisible();
  fail = false;
  data.rateLimitsByLimitId.codex.primary.usedPercent = 100;
  data.rateLimitsByLimitId.codex.secondary.usedPercent = null;
  data.rateLimitsByLimitId.codex.credits.balance = "0";
  data.rateLimitResetCredits.availableCount = 0;
  await page.getByRole("button", { name: "刷新 ↻" }).click();
  await expect(
    page.getByRole("meter", { name: "5 小时额度剩余" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("meter", { name: "每周额度剩余" })).toHaveCount(
    0,
  );
  await expect(page.getByText("0 credits", { exact: true })).toBeVisible();
  await expect(page.getByText("可用重置次数 0")).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("link", { name: "查看重置选项 →" })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("link", { name: "查看重置选项 →" }),
    ).toBeInViewport();
    await page.screenshot({ path: `${out}/usage-${width}.png` });
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "使用情况", exact: true }),
  ).toBeVisible();
  expect(calls).toHaveLength(0);
  expect(reads).toBeGreaterThan(2);
  expect(errors).toEqual([]);
  console.log(
    "Settings-only persistent themes, exact logo, account data, failures, unknown/zero quotas, direct route, dual-theme accessibility and mobile layout passed.",
  );
} finally {
  await browser.close();
}
