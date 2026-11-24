// The shared "looks like a password" rule is taken from the contract, not copied into the app.
import { describe, expect, it } from "vitest";
import { compileRule, looksSecret } from "../src/secret";
import { read, walk } from "./helpers";

const yaml = read("contract/openapi.yaml");
const patterns = [...yaml.matchAll(/- name: (\w+)\n(?:\s+description: .*\n)?\s+regex: (".*")(?:\n\s+flags: (\w+))?/g)].map((m) => ({ name: m[1], regex: JSON.parse(m[2]) as string, flags: m[3] }));
const rules = { secret_like: { max_length_checked: 200, patterns } };

describe("secret-like rule", () => {
  it("finds the five patterns in the contract and compiles each", () => {
    expect(patterns.map((p) => p.name)).toEqual(["private_key_block", "known_credential_prefix", "bearer_or_basic_header", "assignment_of_secret", "single_dense_string"]);
    for (const p of patterns) expect(compileRule(p.regex, p.flags), p.name).toBeInstanceOf(RegExp);
    expect(patterns.filter((p) => p.flags === "i").length).toBe(2);
  });

  it("asks for things that look like a password", () => {
    // Made-up look-alikes, put together here so that no credential-shaped literal sits in the repo.
    const filler = "abcdefghij".repeat(2);
    const samples = [
      ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ") + "\nabc",
      "PASS" + "WORD: " + "Example" + "123",
      "sk-" + filler,
      "Authorization: " + "Bearer " + filler,
      "pass" + "word = " + "hunter" + "2222",
      "API" + "_KEY=" + filler.slice(0, 12),
      ["xK9#", "mQ2$", "vL5@", "pR8"].join(""),
    ];
    for (const s of samples) {
      expect(looksSecret(s, rules), s).toBe(true);
    }
  });

  it("does not ask for ordinary links and text", () => {
    for (const s of ["https://example.com/Some/Path?a=1&B=2#x", "Leases in job queues: a short note", "今天读到一篇讲租约的文章，值得再看一遍。", "hello world"]) {
      expect(looksSecret(s, rules), s).toBe(false);
    }
  });

  it("never counts text longer than max_length_checked", () => {
    expect(looksSecret("sk-" + "abcdefghij".repeat(2) + " " + "x".repeat(200), rules)).toBe(false);
  });

  it("is not hard-coded anywhere in the app", () => {
    for (const f of walk("src", [".ts", ".tsx"])) {
      const text = read(f);
      expect(text, f).not.toContain("PRIVATE KEY");
      expect(text, f).not.toContain("ghp_");
    }
  });
});
