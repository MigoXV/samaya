import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const { calls } = await install(context, fixture());
  await context.route("**/api/directories?*", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path");
    await route.fulfill({
      status: path === "/missing" ? 409 : 200,
      json:
        path === "/missing"
          ? { detail: "目录不存在或不是文件夹" }
          : { path, parent: "/", data: [] },
    });
  });
  const page = await context.newPage();
  const catalogPaths = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/input-catalog" && u.searchParams.has("cwd"))
      catalogPaths.push(u.searchParams.get("cwd"));
  });
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "https://127.0.0.1:8765");
  await page
    .getByRole("button", { name: "查看全部任务 →", exact: true })
    .click();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const directory = page.getByLabel("服务器目录");
  await directory.fill("/missing");
  await page.getByRole("button", { name: "浏览目录", exact: true }).click();
  await expect(page.locator(".directory-picker [role=alert]")).toContainText(
    "目录不存在",
  );
  await directory.fill("");
  await directory.pressSequentially("/root", { delay: 100 });
  await expect(page.getByLabel("工作要求")).toBeDisabled();
  expect(
    catalogPaths.filter((p) =>
      ["/r", "/ro", "/roo", "/root", "/missing"].includes(p),
    ),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "浏览目录", exact: true }).click();
  await expect(page.getByLabel("工作要求")).toBeEnabled();
  await expect.poll(() => catalogPaths.includes("/root")).toBe(true);
  await page.getByLabel("工作要求").fill("保留 home 工作区草稿");
  await directory.fill("/root/");
  await expect(page.getByLabel("工作要求")).toBeDisabled();
  await expect(page.getByLabel("工作要求")).toHaveValue("保留 home 工作区草稿");
  await page.getByRole("button", { name: "浏览目录", exact: true }).click();
  await expect(page.getByLabel("工作要求")).toBeEnabled();
  await context.route("**/api/operations", async (route) => {
    const operation = route.request().postDataJSON();
    if (operation.action !== "create") return route.fallback();
    await route.fulfill({
      json: {
        operationId: operation.operationId,
        state: "failed",
        result: { message: "创建失败（验收）" },
      },
    });
  });
  await page.getByRole("button", { name: "派发任务", exact: true }).click();
  await expect(page.getByLabel("工作要求")).toHaveValue("保留 home 工作区草稿");
  expect(calls.filter((c) => c.action === "send")).toHaveLength(0);
  await context.close();

  const second = await browser.newContext({ ignoreHTTPSErrors: true });
  const state = fixture();
  const record = state.records[12];
  record.thread.historyAvailable = false;
  record.thread.historyNotice =
    "历史暂时不可用，将自动重试；会话及已有消息已保留。";
  record.thread.status = { type: "idle" };
  record.turn = null;
  record.error = null;
  await install(second, state);
  let goalRequests = 0,
    historyRequests = 0;
  await second.route(
    "**/api/threads/*/command-context?command=goal",
    async (route) => {
      goalRequests++;
      await route.fulfill({
        json: { available: false, readOnly: true, data: { goal: null } },
      });
    },
  );
  await second.route("**/api/threads/*/turns?*", async (route) => {
    historyRequests++;
    await route.fulfill({
      json: {
        data: [],
        nextCursor: null,
        historyAvailable: false,
        historyNotice: record.thread.historyNotice,
      },
    });
  });
  const task = await second.newPage();
  await task.clock.install();
  await task.goto(
    (process.env.SAMAYA_UI_TEST_URL || "https://127.0.0.1:8765") +
      "/?thread=" +
      record.thread.id,
  );
  await expect(task.locator(".task-detail")).toContainText("历史暂时不可用");
  await expect(
    task.getByRole("textbox", { name: "补充当前任务", exact: true }),
  ).toBeDisabled();
  await task.clock.fastForward(65000);
  await expect.poll(() => goalRequests).toBeGreaterThan(1);
  await expect.poll(() => historyRequests).toBeGreaterThan(1);
  await second.close();
  console.log(
    "home 目录确认、输入请求抑制、失败保留草稿及暂时不可用历史自动重试验收通过",
  );
} finally {
  await browser.close();
}
