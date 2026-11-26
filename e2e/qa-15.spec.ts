// Internal QA #15 (web#4): the month has as many dots as it has days. The days to come are neutral
// grey dots: they carry no mark, cannot be pointed at, chosen or opened. Nothing else about the
// calendar changes (spec form.md, Cheney 2026-11-26, choice B).
import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const now = () => new Date(Date.now() + 8 * 3600e3);
const daysInMonth = () => new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth() + 1, 0)).getUTCDate();

test("QA #15: the opened month has a dot for every day; the days to come are plain grey dots that cannot be opened", async ({ page }) => {
  await signIn(page, "/calendar");
  const dots = page.locator(".cal-large .cal-day");
  await expect(dots).toHaveCount(daysInMonth());
  await expect(page.locator(".cal-large .is-today")).toHaveCount(1);
  const coming = daysInMonth() - now().getUTCDate();
  test.skip(coming === 0, "today is the last day of the month: there are no days to come to look at");
  const future = page.locator(".cal-large .mark-future");
  await expect(future).toHaveCount(coming);
  // Not links, not in the tab order, and said as "not yet".
  await expect(page.locator(".cal-large a.mark-future")).toHaveCount(0);
  await expect(future.first()).not.toHaveAttribute("tabindex", /.*/);
  await expect(future.first()).toHaveAttribute("aria-label", /还没到/);
  // Seven to a row by date, as before: the eighth dot starts the second row, whatever the days that follow.
  const tops = await dots.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops.slice(0, 7)).size).toBe(1);
  expect(tops[7]).toBeGreaterThan(tops[0]);
});

test("QA #15: pressing a day to come does nothing; the day under the pointer is still named by the days that have come", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, "choosing a day beside the month is for wide screens");
  await signIn(page, "/calendar");
  test.skip(daysInMonth() === now().getUTCDate(), "no day to come");
  const url = page.url();
  await page.locator(".cal-large .mark-future").last().click({ force: true });
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("day-panel")).toHaveAttribute("data-day", /\d{4}-\d{2}-\d{2}/);
  const open = await page.getByTestId("day-panel").getAttribute("data-day");
  expect(open! <= now().toISOString().slice(0, 10)).toBe(true);
  // The month's address ignores a day that has not come, as before.
  await page.goto(`/calendar?day=${new Date(now().getTime() + 86400e3 * 2).toISOString().slice(0, 10)}`);
  expect((await page.getByTestId("day-panel").getAttribute("data-day"))! <= now().toISOString().slice(0, 10)).toBe(true);
});

test("QA #15: the month under Notes and the faint month on Today draw every day too, and the four entries are as they were", async ({ page, isMobile }) => {
  await signIn(page, "/notes");
  await expect((isMobile ? page.locator(".month-card") : page.getByTestId("month-panel")).locator(".cal-day")).toHaveCount(daysInMonth());
  await page.goto("/");
  await expect(page.locator(".today-cal .cal-day")).toHaveCount(daysInMonth());
  await expect(page.locator("nav.nav .nav-entry")).toHaveCount(4);
});
