// Internal QA #111: the notification switch.
//
// 1. Its "On" / "Off" (开 / 关) is one word on one line at every width. Before, the page's
//    overflow-wrap: anywhere reached the switch and let the row squeeze it to one letter: English
//    "On" came out as "O" over "n" at 1440 and 360 px (not at 1280), "Off" lost its "f" at 360 px.
//    A test of the phone widths alone misses the desktop failure, and one at 1280 alone misses both.
// 2. The switch is the account's (all devices) and the browser's permission is this device's: a
//    browser that did not allow notifications does not turn the switch off, and the page says so in
//    a sentence of its own right after the one about the account.
//
// Only simulated permission (the page's Notification.permission and requestPermission are replaced
// before it loads): nothing asks the browser, registers a push, or sends a notification.
import { expect, test, type Page } from "@playwright/test";
import { FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed");
test.beforeEach(async ({ request }) => reset(request));

type Lang = "zh" | "en";
type Permission = "default" | "granted" | "denied" | "unsupported";

/** 1440 / 1280 / 360 are the widths the ticket names; 1280 passed before the fix and must still pass. 320 / 960 / 900 failed too. */
const WIDTHS = [1440, 1280, 960, 900, 360, 320];

const pickLang = (page: Page, lang: Lang) => page.addInitScript((l) => localStorage.setItem("ke.lang", l), lang);

/** The page's idea of the browser's permission, without asking the browser for anything. */
async function simulate(page: Page, permission: Permission) {
  await page.addInitScript((perm) => {
    const w = window as unknown as { asks: number };
    w.asks = 0;
    if (perm === "unsupported") {
      delete (window as unknown as { PushManager?: unknown }).PushManager;
      return;
    }
    Object.defineProperty(Notification, "permission", { get: () => perm });
    Notification.requestPermission = async () => {
      w.asks++;
      return perm;
    };
  }, permission);
}

/** What is wrong with the switches on the page right now (empty: every label is whole, on one line, and on the screen). */
async function squeezed(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const out: string[] = [];
    for (const sw of document.querySelectorAll<HTMLElement>(".switch")) {
      const name = sw.getAttribute("aria-label");
      const label = [...sw.children].find((c) => !c.classList.contains("switch-knob")) as HTMLElement;
      const text = label.firstChild as Text;
      const range = document.createRange();
      // Each letter's own line: "O" over "n" has two different tops.
      const tops = new Set<number>();
      for (let i = 0; i < text.data.length; i++) {
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        tops.add(Math.round(range.getBoundingClientRect().top));
      }
      range.selectNodeContents(label);
      const lines = Math.max(tops.size, range.getClientRects().length);
      if (lines !== 1) out.push(`${name}: "${text.data}" is on ${lines} lines (switch ${Math.round(sw.getBoundingClientRect().width)}px wide)`);
      const box = sw.getBoundingClientRect();
      if (box.left < -0.5 || box.right > window.innerWidth + 0.5) out.push(`${name}: the switch spans ${Math.round(box.left)}..${Math.round(box.right)} in a ${window.innerWidth}px window`);
    }
    return out;
  });
}

async function sweep(page: Page, tag: string, found: string[]) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const problem of await squeezed(page)) found.push(`${tag} @${width}px  ${problem}`);
  }
}

for (const lang of ["en", "zh"] as const) {
  test(`QA #111: the notification switch's On and Off stay on one line from 1440 to 320 px (${lang})`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "sets its own viewports");
    await pickLang(page, lang);
    await simulate(page, "denied");
    await signIn(page, "/assistants/notify");
    const sw = page.getByRole("switch", { name: lang === "en" ? "Notifications" : "通知" });
    const on = lang === "en" ? "On" : "开";
    const off = lang === "en" ? "Off" : "关";
    const found: string[] = [];

    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(sw).toHaveText(on);
    await sweep(page, "On ", found);

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(sw).toHaveText(off);
    await sweep(page, "Off", found);

    expect(found, "the switch's word is split over lines, or pushed off the screen").toEqual([]);
  });
}

