// Internal QA #87: what happens to a picture is said once, beside the files that wait (not after each save, not as a
// question), and a GIF that was an animation says that one picture was kept. The success sentence stays the core's.
import { expect, test, type Page } from "@playwright/test";
import { reset, signIn, state, openInbox } from "./helpers";

test.beforeEach(async ({ request }) => reset(request));

/** A GIF made of `n` pictures of 1 x 1 pixel (the usual smallest GIF, repeated), as base64. */
const gif = (n: number) => {
  const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00];
  const frame = [0x21, 0xf9, 0x04, 0x01, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00];
  return Buffer.from([...header, ...Array.from({ length: n }, () => frame).flat(), 0x3b]).toString("base64");
};

type Kind = "png" | "txt" | "pdf" | { gif: string };
/** Puts one file on the inbox the way a drop does. */
async function drop(page: Page, kind: Kind) {
  await page.evaluate(async (k) => {
    let file: File;
    if (typeof k === "object") {
      file = new File([Uint8Array.from(atob(k.gif), (c) => c.charCodeAt(0))], "motion.gif", { type: "image/gif" });
    } else if (k === "png") {
      const canvas = document.createElement("canvas");
      canvas.width = 3000;
      canvas.height = 2000;
      canvas.getContext("2d")!.fillRect(0, 0, 1500, 1000);
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
      file = new File([blob], "diagram.png", { type: "image/png" });
    } else if (k === "txt") file = new File(["A few made-up words."], "note.txt", { type: "text/plain" });
    else file = new File(["%PDF-1.7 hello"], "paper.pdf", { type: "application/pdf" });
    const data = new DataTransfer();
    data.items.add(file);
    document.querySelector(".inbox")!.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  }, kind);
  await openInbox(page);
  await expect(page.locator(".inbox-files li")).toHaveCount(1);
}

const note = (page: Page) => page.getByTestId("inbox-image-note");
const longEdge = async (page: Page) => ((await (await page.request.get("/v1/meta")).json()).limits.image_long_edge_px as number);

test("QA #87: a picture waiting in the inbox comes with one quiet sentence about what happens to it; the limit it names is the contract's", async ({ page }) => {
  await signIn(page);
  await expect(note(page)).toHaveCount(0);
  await drop(page, "png");
  const edge = await longEdge(page);
  expect(edge).toBe(1600);
  await expect(note(page)).toHaveText(`图片会先在你的设备上处理再存入，长边超过 ${edge} 像素的会缩小；原图不上传。`);
  await expect(note(page)).toHaveClass(/quiet/);
  // Only what is known: no promise about small text, no "original saved", "HD" or "lossless".
  for (const never of ["原图保存", "高清", "无损", "读得清", "不影响"]) await expect(note(page)).not.toContainText(never);
  // A sentence beside the files, not a question: saving needs no second press, and the success sentence is the core's, alone.
  await openInbox(page);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".said")).toHaveText("已存入。");
  await expect(page.locator("[role=alertdialog]")).toHaveCount(0);
  await expect(note(page)).toHaveCount(0);
});

test("QA #87: files that are not pictures carry no such sentence", async ({ page }) => {
  await signIn(page);
  for (const kind of ["txt", "pdf"] as const) {
    await drop(page, kind);
    await expect(note(page)).toHaveCount(0);
    await openInbox(page);
    await page.locator(".inbox-files button", { hasText: "拿掉" }).click();
  }
});

test("QA #87: the sentence is in English too", async ({ page }) => {
  await signIn(page, "/assistants/account");
  await page.getByTestId("language").selectOption("en");
  await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
  await page.goto("/");
  await drop(page, "png");
  await expect(note(page)).toHaveText("Images are processed on your device before saving; anything over 1600 px on the long edge is scaled down. The original isn't uploaded.");
});

test("QA #87: a GIF that was an animation says that one picture was kept, and does not say which; a still GIF says nothing", async ({ page }) => {
  await signIn(page);
  await drop(page, { gif: gif(3) });
  await expect(note(page)).toBeVisible();
  await openInbox(page);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".said")).toHaveText("已存入。 动图只保留了一帧。");
  await expect(page.locator(".said")).not.toContainText("第一");

  await drop(page, { gif: gif(1) });
  await openInbox(page);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".said")).toHaveText("已存入。");
});

