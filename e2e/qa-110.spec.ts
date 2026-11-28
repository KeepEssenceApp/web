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

/** The line is closed until asked; opening it shows the whole text, which does not run off the screen. */
async function expectScope(page: Page, root: ReturnType<Page["locator"]>, words: { label: string; body: string }) {
  const scope = root.getByTestId("digest-scope");
  await expect(scope).toBeVisible();
  await expect(scope).not.toHaveAttribute("open", "");
  await expect(scope.locator("summary")).toHaveText(words.label);
  await expect(root.getByTestId("digest-scope-body")).toBeHidden();
  await scope.locator("summary").click();
  await expect(scope).toHaveAttribute("open", "");
  await expect(root.getByTestId("digest-scope-body")).toHaveText(words.body);
  // It sits under the count line and above who wrote it.
  const order = await root.locator("article header").evaluate((h) => [...h.children].map((c) => c.getAttribute("data-testid") ?? c.tagName));
  expect(order.indexOf("digest-header")).toBeLessThan(order.indexOf("digest-scope"));
  expect(order.indexOf("digest-scope")).toBeLessThan(order.length - 1);
  // Nothing wider than the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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

  test("a day with a digest, opened from the Calendar, has it beside the day's counts (8 saved, 8 in the digest here)", async ({ page, request, isMobile }) => {
    test.skip(isMobile, "the day panel of the Calendar is laid out for the wide screen; the phone shows the digest page above");
    await reset(request);
    const yesterday = dayAgo(1);
    await signIn(page, `/calendar?day=${yesterday}`);
    const day = page.getByTestId("day-panel");
    await expect(day).toHaveAttribute("data-day", yesterday);
    await expect(day.getByTestId("day-counts").locator(".stat-label").first()).toHaveText("存入");
    await expectScope(page, day, ZH);
  });

  test("the same, in English, in the Calendar's day panel", async ({ page, request, isMobile }) => {
    test.skip(isMobile, "the day panel of the Calendar is laid out for the wide screen");
    await reset(request, { account_lang: "en" });
    const yesterday = dayAgo(1);
    await signIn(page, `/calendar?day=${yesterday}`);
    const day = page.getByTestId("day-panel");
    await expect(day.getByTestId("day-counts").locator(".stat-label").first()).toHaveText("Saved");
    await expectScope(page, day, EN);
  });

  test("with no daily digest the line is not there: there is nothing for it to explain", async ({ page, request }) => {
    await reset(request, { empty: true });
    await signIn(page, "/digest");
    await expect(page.getByTestId("digest-none")).toBeVisible();
    await expect(page.getByTestId("digest-scope")).toHaveCount(0);
  });
});
