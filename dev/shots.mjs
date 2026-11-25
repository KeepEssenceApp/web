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

// SHOTS=qa24 takes only the wide-screen set of QA #24 (the last block).
const ONLY = process.env.SHOTS ?? "";
const browser = await chromium.launch();
for (const scheme of ONLY ? [] : ["light", "dark"]) {
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
// Wide screens (QA #17): the list with the panel beside it, at 1440 and 1920.
const WIDE_PAGES = [
  ["today-item", "/item/it_worth"],
  ["today", "/"],
  ["digest", "/digest"],
  ["digest-item", "/digest?item=d1_w1"],
  ["notes", "/notes"],
  ["note", "/notes/n1"],
  ["assistants", "/assistants"],
];
for (const scheme of ONLY ? [] : ["light", "dark"]) {
  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: process.env.SHOT_LOCALE ?? "zh-CN" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.fill('input[type="email"]', "reader@example.com");
    await page.click('button[type="submit"]');
    await page.fill('input[name="code"]', process.env.LOGIN_CODE ?? "246810");
    await page.click('button[type="submit"]');
    await page.waitForSelector(".nav");
    for (const [name, path] of WIDE_PAGES) {
      await page.goto(BASE + path);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/wide-${width}-${scheme}-${name}.png` });
    }
    await ctx.close();
  }
}
// QA #24: Today, Notes, Calendar and Account at 1440 and 1920, light and dark, with nothing open
// ("idle") and with something open ("open"): an item, a note, a day, and the delete area filled in.
const yesterday = new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const QA24 = [
  ["today-idle", "/"],
  ["today-open", "/item/it_worth"],
  ["notes-idle", "/notes"],
  ["notes-open", "/notes/n1"],
  ["calendar-idle", "/calendar"],
  ["calendar-open", `/calendar?day=${yesterday}`],
  ["account-idle", "/assistants/account"],
  ["account-open", "/assistants/account", async (page) => page.fill('input[name="confirm_email"]', "reader@example.com")],
];
for (const scheme of ["light", "dark"]) {
  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: process.env.SHOT_LOCALE ?? "zh-CN" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.fill('input[type="email"]', "reader@example.com");
    await page.click('button[type="submit"]');
    await page.fill('input[name="code"]', process.env.LOGIN_CODE ?? "246810");
    await page.click('button[type="submit"]');
    await page.waitForSelector(".nav");
    for (const [name, path, then] of QA24) {
      await page.goto(BASE + path);
      await page.waitForLoadState("networkidle");
      if (then) await then(page);
      await page.screenshot({ path: `${OUT}/qa24-${width}-${scheme}-${name}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
console.log("screenshots in", OUT);
