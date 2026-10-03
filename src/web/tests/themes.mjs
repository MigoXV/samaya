import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const base = process.env.SAMAYA_TEST_URL || "http://127.0.0.1:8765";
const tid =
  process.env.SAMAYA_THEME_THREAD ||
  JSON.parse(readFileSync("../../.samaya/acceptance/theme-thread.json"))
    .threadId;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  colorScheme: "dark",
});
const page = await context.newPage();
const errors = [],
  report = { realHistoryThread: tid, axe: {}, contrast: {} };
page.on("pageerror", (e) => errors.push(e.message));
let posts = 0,
  streams = 0;
page.on("request", (r) => {
  if (new URL(r.url()).pathname === "/api/operations") posts++;
  if (new URL(r.url()).pathname === "/api/events") streams++;
});
const root = page.locator("html"),
  select = page.locator(".sidebar .theme-control select");
const screen = "../../.samaya/screenshots";
mkdirSync(screen, { recursive: true });
async function audit(name) {
  report.axe[name] = (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()
  ).violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => ({
      target: n.target,
      summary: n.failureSummary,
    })),
  }));
}
async function contrast(theme) {
  report.contrast[theme] = await page.evaluate(() => {
    const rgb = (s) => s.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
    const lum = (s) =>
      rgb(s)
        .slice(0, 3)
        .map((c) => {
          c /= 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const bg = (e) => {
      for (let n = e; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (rgb(c)[3] !== 0) return c;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    return [
      ".brand",
      ".theme-control label",
      ".theme-control select",
      ".workspace-path code",
      ".session-row.selected strong",
      ".new-session",
      ".composer textarea",
    ]
      .map((s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const f = getComputedStyle(e).color,
          b = bg(e);
        return {
          selector: s,
          foreground: f,
          background: b,
          ratio:
            (Math.max(lum(f), lum(b)) + 0.05) /
            (Math.min(lum(f), lum(b)) + 0.05),
        };
      })
      .filter(Boolean);
  });
}
try {
  await page.goto(`${base}/?thread=${tid}`);
  await expect(select).toBeVisible();
  await expect(page.locator(".markdown").last()).toContainText(
    "SAMAYA_THEME_READY",
    { timeout: 30000 },
  );
  await expect(root).toHaveAttribute("data-theme", "vallum");
  report.defaultWhiteEvenWithDarkOS = true;
  await page.locator(".composer textarea").fill("切换主题时保留的消息草稿");
  const before = { posts, streams };
  const composer = await page.locator(".composer textarea").elementHandle();
  for (const theme of ["abyssus", "vallum"]) {
    await select.selectOption(theme);
    await expect(root).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".composer textarea")).toHaveValue(
      "切换主题时保留的消息草稿",
    );
    if (
      !(await composer.evaluate(
        (el) => el === document.querySelector(".composer textarea"),
      ))
    )
      throw new Error("Composer remounted");
    const expected =
      theme === "abyssus" ? "rgb(159, 196, 226)" : "rgb(37, 42, 42)";
    await expect(page.locator(".new-session")).toHaveCSS(
      "background-color",
      expected,
    );
    await page.locator(".new-session").hover();
    await expect(page.locator(".new-session")).toHaveCSS(
      "background-color",
      theme === "abyssus" ? "rgb(180, 210, 233)" : "rgb(93, 112, 108)",
    );
    await audit(`${theme}-hover`);
    await select.focus();
    await expect(select).toBeFocused();
    await page.mouse.move(1400, 10);
    await expect(page.locator(".new-session")).toHaveCSS(
      "background-color",
      expected,
    );
    await audit(`${theme}-workbench`);
    await contrast(theme);
    await page.screenshot({ path: `${screen}/theme-${theme}-desktop.png` });
  }
  if (posts !== before.posts || streams !== before.streams)
    throw new Error("Theme caused operation or connection");
  report.noSubmissionOrReconnect = true;
  report.draftPreserved = true;
  await select.selectOption("abyssus");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "abyssus");
  await expect(select).toHaveValue("abyssus");
  report.reload = true;
  const second = await context.newPage();
  await second.goto(`${base}/settings`);
  await expect(second.locator("html")).toHaveAttribute("data-theme", "abyssus");
  await second
    .locator(".settings-body .theme-control select")
    .selectOption("vallum");
  await expect(root).toHaveAttribute("data-theme", "vallum");
  report.crossTab = true;
  await select.selectOption("system");
  await expect(root).toHaveAttribute("data-theme", "abyssus");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "vallum");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "abyssus");
  await select.selectOption("vallum");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "vallum");
  report.systemFollowsOnlyWhenSelected = true;
  // A theme change from another tab must not replace an open dialog or its field.
  await page.getByRole("button", { name: "切换工作区", exact: true }).click();
  const directory = page.getByRole("dialog").getByLabel("服务器目录");
  await directory.fill("/workspace/长路径/".repeat(12));
  const dialog = await page.getByRole("dialog").elementHandle();
  await second
    .locator(".settings-body .theme-control select")
    .selectOption("abyssus");
  await expect(root).toHaveAttribute("data-theme", "abyssus");
  await expect(directory).toHaveValue("/workspace/长路径/".repeat(12));
  if (
    !(await dialog.evaluate(
      (el) => el === document.querySelector("dialog[open]"),
    ))
  )
    throw new Error("Dialog remounted");
  await audit("abyssus-dialog");
  await page.screenshot({ path: `${screen}/theme-abyssus-dialog.png` });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "切换工作区", exact: true }),
  ).toBeFocused();
  report.dialogPreservedAndFocusReturned = true;
  for (const theme of ["abyssus", "vallum"]) {
    await select.selectOption(theme);
    for (const route of ["sessions", "settings"]) {
      await page.goto(`${base}/${route}?thread=${tid}`);
      await expect(
        page.locator(route === "settings" ? ".settings-body" : ".table-wrap"),
      ).toBeVisible();
      await audit(`${theme}-${route}`);
    }
  }
  // Controlled pending-request fixture exercises React state; no user task is submitted.
  const fixtureSource = await (
    await page.request.get(`${base}/api/threads/${tid}`)
  ).json();
  await page.route(
    new RegExp(`/api/threads/${tid}(?:\\?.*)?$`),
    async (route) => {
      const data = structuredClone(fixtureSource);
      data.thread.status = {
        type: "active",
        activeFlags: ["waitingOnUserInput"],
      };
      data.thread.turns.at(-1).status = "inProgress";
      data.thread.turns.at(-1).items.push({
        id: "theme-long-output",
        type: "mcpToolCall",
        status: "completed",
        server: "主题测试服务".repeat(30),
        tool: "长日志检查",
        arguments: {},
        result: {
          content: [
            {
              type: "resource",
              resource: {
                uri: "test://theme-output",
                mimeType: "text/plain",
                text: "长日志与代码".repeat(300),
              },
            },
          ],
        },
      });
      data.pendingRequests = [
        {
          id: 999,
          key: "theme-ui-fixture",
          method: "mcpServer/elicitation/request",
          params: {
            threadId: tid,
            serverName: "主题交互测试",
            message: "这是浏览器测试中的受控输入请求。",
          },
          mcp: {
            mode: "form",
            schema: {
              type: "object",
              properties: {
                answer: {
                  type: "string",
                  title: "保留这项输入",
                  minLength: 20,
                },
                flag: { type: "boolean", title: "保留布尔选择" },
                choices: {
                  type: "array",
                  title: "保留多选",
                  items: { type: "string", enum: ["选项 A", "选项 B"] },
                },
              },
            },
          },
        },
      ];
      data.pendingRequests.push({
        id: 1000,
        key: "theme-url-fixture",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: tid,
          serverName: "主题测试",
          message: "URL 外观测试；不进行授权。",
        },
        mcp: {
          mode: "url",
          url: "https://example.com/authorize",
          host: "example.com",
        },
      });
      await route.fulfill({ json: data });
    },
  );
  await page.goto(`${base}/?thread=${tid}`);
  await page
    .getByLabel("保留这项输入 · 可选", { exact: true })
    .fill("MCP 草稿");
  await page
    .getByLabel("保留布尔选择 · 可选", { exact: true })
    .selectOption("false");
  await page.getByLabel("选项 B", { exact: true }).check();
  const input = await page
    .getByLabel("保留这项输入 · 可选", { exact: true })
    .elementHandle();
  await page.locator(".mcp-tool > summary").click();
  const count = posts;
  for (const theme of ["abyssus", "vallum"]) {
    await select.selectOption(theme);
    await expect(
      page.getByLabel("保留这项输入 · 可选", { exact: true }),
    ).toHaveValue("MCP 草稿");
    await expect(
      page.getByLabel("保留布尔选择 · 可选", { exact: true }),
    ).toHaveValue("false");
    await expect(page.getByLabel("选项 B", { exact: true })).toBeChecked();
    if (!(await input.evaluate((el) => el.isConnected)))
      throw new Error("MCP field remounted");
    await expect(
      page.getByRole("button", { name: "停止本轮", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect(
      page.locator('.mcp-field [aria-invalid="true"]'),
    ).toBeFocused();
    await expect(page.locator(".mcp-field-error[role=alert]")).toBeVisible();
    await expect(page.locator(".mcp-url .primary")).toHaveCSS(
      "background-color",
      theme === "abyssus" ? "rgb(159, 196, 226)" : "rgb(37, 42, 42)",
    );
    await audit(`${theme}-mcp-fixture`);
  }
  if (posts !== count) throw new Error("Theme submitted MCP");
  await page.locator(".mcp-resource > pre").focus();
  await expect(page.locator(".mcp-resource > pre")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(() =>
      page.locator(".mcp-resource > pre").evaluate((el) => el.scrollTop),
    )
    .toBeGreaterThan(0);
  report.longLogKeyboardScroll = true;
  report.mcpFixtureStatePreserved = true;
  report.mcpInvalidFocusAndUrlTheme = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "项目与会话", exact: true }).click();
  await expect(select).toBeVisible();
  await select.selectOption("abyssus");
  await page.keyboard.press("Escape");
  await expect(page.locator(".nav-open")).toHaveCount(0);
  await audit("abyssus-mobile");
  await page.getByRole("button", { name: "项目与会话", exact: true }).click();
  await select.selectOption("vallum");
  await page.keyboard.press("Escape");
  await audit("vallum-mobile");
  await page.screenshot({ path: `${screen}/theme-vallum-mobile.png` });
  await page.getByRole("button", { name: "项目与会话", exact: true }).click();
  await select.selectOption("abyssus");
  await page.keyboard.press("Escape");
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile overflow");
  await page.screenshot({ path: `${screen}/theme-abyssus-mobile.png` });
  report.mobile = true;
  report.longCodeAndLogOverflow = false;
  await second.close();
  // Fresh document applies saved theme before the React bundle arrives (CSP remains active).
  const slow = await context.newPage();
  let releaseBundle;
  const gate = new Promise((resolve) => {
    releaseBundle = resolve;
  });
  await slow.route("**/assets/*.js", async (route) => {
    await gate;
    await route.continue();
  });
  await slow.goto(base, { waitUntil: "commit" });
  await slow.waitForFunction(() => !!window.samayaTheme);
  await expect(slow.locator("html")).toHaveAttribute("data-theme", "abyssus");
  await expect(slow.locator("#root")).toBeEmpty();
  await expect(slow.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    /^#080a0d$/i,
  );
  report.preReactTheme = true;
  releaseBundle();
  await slow.close();
  // Isolated login page makes storage-failure behavior testable without touching credentials.
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => {
    const get = Storage.prototype.getItem,
      set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (k) {
      if (k === "samaya.theme")
        throw new DOMException("blocked", "SecurityError");
      return get.call(this, k);
    };
    Storage.prototype.setItem = function (k, v) {
      if (k === "samaya.theme")
        throw new DOMException("blocked", "SecurityError");
      return set.call(this, k, v);
    };
  });
  const login = await blocked.newPage();
  await login.route("**/api/auth", (r) =>
    r.fulfill({ json: { authenticated: false } }),
  );
  await login.goto(base);
  await login.getByLabel("界面主题", { exact: true }).selectOption("abyssus");
  await expect(login.locator("html")).toHaveAttribute("data-theme", "abyssus");
  await expect(login.getByRole("status")).toContainText("仅本页生效");
  report.storageBlockedWorks = true;
  await expect(login.locator("button.primary")).toHaveCSS(
    "background-color",
    "rgb(159, 196, 226)",
  );
  for (const theme of ["abyssus", "vallum"]) {
    await login.getByLabel("界面主题", { exact: true }).selectOption(theme);
    await expect(login.locator("button.primary")).toHaveCSS(
      "background-color",
      theme === "abyssus" ? "rgb(159, 196, 226)" : "rgb(37, 42, 42)",
    );
    report.axe[`${theme}-login`] = (
      await new AxeBuilder({ page: login })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations;
    await login.screenshot({ path: `${screen}/theme-login-${theme}.png` });
  }
  await blocked.close();
  const invalid = await browser.newContext();
  await invalid.addInitScript(() =>
    localStorage.setItem("samaya.theme", "unexpected"),
  );
  const ip = await invalid.newPage();
  await ip.goto(base);
  await expect(ip.locator("html")).toHaveAttribute("data-theme", "vallum");
  report.invalidPreferenceFallback = true;
  await invalid.close();
  report.errors = errors;
  writeFileSync(
    "../../docs/theme-results.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (
    errors.length ||
    Object.values(report.axe).some((v) => v.length) ||
    Object.values(report.contrast)
      .flat()
      .some((v) => v.ratio < 4.5)
  )
    throw new Error("Theme accessibility failure");
} finally {
  await browser.close();
}
