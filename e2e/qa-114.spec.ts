// QA #114: the panel beside the daily digest counts the whole history, not the newest 60.
// Synthetic data only: the fake core's `/__test/digest-history` makes N digests of no content, one a day, and says which are
// unread. At 1440 × 900, in each language, in a session of its own. The real core (e1f578f) is the tester's check.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "relies on the fake's digest history hook");

/** The seeded user lives in Asia/Shanghai. */
const dayAgo = (n: number) => new Date(Date.now() + 8 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);

const WORDS = {
  zh: { counts: ["每日摘要", "还没读"], unread: "还没读", read: "读了", button: "读了，晚安", older: "更早的一份", none: "还没有每日摘要。", failed: /出错了/ },
  en: { counts: ["Daily digests", "Unread"], unread: "Unread", read: "Read", button: "Read. Good night", older: "Earlier digest", none: "No daily digest yet.", failed: /Something went wrong/ },
} as const;
type Lang = keyof typeof WORDS;

const panel = (page: Page) => page.getByTestId("panel");
const counts = (page: Page) => panel(page).getByTestId("digest-counts");
const rows = (page: Page) => panel(page).locator(".digest-dates a");
const current = (page: Page) => panel(page).locator(".digest-dates a[aria-current]");

/** The account has `total` digests now (one a day, yesterday back); the request log starts again. The device stays signed in. */
async function changeHistory(request: APIRequestContext, total: number, unread: "oldest" | "none" | "newest" = "oldest") {
  expect((await request.post("/__test/digest-history", { data: { total, unread } })).ok()).toBe(true);
}
/** A new account in this language, with `total` digests. (A reset signs every device out: do it before signing in.) */
async function history(request: APIRequestContext, lang: Lang, total: number, unread: "oldest" | "none" | "newest" = "oldest") {
  await reset(request, lang === "en" ? { account_lang: "en" } : {});
  await changeHistory(request, total, unread);
}
/** The list requests the panel made (the digest entry's own dot asks for one digest, `limit=1`). */
const listRequests = async (request: APIRequestContext) =>
  ((await state(request)).digest_list_requests as { limit: string | null; cursor: string | null }[]).filter((r) => r.limit === "100");

/**
 * The order in which the answers of one refresh come back (QA #114, the refresh counter-example). `hold("detail")` keeps the
 * answer to the open digest back, `hold("list")` the history's pages, until `release()`. The history's pages are counted from
 * the page's first: the first `allowed` pass, every further one is answered 503. So a read that the refresh did not need is a
 * request log that is too long and a load error in the panel, as it was in QA's run (the sixth request failed).
 */
async function controlOrder(page: Page, day: string, allowed: number) {
  let holding: "list" | "detail" | null = null;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let lists = 0;
  await page.route(/\/v1\/digests\?.*limit=100/, async (route) => {
    lists++;
    if (lists > allowed) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "" } }) });
    if (holding === "list") await gate;
    await route.continue();
  });
  await page.route(new RegExp(`/v1/digests/${day}(\\?.*)?$`), async (route) => {
    if (holding === "detail") await gate;
    await route.continue();
  });
  return {
    hold: (what: "list" | "detail") => void (holding = what),
    release: () => {
      holding = null;
      open();
    },
    /** How many list requests the page has made, passed or not. */
    lists: () => lists,
  };
}
/** What the service worker sends when a notification arrives while the page is open: the app's ordinary refresh. */
const refreshApp = (page: Page) => page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "refresh" } })));
const kept = (page: Page) => page.evaluate(() => (window as unknown as { __kept?: number }).__kept);

