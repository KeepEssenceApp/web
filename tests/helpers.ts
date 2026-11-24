import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "..");
export const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

export function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

/** The colour values the tokens define, upper-cased. */
export function tokenColours(): Set<string> {
  return new Set([...read("design/tokens.css").matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toUpperCase()));
}
export function tokenNames(): Set<string> {
  return new Set([...read("design/tokens.css").matchAll(/(--ke-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}
