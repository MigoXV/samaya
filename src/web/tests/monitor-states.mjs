import { chromium, expect } from "@playwright/test";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const cases = [];
const url = process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:5175";
async function scenario(name, alter, check) {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    state = fixture();
  alter(state);
  const controls = await install(context, state),
    page = await context.newPage();
  await page.goto(url);
  await page
    .getByRole("button", { name: "查看全部任务 →", exact: true })
    .click();
  await check(page, state, controls, context);
  cases.push(name);
  await context.unrouteAll({ behavior: "wait" });
  await context.close();
}
await scenario(
  "empty",
  (s) => {
    s.records = [];
    s.pendingRequests = [];
  },
  async (p) =>
    expect(
      p.getByText("暂无可见会话。新建任务后在这里观察进展。"),
    ).toBeVisible(),
);
await scenario(
  "initial-loading",
  (s) => {
    s.initialized = false;
    s.records = [];
  },
  async (p) => expect(p.getByText("正在取得全局会话状态…")).toBeVisible(),
);
await scenario(
  "catalog-failure-not-empty",
  (s) => {
    s.initialized = false;
    s.catalogError = "全局读取失败";
    s.records = [];
  },
  async (p) => {
    await expect(p.getByText("无法加载任务。请重新核对连接。")).toBeVisible();
    await expect(p.getByText("暂无可见会话。")).toHaveCount(0);
  },
);
await scenario(
  "old-backend-monitor-404-is-actionable",
  () => {},
  async (p, s, c, context) => {
    await p.getByRole("list").waitFor();
    await context.route("**/api/monitor", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "API route not found: /api/monitor" }),
      }),
    );
    await p.reload();
    await expect(p.getByText(/当前后端缺少任务总览接口/)).toBeVisible();
    await expect(p.getByText(/暂无可见会话/)).toHaveCount(0);
    expect(c.calls).toHaveLength(0);
  },
);
await scenario(
  "no-search-results",
  () => {},
  async (p) => {
    await p.getByRole("list").waitFor();
    await p.getByRole("searchbox").fill("不存在的项目说明");
    await expect(p.getByText("没有符合筛选条件的任务。")).toBeVisible();
  },
);
await scenario(
  "disconnect-preserves-state",
  (s) => {
    s.connection = "disconnected";
  },
  async (p) => {
    await p.getByRole("list").waitFor();
    await expect(p.locator(".monitor-banner")).toHaveCount(0);
    await p.locator(".connection-notice summary").click();
    await expect(
      p.getByText("连接已断开或正在恢复。保留最后确认状态，不代表执行已停止。"),
    ).toBeVisible();
    await expect(
      p.getByRole("button", { name: "新建任务", exact: true }),
    ).toBeDisabled();
    await expect(p.locator(".task-row").first()).toContainText("执行中");
  },
);
await scenario(
  "uncertain-operation-is-scoped-and-survives-refresh",
  () => {},
  async (p, s, c, context) => {
    await p.getByRole("list").waitFor();
    let requests = 0;
    await context.route("**/api/operations", async (route) => {
      requests++;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "结果待确认" }),
      });
    });
    await p.locator('[data-task-id="demo-0"] .task-open').click();
    await p.getByLabel("补充当前任务", { exact: true }).fill("只发送一次");
    await p.getByRole("button", { name: "追加指令" }).click();
    await expect(
      p.getByRole("button", { name: "1 项操作待核查" }),
    ).toBeVisible();
    await p.reload();
    await p.getByRole("button", { name: "1 项操作待核查" }).waitFor();
    expect(requests).toBe(1);
    await expect(p.getByRole("button", { name: "追加指令" })).toBeDisabled();
    expect(requests).toBe(1);
    await returnToOverview(p);
    await p.locator('[data-task-id="demo-3"] .task-open').click();
    await p.getByLabel("补充当前任务", { exact: true }).fill("另一任务要求");
    await p.getByRole("button", { name: "追加指令" }).click();
    await expect.poll(() => requests).toBe(2);
  },
);
await scenario(
  "mcp-typed-fields-and-unspecified-boolean",
  (s) => {
    const p = s.pendingRequests.find((p) => p.key === "req-7");
    p.mcp = {
      mode: "form",
      schema: p.params.requestedSchema,
      toolApproval: false,
    };
  },
  async (p, s, c) => {
    await p.getByRole("list").waitFor();
    await p
      .locator('[data-task-id="demo-7"]')
      .getByRole("button", { name: /处理 MCP 请求/ })
      .click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: /处理 MCP 请求.*demo-reports/ })
      .click();
    await expect(p.getByRole("spinbutton")).toBeVisible();
    const bool = p.getByLabel(/附带备注/);
    await expect(bool).toHaveValue("");
    await p.getByRole("dialog").getByLabel(/标题/).fill("演示标题");
    await p.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect.poll(() => c.calls.length).toBe(1);
    expect(c.calls[0].body.response.content).not.toHaveProperty("includeNotes");
  },
);
await scenario(
  "identity-expired",
  () => {},
  async (p, s, c, context) => {
    await p.getByRole("list").waitFor();
    await context.route("**/api/monitor", (r) =>
      r.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "请先登录" }),
      }),
    );
    await p.evaluate(() => window.__emit("snapshot", {}));
    await expect(
      p.getByRole("heading", { name: "进入工作空间" }),
    ).toBeVisible();
    expect(c.calls).toHaveLength(0);
  },
);

