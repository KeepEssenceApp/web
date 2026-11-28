import { describe, expect, it } from "vitest";
import { imageFrames, pngFrames, webpFrames } from "../src/frames";

// Made-up files, as much of each as counting reads: the pictures themselves are not needed, only the chunks around them.
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const zeros = (n: number) => Array<number>(n).fill(0);

// PNG: signature, then chunks of length, type, data and a checksum (which counting does not read).
const png = (...chunks: number[][]) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flat()]);
const pngChunk = (type: string, data: number[]) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
const IHDR = pngChunk("IHDR", [...be32(96), ...be32(64), 8, 6, 0, 0, 0]);
const IDAT = pngChunk("IDAT", [0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]);
const IEND = pngChunk("IEND", []);
const acTL = (frames: number) => pngChunk("acTL", [...be32(frames), ...be32(0)]);
const fcTL = (n: number) => pngChunk("fcTL", [...be32(n), ...zeros(22)]);
const fdAT = (n: number) => pngChunk("fdAT", [...be32(n), 0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]);
const apng = (frames: number) => png(IHDR, acTL(frames), fcTL(0), IDAT, ...Array.from({ length: frames - 1 }, (_, k) => [...fcTL(2 * k + 1), ...fdAT(2 * k + 2)]), IEND);

// WebP: "RIFF", the size, "WEBP", then chunks of type, length (little-endian), data, and a byte more when the data is odd.
const webpChunk = (type: string, data: number[]) => [...ascii(type), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
const riff = (...chunks: number[][]) => {
  const body = [...ascii("WEBP"), ...chunks.flat()];
  return new Uint8Array([...ascii("RIFF"), ...le32(body.length), ...body]);
};
const VP8X = (flags: number) => webpChunk("VP8X", [flags, 0, 0, 0, 95, 0, 0, 63, 0, 0]);
const VP8L = webpChunk("VP8L", [0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00]);
const ANIM = webpChunk("ANIM", [...zeros(4), 0, 0]);
const ANMF = webpChunk("ANMF", [...zeros(6), 95, 0, 0, 63, 0, 0, 100, 0, 0, 0, ...VP8L]);
const animatedWebp = (frames: number) => riff(VP8X(0x02), ANIM, ...Array.from({ length: frames }, () => ANMF));

describe("QA #87: how many pictures a PNG holds", () => {
  it("is 2 for an APNG with two frames, and the acTL count for more", () => {
    expect(pngFrames(apng(2))).toBe(2);
    expect(pngFrames(apng(5))).toBe(5);
  });

  it("is 1 for a still PNG, and for an APNG that says it has one frame", () => {
    expect(pngFrames(png(IHDR, IDAT, IEND))).toBe(1);
    expect(pngFrames(png(IHDR, acTL(1), fcTL(0), IDAT, IEND))).toBe(1);
    expect(pngFrames(png(IHDR, acTL(0), IDAT, IEND))).toBe(1);
  });

  it("an acTL after the picture is not an animation (the format puts it before the first IDAT)", () => {
    expect(pngFrames(png(IHDR, IDAT, acTL(2), IEND))).toBe(1);
  });

  it("does not run off the end of a cut file, and is 0 for bytes that are not a PNG", () => {
    expect(pngFrames(apng(3).slice(0, 8 + IHDR.length + 10))).toBe(1);
    expect(pngFrames(apng(3).slice(0, 8 + IHDR.length + 8 + 4))).toBe(1);
    expect(pngFrames(new Uint8Array())).toBe(0);
    expect(pngFrames(new TextEncoder().encode("%PDF-1.7 hello, not a picture"))).toBe(0);
    expect(pngFrames(animatedWebp(2))).toBe(0);
  });
});

describe("QA #87: how many pictures a WebP holds", () => {
  it("counts the ANMF chunks of an animated WebP", () => {
    expect(webpFrames(animatedWebp(2))).toBe(2);
    expect(webpFrames(animatedWebp(6))).toBe(6);
  });

  it("is 1 for a still WebP, lossy or lossless, with or without a VP8X header", () => {
    expect(webpFrames(riff(webpChunk("VP8 ", zeros(10))))).toBe(1);
    expect(webpFrames(riff(VP8L))).toBe(1);
    // VP8X without the animation flag: colour profile (0x20), alpha (0x10), metadata (0x08, 0x04) are still pictures.
    for (const flags of [0x00, 0x10, 0x20, 0x08, 0x04, 0x3c]) expect(webpFrames(riff(VP8X(flags), VP8L))).toBe(1);
  });

  it("the flag decides: ANMF chunks under a header without it are not an animation, one frame under it is not either", () => {
    expect(webpFrames(riff(VP8X(0x10), ANMF, ANMF))).toBe(1);
    expect(webpFrames(riff(VP8X(0x02), ANIM, ANMF))).toBe(1);
  });

  it("a chunk of odd size does not hide the frames after it", () => {
    const exif = webpChunk("EXIF", [1, 2, 3, 4, 5]);
    expect(webpFrames(riff(VP8X(0x0a), ANIM, exif, ANMF, ANMF))).toBe(2);
    expect(webpFrames(riff(VP8X(0x02), webpChunk("ANIM", [0, 0, 0, 0, 0, 0, 7]), ANMF, ANMF, ANMF))).toBe(3);
  });

  it("does not run off the end of a cut file, and is 0 for bytes that are not a WebP", () => {
    const cut = animatedWebp(3).slice(0, 12 + VP8X(2).length + ANIM.length + ANMF.length + 12);
    expect(webpFrames(cut)).toBe(2);
    expect(webpFrames(animatedWebp(3).slice(0, 14))).toBe(1);
    expect(webpFrames(new Uint8Array())).toBe(0);
    expect(webpFrames(new Uint8Array([...ascii("RIFF"), ...le32(4), ...ascii("WAVE")]))).toBe(0);
    expect(webpFrames(apng(2))).toBe(0);
  });
});

describe("QA #87: imageFrames tells the three by their bytes", () => {
  const gif = (n: number) => {
    const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00];
    const frame = [0x21, 0xf9, 0x04, 0x01, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00];
    return new Uint8Array([...header, ...Array.from({ length: n }, () => frame).flat(), 0x3b]);
  };

  it("two frames in any of them is two; a still picture in any of them is one", () => {
    expect(imageFrames(gif(2))).toBe(2);
    expect(imageFrames(apng(2))).toBe(2);
    expect(imageFrames(animatedWebp(2))).toBe(2);
    expect(imageFrames(gif(1))).toBe(1);
    expect(imageFrames(png(IHDR, IDAT, IEND))).toBe(1);
    expect(imageFrames(riff(VP8X(0x10), VP8L))).toBe(1);
  });

  it("is 0 for a JPEG, a PDF, text and nothing", () => {
    expect(imageFrames(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]))).toBe(0);
    expect(imageFrames(new TextEncoder().encode("%PDF-1.7 hello"))).toBe(0);
    expect(imageFrames(new TextEncoder().encode("A few made-up words."))).toBe(0);
    expect(imageFrames(new Uint8Array())).toBe(0);
  });
});
