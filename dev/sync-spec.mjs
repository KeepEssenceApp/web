// Copies the files this repo takes from the spec repo (checked out next to it).
import fs from "node:fs";
const pairs = [
  ["../spec/contract/openapi.yaml", "contract/openapi.yaml"],
  ["../spec/design/tokens.css", "design/tokens.css"],
  ["../spec/design/terms.md", "design/terms.md"],
  ["../spec/product/glossary.md", "design/glossary.md"],
];
for (const [from, to] of pairs) {
  fs.copyFileSync(from, to);
  console.log(`${from} -> ${to}`);
}
