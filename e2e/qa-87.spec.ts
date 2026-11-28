// Internal QA #87: what happens to a picture is said once, beside the files that wait (not after each save, not as a
// question), and a GIF that was an animation says that one picture was kept. The success sentence stays the core's.
import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { reset, signIn, state, openInbox } from "./helpers";

test.beforeEach(async ({ request }) => reset(request));

/** A GIF made of `n` pictures of 1 x 1 pixel (the usual smallest GIF, repeated), as base64. */
const gif = (n: number) => {
  const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00];
  const frame = [0x21, 0xf9, 0x04, 0x01, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00];
  return Buffer.from([...header, ...Array.from({ length: n }, () => frame).flat(), 0x3b]).toString("base64");
};

// Made-up animations the browser can really read: 8 x 8 pixels, two plain colours, built here byte by byte.
const SIDE = 8;
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const pngChunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
};
const colour = (rgb: number[]) => deflateSync(Buffer.concat(Array.from({ length: SIDE }, () => Buffer.from([0, ...Array.from({ length: SIDE }, () => [...rgb, 255]).flat()]))));
const frameControl = (sequence: number) => {
  const d = Buffer.alloc(26);
  d.writeUInt32BE(sequence, 0);
  d.writeUInt32BE(SIDE, 4);
  d.writeUInt32BE(SIDE, 8);
  d.writeUInt16BE(10, 20); // 10 / 100 s
  d.writeUInt16BE(100, 22);
  return pngChunk("fcTL", d);
};
/** An APNG whose `acTL` says `frames` pictures (with 1 it is a still picture that carries the chunk), as base64. */
const apng = (frames: number) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIDE, 0);
  header.writeUInt32BE(SIDE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const parts = [pngChunk("IHDR", header), pngChunk("acTL", Buffer.concat([u32(frames), u32(0)])), frameControl(0), pngChunk("IDAT", colour([200, 30, 30]))];
  let sequence = 1;
  for (let f = 1; f < frames; f++) parts.push(frameControl(sequence++), pngChunk("fdAT", Buffer.concat([u32(sequence++), colour([30, 30, 200])])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...parts, pngChunk("IEND", Buffer.alloc(0))]).toString("base64");
};

const le = (n: number, bytes: number) => {
  const b = Buffer.alloc(bytes);
  b.writeUIntLE(n, 0, bytes);
  return b;
};
const riffChunk = (type: string, data: Buffer) => Buffer.concat([Buffer.from(type, "ascii"), le(data.length, 4), data, Buffer.alloc(data.length & 1)]);
const riff = (...chunks: Buffer[]) => {
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), le(body.length, 4), body]);
};
const vp8x = (flags: number) => riffChunk("VP8X", Buffer.concat([Buffer.from([flags, 0, 0, 0]), le(SIDE - 1, 3), le(SIDE - 1, 3)]));
const anmf = (picture: Buffer) => riffChunk("ANMF", Buffer.concat([le(0, 3), le(0, 3), le(SIDE - 1, 3), le(SIDE - 1, 3), le(100, 3), Buffer.from([0]), picture]));
/** The picture chunks (VP8 or VP8L, with ALPH) of a still 8 x 8 WebP that the browser's own encoder makes. */
async function webpPicture(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async (side) => {
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#c81e1e";
    g.fillRect(0, 0, side, side);
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/webp", 1));
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  }, SIDE);
  const still = Buffer.from(base64, "base64");
  const keep: Buffer[] = [];
  for (let i = 12; i + 8 <= still.length; ) {
    const size = still.readUInt32LE(i + 4);
    const end = i + 8 + size + (size & 1);
    if (["ALPH", "VP8 ", "VP8L"].includes(still.toString("ascii", i, i + 4))) keep.push(still.subarray(i, end));
    i = end;
  }
  expect(keep.length, "the encoder made a WebP with a picture in it").toBeGreaterThan(0);
  return Buffer.concat(keep);
}
const animatedWebp = (picture: Buffer, frames: number) => riff(vp8x(0x02), riffChunk("ANIM", Buffer.alloc(6)), ...Array.from({ length: frames }, () => anmf(picture)));

type Kind = "png" | "txt" | "pdf" | { gif: string } | { bytes: string; name: string; type: string };
/** Puts one file on the inbox the way a drop does. */
async function drop(page: Page, kind: Kind) {
  await page.evaluate(async (k) => {
    let file: File;
    if (typeof k === "object") {
      const [base64, name, type] = "gif" in k ? [k.gif, "motion.gif", "image/gif"] : [k.bytes, k.name, k.type];
      file = new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type });
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

// The count is the file's own (QA #87 ruling, 2026-11-28): an APNG and an animated WebP are told like a GIF, by their bytes.
const file = (bytes: Buffer, name: string, type: string): Kind => ({ bytes: bytes.toString("base64"), name, type });
const frameCases: [string, (page: Page) => Promise<Kind>, boolean][] = [
  ["an APNG of two frames", async () => ({ bytes: apng(2), name: "motion.png", type: "image/png" }), true],
  ["an APNG of five frames", async () => ({ bytes: apng(5), name: "motion.png", type: "image/png" }), true],
  ["an animated WebP of two frames", async (page) => file(animatedWebp(await webpPicture(page), 2), "motion.webp", "image/webp"), true],
  ["an animated WebP that came with the wrong type", async (page) => file(animatedWebp(await webpPicture(page), 2), "motion.png", "image/png"), true],
  ["a PNG that has an acTL chunk with one frame", async () => ({ bytes: apng(1), name: "still.png", type: "image/png" }), false],
  ["a still PNG", async () => "png", false],
  ["a still WebP", async (page) => file(riff(await webpPicture(page)), "still.webp", "image/webp"), false],
  ["a still WebP under a VP8X header without the animation flag", async (page) => file(riff(vp8x(0x10), await webpPicture(page)), "still.webp", "image/webp"), false],
  ["a WebP with the animation flag and one frame", async (page) => file(animatedWebp(await webpPicture(page), 1), "one.webp", "image/webp"), false],
];
for (const [name, make, says] of frameCases) {
  test(`QA #87: ${name} ${says ? "says that one picture was kept, and not which" : "says nothing about frames"}`, async ({ page }) => {
    await signIn(page);
    const before = (await state(page.request)).counts.items;
    await drop(page, await make(page));
    await openInbox(page);
    await page.getByTestId("inbox-save").click();
    await expect(page.locator(".said")).toHaveText(says ? "已存入。 动图只保留了一帧。" : "已存入。");
    await expect(page.locator(".said")).not.toContainText("第一");
    expect((await state(page.request)).counts.items).toBe(before + 1);
  });
}

for (const [name, make] of frameCases.filter(([, , says]) => says)) {
  test(`QA #87: ${name} whose picture was not stored (over the storage quota) does not say that a frame was kept`, async ({ page, request }) => {
    await reset(request, { over_quota: true });
    await signIn(page);
    await drop(page, await make(page));
    await openInbox(page);
    await page.getByTestId("inbox-save").click();
    await expect(page.locator(".said")).toHaveText("已存入。图片没存入：超出存储配额。");
    await expect(page.locator(".said")).not.toContainText("动图");
  });
}
