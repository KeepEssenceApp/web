// W11 (static half): the credential is read in one place and handed only to the request header.
// The browser half is e2e/credential.spec.ts.
import { describe, expect, it } from "vitest";
import { read, walk } from "./helpers";

const files = walk("src", [".ts", ".tsx"]);

describe("credential", () => {
  it("is read from storage only in session.ts", () => {
    const users = files.filter((f) => read(f).includes("ke.credential"));
    expect(users).toEqual(["src/session.ts"]);
  });

  it("is used only by the API client, as the bearer value", () => {
    const callers = files.filter((f) => /\bcredential\(\)/.test(read(f)));
    expect(callers).toEqual(["src/api.ts"]);
    const api = read("src/api.ts");
    expect(api.match(/\bcred\b/g)!.length).toBeLessThanOrEqual(5);
    expect(api).toContain("headers.Authorization = `Bearer ${cred}`");
  });

  it("is never rendered, logged or put in an address", () => {
    for (const f of files) {
      const text = read(f);
      expect(text, f).not.toMatch(/console\.(log|info|debug|warn|error)/);
      if (f.endsWith(".tsx")) expect(text, f).not.toMatch(/grant\.credential\s*}/);
    }
    // The only place a grant's credential is touched is where it is stored.
    const touching = files.filter((f) => /(?<!ke)\.credential\b/.test(read(f)));
    expect(touching).toEqual(["src/pages/SignIn.tsx"]);
  });

  it("has no field where a credential could be typed or pasted", () => {
    for (const f of files.filter((x) => x.endsWith(".tsx"))) expect(read(f), f).not.toMatch(/type="password"/);
  });
});