test("QA #87: what the system share sheet sends is told the same way, only when a picture came", async ({ page }) => {
  await signIn(page);
  await expect.poll(() => page.evaluate(async () => !!navigator.serviceWorker.controller)).toBe(true);
  const share = (withImage: boolean) =>
    page.evaluate(async (withImage) => {
      const form = document.createElement("form");
      form.method = "post";
      form.action = "/share";
      form.enctype = "multipart/form-data";
      const text = document.createElement("input");
      text.name = "text";
      text.value = withImage ? "截屏里的一段话，值得留着。" : "只有一段话，没有图片，值得留着。";
      form.append(text);
      if (withImage) {
        const canvas = document.createElement("canvas");
        canvas.width = 2400;
        canvas.height = 1200;
        canvas.getContext("2d")!.fillRect(100, 100, 800, 600);
        const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg"));
        const file = document.createElement("input");
        file.type = "file";
        file.name = "files";
        const data = new DataTransfer();
        data.items.add(new File([blob], "screenshot.jpg", { type: "image/jpeg" }));
        file.files = data.files;
        form.append(file);
      }
      document.body.append(form);
      form.submit();
    }, withImage);
  await share(true);
  await expect(page.getByTestId("share-result")).toHaveText("已存入。");
  await expect(page.getByTestId("share-image-note")).toHaveText("图片会先在你的设备上处理再存入，长边超过 1600 像素的会缩小；原图不上传。");
  await page.goto("/");
  await share(false);
  await expect(page.getByTestId("share-result")).toBeVisible();
  await expect(page.getByTestId("share-image-note")).toHaveCount(0);
});

test("QA #87: a file over the limit says the limit in MiB, the unit it is in, and saves nothing", async ({ page }) => {
  await signIn(page);
  const before = (await state(page.request)).counts.items;
  const limit = ((await (await page.request.get("/v1/meta")).json()).limits.asset_max_bytes as number);
  expect(limit).toBe(3145728);
  // A PDF one byte over the limit, so no picture is made of it: only the size is judged.
  await page.evaluate(async (max) => {
    const bytes = new Uint8Array(max + 1);
    bytes.set(new TextEncoder().encode("%PDF-1.7 "));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "big.pdf", { type: "application/pdf" }));
    document.querySelector(".inbox")!.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  }, limit);
  await openInbox(page);
  await expect(page.locator(".inbox-files li")).toHaveCount(1);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".inbox-result")).toContainText("文件超过 3 MiB");
  await expect(page.locator(".inbox-result")).not.toContainText("MB ");
  expect((await state(page.request)).counts.items).toBe(before);
});

/** Puts a file that only has the name of a picture on the inbox. */
async function dropBroken(page: Page) {
  await expect(page.locator(".inbox")).toBeVisible();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["this is not a picture, only a test marker"], "broken.png", { type: "image/png" }));
    document.querySelector(".inbox")!.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await openInbox(page);
  await expect(page.locator(".inbox-files li")).toHaveCount(1);
}

test("QA #87: a picture the browser cannot read says so in the interface's language, not in the browser's English, and saves nothing", async ({ page }) => {
  await signIn(page);
  const before = (await state(page.request)).counts.items;
  await dropBroken(page);
  await openInbox(page);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".inbox-result")).toHaveText("没存入：这种文件存不了");
  await expect(page.locator(".inbox-result")).not.toContainText(/decode|source image/i);
  // It can be taken off again, and nothing was made of it.
  await openInbox(page);
  await expect(page.locator(".inbox-files li")).toHaveCount(1);
  await page.locator(".inbox-files button", { hasText: "拿掉" }).click();
  expect((await state(page.request)).counts.items).toBe(before);
});

test("QA #87: the same in English", async ({ page }) => {
  await signIn(page, "/assistants/account");
  await page.getByTestId("language").selectOption("en");
  await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
  await page.goto("/");
  const before = (await state(page.request)).counts.items;
  await dropBroken(page);
  await openInbox(page);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".inbox-result")).toContainText("This kind of file cannot be saved");
  await expect(page.locator(".inbox-result")).not.toContainText(/decode|source image/i);
  expect((await state(page.request)).counts.items).toBe(before);
});

test("QA #87: an animation whose picture was not stored (over the storage quota) does not say that a frame was kept", async ({ page, request }) => {
  await reset(request, { over_quota: true });
  await signIn(page);
  await drop(page, { gif: gif(3) });
  await openInbox(page);
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".said")).toHaveText("已存入。图片没存入：超出存储配额。");
  await expect(page.locator(".said")).not.toContainText("动图");
});
