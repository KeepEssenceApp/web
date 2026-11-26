// Reading a GIF's blocks, without decoding it. Kept apart from lib.ts, which needs a browser to load.

/**
 * How many pictures a GIF holds, by walking its blocks (no decoding): 1 for a still GIF, more for an animation, 0 when
 * the bytes are not a GIF. Saving turns an image into one still picture, so a GIF with more than one is told so (QA #87).
 */
export function gifFrames(b: Uint8Array): number {
  if (b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return 0;
  let i = 13;
  if (b[10] & 0x80) i += 3 * 2 ** ((b[10] & 7) + 1);
  const skip = () => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    i++;
  };
  let frames = 0;
  while (i < b.length) {
    const block = b[i++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      i++;
      skip();
    } else if (block === 0x2c) {
      frames++;
      const flags = b[i + 8] ?? 0;
      i += 9;
      if (flags & 0x80) i += 3 * 2 ** ((flags & 7) + 1);
      i++;
      skip();
    } else break;
  }
  return frames;
}
