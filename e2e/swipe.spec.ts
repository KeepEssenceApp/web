import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn, swipe } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed");
test.beforeEach(async ({ request }) => reset(request));

test("W7: on a phone an analysis swipes right into the deep-dive queue, left to not interested", async ({ page, isMobile }) => {
  test.skip(!isMobile, "swiping exists on touch screens only");
  await signIn(page);
  await expect(page.locator('[data-item="it_know"]')).toBeVisible();
  await swipe(page, '[data-item="it_know"]', 220);
  await expect(page.locator(".said")).toContainText("已加入深挖队列。");
  await expect(page.locator('[data-item="it_know"]')).toHaveCount(0);

  await swipe(page, '[data-item="it_skip"]', -220);
  await expect(page.locator(".said")).toContainText("标了不感兴趣。");
  await expect(page.locator('[data-item="it_skip"]')).toHaveCount(0);

  // A short drag does nothing; "seen" has no swipe.
  await swipe(page, '[data-item="it_worth"]', 40);
  await expect(page.locator('[data-item="it_worth"]')).toBeVisible();

  await page.goto("/notes");
  await expect(page.locator('.queue-row[data-item="it_know"]')).toBeVisible();
  // No assistant was chosen and nothing was opened: it waits for the deep read.
  await expect(page.locator('.queue-row[data-item="it_know"] .state')).toHaveText("等精读");
});

test("W7: a daily digest card swipes the same way", async ({ page, isMobile }) => {
  test.skip(!isMobile, "swiping exists on touch screens only");
  await signIn(page, "/digest");
  await swipe(page, '[data-part="worth"] [data-item="d1_w1"]', 220);
  await expect(page.locator(".said")).toContainText("已加入深挖队列。");
  await expect(page.locator('[data-part="worth"] [data-item="d1_w1"]')).toHaveCount(0);
  await swipe(page, '[data-part="worth"] [data-item="d1_w2"]', -220);
  await expect(page.locator(".said")).toContainText("标了不感兴趣。");
  await page.locator('[data-part="rest"] summary').click();
  await expect(page.locator('.rest-line[data-item="d1_w1"]')).toContainText("在深挖队列里");
  await expect(page.locator('.rest-line[data-item="d1_w2"]')).toContainText("不感兴趣");
});

test("W7: there is no swipe on wide screens", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop only");
  await signIn(page);
  await expect(page.locator(".card.analysis").first()).toBeVisible();
  await expect(page.locator(".swipe")).toHaveCount(0);
});
