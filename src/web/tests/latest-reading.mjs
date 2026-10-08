import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const state = fixture();
await install(context, state);
const requests = [];
let releaseOlder;
const olderGate = new Promise((resolve) => {
  releaseOlder = resolve;
});
let olderRequested = false;
let turnsReturned = false,
  earlyLatest = false;
const pageItems = (prefix) =>
  Array.from({ length: 20 }, (_, i) => ({
    item: {
      id: `${prefix}-${i}`,
      type: "agentMessage",
      text:
        `${prefix}记录 ${i}\n\n` +
        "用于核对阅读位置和分页的内容。\n\n".repeat(5),
    },
  }));
await context.route("**/api/threads/*/turns?*", async (route) => {
  const url = new URL(route.request().url());
  requests.push(url.pathname + url.search);
  if (!url.searchParams.has("cursor")) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    turnsReturned = true;
    await route.fulfill({
      json: {
        data: [{ id: "turn-0", status: "inProgress", items: [] }],
        nextCursor: "older-turns",
      },
    });
  } else
    await route.fulfill({
      json: {
        data: [{ id: "turn-old", status: "completed", items: [] }],
        nextCursor: null,
      },
    });
});
await context.route("**/api/threads/*/turns/*/items?*", async (route) => {
  const url = new URL(route.request().url());
  requests.push(url.pathname + url.search);
  if (url.pathname.includes("turn-0") && !url.searchParams.has("cursor")) {
    if (!turnsReturned) earlyLatest = true;
    await route.fulfill({
      json: {
        data: pageItems("latest"),
        nextCursor: "older-items",
        samayaCursor: 0,
      },
    });
  } else {
    if (url.searchParams.get("cursor") === "older-items") {
      olderRequested = true;
      await olderGate;
    }
    await route.fulfill({
      json: { data: pageItems("older"), nextCursor: null, samayaCursor: 0 },
    });
  }
});
const page = await context.newPage();
await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await page.locator('[data-task-id="demo-0"] .task-open').click();
await expect(page.locator('[data-item-id="latest-0"]')).toBeVisible();
expect(earlyLatest).toBe(true);
const reader = page.locator(".detail-scroll");
const distance = () =>
  reader.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
await expect.poll(distance).toBeLessThan(2);
await expect(page.getByRole("button", { name: /加载更早/ })).toHaveCount(0);
await expect(page.locator(".latest-position")).toHaveCount(0);
await expect(page.locator(".jump-latest")).toHaveCount(0);
expect(
  requests.every(
    (url) => !url.includes("cursor=") && !url.includes("turn-old"),
  ),
).toBe(true);
expect(
  requests
    .filter((url) => url.includes("/items"))
    .every((url) => url.includes("limit=100")),
).toBe(true);
await reader.evaluate((el) => (el.scrollTop -= 400));
await expect.poll(distance).toBeGreaterThan(390);
await expect(page.locator(".jump-latest")).toHaveCount(0);
const marker = page.locator('[data-item-id="latest-19"]');
await reader.evaluate((el) => (el.scrollTop = 0));
const before = (await marker.boundingBox()).y;
await expect.poll(() => olderRequested).toBe(true);
await page.evaluate(() =>
  window.__emit(
    "message",
    {
      method: "item/completed",
      params: {
        threadId: "demo-0",
        turnId: "turn-0",
        item: {
          id: "concurrent-tail",
          type: "agentMessage",
          text: "补历史期间到来的实时输出。\n\n".repeat(40),
        },
      },
    },
    90,
  ),
);
await expect(page.locator('[data-item-id="concurrent-tail"]')).toHaveCount(1);
releaseOlder();
await expect(page.locator('[data-item-id="older-19"]')).toHaveCount(1);
await expect
  .poll(async () => Math.abs((await marker.boundingBox()).y - before))
  .toBeLessThan(2);
await page.getByRole("button", { name: "返回最新消息", exact: true }).click();
await expect.poll(distance).toBeLessThan(2);
await expect(page.locator(".jump-latest")).toHaveCount(0);
// Stay pinned when the live tail grows, but leave a reader of older content alone.
await page.evaluate(() =>
  window.__emit(
    "message",
    {
      method: "item/completed",
      params: {
        threadId: "demo-0",
        turnId: "turn-0",
        item: {
          id: "live-tail",
          type: "agentMessage",
          text: "新尾部\n\n".repeat(30),
        },
      },
    },
    100,
  ),
);
await expect(page.locator('[data-item-id="live-tail"]')).toHaveCount(1);
await expect.poll(distance).toBeLessThan(2);
await reader.evaluate((el) => (el.scrollTop -= 500));
const top = await reader.evaluate((el) => el.scrollTop);
await page.evaluate(() =>
  window.__emit(
    "message",
    {
      method: "item/completed",
      params: {
        threadId: "demo-0",
        turnId: "turn-0",
        item: {
          id: "live-next",
          type: "agentMessage",
          text: "继续输出\n\n".repeat(30),
        },
      },
    },
    101,
  ),
);
await expect(page.locator('[data-item-id="live-next"]')).toHaveCount(1);
expect(
  Math.abs((await reader.evaluate((el) => el.scrollTop)) - top),
).toBeLessThan(2);
await reader.evaluate((el) => (el.scrollTop = 0));

await expect(page.locator('[data-turn-id="turn-old"]')).toHaveCount(1);
expect(requests.some((url) => url.includes("limit=1&cursor=older-turns"))).toBe(
  true,
);
// Re-entering the workspace starts at the newest tail, even after an earlier visit.
await page
  .locator(".monitor-nav-items")
  .getByRole("button", { name: "任务总览", exact: true })
  .click();
await page.getByRole("button", { name: "查看全部任务 →", exact: true }).click();
await page.locator('[data-task-id="demo-0"] .task-open').click();
await expect.poll(distance).toBeLessThan(2);
await expect(page.locator('[data-turn-id="turn-old"]')).toHaveCount(0);
console.log(
  "Latest content loads before turn metadata; tail entry, far-only jump, paging anchors and live-follow behavior passed.",
);
await browser.close();