await scenario(
  "sent-request-awaits-native-resolution",
  (s) => {
    s.pendingRequests[0].responseState = "sent";
  },
  async (p, s, c) => {
    await p.getByRole("list").waitFor();
    await p
      .locator('[data-task-id="demo-0"]')
      .getByRole("button", { name: /等待答复确认/ })
      .click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: /等待答复确认.*去重范围/ })
      .click();
    await expect(
      p.getByRole("button", { name: "确认 →", exact: true }),
    ).toBeDisabled();
    await expect(p.getByText("答复已发送；等待服务端消除请求。")).toBeVisible();
    s.pendingRequests = s.pendingRequests.filter((r) => r.key !== "req-0");
    await c.broadcast();
    await expect(
      p.getByText(
        "请求已处理、失效或连接已变化。请核对最新任务状态，不能重复授权。",
      ),
    ).toBeVisible();
    expect(c.calls).toHaveLength(0);
  },
);
await scenario(
  "terminate-only-selected-background-command",
  (s) => {
    s.records[6].terminals.push({
      processId: "keep-running",
      itemId: "other",
      command: "other-command",
    });
  },
  async (p, s, c) => {
    await p.getByRole("list").waitFor();
    await p.locator('[data-task-id="demo-6"] .task-open').click();
    p.on("dialog", (d) => d.accept());
    await p.locator(".related-activities > summary").click();
    await p
      .locator(".terminal-entry")
      .first()
      .getByRole("button", { name: "终止此命令" })
      .click();
    await expect(p.locator(".terminal-entry")).toHaveCount(1);
    await expect(p.locator(".terminal-entry")).toContainText("other-command");
    expect(c.calls[0].body.processId).toBe("proc-6");
  },
);
await scenario(
  "batch-partial-failure-is-itemized",
  () => {},
  async (p, s, c, context) => {
    await p.getByRole("list").waitFor();
    await p.getByRole("button", { name: "导航", exact: true }).click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "记录管理", exact: true })
      .click();
    await p
      .getByRole("checkbox", {
        name: "选择 [演示] 复核语音推理异常",
        exact: true,
      })
      .check();
    await p
      .getByRole("checkbox", { name: "选择 [演示] 生成报告目录", exact: true })
      .check();
    await context.route("**/api/operations", async (route) => {
      const op = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          operationId: op.operationId,
          state: op.body.threadId === "demo-1" ? "failed" : "succeeded",
          result:
            op.body.threadId === "demo-1"
              ? { message: "演示：仍有后台命令" }
              : {},
        }),
      });
    });
    await p.getByRole("button", { name: "删除", exact: true }).click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "确认删除", exact: true })
      .click();
    await expect(
      p.getByText("demo-1：Error: 操作失败：演示：仍有后台命令", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(p.getByText("demo-10：已确认", { exact: true })).toBeVisible();
  },
);

await scenario(
  "initial-connection-is-not-an-outage",
  (s) => {
    s.connection = "connecting";
    s.initialized = false;
  },
  async (p) => {
    await expect(
      p.getByText("正在取得全局会话状态…", { exact: true }),
    ).toBeVisible();
    await expect(p.locator(".monitor-banner")).toHaveCount(0);
    await expect(p.locator(".connection-notice")).toHaveCount(0);
    await expect(p.locator(".nav-bottom")).toContainText("正在连接…");
  },
);

mkdirSync("../../.samaya/workflow-v3", { recursive: true });
writeFileSync(
  "../../.samaya/workflow-v3/states.json",
  JSON.stringify({ isolated: true, cases }, null, 2),
);
console.log(JSON.stringify({ cases }));
await browser.close();
