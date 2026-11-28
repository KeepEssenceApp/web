// QA #116: Today reads its whole list. The core serves the analysed items first and the ones not analysed yet after them, so a
// list that stopped at 500 lost exactly the items still waiting, and said "everything is handled" with one of them unread.
// Synthetic data only: the fake core's `/__test/today-list` makes N analysed items (all handled, or none) and M waiting ones, in
// the core's order, and `/__test/state` (`item_list_requests`) says which pages were asked for. In each language, in a session
// of its own. The real core (e1f578f) and the production accounts are the tester's check.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "relies on the fake's today-list hook");

const WORDS = {
  zh: { done: "今天的都处理完了。", handled: (n: number) => `今天处理过的 · ${n} 条`, analyses: (n: number) => `解读 · 新的在前 · 现有 ${n} 条`, waiting: (n: number) => `还没解读的条目 · 现有 ${n} 条`, failed: /出错了/ },
  en: { done: "Everything for today is handled.", handled: (n: number) => `Handled today · ${n}`, analyses: (n: number) => `Analyses · newest first · ${n} here now`, waiting: (n: number) => `Items not analysed yet · ${n} here now`, failed: /Something went wrong/ },
} as const;
type Lang = keyof typeof WORDS;

const done = (page: Page) => page.getByTestId("today-empty");
const waitingRows = (page: Page) => page.locator(".waiting-list li.waiting");
const handledRows = (page: Page) => page.locator("[data-handled]").filter({ has: page.locator(".rest-title") });
const handledTitle = (page: Page) => page.locator('[data-part="handled"] summary');

/** A new account in this language whose Today has `analysed` analysed items (all handled when `handled`) and `waiting` that are not analysed. */
async function today(request: APIRequestContext, lang: Lang, analysed: number, waiting: number, handled = true) {
  // A reset signs every device out: do it before signing in.
  await reset(request, lang === "en" ? { account_lang: "en" } : {});
  expect((await request.post("/__test/today-list", { data: { analysed, waiting, handled } })).ok()).toBe(true);
}
/** The requests for Today's list, in the order the core got them: the cursor each one carried. */
const asked = async (request: APIRequestContext) =>
  ((await state(request)).item_list_requests as { limit: string | null; cursor: string | null }[]).filter((r) => r.limit === "100").map((r) => r.cursor ?? "first");
/**
 * Waits until the requests for Today's list have stopped (the count is the same on two reads 400 ms apart) and says how many there
 * were. `page.waitForLoadState("networkidle")` returns at once when the page was idle before, so it cannot say that nothing is in
 * flight now: a count taken after it can be taken in the middle of a read.
 */
async function quiet(request: APIRequestContext) {
  let last = -1;
  await expect
    .poll(
      async () => {
        const n = (await asked(request)).length;
        const same = n === last;
        last = n;
        return same;
      },
      { intervals: [400], timeout: 20000 },
    )
    .toBe(true);
  return last;
}
/**
 * Winds the page's clock on until Today has asked once (the core has got a request), waits until it has stopped asking, and
 * says how many requests that one ask made. The page's timer is made in an effect that runs after the render, so the first
 * wind can find none: wind again only while nothing has reached the core, never while an ask is on its way (that would be a
 * second ask, and the count would not be one ask's).
 */
async function askedOnce(page: Page, request: APIRequestContext) {
  const from = (await asked(request)).length;
  for (let tries = 0; tries < 6; tries++) {
    await page.clock.fastForward(15500);
    const began = await expect
      .poll(async () => (await asked(request)).length, { timeout: 1500 })
      .toBeGreaterThan(from)
      .then(
        () => true,
        () => false,
      );
    if (began) break;
  }
  return (await quiet(request)) - from;
}
/** How many times each page was asked for. */
const perPage = (log: string[]) => log.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});
/** One read of the list is `pages` requests, from the first page to the one with no next cursor; a wide screen reads it twice (the list, and the column beside it). */
const reads = (pages: number, sweeps: number) =>
  Object.fromEntries(Array.from({ length: pages }, (_, p) => [p === 0 ? "first" : String(p * 100), sweeps]));

/** What the service worker sends when a notification arrives while the page is open: the app's ordinary refresh. */
const refreshApp = (page: Page) => page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "refresh" } })));

test.beforeEach(async ({ request }) => reset(request));

