// Internal QA #44: Today's empty list is not "nothing saved" until the calendar has said that no daily digest took
// the items. The real calendar answer is held (not changed) while items and status finish first, as QA did with a
// debugger; no model is involved.
import { expect, test, type Page, type Route } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");

const NOTHING = /今天还没有存入|Nothing saved today yet/;
const IN_DIGEST = /每日摘要已经出了|daily digest is written/;

/** Every text the empty-list sentences take, from the first paint on: nothing may ever say "nothing saved" wrongly. */
async function watchEmptyTexts(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __empty: string[] }).__empty = seen;
    const look = () => {
      for (const el of document.querySelectorAll("[data-testid^='today-empty']")) {
        const text = `${(el as HTMLElement).dataset.testid}: ${el.textContent?.trim()}`;
        if (seen[seen.length - 1] !== text) seen.push(text);
      }
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
  });
}
const emptyTexts = (page: Page) => page.evaluate(() => (window as unknown as { __empty: string[] }).__empty);

/** Holds the calendar answer until `release()`; the answer itself is the fake core's own. */
async function holdCalendar(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let asked!: () => void;
  const arrived = new Promise<void>((r) => (asked = r));
  await page.route("**/v1/calendar*", async (route: Route) => {
    asked();
    await held;
    await route.continue();
  });
  return { release, arrived };
}

/** Deletes what is in Today's list, as the user would from the item pages: the account has saved before, nothing today, no digest. */
async function emptyTodayList(page: Page, request: import("@playwright/test").APIRequestContext) {
  const headers = { Authorization: `Bearer ${await credentialOf(page)}` };
  const list = await (await request.get("/v1/items?state=today&limit=100", { headers })).json();
  for (const item of list.items) expect((await request.delete(`/v1/items/${item.id}`, { headers })).ok()).toBe(true);
}

test.beforeEach(async ({ request }) => reset(request));

test("QA #44: items and status finish first, the calendar is still pending, then says today has a digest: never 'nothing saved'", async ({ page, request }) => {
  expect((await request.post("/__test/digest-today")).ok()).toBe(true);
  await watchEmptyTexts(page);
  await signIn(page);
  const calendar = await holdCalendar(page);
  const items = page.waitForResponse((r) => r.url().includes("/v1/items?state=today") && r.ok());
  await page.goto("/");
  await calendar.arrived;
  await items;
  // The list is in and empty; the calendar has not answered: no sentence about what was saved.
  await expect(page.getByTestId("today-empty-pending")).toBeVisible();
  await expect(page.getByTestId("today-empty")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(NOTHING);
  calendar.release();
  await expect(page.getByTestId("today-empty")).toContainText(IN_DIGEST);
  await expect(page.getByTestId("today-empty-pending")).toHaveCount(0);
  // From the first paint to the end, the false sentence was never there; the pending state was.
  const texts = await emptyTexts(page);
  expect(texts.some((x) => NOTHING.test(x))).toBe(false);
  expect(texts.some((x) => x.startsWith("today-empty-pending"))).toBe(true);
});

test("QA #44: a calendar that answered and says no digest: 'nothing saved today yet' is shown, and only after the answer", async ({ page, request }) => {
  await signIn(page);
  await emptyTodayList(page, request);
  await watchEmptyTexts(page);
  const calendar = await holdCalendar(page);
  const items = page.waitForResponse((r) => r.url().includes("/v1/items?state=today") && r.ok());
  await page.goto("/");
  await calendar.arrived;
  await items;
  await expect(page.getByTestId("today-empty-pending")).toBeVisible();
  await expect(page.getByTestId("today-empty")).toHaveCount(0);
  calendar.release();
  await expect(page.getByTestId("today-empty")).toHaveText(/今天还没有存入。点底部的「从剪贴板存入」，或点旁边的圆形按钮输入。|Nothing saved today yet\. Press “Save from clipboard”/);
  await expect(page.getByTestId("today-empty-pending")).toHaveCount(0);
  await expect(page.getByTestId("today-empty-unknown")).toHaveCount(0);
  // The sentence came once the calendar had answered, not before.
  const texts = await emptyTexts(page);
  expect(texts.map((x) => x.split(":")[0])).toEqual(["today-empty-pending", "today-empty"]);
});

test("QA #44: a calendar that fails is said, not read as 'nothing saved'; trying again shows the real answer", async ({ page, request }) => {
  expect((await request.post("/__test/digest-today")).ok()).toBe(true);
  await watchEmptyTexts(page);
  let fail = true;
  await signIn(page);
  await page.route("**/v1/calendar*", (route) => (fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "down" } }) }) : route.continue()));
  await page.goto("/");
  await expect(page.getByTestId("today-empty-unknown")).toContainText(/没读到今天的每日摘要|could not be read/);
  await expect(page.getByTestId("today-empty")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(NOTHING);
  fail = false;
  await page.getByTestId("today-empty-unknown").getByRole("button").click();
  await expect(page.getByTestId("today-empty")).toContainText(IN_DIGEST);
  await expect(page.getByTestId("today-empty-unknown")).toHaveCount(0);
  expect((await emptyTexts(page)).some((x) => NOTHING.test(x))).toBe(false);
});

test("QA #44: the digest is written while the page is open and a notification says refresh: the calendar of the older load does not decide", async ({ page, request }) => {
  await watchEmptyTexts(page);
  await signIn(page);
  // The page is open on Today with its items and a calendar that said "no digest yet".
  await expect(page.locator(".card.analysis, .waiting-list li").first()).toBeVisible();
  await expect(page.getByTestId("today-empty")).toHaveCount(0);
  // The digest is written; the notification's refresh reloads the list, and the calendar's answer is slow.
  expect((await request.post("/__test/digest-today")).ok()).toBe(true);
  const calendar = await holdCalendar(page);
  const items = page.waitForResponse((r) => r.url().includes("/v1/items?state=today") && r.ok());
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "refresh" } })));
  await calendar.arrived;
  await items;
  await expect(page.getByTestId("today-empty-pending")).toBeVisible();
  await expect(page.getByTestId("today-empty")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(NOTHING);
  calendar.release();
  await expect(page.getByTestId("today-empty")).toContainText(IN_DIGEST);
  expect((await emptyTexts(page)).some((x) => NOTHING.test(x))).toBe(false);
});
