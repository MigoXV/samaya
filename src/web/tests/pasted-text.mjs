import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const state = fixture();
  state.pendingRequests = [];
  await install(context, state);
  const uploads = [],
    sends = [];
  let fail = false;
  await context.route("**/api/uploads?*", (route) => {
    uploads.push({
      url: new URL(route.request().url()),
      text: route.request().postDataBuffer().toString("utf8"),
    });
    return route.fulfill({
      status: fail ? 500 : 200,
      json: fail
        ? { detail: "测试上传失败" }
        : { id: "a".repeat(32), cwd: "/workspace/samaya" },
    });
  });
  await context.route("**/api/operations", (route) => {
    sends.push(route.request().postDataJSON());
    return route.fulfill({ json: { state: "succeeded", result: {} } });
  });
  const page = await context.newPage();
  await page.goto("https://127.0.0.1:8765");
  await page.locator('[data-task-id="demo-6"].overview-task').click();
  const input = page.getByRole("textbox", {
    name: "补充当前任务",
    exact: true,
  });
  const paste = async (text) =>
    input.evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    }, text);
  await input.fill("已有草稿");
  const long = "文".repeat(1001) + "\n完整结尾";
  await paste(long);
  const card = page.locator(".composer-files .composer-file");
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-status", "ready");
  await expect(input).toHaveText("已有草稿");
  expect(uploads[0].text).toBe(long);
  expect(uploads[0].url.searchParams.get("filename")).toBe("粘贴内容.txt");
  await page
    .getByRole("button", { name: "移除文件 粘贴内容.txt", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await input.fill("");
  await paste("短".repeat(1000));
  await expect(input).toHaveText("短".repeat(1000));
  await expect(card).toHaveCount(0);
  await input.fill("");
  fail = true;
  await paste(long);
  await expect(card).toHaveAttribute("data-status", "error");
  await expect(page.locator(".composer-send")).toBeDisabled();
  fail = false;
  await page
    .getByRole("button", { name: "重试上传 粘贴内容.txt", exact: true })
    .click();
  await expect(card).toHaveAttribute("data-status", "ready");
  await page.locator(".composer-send").click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].body.files).toEqual([{ id: "a".repeat(32) }]);
  expect(sends[0].body.text).toBe("");
  console.log(
    "Long paste: exact upload, draft preservation, remove, 1000 boundary, failed upload/retry and attachment-only send passed",
  );
} finally {
  await browser.close();
}
