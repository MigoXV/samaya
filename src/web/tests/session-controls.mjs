import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture(36);
  state.pendingRequests = [];
  const { calls, broadcast } = await install(context, state);
  let failure = true;
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    if (op.action === "send" && failure) {
      calls.push(op);
      return route.fulfill({
        json: {
          operationId: op.operationId,
          state: "failed",
          result: { message: "首条消息拒绝（测试）" },
        },
      });
    }
    return route.fallback();
  });
  await context.route("**/command-context?command=status", (route) =>
    route.fulfill({
      json: {
        readOnly: true,
        data: {
          cwd: "/demo/Laya",
          model: "fixture-model",
          reasoningEffort: "low",
          serviceTier: "default",
          observedAt: Date.now() / 1000,
          tokenUsage: {
            observedAt: Date.now() / 1000,
            usage: {
              total: {
                totalTokens: 2500,
                inputTokens: 2000,
                cachedInputTokens: 1000,
                outputTokens: 500,
              },
              last: { totalTokens: 500 },
              modelContextWindow: 4000,
            },
          },
          rateLimits: {
            rateLimits: {
              primary: {
                usedPercent: 20,
                windowDurationMins: 300,
                resetsAt: Math.floor(Date.now() / 1000) + 3600,
              },
            },
          },
        },
      },
    }),
  );
  await context.route("**/api/input-catalog?*", (route) =>
    route.fulfill({
      json: {
        references: [],
        commands: [
          {
            name: "status",
            description: "会话配置与用量",
            kind: "native",
            enabled: true,
          },
        ],
        prompts: [],
        errors: [],
      },
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8787");
  await expect(
    page.getByRole("button", { name: "查看全部任务 →", exact: true }),
  ).toHaveCount(0);
  const group = page.locator(
    '.overview-workspace[data-workspace="/demo/Laya"]',
  );
  await expect(group).toHaveClass(/workspace-running/);
  await group.locator(".workspace-toggle").click();
  await expect(group.locator(".workspace-tasks")).toBeHidden();
  await expect(group.locator(".workspace-metadata")).toContainText("运行中");
  await group.locator(".workspace-create").click();
  const input = page.getByRole("textbox", {
    name: "新会话工作要求",
    exact: true,
  });
  await expect(page.locator(".model-trigger")).toContainText("Fixture model");
  await input.fill("首条消息草稿不会丢失");
  await input.press("Alt+,");
  await expect(page.locator(".model-effort")).toHaveText("轻度");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("首条消息草稿不会丢失");
  await input.press("Alt+,");
  await expect(page.locator(".model-effort")).toHaveText("轻度");
  await input.press("Alt+.");
  await expect(page.locator(".model-effort")).toHaveText("标准");
  await input.press("Alt+,");
  await input.press("Enter");
  await expect
    .poll(() => calls.filter((c) => c.action === "create").length)
    .toBe(1);
  expect(
    calls.find((c) => c.action === "create").body.modelSettings.reasoningEffort,
  ).toBe("low");
  await expect(page.locator(".operation-feedback[role=status]")).toContainText(
    "任务已创建，但执行提交未确认",
  );
  await expect(page.locator(".operation-feedback[role=alert]")).toContainText(
    "首条消息拒绝",
  );
  const known = page.getByRole("textbox", {
    name: "补充当前任务",
    exact: true,
  });
  await expect(known).toHaveValue("首条消息草稿不会丢失");
  failure = false;
  await known.press("Enter");
  await expect(known).toHaveValue("");
  expect(calls.filter((c) => c.action === "create")).toHaveLength(1);
  const before = calls.length;
  await known.fill("/status");
  await known.press("Enter");
  const status = page.getByRole("status", { name: "会话状态与用量" });
  await expect(status).toContainText("2,500");
  await expect(status).toContainText("剩余 88%");
  await expect(status).toContainText("剩余 80%");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls).toHaveLength(before);
  await page.reload();
  await expect(status).toContainText("2,500");
  const nav = page.locator(".nav-workspaces");
  const laya = nav.locator('[data-sidebar-workspace="/demo/Laya"]');
  await expect(laya.locator(".nav-workspace-threads")).toBeVisible();
  await expect(laya.locator(".nav-workspace-threads > button")).toHaveCount(11);
  await laya.getByRole("button", { name: /再显示/ }).click();
  await expect(laya.locator(".nav-workspace-threads > button")).toHaveCount(13);
  await laya.locator(".nav-workspace-threads > button").nth(1).click();
  await expect(page).toHaveURL(/thread=demo-/);
  for (const r of state.records) {
    r.turn && (r.turn.status = "completed");
    r.terminals = [];
    r.thread.status = { type: "idle" };
    r.confirmedAt = Date.now() / 1000;
  }
  await broadcast();
  await expect(laya).not.toHaveClass(/workspace-running/);
  await expect(laya.locator(".conversation-running")).toHaveCount(0);
  const parent = state.records.find((r) => r.thread.id === "demo-1");
  for (const id of ["child-a", "child-b"]) {
    const child = structuredClone(parent);
    child.thread.id = id;
    child.thread.parentThreadId = parent.thread.id;
    child.thread.status = { type: "active" };
    child.turn.status = "inProgress";
    state.records.push(child);
  }
  parent.terminals = [
    { processId: "background", itemId: "cmd", command: "fixture" },
  ];
  await broadcast();
  await expect(laya.locator(".nav-workspace-heading")).toContainText(
    "运行中 1",
  );
  const runningConversation = laya.locator('[data-conversation-id="demo-1"]');
  await expect(runningConversation).toHaveClass(/conversation-running/);
  await expect(
    runningConversation.locator(".nav-conversation-status"),
  ).toHaveText("运行中");
  state.connection = "disconnected";
  await broadcast();
  await expect(laya.locator(".nav-workspace-heading")).toContainText("待确认");
  await expect(laya.locator(".conversation-running")).toHaveCount(0);
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  expect(errors).toEqual([]);
  console.log(
    "Session controls: draft selection, effort boundaries/caret, first-send recovery, inline status/reload, navigation, collapsed activity, themes and narrow screens passed.",
  );
} finally {
  await browser.close();
}
