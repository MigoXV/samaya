import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  const record = state.records.find((r) => r.thread.id === "demo-5");
  record.thread.status = { type: "idle" };
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Date.now());
  const start = Date.parse(day + "T14:00:00+08:00") / 1000;
  const current = {
    id: "turn-5",
    status: "completed",
    startedAt: start,
    completedAt: start + 30,
    items: [],
  };
  const middle = {
    id: "middle",
    status: "completed",
    startedAt: start - 3719,
    completedAt: start - 3599,
    items: [],
  };
  const oldest = {
    id: "oldest",
    status: "completed",
    startedAt: middle.startedAt - 3720,
    completedAt: middle.startedAt - 3600,
    items: [],
  };
  const turns = [current, middle, oldest];
  record.turn = current;
  await install(context, state);
  await context.route("**/api/threads/demo-5/turns?*", (r) =>
    r.fulfill({ json: { data: turns, nextCursor: null } }),
  );
  await context.route("**/api/threads/demo-5/turns/*/items*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[5];
    const turn = turns.find((t) => t.id === id);
    return route.fulfill({
      json: {
        data: [
          {
            item: {
              id: id + "-answer",
              type: "agentMessage",
              phase: "final_answer",
              text: "已核对结果。",
            },
            completedAtMs: turn.completedAt * 1000,
          },
          {
            item: { id: id + "-user", type: "userMessage", text: "要求 " + id },
            startedAtMs: turn.startedAt * 1000,
          },
        ],
        nextCursor: null,
        samayaCursor: 0,
      },
    });
  });
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "https://127.0.0.1:8765");
  await page.locator('[data-task-id="demo-5"]').click();
  await expect(page.locator('[data-item-id="oldest-user"]')).toBeVisible();
  await expect(
    page.locator('[data-turn-id="oldest"] .conversation-time'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-turn-id="middle"] .conversation-time'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-turn-id="turn-5"] .conversation-time'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-turn-id="middle"] .conversation-time time'),
  ).toHaveAttribute(
    "datetime",
    new Date(middle.startedAt * 1000).toISOString(),
  );
  await expect(
    page.locator('[data-turn-id="middle"] .conversation-time'),
  ).toContainText("今天");
  await page.reload();
  await expect(page.locator('[data-item-id="oldest-user"]')).toBeVisible();
  await expect(page.locator(".conversation-time")).toHaveCount(2);
  console.log(
    "Conversation timestamps: preserved item metadata, local-time labels, one-hour boundaries across loaded turns, pagination reconciliation and reload passed",
  );
} finally {
  await browser.close();
}
