// Internal QA #43: the calendar's way back and the marked entry follow where it was opened from
// (Today or Notes), in the address, so they do not flip between visits.
import { expect, test, type Page } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const back = (page: Page) => page.getByTestId("calendar-back");
const marked = (page: Page) => page.locator("nav.nav .nav-entry[aria-current=page]");

test("QA #43: opened from Today the calendar leads back to Today and Today is marked; opened from Notes, Notes", async ({ page }) => {
  await signIn(page);
  await page.locator("a.today-cal").click();
  await expect(page).toHaveURL(/\/calendar\?from=today$/);
  await expect(back(page)).toHaveText("‹ 今天");
  await expect(back(page)).toHaveAttribute("href", "/");
  await expect(marked(page)).toHaveAttribute("data-entry", "today");

  await page.goto("/notes");
  await page.locator("a.month-card").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(back(page)).toHaveText("‹ 笔记");
  await expect(back(page)).toHaveAttribute("href", "/notes");
  await expect(marked(page)).toHaveAttribute("data-entry", "notes");

  // And again, in the other order: nothing is remembered from the visit before.
  await page.goto("/");
  await page.locator("a.today-cal").click();
  await expect(back(page)).toHaveText("‹ 今天");
  await expect(marked(page)).toHaveAttribute("data-entry", "today");
});

test("QA #43: the place holds through a reload, a month change and a chosen day", async ({ page, isMobile }) => {
  await signIn(page, "/calendar?from=today");
  await expect(back(page)).toHaveText("‹ 今天");
  await page.reload();
  await expect(back(page)).toHaveText("‹ 今天");
  await expect(marked(page)).toHaveAttribute("data-entry", "today");
  // Every link of the page that stays in the calendar says where it was opened from.
  for (const href of await page.locator("main a[href^='/calendar']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) expect(href).toContain("from=today");
  if (!isMobile) {
    const day = page.locator("a.cal-day[data-day]").first();
    await day.click();
    await expect(page).toHaveURL(/\/calendar\?day=\d{4}-\d{2}-\d{2}&from=today$/);
    await expect(back(page)).toHaveText("‹ 今天");
    await expect(marked(page)).toHaveAttribute("data-entry", "today");
  }
});

test("QA #43: an address with nothing said belongs to Notes, and the month panel beside Today opens it from Today", async ({ page, isMobile }) => {
  await signIn(page, "/calendar");
  await expect(back(page)).toHaveText("‹ 笔记");
  await expect(marked(page)).toHaveAttribute("data-entry", "notes");
  await page.goto("/calendar?day=2026-01-01&from=nonsense");
  await expect(back(page)).toHaveText("‹ 笔记");
  if (!isMobile) {
    await page.goto("/");
    await expect(page.getByTestId("month-panel")).toHaveAttribute("href", "/calendar?from=today");
    await page.goto("/notes");
    await expect(page.getByTestId("month-panel")).toHaveAttribute("href", "/calendar");
  }
});
