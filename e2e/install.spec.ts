import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn, state } from "./helpers";

test.beforeEach(async ({ request }) => reset(request));

test("W10: a web app manifest with the name, black background, icons and a share target", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toBe("KeepEssence");
  expect(m.display).toBe("standalone");
  expect(m.background_color.toUpperCase()).toBe("#0B0B0B");
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["180x180", "512x512"]));
  for (const icon of m.icons) {
    const img = await request.get(icon.src);
    expect(img.ok(), icon.src).toBe(true);
    expect(img.headers()["content-type"]).toContain("image/png");
  }
  expect(m.share_target).toMatchObject({ action: "/share", method: "POST", enctype: "multipart/form-data" });
  expect(m.share_target.params).toMatchObject({ title: "title", text: "text", url: "url" });
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/icon-180.png");
});

test("W10: the service worker is small, handles push and the share, and caches no API response", async ({ page, request }) => {
  const sw = await (await request.get("/sw.js")).text();
  expect(sw.length).toBeLessThan(6000);
  for (const word of ['"push"', '"notificationclick"', '"/share"', "showNotification"]) expect(sw).toContain(word);
  expect(sw).not.toMatch(/\/v1\//);
  await signIn(page);
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active)).toBe(true);
  await page.reload();
  await page.locator(".nav").waitFor();
  expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(0);
});

test("W10: a share saves at once and shows the one-sentence result", async ({ page, request }) => {
  await signIn(page);
  const url = `https://example.com/shared/${Date.now()}`;
  await page.goto(`/share?title=${encodeURIComponent("分享来的文章")}&text=${encodeURIComponent(`看看这个 ${url}`)}`);
  await expect(page.getByTestId("share-result")).toHaveText("已存入。");
  // The address bar no longer carries the share, so a reload does not save twice.
  await expect(page).toHaveURL(/\/share$/);
  if (FAKE) expect((await state(request)).last_saved).toMatchObject({ kind: "link", url, entry: "share", title: "分享来的文章" });
  await page.getByRole("link", { name: "去今天" }).click();
  await expect(page.locator(".waiting a", { hasText: "分享来的文章" }).first()).toBeVisible();
});

test("W10: the system share sheet's POST, with an image, goes through the service worker", async ({ page, request }) => {
  await signIn(page);
  await expect.poll(() => page.evaluate(async () => !!navigator.serviceWorker.controller)).toBe(true);
  // What Android sends for the manifest's share_target: a multipart POST to /share.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1200;
    canvas.getContext("2d")!.fillRect(100, 100, 800, 600);
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg"));
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/share";
    form.enctype = "multipart/form-data";
    const text = document.createElement("input");
    text.name = "text";
    text.value = "截屏里的一段话，值得留着。";
    const file = document.createElement("input");
    file.type = "file";
    file.name = "files";
    const data = new DataTransfer();
    data.items.add(new File([blob], "screenshot.jpg", { type: "image/jpeg" }));
    file.files = data.files;
    form.append(text, file);
    document.body.append(form);
    form.submit();
  });
  await expect(page.getByTestId("share-result")).toHaveText("已存入。");
  if (FAKE) {
    const s = await state(request);
    expect(s.last_saved).toMatchObject({ kind: "image", asset_content_type: "image/webp", entry: "share" });
    expect(s.counts.today).toBe(9);
  }
});
