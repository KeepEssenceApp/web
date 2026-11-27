import { expect, test } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn, state, openInbox } from "./helpers";

test.beforeEach(async ({ request }) => reset(request));

test("W6: paste a link or text, one action saves, one sentence from the core", async ({ page, request }) => {
  await signIn(page);
  const box = page.locator(".inbox-box");
  const url = `https://example.com/articles/leases-${Date.now()}`;
  await openInbox(page);
  await box.fill(url);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".said")).toHaveText("已存入。");
  // The box shuts when what was in it is saved, and is empty when it is opened again.
  await expect(page.getByTestId("inbox-sheet")).toHaveCount(0);
  await openInbox(page);
  await expect(box).toHaveValue("");
  if (FAKE) expect((await state(request)).last_saved).toMatchObject({ kind: "link", url, entry: "web-inbox" });

  // The same link again is swallowed, and said so.
  await openInbox(page);
  await box.fill(url);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".said")).toHaveText("之前存过了，没有重复存。");

  await openInbox(page);
  await box.fill("今天读到一句话：一份活同时只归一个人。");
  await box.press("ControlOrMeta+Enter");
  await expect(page.locator(".said")).toHaveText("已存入。");
  if (FAKE) expect((await state(request)).last_saved).toMatchObject({ kind: "text", text: "今天读到一句话：一份活同时只归一个人。" });
});

test("W6: content that looks like a password asks first", async ({ page, request }) => {
  test.skip(!FAKE, "counts items through the fake");
  await signIn(page);
  const before = (await state(request)).counts.items;
  const box = page.locator(".inbox-box");
  await openInbox(page);
  await box.fill("pass" + "word = " + "made-up-Example-1"); // a made-up look-alike
  await page.getByTestId("inbox-save").click();
  const ask = page.locator(".inbox-ask");
  await expect(ask).toContainText("这段内容看起来像密码或凭据，还要存入吗？");
  expect((await state(request)).counts.items).toBe(before);
  await ask.getByRole("button", { name: "不存入" }).click();
  await expect(page.locator(".said")).toHaveText("没存入。");
  expect((await state(request)).counts.items).toBe(before);

  await openInbox(page);
  await box.fill("sk-" + "abcdefghij".repeat(3)); // a made-up look-alike
  await page.getByTestId("inbox-save").click();
  await openInbox(page);
  await page.locator(".inbox-ask").getByRole("button", { name: "存入", exact: true }).click();
  await expect(page.locator(".said")).toHaveText("已存入。");
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
  await openInbox(page);
  await expect(page.locator(".inbox-files li")).toContainText("diagram.png");
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".said")).toHaveText("已存入。");

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
  await openInbox(page);
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
  await expect(page.locator(".said")).toHaveText("已存入。");
});

// ---------------------------------------------------------------- the two controls at the foot of Today
const CLIPBOARD = ["clipboard-read", "clipboard-write"];
const clip = (page: import("@playwright/test").Page, text: string) => page.evaluate((v) => navigator.clipboard.writeText(v), text);

test("the big button saves what is on the clipboard in one press; the sentence is at the top, the bar at the foot, and the box stays shut", async ({ page, request, context, isMobile }) => {
  await context.grantPermissions(CLIPBOARD);
  await signIn(page);
  const url = `https://example.com/from-clipboard-${Date.now()}`;
  await clip(page, url);
  await page.getByTestId("inbox-paste").click();
  const said = page.locator(".said");
  await expect(said).toHaveText("已存入。");
  if (FAKE) expect((await state(request)).last_saved).toMatchObject({ kind: "link", url, entry: "web-inbox" });
  await expect(page.getByTestId("inbox-sheet")).toHaveCount(0);
  // Where they are: the sentence in the top of the screen, the two controls in its lower half, above the phone's own bar.
  const vh = page.viewportSize()!.height;
  const top = await said.boundingBox();
  expect(top!.y).toBeLessThan(80);
  const bar = (await page.locator(".savebar").boundingBox())!;
  expect(bar.y).toBeGreaterThan(vh / 2);
  if (isMobile) {
    const nav = (await page.locator("nav.nav").boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(nav.y + 0.5);
  }
  // Each control is a finger's size.
  for (const id of ["inbox-paste", "inbox-open"]) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("the big button asks before it saves what looks like a password, and says so when the clipboard holds nothing", async ({ page, context }) => {
  test.skip(!FAKE, "counts items through the fake");
  await context.grantPermissions(CLIPBOARD);
  await signIn(page);
  await clip(page, "sk-" + "abcdefghij".repeat(3)); // a made-up look-alike
  await page.getByTestId("inbox-paste").click();
  // Nothing was sent: the box opened with the question and the text still there.
  await expect(page.getByTestId("inbox-sheet")).toBeVisible();
  await expect(page.locator(".inbox-ask")).toContainText("这段内容看起来像密码或凭据，还要存入吗？");
  await expect(page.locator(".inbox-box")).toHaveValue("sk-" + "abcdefghij".repeat(3));
  await page.locator(".inbox-ask").getByRole("button", { name: "不存入" }).click();
  await expect(page.locator(".said")).toHaveText("没存入。");

  await clip(page, "");
  await page.getByTestId("inbox-paste").click();
  await expect(page.locator(".inbox-result")).toHaveText("剪贴板里没有文字，也没有图片。");
});

test("the small button opens the box: a sheet from the bottom on a phone, a popover beside the button on a wide screen; Escape shuts it and the button has the focus again", async ({ page, isMobile }) => {
  await signIn(page);
  const opener = page.getByTestId("inbox-open");
  await opener.click();
  const sheet = page.getByTestId("inbox-sheet");
  await expect(sheet).toBeVisible();
  // It was opened by the press, and only then does it take the keyboard (B5).
  await expect(page.locator(".inbox-box")).toBeFocused();
  // It slides or grows into place: measure it when it has stopped.
  let box = (await sheet.boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(60);
    const next = (await sheet.boundingBox())!;
    const still = next.x === box.x && next.y === box.y && next.width === box.width && next.height === box.height;
    box = next;
    if (still) break;
  }
  const vp = page.viewportSize()!;
  if (isMobile) {
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(vp.width);
    expect(Math.round(box.y + box.height)).toBe(vp.height);
  } else {
    const o = (await opener.boundingBox())!;
    // Beside the button: just above it, and its middle over the button's middle (as far as the window lets it).
    expect(box.y + box.height).toBeLessThanOrEqual(o.y);
    expect(box.y + box.height).toBeGreaterThan(o.y - 40);
    expect(Math.abs(box.x + box.width / 2 - (o.x + o.width / 2))).toBeLessThan(box.width / 2);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();
  // Pressing outside shuts it as well.
  await opener.click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(sheet).toHaveCount(0);
});

test("nothing opens by itself: Today loads with the box shut and the keyboard not taken", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId("inbox-sheet")).toHaveCount(0);
  await expect(page.locator("textarea:focus")).toHaveCount(0);
});
