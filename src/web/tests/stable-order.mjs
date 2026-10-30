import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext();
  const state = fixture();
  state.pendingRequests = [];
  state.records.forEach((r) => {
    r.orderAt = r.thread.updatedAt;
  });
  const { broadcast } = await install(context, state);
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  const sidebar = page.locator("[data-sidebar-workspace]");
  const overview = page.locator(".overview-workspace");
  await expect(sidebar).toHaveCount(3);
  const orders = async () => ({
    side: await sidebar.evaluateAll((ns) =>
      ns.map((n) => n.dataset.sidebarWorkspace),
    ),
    main: await overview.evaluateAll((ns) =>
      ns.map((n) => n.dataset.workspace),
    ),
  });
  const before = await orders();
  for (let i = 0; i < 8; i++) {
    const r = state.records[i % 2];
    r.lastActivityAt = Date.now() / 1000 + i;
    r.thread.recencyAt = r.lastActivityAt;
    r.lastActivityId = 20 + i;
    await broadcast();
    expect(await orders()).toEqual(before);
  }
  const target = state.records.find((r) => r.thread.cwd === "/demo/MeetNote");
  target.orderAt = Date.now() / 1000 + 100;
  await broadcast();
  await expect(sidebar.first()).toHaveAttribute(
    "data-sidebar-workspace",
    "/demo/MeetNote",
  );
  await expect(overview.first()).toHaveAttribute(
    "data-workspace",
    "/demo/MeetNote",
  );
  const after = await orders();
  const taskOrder = () =>
    page
      .locator(".overview-task")
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.taskId));
  const beforeQuestion = await taskOrder();
  state.pendingRequests = [
    {
      key: "new-question",
      id: 1000,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "demo-9",
        turnId: "turn-9",
        questions: [
          { id: "q", header: "确认", question: "是否继续？", options: [] },
        ],
      },
    },
  ];
  await broadcast();
  expect(await taskOrder()).toEqual(beforeQuestion);

  state.records.find((r) => r.thread.parentThreadId).orderAt =
    Date.now() / 1000 + 200;
  await broadcast();
  expect(await orders()).toEqual(after);
  await page.reload();
  await expect(sidebar.first()).toHaveAttribute(
    "data-sidebar-workspace",
    "/demo/MeetNote",
  );
  console.log(
    "stable ordering: alternating replies, new turn, child activity and reload passed",
  );
} finally {
  await browser.close();
}
