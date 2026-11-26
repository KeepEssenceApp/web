import { describe, expect, it } from "vitest";
import { gifFrames } from "../src/gif";

// A GIF 1 x 1 pixel, as the usual smallest one is written, with `n` pictures in it.
const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00];
const frame = [0x21, 0xf9, 0x04, 0x01, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00];
const gif = (n: number) => new Uint8Array([...header, ...Array.from({ length: n }, () => frame).flat(), 0x3b]);

describe("QA #87: how many pictures a GIF holds", () => {
  it("counts the pictures of a still GIF and of an animation", () => {
    expect(gifFrames(gif(1))).toBe(1);
    expect(gifFrames(gif(2))).toBe(2);
    expect(gifFrames(gif(7))).toBe(7);
  });

  it("is 0 for bytes that are not a GIF, and does not run off the end of a cut one", () => {
    expect(gifFrames(new Uint8Array())).toBe(0);
    expect(gifFrames(new TextEncoder().encode("%PDF-1.7 hello, not a picture"))).toBe(0);
    expect(gifFrames(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]))).toBe(0);
    const cut = gif(3).slice(0, header.length + frame.length + 10);
    expect(gifFrames(cut)).toBe(2);
    expect(gifFrames(gif(3).slice(0, 20))).toBeLessThanOrEqual(1);
  });

  it("a local colour table does not hide the next picture", () => {
    // The picture's descriptor says that it has a table of 2 colours (flag 0x80): 6 bytes more before the data.
    const withTable = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x80, 0, 0, 0, 255, 255, 255, 0x02, 0x02, 0x44, 0x01, 0x00];
    expect(gifFrames(new Uint8Array([...header, ...withTable, ...frame, 0x3b]))).toBe(2);
  });
});
