import { expect, test } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn, state } from "./helpers";

test.beforeEach(async ({ request }) => reset(request));

test("W6: paste a link or text, one action saves, one sentence from the core", async ({ page, request }) => {
  await signIn(page);
  const box = page.locator(".inbox-box");
  const url = `https://example.com/articles/leases-${Date.now()}`;
  await box.fill(url);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".inbox-result")).toHaveText("已存入。");
  await expect(box).toHaveValue("");
  if (FAKE) expect((await state(request)).last_saved).toMatchObject({ kind: "link", url, entry: "web-inbox" });

  // The same link again is swallowed, and said so.
  await box.fill(url);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".inbox-result")).toHaveText("之前存过了，没有重复存。");

  await box.fill("今天读到一句话：一份活同时只归一个人。");
  await box.press("ControlOrMeta+Enter");
  await expect(page.locator(".inbox-result")).toHaveText("已存入。");
  if (FAKE) expect((await state(request)).last_saved).toMatchObject({ kind: "text", text: "今天读到一句话：一份活同时只归一个人。" });
});

test("W6: content that looks like a password asks first", async ({ page, request }) => {
  test.skip(!FAKE, "counts items through the fake");
  await signIn(page);
  const before = (await state(request)).counts.items;
  const box = page.locator(".inbox-box");
  await box.fill("pass" + "word = " + "made-up-Example-1"); // a made-up look-alike
  await page.getByTestId("inbox-save").click();
  const ask = page.locator(".inbox-ask");
  await expect(ask).toContainText("这段内容看起来像密码或凭据，还要存入吗？");
  expect((await state(request)).counts.items).toBe(before);
  await ask.getByRole("button", { name: "不存入" }).click();
  await expect(page.locator(".inbox-result")).toHaveText("没存入。");
  expect((await state(request)).counts.items).toBe(before);

  await box.fill("sk-" + "abcdefghij".repeat(3)); // a made-up look-alike
  await page.getByTestId("inbox-save").click();
  await page.locator(".inbox-ask").getByRole("button", { name: "存入", exact: true }).click();
  await expect(page.locator(".inbox-result")).toHaveText("已存入。");
  expect((await state(request)).counts.items).toBe(before + 1);
});

test("W6: a dropped image is compressed to WebP at 1600 px, hashed and uploaded", async ({ page, request }) => {
  await signIn(page);
  // A made-up 3000 x 2000 picture, dropped on the inbox as a PNG file.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 2000;
    const g = canvas.getContext("2d")!;
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `hsl(${i * 6}, 60%, ${30 + (i % 5) * 10}%)`;
      g.fillRect((i % 10) * 300, Math.floor(i / 10) * 334, 300, 334);
    }
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
    const data = new DataTransfer();
    data.items.add(new File([blob], "diagram.png", { type: "image/png" }));
    document.querySelector(".inbox")!.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".inbox-files li")).toContainText("diagram.png");
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".inbox-result")).toHaveText("已存入。");

  if (FAKE) {
    const s = await state(request);
    expect(s.last_saved).toMatchObject({ kind: "image", asset_content_type: "image/webp" });
    expect(s.last_saved.asset_bytes).toBeGreaterThan(100);
    expect(s.last_saved.asset_bytes).toBeLessThan(3145728);
  }
  // Read it back through the contract and measure it.
  const cred = await credentialOf(page);
  const auth = { Authorization: `Bearer ${cred}` };
  const items = (await (await request.get("/v1/items?state=today&limit=100", { headers: auth })).json()).items as { id: string; kind: string; created_at: string }[];
  const image = items.filter((i) => i.kind === "image").sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  const detail = await (await request.get(`/v1/items/${image.id}`, { headers: auth })).json();
  const asset = await (await request.get(`/v1/assets/${detail.asset_id}`, { headers: auth })).json();
  expect(asset.content_type).toBe("image/webp");
  const size = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, asset.download_url);
  expect(size).toEqual([1600, 1067]);

  // The same bytes again: nothing is uploaded twice.
  if (FAKE) expect((await state(request)).counts.assets).toBe(1);
});

test("W6: an image pasted from the clipboard is taken too", async ({ page }) => {
  await signIn(page);
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 30;
    canvas.getContext("2d")!.fillRect(0, 0, 20, 20);
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
    const data = new DataTransfer();
    data.items.add(new File([blob], "image.png", { type: "image/png" }));
    document.querySelector(".inbox-box")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".inbox-files li")).toHaveCount(1);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".inbox-result")).toHaveText("已存入。");
});
