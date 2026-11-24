// Small on purpose: notifications and the share target. No API response is ever cached.
const SHARE_CACHE = "ke-share";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Share target: the system share sheet POSTs here. Text goes on in the address; files wait
// in a cache for the page, which holds the credential and does the saving.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share") {
    event.respondWith(takeShare(event.request));
  }
});

async function takeShare(request) {
  const q = new URLSearchParams();
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    for (const key of await cache.keys()) await cache.delete(key);
    let n = 0;
    for (const file of form.getAll("files")) {
      if (!(file instanceof File) || !file.size) continue;
      const headers = { "Content-Type": file.type || "application/octet-stream", "X-Name": encodeURIComponent(file.name || "") };
      await cache.put(`/__share/${n++}`, new Response(file, { headers }));
    }
    for (const name of ["title", "text", "url"]) {
      const value = form.get(name);
      if (typeof value === "string" && value) q.set(name, value.slice(0, 4000));
    }
    if (n) q.set("files", String(n));
  } catch {
    /* an empty share still lands on the page, which says so */
  }
  return Response.redirect(`/share?${q}`, 303);
}

// One sentence, written by the core. Pressing it opens the item, or Today.
self.addEventListener("push", (event) => event.waitUntil(onPush(event)));

async function onPush(event) {
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { message: event.data ? event.data.text() : "" };
  }
  const body = data.message || data.body || "";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : data.item_id ? `/item/${encodeURIComponent(data.item_id)}` : "/";
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  // "Open in front" means visible and focused. A tab of a browser that is itself in the
  // background can still report visible; it is not in front of the user.
  const visible = windows.filter((w) => w.visibilityState === "visible" && w.focused);
  // The reading interface is open: nothing pops up, the analysis just appears in Today.
  if (visible.length) {
    for (const w of visible) w.postMessage({ type: "refresh" });
    return;
  }
  if (!body) return;
  await self.registration.showNotification("KeepEssence", { body, icon: "/icons/icon-512.png", tag: "ke-ready", data: { url } });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (windows.length) {
        await windows[0].focus();
        windows[0].postMessage({ type: "open", url });
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
