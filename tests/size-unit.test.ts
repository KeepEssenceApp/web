import { describe, expect, it } from "vitest";
import { mib } from "../src/size";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";

describe("QA #87: the size limit is written in the unit it is in", () => {
  it("3,145,728 bytes is 3 MiB; other limits keep one decimal, rounded down so that 'larger than N' is true of every refused file", () => {
    expect(mib(3145728)).toBe("3");
    expect(mib(5 * 1048576)).toBe("5");
    expect(mib(1572864)).toBe("1.5");
    expect(mib(3000000)).toBe("2.8"); // 2.86 MiB: a file of 2.87 MiB is refused, and is larger than 2.8, not than 2.9
    expect(mib(3145729)).toBe("3"); // one byte over 3 MiB is larger than 3
    expect(mib(1)).toBe("0");
  });

  it("the sentences say MiB in both languages, and never MB", () => {
    for (const text of [en["inbox.too_large"], zh["inbox.too_large"]]) {
      expect(text).toContain("{mib} MiB");
      expect(text).not.toMatch(/\bMB\b/);
    }
  });
});
