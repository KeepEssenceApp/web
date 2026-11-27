// W8: every colour in the app comes from design/tokens.css.
import { describe, expect, it } from "vitest";
import { read, tokenColours, tokenNames, walk } from "./helpers";

const NAMED = ["black", "white", "red", "green", "yellow", "blue", "gray", "grey", "gold", "orange", "purple", "pink", "silver", "navy", "teal", "lime", "aqua", "maroon", "olive", "brown", "crimson", "tomato", "goldenrod", "whitesmoke", "gainsboro", "darkgray", "dimgray", "lightgray", "lightgrey"];
const sources = walk("src", [".css", ".tsx", ".ts"]);
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("colours", () => {
  it("has no colour literal in CSS, TSX or TS", () => {
    const found: string[] = [];
    for (const file of sources) {
      const text = strip(read(file));
      for (const m of text.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/g)) found.push(`${file}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });

  it("uses no named colour in a CSS declaration", () => {
    const found: string[] = [];
    for (const file of sources.filter((f) => f.endsWith(".css"))) {
      for (const m of strip(read(file)).matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
        const value = m[2].replace(/var\([^)]*\)/g, "");
        for (const name of NAMED) if (new RegExp(`(^|[\\s,(])${name}($|[\\s,)])`, "i").test(value)) found.push(`${file}: ${m[1]}: ${m[2]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("only refers to tokens that exist", () => {
    const names = tokenNames();
    // Layout variables of the app itself (a cell of the calendar, the phone bar, where a popover or a sheet sits), not design tokens.
    const local = new Set(["--cell", "--gap", "--dot", "--tiny", "--nav-h", "--pop-left", "--pop-bottom", "--pop-origin", "--vv-left", "--vv-bottom", "--vv-width", "--vv-height"]);
    const missing: string[] = [];
    for (const file of sources) for (const m of read(file).matchAll(/var\((--[a-z0-9-]+)/g)) if (!names.has(m[1]) && !local.has(m[1])) missing.push(`${file}: ${m[1]}`);
    expect(missing).toEqual([]);
  });

  it("uses only the token radii (0, 8, 14, 20, 28, pill) and circles", () => {
    const bad: string[] = [];
    for (const m of strip(read("src/styles/app.css")).matchAll(/border-radius\s*:\s*([^;]+);/g)) {
      const parts = m[1].trim().split(/\s+/);
      if (!parts.every((p) => /^var\(--ke-radius(-mark|-tag|-card|-sheet|-control)?\)$/.test(p) || p === "0" || p === "50%")) bad.push(m[1]);
    }
    expect(bad).toEqual([]);
  });

  it("keeps the page, the manifest and inline SVG within the token colours", () => {
    const allowed = tokenColours();
    const used = [
      ...read("index.html").matchAll(/#[0-9a-fA-F]{6}\b/g),
      ...read("public/manifest.webmanifest").matchAll(/#[0-9a-fA-F]{6}\b/g),
      ...read("public/sw.js").matchAll(/#[0-9a-fA-F]{6}\b/g),
    ].map((m) => m[0].toUpperCase());
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((c) => !allowed.has(c))).toEqual([]);
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    expect(manifest.background_color.toUpperCase()).toBe("#0B0B0B");
  });

  it("has no green and no yellow among the tokens it relies on", () => {
    // Red is the only functional colour; gold is the only accent.
    // The greys, the paper, black and white; gold and its darker ink (#795600, #F2D27D: a gold word only); red and its dark-theme twin.
    expect([...tokenColours()].sort()).toEqual(
      ["#0B0B0B", "#191817", "#252321", "#292725", "#343231", "#383532", "#45403D", "#605B59", "#625C57", "#795600", "#B3261E", "#BDB5AF", "#C5A229", "#D7D1CF", "#DDD7D2", "#EEECEC", "#EFEBE7", "#F2877B", "#F2D27D", "#F5F5F3", "#F6F3F0", "#F9F6F4", "#FFFDFC", "#FFFFFF"].sort(),
    );
  });
});
