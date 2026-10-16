import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";

let png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII=";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
mkdirSync("../../.samaya/composer-images", { recursive: true });
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ["clipboard-read", "clipboard-write"],
    colorScheme: "dark",
  });
  const state = fixture();
  state.pendingRequests = [];
  const { calls } = await install(context, state);
  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.__cspViolations.push(event.effectiveDirective),
    );
  });
  await context.route(/\/$/, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    return route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      },
    });
  });
  await context.route("**/api/threads/*/turns/*/items*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            item: {
              id: "images-only-message",
              type: "userMessage",
              content: [
                { type: "image", url: png },
                { type: "image", url: png },
              ],
            },
          },
          {
            item: {
              id: "image-message",
              type: "userMessage",
              content: [
                { type: "text", text: "收到图片。" },
                { type: "image", url: png },
              ],
            },
          },
        ],
        nextCursor: null,
        samayaCursor: 0,
      },
    }),
  );
  let fail = false;
  await context.route("**/api/operations", async (route) => {
    if (!fail) return route.fallback();
    return route.fulfill({
      json: { state: "failed", result: { message: "测试发送失败" } },
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "http://127.0.0.1:8765");
  png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#eeece5";
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = "#252a2a";
    ctx.fillRect(0, 0, 1280, 64);
    ctx.fillStyle = "#afbfb8";
    ctx.fillRect(48, 116, 400, 24);
    for (let index = 0; index < 8; index++) {
      ctx.fillStyle = index % 2 ? "#637774" : "#252a2a";
      ctx.fillRect(48, 180 + index * 52, 980 - index * 48, 10);
    }
    return canvas.toDataURL("image/png");
  });
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "abyssus");
  expect(
    await page.evaluate(() => window.samayaTheme.getSnapshot().preference),
  ).toBe("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "vallum");
  await page.evaluate(() => window.samayaTheme.setPreference("abyssus"));
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "abyssus");
  await page.evaluate(() => {
    localStorage.removeItem("samaya.theme");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "samaya.theme", newValue: null }),
    );
  });
  await expect(root).toHaveAttribute("data-theme", "vallum");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "abyssus");

  await page
    .getByRole("button", { name: "查看全部任务 →", exact: true })
    .click();
  await page.locator('[data-task-id="demo-5"] .task-open').click();
  const input = page.getByRole("textbox", {
    name: "补充当前任务",
    exact: true,
  });
  const thumbnails = page.locator(".composer-images img");
  const primary = page.locator(".composer-actions > button");
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveAttribute("data-action", "stop");
  await expect(page.locator(".stop-button")).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "已发送图片 1" }).first(),
  ).toBeVisible();
  async function expectSentImagesRightAligned() {
    for (const id of ["image-message", "images-only-message"]) {
      const item = page.locator(`[data-item-id="${id}"]`);
      const positions = await item.evaluate((el) => {
        const row = el.querySelector(".user-message-images");
        const images = [...row.querySelectorAll("img")];
        const bounds = row.getBoundingClientRect();
        const parent = el.getBoundingClientRect();
        const text = el.querySelector(".message.user");
        return {
          rowRight: bounds.right,
          parentRight: parent.right,
          textRight: text?.getBoundingClientRect().right,
          rowsRight: images
            .filter(
              (image, index) =>
                !images[index + 1] ||
                Math.abs(
                  image.getBoundingClientRect().top -
                    images[index + 1].getBoundingClientRect().top,
                ) > 1,
            )
            .map((image) => image.getBoundingClientRect().right),
          contained: images.every(
            (image) => image.getBoundingClientRect().left >= bounds.left - 1,
          ),
        };
      });
      expect(Math.abs(positions.rowRight - positions.parentRight)).toBeLessThan(
        1,
      );
      if (positions.textRight !== undefined)
        expect(Math.abs(positions.rowRight - positions.textRight)).toBeLessThan(
          1,
        );
      for (const right of positions.rowsRight)
        expect(Math.abs(right - positions.rowRight)).toBeLessThan(1);
      expect(positions.contained).toBe(true);
    }
  }
  await expectSentImagesRightAligned();
  async function pasteImage(target = input) {
    await target.focus();
    await page.evaluate(async (url) => {
      const bytes = Uint8Array.from(atob(url.split(",")[1]), (char) =>
        char.charCodeAt(0),
      );
      const blob = new Blob([bytes], { type: "image/png" });
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
    }, png);
    await target.press("Control+V");
  }
  await input.fill("检查截图");
  await expect(primary).toHaveAttribute("data-action", "send");
  const compactHeight = await page
    .locator(".composer-input")
    .evaluate((el) => el.getBoundingClientRect().height);
  await pasteImage();
  await expect(thumbnails).toHaveCount(1);
  expect(
    await thumbnails.first().evaluate((image) => image.naturalWidth),
  ).toBeGreaterThan(0);
  await expect(input).toHaveValue("检查截图");
  const layout = await page.locator(".composer-input").evaluate((el) => {
    const box = el.getBoundingClientRect();
    const thumbnail = el
      .querySelector(".composer-image")
      .getBoundingClientRect();
    return {
      height: box.height,
      thumbnailWidth: thumbnail.width,
      contained: thumbnail.top >= box.top && thumbnail.bottom <= box.bottom,
    };
  });
  expect(layout.height).toBeGreaterThan(compactHeight + 100);
  expect(layout.thumbnailWidth).toBe(96);
  await expect(thumbnails.first()).toHaveCSS("object-fit", "contain");
  expect(layout.contained).toBe(true);
  const actionGap = await page
    .locator(".composer-input")
    .evaluate(
      (el) =>
        el.querySelector(".composer-send").getBoundingClientRect().left -
        el.querySelector(".model-selector").getBoundingClientRect().right,
    );
  expect(actionGap).toBe(8);
  await page
    .locator(".composer-input")
    .screenshot({ path: "../../.samaya/composer-images/inside-input.png" });
  await page
    .getByRole("button", { name: "放大查看图片 1", exact: true })
    .click();
  const preview = page.getByRole("dialog", { name: "图片预览", exact: true });
  await expect(preview).toBeVisible();
  expect(await preview.locator("img").getAttribute("src")).toBe(
    await thumbnails.first().getAttribute("src"),
  );
  await preview.screenshot({
    path: "../../.samaya/composer-images/large-preview.png",
  });
  expect(
    await preview
      .locator("img")
      .evaluate((image) => image.getBoundingClientRect().width),
  ).toBeGreaterThan(500);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "放大查看图片 1", exact: true }),
  ).toBeFocused();
  await returnToOverview(page);
  await page.locator('[data-task-id="demo-5"] .task-open').click();
  await expect(thumbnails).toHaveCount(1);
  fail = true;
  await input.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "测试发送失败" }),
  ).toBeVisible();
  await expect(thumbnails).toHaveCount(1);
  await expect(input).toHaveValue("检查截图");
  fail = false;
  await input.press("Enter");
  await expect
    .poll(() => calls.filter((call) => call.action === "steer").length)
    .toBe(1);
  const steered = calls.find((call) => call.action === "steer");
  expect(steered.body.text).toBe("检查截图");
  expect(steered.body.images[0].url).toMatch(/^data:image\/png;base64,/);
  await expect(thumbnails).toHaveCount(0);
  await expect(input).toHaveValue("");
  await expect(primary).toHaveAttribute("data-action", "stop");
  await expect(primary.locator("img")).toHaveAttribute(
    "src",
    "/figma/stop.svg",
  );
  expect(
    await primary
      .locator("img")
      .evaluate((image) => image.getBoundingClientRect().width),
  ).toBe(18);
  const emptyCalls = calls.length;
  await input.press("Enter");
  expect(calls.length).toBe(emptyCalls);

  await pasteImage();
  await expect(thumbnails).toHaveCount(1);
  await page.getByRole("button", { name: "移除图片 1", exact: true }).click();
  await expect(thumbnails).toHaveCount(0);
  // Real Ctrl+V, but hide File data from that one paste event to reproduce
  // screenshot tools that require the async system clipboard path.
  await input.evaluate((el) => {
    el.addEventListener(
      "paste",
      (event) => {
        const clipboard = new DataTransfer();
        clipboard.setData("text/html", "<img>");
        Object.defineProperty(event, "clipboardData", {
          value: clipboard,
        });
      },
      { once: true, capture: true },
    );
  });
  await pasteImage();
  await expect(thumbnails).toHaveCount(1);
  await page.getByRole("button", { name: "移除图片 1", exact: true }).click();
  await expect(thumbnails).toHaveCount(0);
  // Clipboard permission errors must be visible, with an image picker available.
  await input.evaluate((el) => {
    const clipboard = navigator.clipboard;
    const original = clipboard.read.bind(clipboard);
    clipboard.read = async () => {
      throw new DOMException("denied", "NotAllowedError");
    };
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: new DataTransfer(),
        bubbles: true,
        cancelable: true,
      }),
    );
    setTimeout(() => {
      clipboard.read = original;
    }, 0);
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "无法读取截图" }),
  ).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "screenshot.png",
    mimeType: "image/png",
    buffer: Buffer.from(png.split(",")[1], "base64"),
  });
  await expect(thumbnails).toHaveCount(1);
  await page.getByRole("button", { name: "移除图片 1", exact: true }).click();
  await expect(thumbnails).toHaveCount(0);
  await page.evaluate(() => navigator.clipboard.writeText("普通文字粘贴"));
  await input.focus();
  await input.press("Control+V");
  await expect(input).toHaveValue("普通文字粘贴");
  await input.fill("");
  await input.evaluate((el) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" }),
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "支持粘贴" }),
  ).toBeVisible();
  await expect(thumbnails).toHaveCount(0);
  await input.evaluate((el) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {
        type: "image/png",
      }),
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "5 MB" }),
  ).toBeVisible();
  await expect(thumbnails).toHaveCount(0);
  for (let index = 0; index < 5; index++) {
    await pasteImage();
    await expect(thumbnails).toHaveCount(index + 1);
  }
  await pasteImage();
  await expect(
    page.getByRole("alert").filter({ hasText: "最多添加 5 张" }),
  ).toBeVisible();
  await expect(thumbnails).toHaveCount(5);
  for (const theme of ["vallum", "abyssus"]) {
    await page.mouse.move(0, 0);
    await page.evaluate(
      (value) => window.samayaTheme.setPreference(value),
      theme,
    );
    await expect(
      page.getByRole("button", { name: "移除图片 1", exact: true }),
    ).toHaveCSS(
      "background-color",
      theme === "abyssus" ? "rgb(17, 24, 32)" : "rgb(252, 251, 248)",
    );
    await expect(primary).toHaveCSS(
      "background-color",
      theme === "abyssus" ? "rgb(159, 196, 226)" : "rgb(37, 42, 42)",
    );
    await page.setViewportSize({ width: 320, height: 900 });
    await expectSentImagesRightAligned();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await expect(thumbnails.first()).toBeVisible();
    const attachmentLayout = await page
      .locator(".composer-images")
      .evaluate((el) => ({
        hasHorizontalOverflow: el.scrollWidth > el.clientWidth,
        overflowY: getComputedStyle(el).overflowY,
        wrap: getComputedStyle(el).flexWrap,
      }));
    expect(attachmentLayout).toEqual({
      hasHorizontalOverflow: false,
      overflowY: "visible",
      wrap: "wrap",
    });
    const toolbar = await page.locator(".composer-input").evaluate((el) => ({
      add: el.querySelector(".composer-add").getBoundingClientRect().top,
      send: el.querySelector(".composer-send").getBoundingClientRect().top,
    }));
    expect(Math.abs(toolbar.add - toolbar.send)).toBeLessThan(2);
    await page.locator(".composer-input").screenshot({
      path: `../../.samaya/composer-images/${theme}-narrow.png`,
    });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  for (let index = 5; index > 0; index--)
    await page
      .getByRole("button", { name: `移除图片 ${index}`, exact: true })
      .click();

  await returnToOverview(page);
  await page.locator('[data-task-id="demo-6"] .task-open').click();
  await pasteImage();
  await expect(thumbnails).toHaveCount(1);
  await input.press("Enter");
  await expect
    .poll(() => calls.filter((call) => call.action === "send").length)
    .toBe(1);
  const sent = calls.find((call) => call.action === "send");
  expect(sent.body.text).toBe("");
  expect(sent.body.images).toHaveLength(1);
  await expect(thumbnails).toHaveCount(0);
  await expect(primary).toHaveAttribute("data-action", "stop");

  await returnToOverview(page);
  await page
    .getByRole("button", { name: "返回工作区总览", exact: true })
    .click();
  const workspace = page.locator('[data-workspace="/demo/Laya"]');
  if (!(await workspace.locator(".workspace-create").isVisible()))
    await workspace.locator(".workspace-toggle").click();
  await workspace.locator(".workspace-create").click();
  const draft = page.getByRole("textbox", {
    name: "新会话工作要求",
    exact: true,
  });
  await pasteImage(draft);
  await expect(thumbnails).toHaveCount(1);
  await draft.press("Enter");
  await expect
    .poll(() => calls.filter((call) => call.action === "create").length)
    .toBe(1);
  await expect
    .poll(() => calls.filter((call) => call.action === "send").length)
    .toBe(2);
  expect(
    calls.filter((call) => call.action === "send").at(-1).body.images,
  ).toHaveLength(1);
  await expect(thumbnails).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  console.log(
    "真实 Control+V 图片粘贴、预览、移除、失败保留、新建/发送/追加、双主题与默认跟随系统验证通过。",
  );
} finally {
  await browser.close();
}