for (const lang of ["zh", "en"] as const) {
  const w = WORDS[lang];
  test.describe(`QA #116 in ${lang === "zh" ? "Chinese" : "English"}`, () => {
    // The browser speaks the account's language: a browser in another one makes the app mount again when it signs in (the
    // language changes), which would ask for the list twice for a reason that has nothing to do with this.
    test.use({ locale: lang === "zh" ? "zh-CN" : "en-US" });

    test("499 handled + 1 waiting (the control): the waiting item is listed, nothing says it is done, 499 handled, five requests", async ({ page, request, isMobile }) => {
      await today(request, lang, 499, 1);
      await signIn(page, "/");
      await expect(waitingRows(page)).toHaveCount(1);
      await expect(waitingRows(page).first()).toHaveAttribute("data-item", "it_w0001");
      await expect(page.locator("section", { hasText: w.waiting(1) })).toBeVisible();
      await expect(handledTitle(page)).toHaveText(w.handled(499));
      await expect(handledRows(page)).toHaveCount(499);
      await expect(done(page)).toHaveCount(0);
      if (!isMobile) await expect(page.getByTestId("today-counts")).toBeVisible();
      expect(perPage(await asked(request))).toEqual(reads(5, isMobile ? 1 : 2));
    });

    test("500 handled + 1 waiting: the 501st, the waiting one, is listed and nothing says it is done; 500 handled; six requests, the sixth with the fifth page's cursor", async ({ page, request, isMobile }) => {
      await today(request, lang, 500, 1);
      await signIn(page, "/");
      await expect(waitingRows(page)).toHaveCount(1);
      await expect(waitingRows(page).first()).toHaveAttribute("data-item", "it_w0001");
      await expect(page.locator("section", { hasText: w.waiting(1) })).toBeVisible();
      await expect(handledTitle(page)).toHaveText(w.handled(500));
      await expect(handledRows(page)).toHaveCount(500);
      await expect(done(page)).toHaveCount(0);
      if (!isMobile) await expect(page.getByTestId("today-counts")).toBeVisible();
      await quiet(request);
      const log = await asked(request);
      expect(perPage(log)).toEqual(reads(6, isMobile ? 1 : 2));
      // The page after the 500th item is asked with the cursor the fifth page gave, and nothing is asked beyond it.
      expect(log).toContain("500");
      expect(log).not.toContain("600");
    });

    test("501 handled, none waiting: the done sentence, 501 handled and 501 rows, read to the page with no cursor", async ({ page, request, isMobile }) => {
      await today(request, lang, 501, 0);
      await signIn(page, "/");
      await expect(done(page)).toHaveText(w.done);
      await expect(handledTitle(page)).toHaveText(w.handled(501));
      await expect(handledRows(page)).toHaveCount(501);
      await expect(waitingRows(page)).toHaveCount(0);
      await quiet(request);
      expect(perPage(await asked(request))).toEqual(reads(6, isMobile ? 1 : 2));
    });

    test("exactly 500 handled: done, 500 rows, five requests: the fifth page has no cursor, so there is no sixth", async ({ page, request, isMobile }) => {
      await today(request, lang, 500, 0);
      await signIn(page, "/");
      await expect(done(page)).toHaveText(w.done);
      await expect(handledTitle(page)).toHaveText(w.handled(500));
      await quiet(request);
      expect(perPage(await asked(request))).toEqual(reads(5, isMobile ? 1 : 2));
    });

    test("fewer than 100, all handled: done, one request", async ({ page, request, isMobile }) => {
      await today(request, lang, 37, 0);
      await signIn(page, "/");
      await expect(done(page)).toHaveText(w.done);
      await expect(handledTitle(page)).toHaveText(w.handled(37));
      await quiet(request);
      expect(perPage(await asked(request))).toEqual(reads(1, isMobile ? 1 : 2));
    });

    test("analyses that are not handled are all listed too, past the 500th: 501 analyses, no waiting row, no done sentence", async ({ page, request }) => {
      await today(request, lang, 501, 0, false);
      await signIn(page, "/");
      await expect(page.locator("section", { hasText: w.analyses(501) })).toBeVisible();
      await expect(page.locator(".cards .card")).toHaveCount(501);
      await expect(done(page)).toHaveCount(0);
    });

    test("the sixth page fails (503): the load error, and neither the done sentence nor a part of the list", async ({ page, request }) => {
      await today(request, lang, 500, 1);
      const sixth = { n: 0 };
      await page.route(/\/v1\/items\?.*cursor=500/, (route) => {
        sixth.n++;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "" } }) });
      });
      await signIn(page, "/");
      await expect(page.getByRole("alert").first()).toHaveText(w.failed);
      // The five pages that did come are not made into an answer.
      await expect(done(page)).toHaveCount(0);
      await expect(waitingRows(page)).toHaveCount(0);
      await expect(handledTitle(page)).toHaveCount(0);
      await expect(page.locator(".cards .card")).toHaveCount(0);
      // The sixth page was asked for (it is the one that failed); the core got the five before it and nothing after.
      expect(sixth.n).toBeGreaterThan(0);
      expect(Object.keys(perPage(await asked(request))).sort()).toEqual(["100", "200", "300", "400", "first"]);
    });

    // ---- Today's quiet ask is not silent when it fails (#116, item 11). A read that fails on any page, or is void three times
    // over, is no list: the list from before, its counts and a "done" that came with it are taken away, the load error is shown,
    // the page keeps asking (the error's own ask, every 15 seconds), and the first read that holds brings the list back, clears
    // the error and has the column beside Today ask again. Only Today's own list is read by the ask (the column beside it does
    // not ask by itself), so a quiet ask is one read in both layouts. The other pages' quiet asks stay silent (qa-24-26.spec.ts).
    const todayColumn = (page: Page) => page.locator(".page.today");
    for (const at of [
      { name: "sixth", url: /\/v1\/items\?.*cursor=500/, reached: 5 },
      { name: "first", url: /\/v1\/items\?(?!.*cursor=)/, reached: 0 },
    ] as const) {
      test(`Today asks again quietly (501 items, one waiting) and the ${at.name} page fails (503): the load error replaces the list, the counts and the sentences; it keeps asking; when a read holds, 501 items are back (500 handled, 1 waiting), the error is gone and the column beside Today asks again`, async ({ page, request, isMobile }) => {
        await page.clock.install();
        await today(request, lang, 500, 1);
        await signIn(page, "/");
        await expect(waitingRows(page)).toHaveCount(1);
        await expect(handledRows(page)).toHaveCount(500);
        if (!isMobile) await expect(page.getByTestId("today-counts").locator(".stat-n").nth(1)).toHaveText("1");
        await quiet(request);

        const failing = { n: 0, fail: true };
        await page.route(at.url, (route) => {
          failing.n++;
          return failing.fail
            ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "" } }) })
            : route.continue();
        });
        const before = (await asked(request)).length;
        await page.clock.fastForward(15500);
        // One ask: the pages before the failing one reached the core, the failing one was refused on its way, nothing after it.
        await expect.poll(() => failing.n).toBe(1);
        await expect.poll(async () => (await asked(request)).length).toBe(before + at.reached);
        // The list from before is gone with everything that was said about it. Not a part of it either.
        await expect(todayColumn(page).getByRole("alert")).toHaveText(w.failed);
        await expect(done(page)).toHaveCount(0);
        await expect(waitingRows(page)).toHaveCount(0);
        await expect(handledTitle(page)).toHaveCount(0);
        await expect(page.locator(".cards .card")).toHaveCount(0);
        await expect(todayColumn(page).locator("h2.label")).toHaveCount(0);
        await quiet(request);
        expect((await asked(request)).length).toBe(before + at.reached);

        // While it is down the item is analysed. The column beside Today does not ask by itself: it still has the old count.
        expect((await request.post("/__test/analyse", { data: { item_id: "it_w0001" } })).ok()).toBe(true);
        if (!isMobile) await expect(page.getByTestId("today-counts").locator(".stat-n").nth(1)).toHaveText("1");

        // The page asks again on its own (the timer is made in the effect that follows the render of the error: wind the clock on
        // until the page has asked, not once) and while the read fails it stays the error.
        await expect
          .poll(async () => {
            await page.clock.fastForward(15500);
            return failing.n;
          })
          .toBeGreaterThan(1);
        await expect(todayColumn(page).getByRole("alert")).toHaveText(w.failed);
        await expect(done(page)).toHaveCount(0);
        await expect(waitingRows(page)).toHaveCount(0);

        // A read holds: the whole list is back, the error is gone, nothing says done, and the column beside Today asked again.
        failing.fail = false;
        await expect
          .poll(async () => {
            await page.clock.fastForward(15500);
            return handledRows(page).count();
          })
          .toBe(500);
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(page.locator('.cards .card[data-item="it_w0001"]')).toBeVisible();
        await expect(page.locator("section", { hasText: w.analyses(1) })).toBeVisible();
        await expect(handledTitle(page)).toHaveText(w.handled(500));
        await expect(waitingRows(page)).toHaveCount(0);
        await expect(done(page)).toHaveCount(0);
        if (!isMobile) {
          const counts = page.getByTestId("today-counts");
          await expect(counts.locator(".stat-n").nth(1)).toHaveText("0");
          await expect(counts.locator(".stat-n").nth(2)).toHaveText("1");
          await expect(counts.locator(".stat-n").nth(3)).toHaveText("500");
        }
      });
    }

    test("Today asks again quietly and the list is void three times over (it moves under every read): 18 requests and no more, then the load error with no list and no count; it keeps asking; when the list holds still it is whole again", async ({ page, request, isMobile }) => {
      await page.clock.install();
      await today(request, lang, 500, 12);
      await signIn(page, "/");
      await expect(waitingRows(page)).toHaveCount(12);
      await expect(handledRows(page)).toHaveCount(500);
      if (!isMobile) await expect(page.getByTestId("today-counts").locator(".stat-n").nth(1)).toHaveText("12");
      await quiet(request);

      // From now every read of the sixth page is preceded by a shift (the first waiting item is analysed, not seen).
      expect((await request.post("/__test/today-drift", { data: { cursor: "500", times: 6 } })).ok()).toBe(true);
      // Three rounds of six pages (each stops at the sixth, where the repeat shows): the ceiling, in both layouts.
      expect(await askedOnce(page, request)).toBe(18);
      await expect(todayColumn(page).getByRole("alert")).toHaveText(w.failed);
      expect((await state(request)).item_list_drifts).toBe(3);
      await expect(done(page)).toHaveCount(0);
      await expect(waitingRows(page)).toHaveCount(0);
      await expect(handledTitle(page)).toHaveCount(0);
      await expect(page.locator(".cards .card")).toHaveCount(0);
      await expect(todayColumn(page).locator("h2.label")).toHaveCount(0);
      // The column beside Today did not ask: it has the count from before the shifts.
      if (!isMobile) await expect(page.getByTestId("today-counts").locator(".stat-n").nth(1)).toHaveText("12");

      // It keeps asking, and the list is still moving: the next ask is another three rounds and the page stays the error.
      expect(await askedOnce(page, request)).toBe(18);
      expect((await state(request)).item_list_drifts).toBe(6);
      await expect(todayColumn(page).getByRole("alert")).toHaveText(w.failed);
      await expect(done(page)).toHaveCount(0);
      await expect(page.locator(".cards .card")).toHaveCount(0);

      // The list holds still: the next ask is the whole list (six of the twelve were analysed by the shifts, not seen).
      expect((await request.post("/__test/today-drift", { data: { cursor: "500", times: 0 } })).ok()).toBe(true);
      await expect
        .poll(async () => {
          await page.clock.fastForward(15500);
          return handledRows(page).count();
        })
        .toBe(500);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(waitingRows(page)).toHaveCount(6);
      await expect(page.locator(".cards .card")).toHaveCount(6);
      await expect(handledTitle(page)).toHaveText(w.handled(500));
      await expect(done(page)).toHaveCount(0);
      // The column beside Today asked again with it.
      if (!isMobile) await expect(page.getByTestId("today-counts").locator(".stat-n").nth(1)).toHaveText("6");
    });

    // ---- The list moves while it is read (#116, items 7–9). The core's cursor is a position: an analysis that lands between two
    // pages puts its item first and moves the ones before it back, so the next page starts with the last item of the one before.
    // `/__test/today-drift` makes that happen just before the page with the given cursor is served. A phone reads the list once
    // (a read of 501 items is six requests); a wide screen reads it twice (the list, and the column beside it), so there the
    // number of requests is the phone's times two, and the same bound.

    test("QA's counter-example: the only waiting item is analysed between the fifth and the sixth page: no done sentence; the read starts over; in the end 501 items, 500 handled, the new analysis not seen", async ({ page, request, isMobile }) => {
      await today(request, lang, 500, 1);
      expect((await request.post("/__test/today-drift", { data: { cursor: "500", times: 1 } })).ok()).toBe(true);
      await signIn(page, "/");
      // The analysis that landed is listed as an analysis, not seen (it is not among the handled), and nothing is waiting.
      await expect(page.locator('.cards .card[data-item="it_w0001"]')).toBeVisible();
      await expect(page.locator("section", { hasText: w.analyses(1) })).toBeVisible();
      await expect(handledTitle(page)).toHaveText(w.handled(500));
      await expect(handledRows(page)).toHaveCount(500);
      await expect(page.locator('[data-handled="it_w0001"]')).toHaveCount(0);
      await expect(waitingRows(page)).toHaveCount(0);
      await expect(done(page)).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await quiet(request);
      expect((await state(request)).item_list_drifts).toBe(1);
      const log = await asked(request);
      if (isMobile) {
        // Round one stops at the sixth page (the repeat is seen there); round two reads all six.
        expect(perPage(log)).toEqual(reads(6, 2));
      } else {
        expect(log.length).toBeLessThanOrEqual(36);
        expect(Object.keys(perPage(log)).sort()).toEqual(["100", "200", "300", "400", "500", "first"]);
      }
    });

    test("a list that moves in every read: after three reads and no more the load error, no done sentence, no list, no count", async ({ page, request, isMobile }) => {
      await page.clock.install();
      await today(request, lang, 500, 12);
      // Every request for the sixth page is preceded by a shift (12 waiting, so there is always one to analyse).
      expect((await request.post("/__test/today-drift", { data: { cursor: "500", times: 12 } })).ok()).toBe(true);
      await signIn(page, "/");
      await expect(page.getByRole("alert").first()).toHaveText(w.failed);
      await quiet(request);
      await expect(done(page)).toHaveCount(0);
      await expect(waitingRows(page)).toHaveCount(0);
      await expect(handledTitle(page)).toHaveCount(0);
      await expect(page.locator(".cards .card")).toHaveCount(0);
      await expect(page.locator("h2.label")).toHaveCount(0);
      // Three reads of six pages (each stops at the sixth) and the core is asked nothing more by itself: 18 requests on a phone.
      // A wide screen has two readers, 36 at most: each one's shift can end the other's read on an earlier page, so how many
      // pages each read got to is not fixed, only that it is three reads each and no more.
      const log = await asked(request);
      const drifts = (await state(request)).item_list_drifts as number;
      if (isMobile) {
        expect(perPage(log)).toEqual(reads(6, 3));
        expect(drifts).toBe(3);
      } else {
        expect(log.length).toBeLessThanOrEqual(36);
        expect(drifts).toBeGreaterThanOrEqual(3);
      }
      await quiet(request);
      expect((await asked(request)).length).toBe(log.length);
    });

    test("the read before said done, the next read fails (503): the load error replaces the sentence; the page keeps asking; when the read works it shows the item that is waiting", async ({ page, request, isMobile }) => {
      await page.clock.install();
      await today(request, lang, 501, 0);
      await signIn(page, "/");
      await expect(done(page)).toHaveText(w.done);
      await expect(handledTitle(page)).toHaveText(w.handled(501));

      // From now the sixth page fails, and an item that is not analysed is in Today.
      const sixth = { n: 0, fail: true };
      await page.route(/\/v1\/items\?.*cursor=500/, (route) => {
        sixth.n++;
        return sixth.fail
          ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "" } }) })
          : route.continue();
      });
      expect((await request.post("/__test/today-list", { data: { analysed: 500, waiting: 1, handled: true } })).ok()).toBe(true);
      await refreshApp(page);
      // This read failed: no sentence from the read before it, no part of a list.
      await expect(page.getByRole("alert").first()).toHaveText(w.failed);
      await expect(done(page)).toHaveCount(0);
      await expect(handledTitle(page)).toHaveCount(0);
      await expect(waitingRows(page)).toHaveCount(0);
      const failedOnce = sixth.n;
      expect(failedOnce).toBeGreaterThan(0);

      // Nothing was waiting in the list before; it asks again nevertheless, and while it fails it stays the error. The timer is
      // made in the effect that follows the render of the error, which can be a moment after the error is on the screen: wind the
      // clock on until the page has asked, not once.
      await expect
        .poll(async () => {
          await page.clock.fastForward(15500);
          return sixth.n;
        })
        .toBeGreaterThan(failedOnce);
      await expect(page.getByRole("alert").first()).toHaveText(w.failed);
      await expect(done(page)).toHaveCount(0);

      // The core answers again: the list is whole, with the waiting item in it, and nothing says it is done.
      sixth.fail = false;
      await page.clock.fastForward(15500);
      await expect(waitingRows(page)).toHaveCount(1);
      await expect(waitingRows(page).first()).toHaveAttribute("data-item", "it_w0001");
      await expect(handledTitle(page)).toHaveText(w.handled(500));
      await expect(done(page)).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      if (!isMobile) {
        // The column beside Today does not ask again by itself: it asked again with the page when the list came back.
        const counts = page.getByTestId("today-counts");
        await expect(counts.locator(".stat-n").nth(1)).toHaveText("1");
        await expect(counts.locator(".stat-n").nth(3)).toHaveText("500");
      }
    });

    test("the read before said done, the next read is void three times over: the load error replaces the sentence, at most three reads; the page keeps asking; when the list holds still it is the whole list", async ({ page, request, isMobile }) => {
      await page.clock.install();
      await today(request, lang, 500, 0);
      await signIn(page, "/");
      await expect(done(page)).toHaveText(w.done);
      await expect(handledTitle(page)).toHaveText(w.handled(500));

      // Twelve items are waiting now (500 + 12), and the list moves under every read.
      expect((await request.post("/__test/today-list", { data: { analysed: 500, waiting: 12, handled: true } })).ok()).toBe(true);
      expect((await request.post("/__test/today-drift", { data: { cursor: "500", times: 12 } })).ok()).toBe(true);
      await refreshApp(page);
      await expect(page.getByRole("alert").first()).toHaveText(w.failed);
      await quiet(request);
      await expect(done(page)).toHaveCount(0);
      await expect(handledTitle(page)).toHaveCount(0);
      await expect(page.locator("h2.label")).toHaveCount(0);
      const log = await asked(request);
      const drifted = (await state(request)).item_list_drifts as number;
      if (isMobile) {
        expect(perPage(log)).toEqual(reads(6, 3));
        expect(drifted).toBe(3);
      } else {
        expect(log.length).toBeLessThanOrEqual(36);
      }

      // It keeps asking: the list is quiet now (no more shifts), the next ask is whole. The shifts analysed `drifted` of the 12
      // (not seen), the rest wait.
      expect((await request.post("/__test/today-drift", { data: { cursor: "500", times: 0 } })).ok()).toBe(true);
      await page.clock.fastForward(15500);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(waitingRows(page)).toHaveCount(12 - drifted);
      await expect(page.locator(".cards .card")).toHaveCount(drifted);
      await expect(handledTitle(page)).toHaveText(w.handled(500));
      await expect(done(page)).toHaveCount(0);
    });

    test("every quiet ask is the whole list again (six requests for 501 items); the 501st's analysis, when it lands, moves up with no reload", async ({ page, request, isMobile }) => {
      await page.clock.install();
      await today(request, lang, 500, 1);
      await signIn(page, "/");
      await expect(waitingRows(page)).toHaveCount(1);
      if (!isMobile) await expect(page.getByTestId("today-counts")).toBeVisible();
      await quiet(request);
      await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));

      // A quiet ask with nothing new: the six pages, once.
      const first = (await asked(request)).length;
      await page.clock.fastForward(15500);
      await expect.poll(async () => (await asked(request)).length).toBe(first + 6);
      await quiet(request);
      expect((await asked(request)).length).toBe(first + 6);
      expect((await asked(request)).slice(first)).toEqual(["first", "100", "200", "300", "400", "500"]);
      await expect(waitingRows(page)).toHaveCount(1);

      // The assistant hands the 501st's analysis in. The next quiet ask finds it.
      expect((await request.post("/__test/analyse", { data: { item_id: "it_w0001" } })).ok()).toBe(true);
      await page.clock.fastForward(15000);
      await expect(page.locator('.cards .card[data-item="it_w0001"]')).toBeVisible();
      await expect(waitingRows(page)).toHaveCount(0);
      await expect(done(page)).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);

      // Nothing is waiting now: the page stops asking.
      await quiet(request);
      const settled = (await asked(request)).length;
      await page.clock.fastForward(60000);
      await quiet(request);
      expect((await asked(request)).length).toBe(settled);
    });

    // ---- Two quiet asks overlap (#116, Project 7241967247, QA 7241982507). Only the ask started last may answer, success or
    // failure, in whichever order the answers come back; an answer to an earlier one changes nothing on the page. QA's
    // counter-example: 500 handled + 1 waiting is on the page; the other end sees the last one (501 handled, none waiting); an
    // ask reads six pages and its sixth answer (200: nothing waiting) is held on its way; the other end adds a 502nd item, which
    // waits; the tab comes back and a new ask starts, whose sixth page is refused (503); then the held 200 arrives. It used to
    // say "Everything for today is handled." with one item waiting. The page's words are watched from inside the page, so a
    // sentence that shows for a moment is not missed. Each row is one order of the four answers.
    const state1 = "w1h500"; // what is shown before: one waiting, 500 handled
    const state2 = "w1h501"; // what the list is after the other end's two changes: one waiting, 501 handled
    for (const row of [
      { older: "ok", newer: "fail", first: "newer", name: "QA's counter-example: the newer ask fails first, then the held older success arrives" },
      { older: "ok", newer: "fail", first: "older", name: "reverse order: the held older success arrives first, then the newer ask fails" },
      { older: "fail", newer: "ok", first: "newer", name: "the newer ask succeeds first, then the older one fails" },
      { older: "fail", newer: "ok", first: "older", name: "the older ask fails first, then the newer one succeeds" },
      { older: "ok", newer: "ok", first: "newer", name: "both succeed, the newer first: the older complete answer does not bring the old counts back" },
      { older: "ok", newer: "ok", first: "older", name: "both succeed, the older first: its answer is dropped although nothing newer has answered" },
      { older: "fail", newer: "fail", first: "newer", name: "both fail, the newer first" },
      { older: "fail", newer: "fail", first: "older", name: "both fail, the older first: no load error until the newer ask answers" },
    ] as const) {
      test(`two quiet asks overlap (${row.name}): no done sentence at any moment; only the newer ask's answer shows; a stable read after it shows the one waiting item`, async ({ page, request }) => {
        await page.clock.install();
        await today(request, lang, 500, 1);
        await signIn(page, "/");
        await expect(waitingRows(page)).toHaveCount(1);
        await expect(handledRows(page)).toHaveCount(500);
        await quiet(request);

        // Watch the page from inside: one entry for each different thing it shows, in order.
        await page.evaluate(() => {
          const log: string[] = [];
          (window as unknown as { __shows: string[] }).__shows = log;
          const look = () => {
            const rows = (s: string) => document.querySelectorAll(s).length;
            const handled = [...document.querySelectorAll("[data-handled]")].filter((e) => e.querySelector(".rest-title")).length;
            const now = document.querySelector('[data-testid="today-empty"]')
              ? "done"
              : document.querySelector('[role="alert"]')
                ? "error"
                : `w${rows(".waiting-list li.waiting")}h${handled}`;
            if (log[log.length - 1] !== now) log.push(now);
          };
          look();
          new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
        });
        const shows = () => page.evaluate(() => (window as unknown as { __shows: string[] }).__shows);

        // The other end handles the last item: the list the older ask will read has 501 handled and nothing waiting.
        expect((await request.post("/__test/today-list", { data: { analysed: 501, waiting: 0, handled: true } })).ok()).toBe(true);
        // The sixth page of the first two asks is held on its way (an answer that was made when the request arrived, delivered
        // later, so what the older one carries is what the core said then); every later one goes through.
        const gate = () => {
          let open!: () => void;
          const wait = new Promise<void>((r) => (open = r));
          return { wait, open };
        };
        const holds = [gate(), gate()];
        const reached = [false, false];
        let sixth = 0;
        await page.route(/\/v1\/items\?.*cursor=500/, async (route) => {
          const i = sixth++;
          if (i > 1) return route.continue();
          const kind = i === 0 ? row.older : row.newer;
          const real = kind === "ok" ? await route.fetch() : undefined;
          reached[i] = true;
          await holds[i].wait;
          return real
            ? route.fulfill({ response: real })
            : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "" } }) });
        });
        // The older ask (the timer), its sixth page held.
        await page.clock.fastForward(15500);
        await expect.poll(() => reached[0]).toBe(true);
        // The other end adds a 502nd item, waiting; the newer ask (the timer again; a tab that comes back is the same call).
        expect((await request.post("/__test/today-list", { data: { analysed: 501, waiting: 1, handled: true } })).ok()).toBe(true);
        await page.clock.fastForward(15500);
        await expect.poll(() => reached[1]).toBe(true);
        // Nothing has answered yet: the page shows what it showed.
        expect(await shows()).toEqual([state1]);

        const settle = () => new Promise((r) => setTimeout(r, 400));
        const release = async (which: 0 | 1) => {
          holds[which].open();
          await settle();
        };
        const order = row.first === "newer" ? ([1, 0] as const) : ([0, 1] as const);

        await release(order[0]);
        // The first answer: if it is the newer ask's it shows; the older ask's never does, and the newer one has not answered.
        const afterFirst = order[0] === 1 ? (row.newer === "ok" ? [state1, state2] : [state1, "error"]) : [state1];
        expect(await shows()).toEqual(afterFirst);
        await release(order[1]);
        // The second answer, whichever it is, changes nothing more than the newer ask's answer did.
        const newerShows = row.newer === "ok" ? [state1, state2] : [state1, "error"];
        expect(await shows()).toEqual(newerShows);
        // No moment of this said done.
        expect(await shows()).not.toContain("done");
        await expect(done(page)).toHaveCount(0);

        // A stable read: the page asks again on its own while it shows the error (and keeps asking while an item waits).
        await expect
          .poll(async () => {
            await page.clock.fastForward(15500);
            return handledRows(page).count();
          })
          .toBe(501);
        await expect(waitingRows(page)).toHaveCount(1);
        await expect(waitingRows(page).first()).toHaveAttribute("data-item", "it_w0001");
        await expect(handledTitle(page)).toHaveText(w.handled(501));
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(done(page)).toHaveCount(0);
        await settle();
        expect(await shows()).not.toContain("done");
        expect((await shows()).at(-1)).toBe(state2);
      });
    }

    test("the wide column beside Today counts the whole list: 500 handled + 1 waiting is 1 waiting, 500 handled; 501 handled is 501", async ({ page, request, isMobile }) => {
      test.skip(isMobile, "the column is for wide screens");
      await today(request, lang, 500, 1);
      await signIn(page, "/");
      const counts = page.getByTestId("today-counts");
      // saved today, waiting, analyses to read, handled.
      await expect(counts.locator(".stat-n")).toHaveCount(4);
      await expect(counts.locator(".stat-n").nth(1)).toHaveText("1");
      await expect(counts.locator(".stat-n").nth(2)).toHaveText("0");
      await expect(counts.locator(".stat-n").nth(3)).toHaveText("500");
      await expect(page.getByTestId("rest-handled").locator("h2")).toHaveText(w.handled(500));

      // The same account, now with all 501 handled.
      expect((await request.post("/__test/today-list", { data: { analysed: 501, waiting: 0, handled: true } })).ok()).toBe(true);
      await page.reload();
      await expect(counts.locator(".stat-n").nth(1)).toHaveText("0");
      await expect(counts.locator(".stat-n").nth(3)).toHaveText("501");
      await expect(page.getByTestId("rest-handled").locator("h2")).toHaveText(w.handled(501));
      await expect(done(page)).toHaveText(w.done);
    });
  });
}

