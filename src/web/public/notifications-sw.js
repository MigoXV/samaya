// Native notifications only. This worker does not cache pages, API responses or credentials.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const threadId = event.notification.data?.threadId;
  if (typeof threadId !== "string") return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const client = windows.find(
        (c) => new URL(c.url).origin === self.location.origin,
      );
      if (client) {
        client.postMessage({ type: "samaya:open-thread", threadId });
        await client.focus();
      } else
        await self.clients.openWindow(
          `/?thread=${encodeURIComponent(threadId)}`,
        );
    })(),
  );
});
