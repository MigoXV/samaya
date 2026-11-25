import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  const root = state.records.find((r) => r.thread.id === "demo-5");
  const parentId = root.thread.id;
  const cwd = root.thread.cwd;
  root.thread.status = { type: "active", activeFlags: [] };
  state.records = [
    root,
    {
      ...structuredClone(root),
      thread: { ...root.thread, id: "child", parentThreadId: parentId },
    },
  ];
  state.pendingRequests = [];
  const { broadcast } = await install(context, state);
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "https://127.0.0.1:8765/");
  const workspace = page.locator(`[data-sidebar-workspace="${cwd}"]`);
  const heading = workspace.locator(".nav-workspace-heading");
  const disclosure = heading.locator("button[aria-expanded]").first();
  await expect(workspace).toHaveClass("workspace-running");
  if ((await disclosure.getAttribute("aria-expanded")) !== "true")
    await disclosure.click();
  await expect(heading.locator(".nav-running-indicator")).toHaveCount(0);
  await expect(heading.getByTitle("运行中 1", { exact: true })).toBeVisible();
  const row = workspace.locator(".nav-conversation-row").filter({
    has: page.locator(`[data-conversation-id="${parentId}"]`),
  });
  await expect(row).toHaveClass(/conversation-running/);
  const gap = async () =>
    (await row.boundingBox()).y -
    ((await heading.boundingBox()).y + (await heading.boundingBox()).height);
  await page.mouse.move(1000, 100);
  expect(await gap()).toBe(4);
  await expect(row.locator(".nav-running-indicator svg")).toHaveCSS(
    "animation-name",
    "nav-running-spin",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(row.locator(".nav-running-indicator svg")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  state.pendingRequests = [
    {
      key: "plan-question",
      id: 98,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "child",
        questions: [{ id: "q", question: "请选择方案" }],
      },
    },
  ];
  await broadcast();
  await expect(workspace).toHaveClass("workspace-awaiting");
  await expect(heading).toContainText("待处理 1");
  await expect(row).toHaveClass(/conversation-awaiting/);
  await expect(row.locator(".nav-conversation-status")).toHaveText("待处理");
  for (const theme of ["abyssus", "vallum"]) {
    await page.evaluate(
      (value) => window.samayaTheme.setPreference(value),
      theme,
    );
    expect(await gap()).toBe(4);
    const fill = (locator) =>
      locator.evaluate((node) => getComputedStyle(node).backgroundColor);
    await expect
      .poll(async () => (await fill(row)) === (await fill(heading)))
      .toBe(true);
    expect(await fill(row)).not.toBe("rgba(0, 0, 0, 0)");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (!(await row.isVisible())) {
    await page.getByRole("button", { name: "导航", exact: true }).click();
  }
  await expect(row).toBeVisible();
  expect(await gap()).toBe(4);
  await expect(row.locator(".nav-conversation-status")).toHaveText("待处理");
  await page.setViewportSize({ width: 1440, height: 960 });

  state.records.push({
    ...structuredClone(root),
    thread: { ...root.thread, id: "another-root" },
  });
  await broadcast();
  await expect(heading).toContainText("运行中 1");
  await expect(row.locator(".nav-conversation-status")).toHaveText("待处理");
  const rows = workspace.locator(".nav-conversation-row");
  await expect(rows).toHaveCount(2);
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  expect(second.y - first.y - first.height).toBe(2);
  state.records.pop();
  state.pendingRequests = [];
  await broadcast();
  await expect(row).toHaveClass(/conversation-running/);
  await expect(heading).toContainText("运行中 1");
  state.connection = "disconnected";
  await broadcast();
  await expect(workspace).not.toHaveClass(/workspace-(running|awaiting)/);
  await expect(row).not.toHaveClass(/conversation-(running|awaiting)/);
  await expect(heading).toContainText("待确认");
  console.log(
    "Sidebar: 4px gap, child request attribution, retained highlight, resumed activity and disconnected state",
  );
} finally {
  await browser.close();
}
