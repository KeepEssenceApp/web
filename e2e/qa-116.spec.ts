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
/** How many times each page was asked for. */
const perPage = (log: string[]) => log.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});
/** One read of the list is `pages` requests, from the first page to the one with no next cursor; a wide screen reads it twice (the list, and the column beside it). */
const reads = (pages: number, sweeps: number) =>
  Object.fromEntries(Array.from({ length: pages }, (_, p) => [p === 0 ? "first" : String(p * 100), sweeps]));

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
      await page.waitForLoadState("networkidle");
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
      await page.waitForLoadState("networkidle");
      expect(perPage(await asked(request))).toEqual(reads(6, isMobile ? 1 : 2));
    });

    test("exactly 500 handled: done, 500 rows, five requests: the fifth page has no cursor, so there is no sixth", async ({ page, request, isMobile }) => {
      await today(request, lang, 500, 0);
      await signIn(page, "/");
      await expect(done(page)).toHaveText(w.done);
      await expect(handledTitle(page)).toHaveText(w.handled(500));
      await page.waitForLoadState("networkidle");
      expect(perPage(await asked(request))).toEqual(reads(5, isMobile ? 1 : 2));
    });

    test("fewer than 100, all handled: done, one request", async ({ page, request, isMobile }) => {
      await today(request, lang, 37, 0);
      await signIn(page, "/");
      await expect(done(page)).toHaveText(w.done);
      await expect(handledTitle(page)).toHaveText(w.handled(37));
      await page.waitForLoadState("networkidle");
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

    test("a page that fails when Today asks again quietly changes nothing: the whole list from before stays, and it does not say done", async ({ page, request }) => {
      await page.clock.install();
      await today(request, lang, 500, 1);
      await signIn(page, "/");
      await expect(waitingRows(page)).toHaveCount(1);
      const sixth = { n: 0 };
      await page.route(/\/v1\/items\?.*cursor=500/, (route) => {
        sixth.n++;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "" } }) });
      });
      const before = (await asked(request)).length;
      await page.clock.fastForward(15500);
      // The core got the first five pages again (the sixth was refused on its way); that is the whole of this ask.
      await expect.poll(() => sixth.n).toBe(1);
      await expect.poll(async () => (await asked(request)).length).toBe(before + 5);
      await expect(waitingRows(page)).toHaveCount(1);
      await expect(handledRows(page)).toHaveCount(500);
      await expect(done(page)).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });

    test("every quiet ask is the whole list again (six requests for 501 items); the 501st's analysis, when it lands, moves up with no reload", async ({ page, request, isMobile }) => {
      await page.clock.install();
      await today(request, lang, 500, 1);
      await signIn(page, "/");
      await expect(waitingRows(page)).toHaveCount(1);
      if (!isMobile) await expect(page.getByTestId("today-counts")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));

      // A quiet ask with nothing new: the six pages, once.
      const first = (await asked(request)).length;
      await page.clock.fastForward(15500);
      await expect.poll(async () => (await asked(request)).length).toBe(first + 6);
      await page.waitForLoadState("networkidle");
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
      await page.waitForLoadState("networkidle");
      const settled = (await asked(request)).length;
      await page.clock.fastForward(60000);
      await page.waitForLoadState("networkidle");
      expect((await asked(request)).length).toBe(settled);
    });

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

// The page of the empty daily digest counts today's analyses with the same call. The count of analyses is now of the whole
// day: that follows from the data being whole. The sentences and when they show are not part of this (#113 decides those).
test.describe("QA #116: the same call elsewhere", () => {
  test("the empty digest page's count of today's analyses reads all of them: 501 analyses are 501", async ({ page, request }) => {
    await reset(request, { empty: true, no_digest_reason: "not_yet_time" });
    expect((await request.post("/__test/today-list", { data: { analysed: 501, waiting: 0, handled: false } })).ok()).toBe(true);
    await signIn(page, "/digest");
    await expect(page.getByTestId("digest-why")).toContainText("501");
    await page.waitForLoadState("networkidle");
    expect(perPage(await asked(request))).toEqual(reads(6, 1));
  });
});
