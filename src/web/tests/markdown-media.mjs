import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1100, height: 900 },
  });
  await install(context, fixture());
  await context.route("**/api/threads/*/turns/*/items*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            item: {
              id: "media",
              type: "agentMessage",
              text: "![本地图片](/workspace/picture.png)\n\n```mermaid\nflowchart LR\n A[开始] --> B[完成]\n```\n\n```mermaid\nnot valid diagram !\n```",
            },
          },
        ],
        nextCursor: null,
        samayaCursor: 0,
      },
    }),
  );
  await context.route("**/files/preview?*", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  const page = await context.newPage();
  await page.goto(process.env.SAMAYA_UI_TEST_URL || "https://127.0.0.1:8765");
  await page.locator('.overview-task[data-task-id="demo-5"]').click();
  const media = page.locator('[data-item-id="media"]');
  await expect(media.getByAltText("本地图片")).toHaveAttribute(
    "src",
    /\/files\/preview\?/,
  );
  await expect
    .poll(() =>
      media.getByAltText("本地图片").evaluate((el) => el.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(media.getByAltText("Mermaid 图表")).toBeVisible({
    timeout: 15000,
  });
  await expect
    .poll(() =>
      media.getByAltText("Mermaid 图表").evaluate((el) => el.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(media.getByText("图表暂时无法渲染，请查看源码。")).toBeVisible();
  await expect(media.locator("pre")).toHaveCount(2);
  await page.screenshot({ path: "../../.samaya/markdown-media.png" });
  console.log(
    "Local image mapping, image decode, Mermaid render and invalid source fallback passed",
  );
} finally {
  await browser.close();
}