// The same rule serves every switch, so the others are held to it too (found as they are).
test("QA #111: the other switches (Account, My calendar) keep their word whole too", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "sets its own viewports");
  await pickLang(page, "en");
  await signIn(page, "/assistants/account");
  await expect(page.locator(".switch")).not.toHaveCount(0);
  const found: string[] = [];
  await sweep(page, "account", found);
  await page.goto("/assistants/calendar");
  await expect(page.locator(".switch")).not.toHaveCount(0);
  await sweep(page, "calendar", found);
  expect(found).toEqual([]);
});

const SCOPE = {
  en: { on: "On for your account (all your devices).", off: "Off for your account (all your devices)." },
  zh: { on: "账户里开着，对你所有设备生效。", off: "账户里关着，对你所有设备生效。" },
};
const HERE = {
  en: { denied: "This device: the browser did not allow notifications, so nothing shows here.", unsupported: "This device: this browser does not support notifications, so nothing shows here." },
  zh: { denied: "本设备：浏览器没允许通知，这里收不到。", unsupported: "本设备：这个浏览器不支持通知，这里收不到。" },
};

for (const lang of ["en", "zh"] as const) {
  test(`QA #111: the account's switch and this device's permission are told apart, and stay apart (${lang})`, async ({ page, request }) => {
    await pickLang(page, lang);
    await simulate(page, "denied");
    await signIn(page, "/assistants/notify");
    const sw = page.getByRole("switch", { name: lang === "en" ? "Notifications" : "通知" });
    const scope = page.getByTestId("notify-scope");
    const here = page.getByTestId("notify-here");

    // The browser said no, and the account's switch is still on: it is not turned off or disabled for it.
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(sw).toBeEnabled();
    await expect(scope).toHaveText(SCOPE[lang].on);
    await expect(here).toHaveText(HERE[lang].denied);
    expect((await state(request)).settings.notify).toBe(true);
    // The sentence about this device comes right after the one about the account, before anything else.
    expect(await here.evaluate((el) => el.previousElementSibling?.querySelector('[data-testid="notify-scope"]') !== null)).toBe(true);

    // Turning the account's switch off is the account's doing; this device's sentence is as true as before.
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(scope).toHaveText(SCOPE[lang].off);
    await expect(here).toHaveText(HERE[lang].denied);
    expect((await state(request)).settings.notify).toBe(false);
    // And on again: still nothing about the browser touched the account.
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(scope).toHaveText(SCOPE[lang].on);
    expect((await state(request)).settings.notify).toBe(true);
    // Nothing asked the browser.
    expect(await page.evaluate(() => (window as unknown as { asks: number }).asks)).toBe(0);
  });
}

test("QA #111: a browser without notifications says so in a sentence of its own; one that has not been asked, or allows them, says nothing extra", async ({ page, request }) => {
  await pickLang(page, "en");
  await simulate(page, "unsupported");
  await signIn(page, "/assistants/notify");
  await expect(page.getByTestId("notify-here")).toHaveText(HERE.en.unsupported);
  await expect(page.getByRole("switch", { name: "Notifications" })).toHaveAttribute("aria-checked", "true");
  expect((await state(request)).settings.notify).toBe(true);

  // Not asked yet / allowed: the device sentence under the switch is not there (the device's own part below still speaks).
  for (const permission of ["default", "granted"] as const) {
    const fresh = await page.context().newPage();
    await pickLang(fresh, "en");
    await simulate(fresh, permission);
    await fresh.goto("/assistants/notify");
    await expect(fresh.getByTestId("notify-state")).toBeVisible();
    await expect(fresh.getByTestId("notify-scope")).toHaveText(SCOPE.en.on);
    await expect(fresh.getByTestId("notify-here")).toHaveCount(0);
    await fresh.close();
  }
});
