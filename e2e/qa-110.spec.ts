// QA #110: a daily digest says what it covers, apart from what was saved that day.
// Synthetic data only: the fake core's seed has a day with 8 saved and a digest of 8, and a today with 7 saved and no
// digest. Nothing here reads a user's content, calls a model or says anything about 26 Nov's real figures.
import { expect, test, type Page } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.skip(!FAKE, "relies on the fake's seed");

/** The seeded user lives in Asia/Shanghai. */
const dayAgo = (n: number) => new Date(Date.now() + 8 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);

const ZH = {
  label: "每日摘要收哪些条目",
  body: "每日摘要不按「当天存了多少」来收。写摘要时，会从还没进过摘要、没有删除、已经解读过的条目里（含没能解读出结果的），按解读完成的先后挑选，每份有上限，所以可能包含前几天积下的条目。当天存入、但写摘要时还没解读完，或超出这一份上限的，不会出现在这份里；之后如果仍满足条件（例如还没删除），可能被以后的摘要选入，但不固定是哪天。日历里的「存入」数和摘要条数算的不是同一件事，所以不一定相同。",
};
const EN = {
  label: "What a daily digest covers",
  body: "A daily digest isn't built from “everything saved today”. When it's written, it picks from items you haven't deleted that have been processed (including any we couldn't analyse) and haven't been in a digest yet, earliest-processed first, up to a set limit per digest. So it can include items from earlier days. Items saved that day that weren't processed yet when it was written, or didn't fit, won't be in it; they may be picked for a later digest if they still qualify (for example, you haven't deleted them), but not on a set day. The Calendar's Saved count and the digest count measure different things, so they can differ.",
};

/** W8: what can be pressed is no lower than 44 CSS px. */
const MIN_TAP = 44;

/**
 * The line is closed until asked; what can be pressed on it is at least 44 px high before it opens (W8), the whole of that
 * height presses it, and opening it shows the whole text, which does not run off the screen. The height is read from the
 * rendered page (not from the stylesheet) at whatever width the project runs: 1280 px on desktop, 412 px on the phone.
 */
async function expectScope(page: Page, root: ReturnType<Page["locator"]>, words: { label: string; body: string }) {
  const scope = root.getByTestId("digest-scope");
  const summary = scope.locator("summary");
  await expect(scope).toBeVisible();
  await expect(scope).not.toHaveAttribute("open", "");
  await expect(summary).toHaveText(words.label);
  await expect(root.getByTestId("digest-scope-body")).toBeHidden();
  // Closed: the pressable area is at least 44 px high and inside the window sideways.
  await summary.scrollIntoViewIfNeeded();
  const box = (await summary.boundingBox())!;
  test.info().annotations.push({ type: "closed line", description: `${box.height} px high at ${page.viewportSize()!.width} px wide` });
  expect(box.height, `the closed line is ${box.height} px high at ${page.viewportSize()!.width} px wide`).toBeGreaterThanOrEqual(MIN_TAP);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  // The whole height is the button: the top and the bottom pixel row both land on the summary, not on what is next to it.
  const hits = await summary.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const on = (y: number) => document.elementFromPoint(r.left + 8, y)?.closest("summary") === el;
    return [on(r.top + 1), on(r.bottom - 1)];
  });
  expect(hits).toEqual([true, true]);
  // Press it at its lowest edge, where the old 33 px line was not: it opens.
  await summary.click({ position: { x: 8, y: box.height - 2 } });
  await expect(scope).toHaveAttribute("open", "");
  // Still the same height once open (the text is under it, not part of it).
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TAP);
  await expect(root.getByTestId("digest-scope-body")).toBeInViewport();
  await expect(root.getByTestId("digest-scope-body")).toHaveText(words.body);
  const body = (await root.getByTestId("digest-scope-body").boundingBox())!;
  expect(body.x).toBeGreaterThanOrEqual(0);
  expect(body.x + body.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  // It sits under the count line and above who wrote it.
  const order = await root.locator("article header").evaluate((h) => [...h.children].map((c) => c.getAttribute("data-testid") ?? c.tagName));
  expect(order.indexOf("digest-header")).toBeLessThan(order.indexOf("digest-scope"));
  expect(order.indexOf("digest-scope")).toBeLessThan(order.length - 1);
  // Nothing wider than the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/**
 * A day's digest from the Calendar, the way each screen really gets there. From 1100 px the day is chosen in the month and
 * opens in the panel beside it (`day-panel`, the digest embedded in it). On a phone the month has no panel: a day with a
 * daily digest is a link to the digest's own page (/digest/:day), so that is the path pressed here. Returns what holds the digest.
 */
async function openDayFromCalendar(page: Page, day: string, phone: boolean) {
  if (!phone) {
    await signIn(page, `/calendar/${day.slice(0, 7)}?day=${day}`);
    const panel = page.getByTestId("day-panel");
    await expect(panel).toHaveAttribute("data-day", day);
    return panel;
  }
  await signIn(page, `/calendar/${day.slice(0, 7)}`);
  await expect(page.getByTestId("day-panel")).toHaveCount(0);
  await page.locator(`a.cal-day[data-day="${day}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/digest/${day}$`));
  return page.locator(`article[data-day="${day}"]`).locator("..");
}

test.describe("QA #110: what a daily digest covers", () => {
  test("in Chinese, on the Daily digest page", async ({ page, request }) => {
    await reset(request);
    await signIn(page, "/digest");
    await expect(page.getByTestId("digest-header")).toHaveText(/这份每日摘要里有 \d+ 条。/);
    await expectScope(page, page.locator("article[data-day]").locator(".."), ZH);
  });

  test("in English, on the Daily digest page", async ({ page, request }) => {
    await reset(request, { account_lang: "en" });
    await signIn(page, "/digest");
    await expect(page.getByTestId("digest-header")).toHaveText(/\d+ in this daily digest\./);
    await expectScope(page, page.locator("article[data-day]").locator(".."), EN);
  });

  test("a day with a digest, opened from the Calendar, has it (beside the day's counts on the wide screen: 8 saved, 8 in the digest here)", async ({ page, request, isMobile }) => {
    await reset(request);
    const yesterday = dayAgo(1);
    const day = await openDayFromCalendar(page, yesterday, isMobile);
    if (!isMobile) await expect(day.getByTestId("day-counts").locator(".stat-label").first()).toHaveText("存入");
    await expectScope(page, day, ZH);
  });

  test("the same, in English", async ({ page, request, isMobile }) => {
    await reset(request, { account_lang: "en" });
    const yesterday = dayAgo(1);
    const day = await openDayFromCalendar(page, yesterday, isMobile);
    if (!isMobile) await expect(day.getByTestId("day-counts").locator(".stat-label").first()).toHaveText("Saved");
    await expectScope(page, day, EN);
  });

  test("with no daily digest the line is not there: there is nothing for it to explain", async ({ page, request }) => {
    await reset(request, { empty: true });
    await signIn(page, "/digest");
    await expect(page.getByTestId("digest-none")).toBeVisible();
    await expect(page.getByTestId("digest-scope")).toHaveCount(0);
  });
});
