// Internal QA #108: an item's own page has the status bar (rule A5). Below 1100 px an item opens on a page of its own
// (on a phone always), and without the bar the user never sees whether the assistant is at work. On a wide screen the
// item sits beside its list, whose page carries the bar, and the item must not add a second one.
import { expect, test, type Page } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");

const ITEMS = ["it_triaged", "it_saved"]; // one analysed, one not read yet: the bar is on both

/** A phone is the phone project; the other project is made as narrow as a tablet (not wide, not a phone) to see the other layout. */
async function narrowScreen(page: Page, isMobile: boolean) {
  if (!isMobile) await page.setViewportSize({ width: 900, height: 900 });
}

test.describe("QA #108: the item page has the status bar", () => {
  for (const id of ITEMS) {
    test(`${id}, in Chinese: a mark on a phone that opens the bar, one line on a tablet width`, async ({ page, request, isMobile }) => {
      await reset(request);
      await narrowScreen(page, isMobile);
      await signIn(page, `/item/${id}`);
      await expect(page.locator("[data-open-item]")).toBeVisible();
      const top = page.locator(".item-top");
      await expect(top.locator("a.back")).toBeVisible();
      if (isMobile) {
        const mark = top.locator(".status-mark");
        await expect(mark).toHaveCount(1);
        await expect(mark).toHaveAttribute("aria-label", "助手的状态");
        await expect(mark).toHaveText("2");
        await expect(page.locator(".status-pop")).toHaveCount(0);
        await mark.click();
        await expect(page.locator(".status-pop .status-cell")).toHaveCount(4);
        await expect(page.locator(".status-pop")).toContainText("阿深");
      } else {
        const bar = top.locator(".status");
        await expect(bar).toHaveAttribute("data-layout", "narrow");
        await expect(bar).toHaveAttribute("aria-label", "助手的状态");
        await expect(bar).toContainText("2 个助手在干活");
      }
    });
  }

  test("in English the bar is there too", async ({ page, request, isMobile }) => {
    await reset(request, { account_lang: "en" });
    await narrowScreen(page, isMobile);
    await signIn(page, "/item/it_triaged");
    await expect(page.locator("[data-open-item]")).toBeVisible();
    const top = page.locator(".item-top");
    if (isMobile) {
      const mark = top.locator(".status-mark");
      await expect(mark).toHaveAttribute("aria-label", "Assistant status");
      await mark.click();
      await expect(page.locator(".status-pop .status-cell")).toHaveCount(4);
    } else {
      await expect(top.locator(".status")).toHaveAttribute("aria-label", "Assistant status");
      await expect(top.locator(".status")).toContainText(/working/);
    }
  });

  test("the manage tier goes from the bar to Assistants", async ({ page, request, isMobile }) => {
    await reset(request);
    await narrowScreen(page, isMobile);
    await signIn(page, "/item/it_triaged");
    await expect(page.locator("[data-open-item]")).toBeVisible();
    if (isMobile) {
      await page.locator(".item-top .status-mark").click();
      await page.locator(".status-pop a").click();
    } else {
      await page.locator(".item-top a.status-press").click();
    }
    await expect(page).toHaveURL(/\/assistants$/);
  });

  test("an item opened from Notes has it as well, and the way back still goes to Notes", async ({ page, request, isMobile }) => {
    await reset(request);
    await narrowScreen(page, isMobile);
    await signIn(page, "/notes?item=it_triaged");
    await expect(page.locator("[data-open-item]")).toBeVisible();
    await expect(page.locator(".item-top .status-mark, .item-top .status")).toHaveCount(1);
    await page.locator(".item-top a.back").click();
    await expect(page).toHaveURL(/\/notes$/);
  });

  test("beside a list (wide screen) there is one status bar, not two", async ({ page, request, isMobile }) => {
    test.skip(isMobile, "the panel is for wide screens");
    await reset(request);
    await signIn(page, "/item/it_triaged");
    await expect(page.locator("[data-open-item]")).toBeVisible();
    await expect(page.locator(".status")).toHaveCount(1);
    await expect(page.locator(".item-top")).toHaveCount(0);
    // The panel still has its own "Close".
    await expect(page.getByTestId("panel-close")).toBeVisible();
  });

  test("a phone: the mark sits inside the top line and nothing sticks out at the sides", async ({ page, request, isMobile }) => {
    test.skip(!isMobile, "phone only");
    await reset(request);
    await signIn(page, "/item/it_triaged");
    await expect(page.locator(".item-top .status-mark")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const box = (await page.locator(".item-top").boundingBox())!;
    const mark = (await page.locator(".item-top .status-mark").boundingBox())!;
    expect(mark.x + mark.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  });
});
