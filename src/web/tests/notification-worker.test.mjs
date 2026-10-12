import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(
  new URL("../public/notifications-sw.js", import.meta.url),
  "utf8",
);
function worker(windows = []) {
  let handler;
  const calls = [];
  vm.runInNewContext(source, {
    URL,
    self: {
      location: { origin: "https://samaya.example" },
      addEventListener(type, fn) {
        assert.equal(type, "notificationclick");
        handler = fn;
      },
      clients: {
        async matchAll() {
          return windows;
        },
        async openWindow(url) {
          calls.push(["open", url]);
        },
      },
    },
  });
  return {
    calls,
    async click(threadId) {
      let pending;
      handler({
        notification: {
          data: { threadId },
          close() {
            calls.push(["close"]);
          },
        },
        waitUntil(promise) {
          pending = promise;
        },
      });
      await pending;
    },
  };
}
test("notification focuses an existing same-origin tab with the exact thread", async () => {
  const messages = [];
  const w = worker([
    { url: "https://other.example/" },
    {
      url: "https://samaya.example/?view=settings",
      postMessage(msg) {
        messages.push(msg);
      },
      async focus() {
        messages.push("focus");
      },
    },
  ]);
  await w.click("thread-123");
  assert.equal(messages[0].type, "samaya:open-thread");
  assert.equal(messages[0].threadId, "thread-123");
  assert.equal(messages[1], "focus");
  assert.deepEqual(w.calls, [["close"]]);
});
test("notification opens an encoded task URL when no tab exists", async () => {
  const w = worker();
  await w.click("thread /?&");
  assert.deepEqual(w.calls, [
    ["close"],
    ["open", "/?thread=thread%20%2F%3F%26"],
  ]);
});
test("malformed notification data never opens a page", async () => {
  const w = worker();
  await w.click(undefined);
  assert.deepEqual(w.calls, [["close"]]);
});
