import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";
const out = "../../.samaya/composer-files";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const state = fixture();
  state.pendingRequests = [];
  const { calls } = await install(context, state);
  let failUpload = true,
    failSend = false,
    holdUpload = false,
    releaseUpload;
  const uploads = [];
  await context.route("**/api/uploads?*", async (route) => {
    const url = new URL(route.request().url());
    const entry = {
      filename: url.searchParams.get("filename"),
      cwd: url.searchParams.get("cwd"),
      tid: url.searchParams.get("threadId"),
      bytes: route.request().postDataBuffer()?.length,
    };
    uploads.push(entry);
    if (holdUpload)
      await new Promise((resolve) => {
        releaseUpload = resolve;
      });
    if (failUpload)
      return route.fulfill({
        status: 503,
        json: { detail: "文件上传失败，请重试" },
      });
    return route.fulfill({
      json: {
        id: String(uploads.length).padStart(32, "0"),
        name: entry.filename,
        size: entry.bytes,
        cwd: entry.cwd,
      },
    });
  });
  await context.route("**/api/operations", async (route) => {
    const op = route.request().postDataJSON();
    if (failSend && ["send", "steer"].includes(op.action))
      return route.fulfill({
        json: { state: "failed", result: { message: "附件发送失败" } },
      });
    return route.fallback();
  });
  const fileName = "已发送的需求说明.pdf";
  const history =
    "\n\n<samaya_attachments>\n" +
    JSON.stringify({
      files: [
        {
          id: "a".repeat(32),
          name: fileName,
          size: 256,
          path: "/demo/.samaya/uploads/id/payload.pdf",
        },
      ],
    }) +
    "\n</samaya_attachments>";
  await context.route("**/api/threads/*/turns/*/items*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            item: {
              id: "uploaded-user",
              type: "userMessage",
              text: "请检查附件。" + history,
            },
          },
        ],
        nextCursor: null,
        samayaCursor: 0,
      },
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8786");
  await page
    .getByRole("button", { name: "查看全部任务 →", exact: true })
    .click();
  await page.locator('[data-task-id="demo-6"] .task-open').click();
  await expect(page.locator(".user-message-files")).toContainText(fileName);
  await expect(
    page.locator('[data-item-id="uploaded-user"]'),
  ).not.toContainText("samaya_attachments");
  await expect(
    page.locator('[data-item-id="uploaded-user"]'),
  ).not.toContainText("/demo/.samaya");
  const input = page.getByRole("textbox", {
    name: "补充当前任务",
    exact: true,
  });
  const picker = page.locator('input[type="file"]');
  const cards = page.locator(".composer-files .composer-file");
  const send = page.locator(".composer-send");
  expect(await picker.getAttribute("accept")).toBeNull();
  await page.locator(".composer-add summary").click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "上传文件", exact: true }).click(),
  ]);
  await chooser.setFiles({
    name: "需求说明.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 example"),
  });
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-status", "error");
  await expect(send).toBeDisabled();
  failUpload = false;
  await page
    .getByRole("button", { name: "重试上传 需求说明.pdf", exact: true })
    .click();
  await expect(cards.first()).toHaveAttribute("data-status", "ready");
  await expect(send).toBeEnabled();
  expect(uploads[1].tid).toBe("demo-6");
  expect(uploads[1].bytes).toBe(16);
  holdUpload = true;
  await picker.setInputFiles({
    name: "补充记录.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("notes"),
  });
  await expect(cards.nth(1)).toHaveAttribute("data-status", "uploading");
  await expect(send).toBeDisabled();
  await returnToOverview(page);
  await page.locator('[data-task-id="demo-5"] .task-open').click();
  await expect(cards).toHaveCount(0);
  await returnToOverview(page);
  await page.locator('[data-task-id="demo-6"] .task-open').click();
  await expect(cards).toHaveCount(2);
  holdUpload = false;
  await expect.poll(() => typeof releaseUpload).toBe("function");
  releaseUpload();
  await expect(cards.nth(1)).toHaveAttribute("data-status", "ready");
  await input.fill("检查这两个附件");
  failSend = true;
  await input.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "附件发送失败" }),
  ).toBeVisible();
  await expect(cards).toHaveCount(2);
  await expect(input).toHaveValue("检查这两个附件");
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .locator(".composer-input")
        .screenshot({ path: `${out}/${theme}-${width}.png` });
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  failSend = false;
  await input.press("Enter");
  await expect(cards).toHaveCount(0);
  const sent = calls.find(
    (c) => c.action === "send" && c.body.threadId === "demo-6",
  );
  expect(sent.body.files).toHaveLength(2);
  expect(sent.body.text).toBe("检查这两个附件");
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["one,two\n1,2"], "values.csv", { type: "text/csv" }),
    );
    return data;
  });
  await page
    .locator(".composer-input")
    .dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(page.locator(".composer-drop-hint")).toBeVisible();
  await page
    .locator(".composer-input")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-status", "ready");
  await expect(input).toHaveValue("");
  await expect(send).toHaveAttribute("data-action", "send");
  await input.press("Enter");
  await expect(cards).toHaveCount(0);
  expect(calls.find((c) => c.action === "steer").body.files).toHaveLength(1);
  await picker.setInputFiles(
    Array.from({ length: 6 }, (_, index) => ({
      name: `${index}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    })),
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "最多添加 5 个文件" }),
  ).toBeVisible();
  await expect(cards).toHaveCount(0);
  const beforeLimit = uploads.length;
  await picker.setInputFiles({
    name: "too-large.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "20 MB" }),
  ).toBeVisible();
  expect(uploads.length).toBe(beforeLimit);
  await picker.setInputFiles({
    name: "移除.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("x"),
  });
  await expect(cards.first()).toHaveAttribute("data-status", "ready");
  await page
    .getByRole("button", { name: "移除文件 移除.txt", exact: true })
    .click();
  await expect(cards).toHaveCount(0);
  await returnToOverview(page);
  await page
    .getByRole("button", { name: "返回工作区总览", exact: true })
    .click();
  const group = page.locator('[data-workspace="/demo/Laya"]');
  if (!(await group.locator(".workspace-create").isVisible()))
    await group.locator(".workspace-toggle").click();
  await group.locator(".workspace-create").click();
  await picker.setInputFiles({
    name: "new-task.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"todo":true}'),
  });
  await expect(cards.first()).toHaveAttribute("data-status", "ready");
  await page
    .getByRole("textbox", { name: "新会话工作要求", exact: true })
    .press("Enter");
  await expect
    .poll(() => calls.filter((c) => c.action === "create").length)
    .toBe(1);
  await expect
    .poll(() => calls.filter((c) => c.action === "send").length)
    .toBe(2);
  expect(
    calls.filter((c) => c.action === "send").at(-1).body.files,
  ).toHaveLength(1);
  await expect(cards).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "File picker, retry, pending/scope, attachment-only send/steer/create, limits, drag/drop, history, dual themes, narrow layouts and axe passed.",
  );
} finally {
  await browser.close();
}
