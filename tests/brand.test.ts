// #106: the two official lockups the core's mails point at (`{APP_ORIGIN}/brand/lockup-{en,zh}-black.png`).
// They are the marketing repo's files, copied byte for byte and pinned by sha256; this checks they are real PNGs
// of the expected shape, not the app's page (which is what an unknown path answers, see docs/pitfalls.md).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers";

/** marketing `brand/lockup/` as of commit b77cb15 (marketing PR #2); change them only together with that source. */
const LOCKUPS = {
  en: { sha256: "988b1337c973302ed7340980732f3c7627b2b30a6ce04f0eaea7ed3266d67743", width: 1236, height: 288, mailWidth: 137 },
  zh: { sha256: "daa050890e8759da94524ea4ab9ddd18c5d61344cde7aed4b10afd4ef2d20b55", width: 658, height: 288, mailWidth: 73 },
} as const;
/** The height the core's mails show the lockup at (core `src/services/mailcopy.ts`), in pixels. */
const MAIL_HEIGHT = 32;

const file = (lang: "en" | "zh") => path.join(ROOT, "public", "brand", `lockup-${lang}-black.png`);

describe("#106 the lockups for the mails", () => {
  for (const lang of ["en", "zh"] as const) {
    const want = LOCKUPS[lang];

    it(`${lang}: is a PNG (signature, size, transparent 8-bit colour), not a page`, () => {
      const bytes = fs.readFileSync(file(lang));
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // IHDR: width and height, bit depth 8, colour type 6 (RGBA: the background is transparent).
      expect(bytes.readUInt32BE(16)).toBe(want.width);
      expect(bytes.readUInt32BE(20)).toBe(want.height);
      expect(bytes[24]).toBe(8);
      expect(bytes[25]).toBe(6);
      expect(bytes.subarray(0, 64).toString("latin1")).not.toMatch(/<!doctype|<html|<svg/i);
    });

    it(`${lang}: is the official file, byte for byte`, () => {
      expect(createHash("sha256").update(fs.readFileSync(file(lang))).digest("hex")).toBe(want.sha256);
      // Next to a marketing checkout that has the lockup, it is the same file.
      const source = path.join(ROOT, "..", "marketing", "brand", "lockup", `lockup-${lang}-black.png`);
      if (fs.existsSync(source)) expect(fs.readFileSync(file(lang)).equals(fs.readFileSync(source))).toBe(true);
    });

    it(`${lang}: the size the mail declares keeps the file's proportions`, () => {
      expect(Math.abs((want.width * MAIL_HEIGHT) / want.height - want.mailWidth)).toBeLessThan(0.5);
    });
  }
});
