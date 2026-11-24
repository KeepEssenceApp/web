// Takes screenshots of the main screens (light and dark, desktop and phone) for a visual check.
//   node dev/fake-core.mjs &   then   node dev/shots.mjs [BASE_URL]
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:8803";
const OUT = "screenshots";
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["today", "/"],
  ["item", "/item/it_worth"],
  ["digest", "/digest"],
  ["notes", "/notes"],
  ["note", "/notes/n1"],
  ["calendar", "/calendar"],
  ["assistants", "/assistants"],
  ["connect", "/assistants/connect"],
  ["rules", "/assistants/rules"],
  ["devices", "/assistants/devices"],
  ["mycalendar", "/assistants/calendar"],
  ["notify", "/assistants/notify"],
  ["account", "/assistants/account"],
  ["authorize", "/authorize?request=req_agent"],
  ["approve", "/approve"],
];

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  for (const [form, opts] of [
    ["desktop", { viewport: { width: 1280, height: 860 } }],
    ["phone", { ...devices["Pixel 7"] }],
  ]) {
    const ctx = await browser.newContext({ ...opts, colorScheme: scheme, locale: process.env.SHOT_LOCALE ?? "zh-CN" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.screenshot({ path: `${OUT}/${form}-${scheme}-signin.png` });
    await page.fill('input[type="email"]', "reader@example.com");
    await page.click('button[type="submit"]');
    await page.fill('input[name="code"]', process.env.LOGIN_CODE ?? "246810");
    await page.click('button[type="submit"]');
    await page.waitForSelector(".nav");
    for (const [name, path] of PAGES) {
      await page.goto(BASE + path);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/${form}-${scheme}-${name}.png`, fullPage: form === "desktop" && name !== "today" ? false : false });
    }
    await ctx.close();
  }
}
await browser.close();
console.log("screenshots in", OUT);