// The same rule on a page that keeps quiet (the item's own page: its quiet ask has no `showFailure`). Two asks overlap: the older
// one's answer is the analysis (held), the newer one fails (held). The failure stays silent, as it always did here; and the
// older success, which is older than the ask started last, is dropped, whichever of the two comes back first: the page does not
// move, there is no load error, and the next ask that holds shows the analysis.
test.describe("QA #116: a quiet ask that overlaps another, on a page that does not show failures", () => {
  for (const first of ["older", "newer"] as const) {
    test(`the item's own page: the held older success and the newer failure (the ${first} answers first): nothing shown changes, no error, the next ask shows the analysis`, async ({ page, request, isMobile }) => {
      // Beside the list the panel is told by the list's own quiet ask when an analysis lands, and reloads: that is another read of
      // the item, not this page's ask. The phone shows the item alone.
      test.skip(!isMobile, "on a wide screen the list beside the item tells the panel, which reloads (not the item's own ask)");
      await reset(request);
      await page.clock.install();
      await signIn(page, "/item/it_triaged");
      const item = page.locator('[data-open-item="it_triaged"]');
      await expect(item).toContainText("还没解读");
      await page.waitForLoadState("networkidle");

      const gate = () => {
        let open!: () => void;
        const wait = new Promise<void>((r) => (open = r));
        return { wait, open };
      };
      const holds = [gate(), gate()];
      const reached = [false, false];
      let n = 0;
      await page.route(/\/v1\/items\/it_triaged$/, async (route) => {
        const i = n++;
        if (i > 1) return route.continue();
        // The older ask carries the analysis (made when it arrives), the newer one fails.
        const real = i === 0 ? await route.fetch() : undefined;
        reached[i] = true;
        await holds[i].wait;
        return real ? route.fulfill({ response: real }) : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "" } }) });
      });
      expect((await request.post("/__test/analyse", { data: { item_id: "it_triaged" } })).ok()).toBe(true);
      await page.clock.fastForward(15500);
      await expect.poll(() => reached[0]).toBe(true);
      await page.clock.fastForward(15500);
      await expect.poll(() => reached[1]).toBe(true);

      const settle = () => new Promise((r) => setTimeout(r, 400));
      for (const which of first === "older" ? ([0, 1] as const) : ([1, 0] as const)) {
        holds[which].open();
        await settle();
        // Nothing the page shows changed: still not analysed, no load error, no message.
        await expect(item).toContainText("还没解读");
        await expect(item.locator(".summary")).toHaveCount(0);
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(page.locator(".said")).toHaveCount(0);
      }
      // The next ask holds and shows the analysis.
      await expect
        .poll(async () => {
          await page.clock.fastForward(15500);
          return item.locator(".summary").count();
        })
        .toBe(1);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  }
});

// The page of the empty daily digest counts today's analyses with the same call. The count of analyses is now of the whole
// day: that follows from the data being whole. The sentences and when they show are not part of this (#113 decides those).
test.describe("QA #116: the same call elsewhere", () => {
  test("the empty digest page's count of today's analyses reads all of them: 501 analyses are 501", async ({ page, request }) => {
    await reset(request, { empty: true, no_digest_reason: "not_yet_time" });
    expect((await request.post("/__test/today-list", { data: { analysed: 501, waiting: 0, handled: false } })).ok()).toBe(true);
    await signIn(page, "/digest");
    await expect(page.getByTestId("digest-why")).toContainText("501");
    await quiet(request);
    expect(perPage(await asked(request))).toEqual(reads(6, 1));
  });
});