test.describe("QA #114 at 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(({ isMobile }) => isMobile, "the panel is for wide screens");

  for (const lang of ["zh", "en"] as const) {
    const w = WORDS[lang];
    test.describe(`in ${lang === "zh" ? "Chinese" : "English"}`, () => {
      // The browser speaks the account's language: a browser in another one makes the app mount again when it signs in
      // (the language changes), which would ask for the list twice for a reason that has nothing to do with this.
      test.use({ locale: lang === "zh" ? "zh-CN" : "en-US" });

      test("61 digests, only the oldest unread: 61 and 1, 61 rows; the oldest opens from the last row and from the body's earlier link, and reading it makes 61 and 0 with no reload", async ({ page, request }) => {
        await history(request, lang, 61);
        await signIn(page, "/digest");
        await expect(counts(page).locator(".stat-n")).toHaveText(["61", "1"]);
        await expect(counts(page).locator(".stat-label")).toHaveText([...w.counts]);
        await expect(rows(page)).toHaveCount(61);
        // The open one, the latest, is marked, and only it.
        await expect(current(page)).toHaveCount(1);
        await expect(rows(page).first()).toHaveAttribute("aria-current", "true");
        await expect(rows(page).first()).toHaveAttribute("data-day", dayAgo(1));
        // The oldest is in the list, and it is the one not read.
        const oldest = dayAgo(61);
        await expect(rows(page).last()).toHaveAttribute("data-day", oldest);
        await expect(rows(page).last()).toContainText(w.unread);
        await expect(panel(page).locator(".digest-dates a", { hasText: w.unread })).toHaveCount(1);
        // One request: the page is the largest the contract allows, and the history is shorter.
        expect(await listRequests(request)).toEqual([{ limit: "100", cursor: null }]);

        // From the last row.
        await rows(page).last().click();
        await expect(page).toHaveURL(new RegExp(`/digest/${oldest}$`));
        await expect(page.locator(`article[data-day="${oldest}"] header .state`)).toHaveText(w.unread);
        await expect(current(page)).toHaveCount(1);
        await expect(panel(page).locator(`.digest-dates a[data-day="${oldest}"]`)).toHaveAttribute("aria-current", "true");
        // Opening another digest from the list does not read the history again.
        expect(await listRequests(request)).toHaveLength(1);

        // From the body's link to the earlier digest, from the one next to it.
        await page.goto(`/digest/${dayAgo(60)}`);
        await expect(counts(page).locator(".stat-n")).toHaveText(["61", "1"]);
        await expect(panel(page).locator(`.digest-dates a[data-day="${dayAgo(60)}"]`)).toHaveAttribute("aria-current", "true");
        await page.getByRole("link", { name: new RegExp(w.older) }).click();
        await expect(page).toHaveURL(new RegExp(`/digest/${oldest}$`));
        await expect(page.locator(`article[data-day="${oldest}"] header .state`)).toHaveText(w.unread);
        await expect(current(page)).toHaveCount(1);
        await expect(panel(page).locator(`.digest-dates a[data-day="${oldest}"]`)).toHaveAttribute("aria-current", "true");
        // The reload of the page was one read; the link to the earlier digest none.
        await page.waitForTimeout(300);
        expect(await listRequests(request)).toHaveLength(2);

        // Read, good night: the panel follows with no reload.
        await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));
        await page.getByRole("button", { name: w.button }).click();
        await expect(counts(page).locator(".stat-n")).toHaveText(["61", "0"]);
        await expect(panel(page).locator(`.digest-dates a[data-day="${oldest}"]`)).toContainText(w.read);
        await expect(panel(page).locator(".digest-dates a", { hasText: w.unread })).toHaveCount(0);
        await expect(rows(page)).toHaveCount(61);
        expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);
        // Reading it asked for the history once more, and only once.
        await page.waitForTimeout(500);
        expect(await listRequests(request)).toHaveLength(3);
      });

      test("60 digests: all read is 60 and 0, only the 60th unread is 60 and 1, one list request each", async ({ page, request }) => {
        await history(request, lang, 60, "none");
        await signIn(page, "/digest");
        await expect(counts(page).locator(".stat-n")).toHaveText(["60", "0"]);
        await expect(rows(page)).toHaveCount(60);
        expect(await listRequests(request)).toHaveLength(1);

        await changeHistory(request, 60, "oldest");
        await page.goto("/digest");
        await expect(counts(page).locator(".stat-n")).toHaveText(["60", "1"]);
        await expect(rows(page)).toHaveCount(60);
        await expect(rows(page).last()).toContainText(w.unread);
        expect(await listRequests(request)).toHaveLength(1);
      });

      test("100 digests are one request; 101, with the 101st unread, are two, 101 and 1, and the 101st is in the list", async ({ page, request }) => {
        await history(request, lang, 100);
        await signIn(page, "/digest");
        await expect(counts(page).locator(".stat-n")).toHaveText(["100", "1"]);
        await expect(rows(page)).toHaveCount(100);
        expect(await listRequests(request)).toEqual([{ limit: "100", cursor: null }]);

        await changeHistory(request, 101);
        await page.goto("/digest");
        await expect(counts(page).locator(".stat-n")).toHaveText(["101", "1"]);
        await expect(rows(page)).toHaveCount(101);
        await expect(rows(page).last()).toHaveAttribute("data-day", dayAgo(101));
        await expect(rows(page).last()).toContainText(w.unread);
        await expect(current(page)).toHaveCount(1);
        // The second request is the first one's next page.
        expect(await listRequests(request)).toEqual([
          { limit: "100", cursor: null },
          { limit: "100", cursor: "100" },
        ]);
        // How long it took is recorded, not judged (#60 tracks speed).
        const took = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => /\/v1\/digests\?.*limit=100/.test(e.name)).map((e) => Math.round(e.duration)));
        test.info().annotations.push({ type: "101 digests", description: `${took.length} list requests in the load of the page: ${took.join(" ms, ")} ms (fake core, no network)` });
      });

      test("no digests: the sentence it always had, no counts", async ({ page, request }) => {
        await history(request, lang, 0);
        await signIn(page, "/digest");
        await expect(panel(page).getByRole("heading", { name: lang === "zh" ? "每日摘要 · 按日期" : "Daily digests by date" })).toBeVisible();
        await expect(panel(page).locator(".sentence")).toHaveText(w.none);
        await expect(counts(page)).toHaveCount(0);
        await expect(rows(page)).toHaveCount(0);
        expect(await listRequests(request)).toHaveLength(1);
      });

      // QA's counter-example on 499bc41: the data changes in the same session, with no reload of the page. The body (one digest) and
      // the panel (all of them) must say the same thing about the digest that is open.
      test("a newer digest arrives in the same session and the app goes back to /digest with no reload: body and panel agree, 102 and 1, only the new one is open, one more read of the history", async ({ page, request }) => {
        await history(request, lang, 101, "none");
        await signIn(page, `/digest/${dayAgo(60)}`);
        await expect(counts(page).locator(".stat-n")).toHaveText(["101", "0"]);
        await expect(rows(page)).toHaveCount(101);
        await expect(current(page)).toHaveCount(1);
        await expect(current(page)).toHaveAttribute("data-day", dayAgo(60));
        expect(await listRequests(request)).toHaveLength(2);

        // Today's digest is written, unread. The page is not reloaded.
        const today = dayAgo(0);
        expect((await request.post("/__test/digest-today")).ok()).toBe(true);
        await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));
        await page.locator('nav a[href="/digest"]').click();
        await expect(page).toHaveURL(/\/digest$/);
        await expect(page.locator(`article[data-day="${today}"]`)).toBeVisible();
        await expect(page.locator(`article[data-day="${today}"] header .state`)).toHaveText(w.unread);

        // The panel says what the body says.
        await expect(counts(page).locator(".stat-n")).toHaveText(["102", "1"]);
        await expect(counts(page).locator(".stat-label")).toHaveText([...w.counts]);
        await expect(rows(page)).toHaveCount(102);
        await expect(rows(page).first()).toHaveAttribute("data-day", today);
        await expect(rows(page).first()).toContainText(w.unread);
        await expect(rows(page).nth(1)).toHaveAttribute("data-day", dayAgo(1));
        await expect(panel(page).locator(".digest-dates a", { hasText: w.unread })).toHaveCount(1);
        await expect(current(page)).toHaveCount(1);
        await expect(current(page)).toHaveAttribute("data-day", today);
        expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);
        // The history was read again once (two pages of it), not once for every thing the page did.
        await page.waitForTimeout(500);
        expect(await listRequests(request)).toHaveLength(4);

        // Reading it: both numbers follow with one more read of the history, and the open one is still only the new one.
        await page.getByRole("button", { name: w.button }).click();
        await expect(counts(page).locator(".stat-n")).toHaveText(["102", "0"]);
        await expect(rows(page).first()).toContainText(w.read);
        await expect(panel(page).locator(".digest-dates a", { hasText: w.unread })).toHaveCount(0);
        await expect(current(page)).toHaveCount(1);
        await expect(current(page)).toHaveAttribute("data-day", today);
        await page.waitForTimeout(500);
        expect(await listRequests(request)).toHaveLength(6);
        expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);
      });

      test("the open digest was changed elsewhere (the newest is unread, the list in this page says the oldest is): going back to /digest with no reload, the row says what the body says", async ({ page, request }) => {
        await history(request, lang, 61, "oldest");
        await signIn(page, `/digest/${dayAgo(30)}`);
        await expect(counts(page).locator(".stat-n")).toHaveText(["61", "1"]);
        await expect(rows(page).last()).toContainText(w.unread);
        await expect(rows(page).first()).toContainText(w.read);
        expect(await listRequests(request)).toHaveLength(1);

        await changeHistory(request, 61, "newest");
        await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));
        await page.locator('nav a[href="/digest"]').click();
        await expect(page.locator(`article[data-day="${dayAgo(1)}"] header .state`)).toHaveText(w.unread);
        await expect(rows(page).first()).toContainText(w.unread);
        await expect(rows(page).last()).toContainText(w.read);
        await expect(panel(page).locator(".digest-dates a", { hasText: w.unread })).toHaveCount(1);
        await expect(counts(page).locator(".stat-n")).toHaveText(["61", "1"]);
        await expect(current(page)).toHaveCount(1);
        await expect(current(page)).toHaveAttribute("data-day", dayAgo(1));
        expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);
        await page.waitForTimeout(500);
        // The hook above started the log again: this one read is the whole history asked for once more.
        expect(await listRequests(request)).toHaveLength(1);
      });

      test("the history read that follows a newer digest fails on its second page: the load error and no count, never the first page's; reading the digest then shows 102 and 0", async ({ page, request }) => {
        await history(request, lang, 101, "none");
        await signIn(page, `/digest/${dayAgo(60)}`);
        await expect(counts(page).locator(".stat-n")).toHaveText(["101", "0"]);
        expect((await request.post("/__test/digest-today")).ok()).toBe(true);
        const second = /\/v1\/digests\?.*cursor=/;
        await page.route(second, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "server_error", message: "" } }) }));
        await page.locator('nav a[href="/digest"]').click();
        await expect(page.locator(`article[data-day="${dayAgo(0)}"]`)).toBeVisible();
        await expect(panel(page).getByRole("alert")).toHaveText(w.failed);
        await expect(counts(page)).toHaveCount(0);
        await expect(rows(page)).toHaveCount(0);

        // The page answers again; the next thing the page changes (reading this digest) asks for the history again.
        await page.unroute(second);
        await page.getByRole("button", { name: w.button }).click();
        await expect(counts(page).locator(".stat-n")).toHaveText(["102", "0"]);
        await expect(rows(page)).toHaveCount(102);
        await expect(current(page)).toHaveAttribute("data-day", dayAgo(0));
      });

      // QA's counter-example on f3b6acc: the open digest (unread) is read on another device and the app refreshes once, in the ordinary way.
      // The history of that refresh is let through whole, the digest of that refresh later. The list of this refresh was compared with the
      // digest of the one before (still unread on the page), found "disagreeing", and read again; that read, the page's third (the sixth
      // with 101 digests), failed, the digest then answered "read", and the panel had a load error and no rows. Only this refresh's digest says
      // what this refresh's list is to say, so nothing is compared before it has answered, and when it has, the two agree and nothing is read.
      for (const total of [61, 101]) {
        const pages = total > 100 ? 2 : 1;
        test(`${total} digests, the open one read elsewhere, one ordinary refresh, its history answered before its digest: no extra read of the history, ${total} and 0, no load error, only the open one marked`, async ({ page, request }) => {
          await history(request, lang, total, "oldest");
          const oldest = dayAgo(total);
          const order = await controlOrder(page, oldest, 2 * pages);
          await signIn(page, `/digest/${oldest}`);
          await expect(counts(page).locator(".stat-n")).toHaveText([String(total), "1"]);
          await expect(rows(page)).toHaveCount(total);
          await expect(current(page)).toHaveAttribute("data-day", oldest);
          await expect(page.locator(`article[data-day="${oldest}"] header .state`)).toHaveText(w.unread);
          expect(await listRequests(request)).toHaveLength(pages);

          // Read on another device: the page knows nothing of it. (The hook starts the request log again.)
          await changeHistory(request, total, "none");
          await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));
          order.hold("detail");
          await refreshApp(page);
          // This refresh's history is whole and says read; this refresh's digest has not answered, the body still says what it said.
          await expect(counts(page).locator(".stat-n")).toHaveText([String(total), "0"]);
          await expect(rows(page)).toHaveCount(total);
          await page.waitForTimeout(500);
          await expect(page.locator(`article[data-day="${oldest}"] header .state`)).toHaveText(w.unread);
          // Nothing was read for the sake of a comparison with the page of the refresh before: the first read and this refresh's.
          // (`lists()` counts every request the page made, also the ones answered 503, which the fake's own log never sees.)
          expect(order.lists()).toBe(2 * pages);
          expect(await listRequests(request)).toHaveLength(pages);
          await expect(panel(page).getByRole("alert")).toHaveCount(0);

          // Its digest answers: read. Both say the same, and nothing more is asked.
          order.release();
          await expect(page.locator(`article[data-day="${oldest}"] header .state`)).toHaveText(w.read);
          await expect(counts(page).locator(".stat-n")).toHaveText([String(total), "0"]);
          await expect(counts(page).locator(".stat-label")).toHaveText([...w.counts]);
          await expect(rows(page)).toHaveCount(total);
          await expect(panel(page).locator(".digest-dates a", { hasText: w.unread })).toHaveCount(0);
          await expect(panel(page).getByRole("alert")).toHaveCount(0);
          await expect(current(page)).toHaveCount(1);
          await expect(current(page)).toHaveAttribute("data-day", oldest);
          await page.waitForTimeout(500);
          expect(await listRequests(request)).toHaveLength(pages);
          // The page's own count of what it asked: the first read, the refresh's, and no other.
          expect(order.lists()).toBe(2 * pages);
          expect(await kept(page)).toBe(1);
        });
      }

      test("101 digests, the same refresh the other way round (its digest answers first, its history later): still no extra read, and the panel follows when its history answers", async ({ page, request }) => {
        await history(request, lang, 101, "oldest");
        const oldest = dayAgo(101);
        const order = await controlOrder(page, oldest, 4);
        await signIn(page, `/digest/${oldest}`);
        await expect(counts(page).locator(".stat-n")).toHaveText(["101", "1"]);
        await expect(page.locator(`article[data-day="${oldest}"] header .state`)).toHaveText(w.unread);

        await changeHistory(request, 101, "none");
        await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));
        order.hold("list");
        await refreshApp(page);
        // The digest of this refresh says read; the panel still has the list it had (101 and 1), which is from the refresh before.
        await expect(page.locator(`article[data-day="${oldest}"] header .state`)).toHaveText(w.read);
        await page.waitForTimeout(500);
        await expect(counts(page).locator(".stat-n")).toHaveText(["101", "1"]);
        expect(await listRequests(request)).toHaveLength(0);
        await expect(panel(page).getByRole("alert")).toHaveCount(0);

        order.release();
        await expect(counts(page).locator(".stat-n")).toHaveText(["101", "0"]);
        await expect(rows(page)).toHaveCount(101);
        await expect(panel(page).locator(".digest-dates a", { hasText: w.unread })).toHaveCount(0);
        await expect(current(page)).toHaveCount(1);
        await expect(current(page)).toHaveAttribute("data-day", oldest);
        await page.waitForTimeout(500);
        expect(await listRequests(request)).toHaveLength(2);
        expect(order.lists()).toBe(4);
        await expect(panel(page).getByRole("alert")).toHaveCount(0);
        expect(await kept(page)).toBe(1);
      });

      // What the check is for: when this refresh's digest and this refresh's history really disagree, the history is read once more.
      test("this refresh's digest and this refresh's history really disagree (a newer digest was written between the two): the history is read once more, 102 and 1, the open one marked", async ({ page, request }) => {
        await history(request, lang, 61, "none");
        await signIn(page, "/digest");
        await expect(counts(page).locator(".stat-n")).toHaveText(["61", "0"]);
        await expect(current(page)).toHaveAttribute("data-day", dayAgo(1));
        expect(await listRequests(request)).toHaveLength(1);

        // A newer digest is written and the app refreshes. The digest of that refresh is today's; the first read of the history of
        // that refresh is answered as it was before today's digest was written (the two requests were answered a moment apart).
        const today = dayAgo(0);
        expect((await request.post("/__test/digest-today")).ok()).toBe(true);
        await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1));
        let stale = true;
        await page.route(/\/v1\/digests\?.*limit=100/, async (route) => {
          if (!stale) return route.continue();
          stale = false;
          const body = await (await route.fetch()).json();
          await route.fulfill({ json: { ...body, digests: body.digests.filter((d: { day: string }) => d.day !== today) } });
        });
        await refreshApp(page);
        await expect(page.locator(`article[data-day="${today}"]`)).toBeVisible();
        await expect(counts(page).locator(".stat-n")).toHaveText(["62", "1"]);
        await expect(rows(page)).toHaveCount(62);
        await expect(current(page)).toHaveCount(1);
        await expect(current(page)).toHaveAttribute("data-day", today);
        await page.waitForTimeout(500);
        // The first load, this refresh's read, and the one more for the disagreement: three, not a fourth.
        expect(await listRequests(request)).toHaveLength(3);
        expect(await kept(page)).toBe(1);
      });

      test("going from one day to another in the list reads the history no more than once", async ({ page, request }) => {
        await history(request, lang, 61, "none");
        await signIn(page, "/digest");
        await expect(rows(page)).toHaveCount(61);
        for (const n of [2, 10, 61]) {
          await panel(page).locator(`.digest-dates a[data-day="${dayAgo(n)}"]`).click();
          await expect(page.locator(`article[data-day="${dayAgo(n)}"]`)).toBeVisible();
          await expect(current(page)).toHaveAttribute("data-day", dayAgo(n));
        }
        await page.locator('nav a[href="/digest"]').click();
        await expect(page.locator(`article[data-day="${dayAgo(1)}"]`)).toBeVisible();
        await expect(current(page)).toHaveAttribute("data-day", dayAgo(1));
        await page.waitForTimeout(500);
        expect(await listRequests(request)).toHaveLength(1);
      });

      test("the second page fails with a 5xx: the load error, never a count of the first page; a reload with the page answering shows 101 and 1", async ({ page, request }) => {
        await history(request, lang, 101);
        // Every text the counts ever had on the page, from the first paint.
        await page.addInitScript(() => {
          const seen: string[] = [];
          (window as unknown as { __counts: string[] }).__counts = seen;
          const look = () => {
            const el = document.querySelector('[data-testid="digest-counts"]');
            if (el) seen.push(el.textContent ?? "");
          };
          new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
        });
        const second = /\/v1\/digests\?.*cursor=/;
        await page.route(second, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "server_error", message: "" } }) }));
        await signIn(page, "/digest");
        // The digest itself, on the left, is fine; the panel says what failed.
        await expect(page.locator("article[data-day]")).toBeVisible();
        await expect(panel(page).getByRole("alert")).toHaveText(w.failed);
        await expect(counts(page)).toHaveCount(0);
        await expect(rows(page)).toHaveCount(0);
        expect(await page.evaluate(() => (window as unknown as { __counts: string[] }).__counts)).toEqual([]);

        await page.unroute(second);
        await page.reload();
        await expect(counts(page).locator(".stat-n")).toHaveText(["101", "1"]);
        await expect(rows(page)).toHaveCount(101);
      });
    });
  }
});
