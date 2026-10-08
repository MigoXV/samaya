import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const screenshots = fileURLToPath(
  new URL("../../../.samaya/history-pagination/", import.meta.url),
);
mkdirSync(screenshots, { recursive: true });
import AxeBuilder from "@axe-core/playwright";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const url = process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765";
const tools = (page) =>
  Array.from({ length: 100 }, (_, i) => ({
    item: {
      id: `tool-${page}-${i}`,
      type: "commandExecution",
      command: `check-${page}-${i}`,
      status: "completed",
      exitCode: 0,
    },
  }));
async function setup(width = 1440) {
  const context = await browser.newContext({
    viewport: { width, height: 960 },
  });
  await install(context, fixture());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, errors };
}
async function open(page) {
  await page.goto(url);
  await page
    .getByRole("button", { name: "查看全部任务 →", exact: true })
    .click();
  await page.locator('[data-task-id="demo-0"] .task-open').click();
}
// Tool-only and empty pages must advance through the same turn before admitting older turns.
{
  const { context, page, errors } = await setup();
  const calls = [];
  await context.route("**/api/threads/demo-0/turns?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    calls.push(cursor ? "older-turn" : "latest-turn");
    return route.fulfill({
      json: {
        data: [
          {
            id: cursor ? "older-turn" : "turn-0",
            status: "completed",
            items: [],
          },
        ],
        nextCursor: cursor ? null : "turn-page",
      },
    });
  });
  await context.route("**/api/threads/demo-0/turns/*/items?*", (route) => {
    const u = new URL(route.request().url());
    const cursor = u.searchParams.get("cursor");
    calls.push(
      cursor ||
        (u.pathname.includes("older-turn") ? "older-items" : "latest-items"),
    );
    expect(u.searchParams.get("limit")).toBe("100");
    if (u.pathname.includes("older-turn"))
      return route.fulfill({
        json: {
          data: [
            {
              item: {
                id: "older-response",
                type: "agentMessage",
                text: "更早轮次的完整回复。\n\n".repeat(80),
              },
            },
            {
              item: {
                id: "older-user",
                type: "userMessage",
                text: "更早的要求。",
              },
            },
          ],
          nextCursor: null,
        },
      });
    const n = cursor ? Number(cursor.slice(1)) : 0;
    return route.fulfill({
      json: {
        data:
          n === 2
            ? []
            : n === 3
              ? [
                  {
                    item: {
                      id: "original-user",
                      type: "userMessage",
                      text: "工具密集轮次的原始要求。",
                    },
                  },
                ]
              : tools(n),
        nextCursor: n < 3 ? `p${n + 1}` : null,
        samayaCursor: 0,
      },
    });
  });
  await open(page);
  await expect(page.locator('[data-item-id="original-user"]')).toBeVisible();
  await expect(page.locator('[data-turn-id="older-turn"]')).toHaveCount(1);
  await expect(page.getByText("已到对话起点", { exact: true })).toBeVisible();
  expect(calls.indexOf("older-turn")).toBeGreaterThan(calls.indexOf("p3"));
  for (const cursor of ["p1", "p2", "p3", "older-turn"])
    expect(calls.filter((c) => c === cursor)).toHaveLength(1);
  await expect(page.getByRole("button", { name: /加载更早/ })).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
}
// Failure pauses automatic loading and retries the exact cursor without discarding visible content.
{
  const { context, page, errors } = await setup(390);
  let attempts = 0;
  await context.route("**/api/threads/demo-0/turns?*", (route) =>
    route.fulfill({
      json: {
        data: [{ id: "turn-0", status: "inProgress", items: [] }],
        nextCursor: null,
      },
    }),
  );
  await context.route("**/api/threads/demo-0/turns/turn-0/items?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (!cursor)
      return route.fulfill({
        json: {
          data: [
            {
              item: {
                id: "current",
                type: "agentMessage",
                text: "当前内容保留，可继续阅读。",
              },
            },
          ],
          nextCursor: "retry-this",
          samayaCursor: 0,
        },
      });
    expect(cursor).toBe("retry-this");
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { detail: "临时不可用" } })
      : route.fulfill({
          json: {
            data: [
              {
                item: {
                  id: "recovered",
                  type: "userMessage",
                  text: "恢复的更早内容。",
                },
              },
            ],
            nextCursor: null,
          },
        });
  });
  await open(page);
  await expect(page.locator(".history-pagination [role=alert]")).toContainText(
    "更早对话加载失败",
  );
  await expect(page.locator('[data-item-id="current"]')).toBeVisible();
  await page.waitForTimeout(350);
  expect(attempts).toBe(1);
  await page.locator(".history-pagination").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshots}/failure-mobile.png` });
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator('[data-item-id="recovered"]')).toBeVisible();
  await expect(page.locator('[data-item-id="current"]')).toBeVisible();
  expect(attempts).toBe(2);
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate(
      (value) => window.samayaTheme.setPreference(value),
      theme,
    );
    await page.screenshot({ path: `${screenshots}/${theme}-mobile.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
      ).violations.map((v) => v.id),
    ).toEqual([]);
  }
  expect(errors).toEqual([]);
  await context.close();
}
// In-flight earlier history belongs to its workspace; navigation aborts it.
{
  const { context, page, errors } = await setup();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let requested = false;
  await context.route("**/api/threads/demo-0/turns?*", (route) =>
    route.fulfill({
      json: {
        data: [{ id: "turn-0", status: "inProgress", items: [] }],
        nextCursor: null,
      },
    }),
  );
  await context.route(
    "**/api/threads/demo-0/turns/turn-0/items?*",
    async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (!cursor)
        return route.fulfill({
          json: { data: tools(0), nextCursor: "slow-page", samayaCursor: 0 },
        });
      requested = true;
      await gate;
      await route
        .fulfill({
          json: {
            data: [
              {
                item: {
                  id: "late-other-task",
                  type: "agentMessage",
                  text: "不应进入其他任务",
                },
              },
            ],
            nextCursor: null,
          },
        })
        .catch(() => {});
    },
  );
  await open(page);
  await expect.poll(() => requested).toBe(true);
  await returnToOverview(page);
  await page.locator('[data-task-id="demo-3"] .task-open').click();
  release();
  await expect(page.locator('[data-turn-id="turn-3"]')).toHaveCount(1);
  await expect(page.locator('[data-item-id="late-other-task"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
}
// Turn-page failures also pause at the unified boundary and retry the same native cursor.
{
  const { context, page } = await setup();
  let attempts = 0;
  await context.route("**/api/threads/demo-0/turns?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (!cursor)
      return route.fulfill({
        json: {
          data: [{ id: "turn-0", status: "completed", items: [] }],
          nextCursor: "older-boundary",
        },
      });
    expect(cursor).toBe("older-boundary");
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { detail: "轮次读取失败" } })
      : route.fulfill({ json: { data: [], nextCursor: null } });
  });
  await open(page);
  await expect(page.locator(".history-pagination [role=alert]")).toBeVisible();
  await page.waitForTimeout(250);
  expect(attempts).toBe(1);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("已到对话起点", { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  await context.close();
}
// A bounded batch stops even when every page is collapsed tools; touch can continue a short viewport.
{
  const { context, page } = await setup(390);
  let earlierRequests = 0;
  await context.route("**/api/threads/demo-0/turns?*", (route) =>
    route.fulfill({
      json: {
        data: [{ id: "turn-0", status: "completed", items: [] }],
        nextCursor: null,
      },
    }),
  );
  await context.route("**/api/threads/demo-0/turns/turn-0/items?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const n = cursor ? Number(cursor.slice(1)) : 0;
    if (cursor) earlierRequests++;
    return route.fulfill({
      json: {
        data:
          n === 8
            ? [
                {
                  item: {
                    id: "after-budget",
                    type: "userMessage",
                    text: "触摸继续恢复原始要求。",
                  },
                },
              ]
            : tools(n),
        nextCursor: n < 8 ? `p${n + 1}` : null,
        samayaCursor: 0,
      },
    });
  });
  await open(page);
  await expect.poll(() => earlierRequests).toBe(6);
  await page.waitForTimeout(250);
  expect(earlierRequests).toBe(6);
  await page.locator(".detail-scroll").evaluate((el) => {
    const event = (name, y) =>
      el.dispatchEvent(
        new TouchEvent(name, {
          touches: [new Touch({ identifier: 1, target: el, clientY: y })],
        }),
      );
    event("touchstart", 200);
    event("touchmove", 250);
  });
  await expect(page.locator('[data-item-id="after-budget"]')).toBeVisible();
  expect(earlierRequests).toBe(8);
  await context.close();
}
await browser.close();
console.log(
  "Unified automatic history: dense/empty pages, chronological boundaries, deduplicated cursors, paused failure/retry, mobile themes, accessibility and navigation cancellation passed.",
);
