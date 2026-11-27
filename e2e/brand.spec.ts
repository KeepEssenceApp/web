// #106: the core's mails point at `{APP_ORIGIN}/brand/lockup-{en,zh}-black.png`. In production an unknown path
// answers with the app's own page and a 200, so the status code proves nothing: this looks at the content type,
// the PNG header and the bytes. It runs against the fake core, which serves dist/ but answers 404 (not the page) for
// a missing file with an extension: it shows the build holds the files, not what production answers (docs/pitfalls.md).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const dist = (name: string) => path.join(process.cwd(), "dist", "brand", name);

for (const lang of ["en", "zh"] as const) {
  test(`#106 /brand/lockup-${lang}-black.png is the PNG, with an image content type, not the app's page`, async ({ request }) => {
    const res = await request.get(`/brand/lockup-${lang}-black.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    const body = await res.body();
    expect([...body.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // Byte for byte what the build holds, and what the repo pins (tests/brand.test.ts).
    expect(createHash("sha256").update(body).digest("hex")).toBe(createHash("sha256").update(fs.readFileSync(dist(`lockup-${lang}-black.png`))).digest("hex"));
  });
}
