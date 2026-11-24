// W9: the interface only uses the words of design/terms.md; none of the banned words appears.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { zh } from "../src/i18n/zh";
import { en } from "../src/i18n/en";
import { ROOT, read, walk } from "./helpers";

/** Banned words, read from the two documents at test time. */
function banned() {
  const terms = read("design/terms.md").split("\n").find((l) => l.startsWith("不用的词"))!;
  const glossary = read("design/glossary.md");
  const section = glossary.slice(glossary.indexOf("## 不用的词"));
  const lines = section.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  const plain = lines[0];
  const metaphors = lines[1].slice(lines[1].indexOf("包括：") + 3);
  const clean = (w: string) => w.replace(/（[^）]*）/g, "").replace(/[。.]$/, "").trim();
  const zhWords = new Set<string>();
  const enWords = new Set<string>();
  for (const part of terms.replace(/^不用的词（[^）]*）：/, "").replace(/，以及任何比喻。?$/, "").split("、")) {
    const m = clean(part).match(/^([一-鿿]+)?\s*([A-Za-z][A-Za-z ]*)?$/);
    if (m?.[1]) zhWords.add(m[1]);
    if (m?.[2]) enWords.add(m[2].trim().toLowerCase());
  }
  for (const part of [...plain.split("、"), ...metaphors.split("、")]) {
    const w = clean(part);
    if (!w) continue;
    if (/^[A-Za-z ]+$/.test(w)) enWords.add(w.toLowerCase());
    else zhWords.add(w);
  }
  // The glossary's metaphor list names 深挖, which is also the glossary's own word for
  // "deep dive" and is required by design/terms.md. The term table wins; reported upstream.
  zhWords.delete("深挖");
  return { zhWords, enWords };
}

const { zhWords, enWords } = banned();
// "设置 / settings" is banned as the name of an entry; 助手设置 is the glossary's own term,
// and the connect guides quote another product's menu ("Settings → Connected Apps").
const entryOnly = new Set(["设置", "settings"]);

describe("words", () => {
  it("reads a real list of banned words", () => {
    for (const w of ["书签", "知识库", "搜索", "首页", "喜欢", "钥匙", "蜂巢", "token"]) expect(zhWords.has(w) || enWords.has(w)).toBe(true);
    for (const w of ["bookmark", "search", "home", "settings", "api key", "like"]) expect(enWords.has(w)).toBe(true);
  });

  it("has no banned Chinese word in the Chinese dictionary", () => {
    const hits: string[] = [];
    for (const [key, value] of Object.entries(zh)) {
      const text = value.replace(/助手设置/g, "");
      for (const w of zhWords) if (text.includes(w)) hits.push(`${key}: ${w}`);
      for (const w of enWords) if (!entryOnly.has(w) && new RegExp(`\\b${w}s?\\b`, "i").test(text)) hits.push(`${key}: ${w}`);
    }
    expect(hits).toEqual([]);
  });

  it("has no banned English word in the English dictionary", () => {
    const hits: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      for (const w of enWords) {
        if (entryOnly.has(w) && key.startsWith("connect.")) continue;
        if (new RegExp(`\\b${w}s?\\b`, "i").test(value)) hits.push(`${key}: ${w}`);
      }
      for (const w of zhWords) if (value.includes(w)) hits.push(`${key}: ${w}`);
    }
    expect(hits).toEqual([]);
  });

  it("names the four entries exactly as the term table does", () => {
    expect([zh["nav.today"], zh["nav.digest"], zh["nav.notes"], zh["nav.assistants"]]).toEqual(["今天", "每日摘要", "笔记", "助手设置"]);
    expect([en["nav.today"], en["nav.digest"], en["nav.notes"], en["nav.assistants"]]).toEqual(["Today", "Daily digest", "Notes", "Assistants"]);
    const table = read("design/terms.md");
    for (const [a, b] of [["读了，晚安", "Read. Good night"], ["加入深挖队列", "Add to the deep-dive queue"], ["把结果贴回来", "Paste the result back"], ["移出队列", "Remove from the queue"], ["看精读", "See the deep read"], ["接入一个助手", "Connect an assistant"]]) {
      expect(table).toContain(`| ${a} | ${b} |`);
      expect(Object.values(zh)).toContain(a);
      expect(Object.values(en)).toContain(b);
    }
  });

  it("has both languages for every string, and none empty by accident", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const [k, v] of Object.entries(zh)) if (k !== "calendar.mark.future") expect(v, k).not.toBe("");
  });

  it("keeps Chinese text out of the components: every visible string is in a dictionary", () => {
    const hits = walk("src", [".tsx", ".ts"])
      .filter((f) => !f.includes(`${path.sep}i18n${path.sep}`))
      .filter((f) => /[一-鿿]/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
    expect(hits).toEqual([]);
  });

  it("uses every dictionary key's vocabulary from the copies that match the spec repo", () => {
    for (const [mine, theirs] of [["design/tokens.css", "../spec/design/tokens.css"], ["design/terms.md", "../spec/design/terms.md"], ["design/glossary.md", "../spec/product/glossary.md"], ["contract/openapi.yaml", "../spec/contract/openapi.yaml"]]) {
      const spec = path.join(ROOT, theirs);
      if (fs.existsSync(spec)) expect(read(mine), `${mine} differs from the spec repo; run npm run sync:spec`).toBe(fs.readFileSync(spec, "utf8"));
    }
  });
});
