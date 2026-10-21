import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fixture, install, returnToOverview } from "./monitor-fixture.mjs";

const out = fileURLToPath(
  new URL("../../../.samaya/file-downloads/", import.meta.url),
);
mkdirSync(out, { recursive: true });
const server = spawn(
  "poetry",
  ["run", "python", "-m", "tests.download_browser_server"],
  {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stderr.on("data", (data) => {
  logs += data;
});
let browser;
try {
  const { url: serverUrl, root } = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Download test server did not start: ${logs}`)),
      15000,
    );
    const lines = createInterface({ input: server.stdout });
    lines.on("line", (line) => {
      if (line.startsWith("SAMAYA_DOWNLOAD_TEST=")) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice("SAMAYA_DOWNLOAD_TEST=".length)));
      }
    });
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Download server exited (${code}): ${logs}`));
    });
  });
  await expect
    .poll(async () => {
      try {
        return (await fetch(`${serverUrl}/api/auth`)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
  const filename = "识别结果 对比.csv";
  const bytes = Buffer.from("音频,差异\nrita.wav,3\n\u0000binary\n");
  const links = [
    ["绝对路径", `${root}/识别结果%20对比.csv`, filename],
    ["相对路径", "./exports/报告%20结果.csv", "报告 结果.csv"],
    ["file 链接", `file://${root}/识别结果%20对比.csv`, filename],
    ["sandbox 链接", `sandbox:${root}/识别结果%20对比.csv`, filename],
    ["源码行列", `${root}/app.py:12:3`, "app.py"],
    ["源码锚点", "app.py#L12-L20", "app.py"],
    ["相对源码行号", "app.py:12", "app.py"],
  ];
  const text = [
    "已生成本次对比结果，可下载留存。",
    ...links.map(([label, href]) => `[${label}](${href})`),
    "[失败后重试](./retry.csv)",
    `[${"很长的文件名".repeat(15)}.csv](./long.csv)`,
    "[网页](https://example.com/report) · [邮件](mailto:hello@example.com) · [目录锚点](#section)",
    "[危险链接](javascript:alert%281%29)",
    "![本地图片](file:///tmp/private.png)",
  ].join("\n\n");
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const state = fixture();
  state.pendingRequests = [];
  expect(
    (
      await context.request.post(`${serverUrl}/api/login`, {
        data: { token: "isolated-download-test" },
      })
    ).ok(),
  ).toBe(true);
  await install(context, state);
  await context.route("**/api/threads/*/turns/*/items*", (route) =>
    route.fulfill({
      json: {
        data: [{ item: { id: "download-reply", type: "agentMessage", text } }],
        nextCursor: null,
      },
    }),
  );
  const requests = [];
  let failure = 404;
  let hold = false;
  let release;
  await context.route("**/api/threads/*/files/download?*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.searchParams.get("path");
    requests.push({ method: request.method(), path, route: url.pathname });
    if (request.method() === "HEAD" && hold)
      await new Promise((resolve) => {
        release = resolve;
      });
    if (path.includes("retry.csv") && failure) {
      if (failure === "network") return route.abort("failed");
      return route.fulfill({ status: failure, body: "" });
    }
    await route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(serverUrl);
  await page.locator('.overview-task[data-task-id="demo-5"]').click();
  const reply = page.locator('[data-item-id="download-reply"]');
  await expect(reply.locator(".file-link")).toHaveCount(9);
  const initialUrl = page.url();
  const received = [];
  page.on("download", (d) => received.push(d));
  for (const [label, , expectedName] of links) {
    const link = reply.getByRole("link", { name: label, exact: true });
    hold = label === "绝对路径";
    const height = (await reply.boundingBox()).height;
    const cursor = await link.evaluate((a) => getComputedStyle(a).cursor);
    const pending = page.waitForEvent("download");
    await link.click();
    if (hold) {
      await expect(link).toHaveAttribute("aria-busy", "true");
      await expect.poll(() => typeof release).toBe("function");
      await expect(reply.locator(".file-download-notice")).toHaveCount(0);
      expect((await reply.boundingBox()).height).toBe(height);
      expect(await link.evaluate((a) => getComputedStyle(a).cursor)).toBe(
        cursor,
      );
      hold = false;
      release();
    }
    const download = await pending;
    expect(download.suggestedFilename()).toBe(expectedName);
    expect(await download.failure()).toBeNull();
    expect(readFileSync(await download.path())).toEqual(bytes);
    expect((await reply.boundingBox()).height).toBe(height);
    expect(page.url()).toBe(initialUrl);
    await expect(reply).toBeVisible();
  }
  expect(
    requests.every((r) => r.route === "/api/threads/demo-5/files/download"),
  ).toBe(true);
  expect(requests.filter((r) => r.method === "HEAD")).toHaveLength(
    links.length,
  );
  await expect(
    reply.getByRole("link", { name: "网页", exact: true }),
  ).toHaveAttribute("href", "https://example.com/report");
  await expect(
    reply.getByRole("link", { name: "邮件", exact: true }),
  ).toHaveAttribute("href", "mailto:hello@example.com");
  await expect(
    reply.getByRole("link", { name: "目录锚点", exact: true }),
  ).toHaveAttribute("href", "#section");
  await expect(reply.locator("a", { hasText: "危险链接" })).not.toHaveAttribute(
    "href",
  );
  await expect(reply.locator('img[alt="本地图片"]')).not.toHaveAttribute(
    "src",
    /file:/,
  );

  const retry = reply.getByRole("link", { name: "失败后重试", exact: true });
  for (const [status, message] of [
    [404, "文件不存在或已移动"],
    [403, "没有权限读取"],
    [400, "目标不是普通文件"],
    [503, "暂时无法下载"],
    ["network", "无法连接服务器"],
  ]) {
    failure = status;
    await retry.click();
    await expect(reply.locator(".file-download-notice")).toContainText(message);
    expect(received.length).toBe(links.length);
    expect(page.url()).toBe(initialUrl);
  }
  failure = 0;
  hold = true;
  const before = requests.length;
  await retry.click();
  await expect(retry).toHaveAttribute("aria-busy", "true");
  await retry.evaluate((a) => {
    a.click();
    a.click();
  });
  expect(requests.length).toBe(before + 1);
  await expect(reply.locator(".file-download-notice")).toHaveText(
    "下载失败：无法连接服务器。请点击文件链接重试。",
  );
  const resumed = page.waitForEvent("download");
  hold = false;
  release();
  expect(await (await resumed).failure()).toBeNull();
  await expect(reply.locator(".file-download-notice")).toHaveCount(0);

  // Enter triggers the same browser download as a pointer click.
  await retry.focus();
  const keyboardDownload = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  expect(await (await keyboardDownload).failure()).toBeNull();

  failure = 404;
  await retry.click();
  await expect(reply.locator(".file-download-notice")).toContainText(
    "文件不存在",
  );
  for (const theme of ["vallum", "abyssus"]) {
    await page.evaluate((t) => window.samayaTheme.setPreference(t), theme);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await retry.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const scan = await new AxeBuilder({ page })
        .include(".agent-reply")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(scan.violations).toEqual([]);
      await page.screenshot({ path: `${out}/${theme}-${width}.png` });
    }
  }
  // Leaving a conversation during preflight must not start a late download.
  await page.setViewportSize({ width: 1440, height: 1000 });
  hold = true;
  failure = 0;
  await retry.click();
  await expect(retry).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => requests.at(-1)?.method).toBe("HEAD");
  const count = received.length;
  await returnToOverview(page);
  hold = false;
  release();
  await page.locator('.overview-task[data-task-id="demo-5"]').click();
  await expect(reply.locator(".file-download-notice")).toHaveCount(0);
  expect(received.length).toBe(count);
  failure = 401;
  await page.evaluate(() => {
    window.__downloadUnauthorized = false;
    window.addEventListener("samaya:unauthorized", () => {
      window.__downloadUnauthorized = true;
    });
  });
  await retry.click();
  await expect
    .poll(() => page.evaluate(() => window.__downloadUnauthorized))
    .toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "PASS file downloads: native downloads, filenames/bytes, paths, errors/retry, keyboard, themes, 320px, cancellation and authentication",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await exited;
  }
}
