import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const ctx = await browser.newContext();
  const state = fixture();
  const rule = {
    acceptWithExecpolicyAmendment: {
      execpolicy_amendment: ["git", "add", "example.txt"],
    },
  };
  const approval = {
    id: 22,
    key: "approval-22",
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "demo-3",
      turnId: "turn-3",
      reason: "申请在沙箱外执行 Git 操作",
      command: "git add example.txt",
      availableDecisions: ["accept", rule, "cancel"],
    },
  };
  state.pendingRequests = [structuredClone(approval)];
  const { calls, broadcast } = await install(ctx, state);
  const page = await ctx.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8788");
  await page.locator('[data-task-id="demo-3"].overview-task').click();
  const panel = page.locator(".inline-decision .request-panel");
  await expect(panel).toContainText("git add example.txt");
  await expect(
    panel.getByRole("button", { name: "拒绝", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "取消本次操作" }),
  ).toBeVisible();
  expect(calls.filter((c) => c.action === "respond")).toHaveLength(0);
  await panel.getByRole("button", { name: "允许本次", exact: true }).click();
  await expect
    .poll(() => calls.filter((c) => c.action === "respond").length)
    .toBe(1);
  expect(calls.at(-1).body.response).toEqual({ decision: "accept" });
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".operation-feedback[role=status]")).toHaveCount(0);
  await page.screenshot({ path: "../../.samaya/approval-quiet.png" });
  state.pendingRequests = [
    { ...structuredClone(approval), id: 23, key: "approval-23" },
  ];
  await broadcast();
  await panel.getByText("查看授权规则", { exact: true }).click();
  await expect(panel).toContainText("example.txt");
  await panel.getByRole("button", { name: "允许并记住此命令规则" }).click();
  await expect
    .poll(() => calls.filter((c) => c.action === "respond").length)
    .toBe(2);
  expect(calls.at(-1).body.response).toEqual({ decision: rule });
  state.pendingRequests = [
    {
      ...structuredClone(approval),
      id: 24,
      key: "approval-24",
      responseState: "sent",
    },
  ];
  await broadcast();
  await expect(
    panel.getByRole("button", { name: "允许本次", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".inline-decision")).toContainText(
    "等待服务端确认",
  );
  console.log(
    "Approval UI: inline command, advertised choices, explicit once/rule approval, no auto approval, sent disabled passed.",
  );
} finally {
  await browser.close();
}
