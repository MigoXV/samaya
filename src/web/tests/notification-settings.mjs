import { chromium, expect } from "@playwright/test";
import { fixture, install } from "./monitor-fixture.mjs";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  for (const scenario of ["permission-pending", "worker-pending", "dismissed"]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await install(context, fixture());
    await context.addInitScript((scenario) => {
      class FakeNotification {
        static permission = scenario === "worker-pending" ? "granted" : "default";
        static requestPermission() {
          return scenario === "dismissed"
            ? Promise.resolve("default")
            : new Promise(() => {});
        }
      }
      window.Notification = FakeNotification;
      Object.defineProperty(navigator.serviceWorker, "register", {
        value: () => new Promise(() => {}),
      });
    }, scenario);
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(process.env.SAMAYA_UI_TEST_URL || "https://127.0.0.1:8765");
    await page.getByRole("button", { name: "设置与连接", exact: true }).click();
    await page.getByRole("button", { name: "开启浏览器通知", exact: true }).click();
    if (scenario !== "dismissed") await page.clock.fastForward(16000);
    const button = page.locator(".notification-settings button");
    await expect(button).toBeEnabled();
    if (scenario === "worker-pending") {
      await expect(button).toHaveText("已开启 · 关闭");
      await expect(page.locator(".notification-settings [role=alert]")).toContainText("证书");
      await button.click();
      await expect(button).toHaveText("开启浏览器通知");
    } else {
      await expect(button).toHaveText("开启浏览器通知");
      await expect(page.locator(".notification-settings [role=alert]")).toContainText(
        scenario === "dismissed" ? "尚未允许通知" : "通知权限申请未完成",
      );
    }
    await context.close();
  }
  console.log("通知授权超时、服务注册超时、已授权免重复申请、关闭通知及取消授权回归通过");
} finally {
  await browser.close();
}
