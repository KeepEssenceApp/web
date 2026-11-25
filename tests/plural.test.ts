// QA #50: one of a thing is never said in the plural.
import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";
import { fill } from "../src/i18n/fill";

describe("counts in English", () => {
  it("says one daily digest, one note, one day", () => {
    expect(fill(en["calendar.counts"], { saved: 52, digests: 1, read: 1, notes: 1 })).toBe("52 saved · 1 daily digest · 1 digest read · 1 note");
    expect(fill(en["calendar.counts"], { saved: 1, digests: 2, read: 0, notes: 3 })).toBe("1 saved · 2 daily digests · 0 digests read · 3 notes");
    expect(fill(en["today.days_left"], { n: 1 })).toBe("1 day left");
    expect(fill(en["today.days_left"], { n: 30 })).toBe("30 days left");
    expect(fill(en["assistant.usage.line"], { calls: "1", items: "1", input: "1,204", output: "1" })).toBe("1 call · 1 item · 1,204 word pieces read · 1 word piece written");
  });
  it("leaves no number followed by a bare plural in any English sentence", () => {
    for (const [key, text] of Object.entries(en)) {
      const vars = Object.fromEntries([...text.matchAll(/\{(?:s:)?(\w+)\}/g)].map((m) => [m[1], 1]));
      expect(fill(text, vars), key).not.toMatch(/(^|[^\d.,])1 (\w+ )?(days|notes|digests|items|calls|assistants|pieces|analyses)\b/);
    }
  });
  it("is not used in Chinese", () => {
    for (const text of Object.values(zh)) expect(text).not.toContain("{s:");
  });
});
