// How many pictures an image file holds, read from the bytes and not from the type it came with (QA #87). It does not
// decode anything, so it runs anywhere (the page, the unit tests). The extension has the same counter (src/lib/frames.ts):
// keep the two alike.
import { gifFrames } from "./gif";

const at = (b: Uint8Array, n: number): number => b[n] ?? 0;
const be32 = (b: Uint8Array, i: number): number => ((at(b, i) << 24) | (at(b, i + 1) << 16) | (at(b, i + 2) << 8) | at(b, i + 3)) >>> 0;
const le32 = (b: Uint8Array, i: number): number => (at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16) | (at(b, i + 3) << 24)) >>> 0;
const tag = (b: Uint8Array, i: number, name: string): boolean => [...name].every((c, k) => at(b, i + k) === c.charCodeAt(0));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * How many pictures a PNG holds: 1 for a still one, and the `acTL` chunk's count for an APNG (an animated PNG). That
 * chunk comes before the first `IDAT`, so the walk stops there. 0 when the bytes are not a PNG.
 */
export function pngFrames(b: Uint8Array): number {
  if (b.length < 8 || PNG_SIGNATURE.some((v, k) => at(b, k) !== v)) return 0;
  let i = 8;
  while (i + 8 <= b.length) {
    const size = be32(b, i);
    if (tag(b, i + 4, "IDAT") || tag(b, i + 4, "IEND")) break;
    if (tag(b, i + 4, "acTL")) return i + 16 <= b.length ? Math.max(1, be32(b, i + 8)) : 1;
    i += 12 + size; // length, type, data, checksum
  }
  return 1;
}

/**
 * How many pictures a WebP holds: 1 for a still one, and the number of `ANMF` chunks for an animated one. A file with a
 * `VP8X` header is animated only when that header's animation flag is set; without the flag it is a still picture,
 * whatever else it carries (colour profile, alpha, metadata). 0 when the bytes are not a WebP.
 */
export function webpFrames(b: Uint8Array): number {
  if (b.length < 12 || !tag(b, 0, "RIFF") || !tag(b, 8, "WEBP")) return 0;
  if (!tag(b, 12, "VP8X") || !(at(b, 20) & 0x02)) return 1;
  let frames = 0;
  let i = 12;
  while (i + 8 <= b.length) {
    if (tag(b, i, "ANMF")) frames++;
    const size = le32(b, i + 4);
    i += 8 + size + (size & 1); // type, length, data, and a byte more when the data is odd
  }
  return Math.max(1, frames);
}

/** How many pictures a GIF, an APNG or a WebP holds, by the file's own structure: 1 for a still picture, 0 for anything else. */
export function imageFrames(b: Uint8Array): number {
  return gifFrames(b) || pngFrames(b) || webpFrames(b);
}
