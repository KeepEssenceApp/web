// QA #74: marking a line of the daily digest from its panel shows on the line at once.
import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn, openInbox } from "./helpers";

test.skip(!FAKE, "relies on the fake's seed");
test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("QA #74: Seen, pressed in the panel, shows on the digest line without a reload", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, "the panel sits beside the digest on wide screens only");
  await signIn(page, "/digest");
  await page.locator("details.rest > summary, .rest summary").first().click().catch(() => undefined);
  const line = page.locator(".rest-line").filter({ hasNot: page.getByTestId("rest-state") }).filter({ has: page.locator("a") }).first();
  const id = await line.getAttribute("data-item");
  await line.locator("a").click();
  // The core is slow: the line must not wait for it.
  await page.request.post("/__test/delay", { data: { ms: 2000 } });
  await page.getByRole("complementary").getByRole("button", { name: "看过了" }).click();
  await expect(page.locator(`.rest-line[data-item="${id}"]`).getByTestId("rest-state")).toHaveText("你标的：看过了", { timeout: 1000 });
});

test.afterEach(async ({ request }) => {
  await request.post("/__test/delay", { data: { ms: 0 } });
});

test("QA #73: a day pressed in the month card on Today opens the month with that day chosen", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, "the day panel exists on wide screens only");
  await signIn(page, "/");
  const days = page.getByTestId("month-panel").locator(".cal-day[data-day]:not(.mark-future)");
  await expect(days.first()).toBeVisible();
  const n = await days.count();
  test.skip(n < 3, "the month has only just begun");
  const day = await days.nth(n - 3).getAttribute("data-day");
  await days.nth(n - 3).click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?day=${day}&from=today$`));
  await expect(page.getByTestId("day-panel")).toHaveAttribute("data-day", day!);
  // Beside the days, the card still opens the month as before.
  await page.goto("/");
  await page.getByTestId("month-panel").locator(".label").click();
  await expect(page).toHaveURL(/\/calendar\?from=today$/);
});

test("QA #75: the month says what each kind of dot means", async ({ page }) => {
  await signIn(page, "/calendar");
  const legend = page.getByTestId("cal-legend").locator("li");
  await expect(legend).toHaveCount(5);
  await expect(legend.first()).toContainText("什么都没存入");
  for (const box of await legend.locator(".cal-dot").all()) expect((await box.boundingBox())!.width).toBeGreaterThan(2);
});

test("QA #76: the save sentence goes once the user moves on", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, "on a narrow screen opening an item leaves Today, and the bar with it");
  await signIn(page, "/");
  await openInbox(page);
  await page.locator(".inbox-box").fill("一条用来看提示的文字");
  await page.locator(".inbox-box").press("Meta+Enter");
  const said = page.locator(".said");
  await expect(said).toHaveText("已存入。");
  // Open an item beside the list: Today, and the two controls, stay on the screen; the sentence about the save does not.
  await page.evaluate(() => {
    history.pushState(null, "", "/?item=it_worth");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\?item=it_worth$/);
  await expect(page.getByTestId("inbox-open")).toBeVisible();
  await expect(said).toHaveCount(0);
});

test("QA #92: an analysis the panel learns of first also moves the item in the list, at once", async ({ page, request }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, "the panel sits beside the list on wide screens only");
  await signIn(page, "/");
  await openInbox(page);
  await page.locator(".inbox-box").fill("等解读的一条 " + Date.now());
  await page.locator(".inbox-box").press("Meta+Enter");
  const row = page.locator(".waiting").first();
  await expect(row).toBeVisible();
  const id = await row.getAttribute("data-item");
  await row.locator("a").click();
  await expect(page).toHaveURL(new RegExp(`/item/${id}$`));
  await expect(page.getByRole("complementary")).toContainText("还没解读");
  // The analysis is handed in. The list's next answer is an old one (it was on its way already);
  // the panel's is the new one.
  const old = await (await page.request.get("/v1/items?state=today", { headers: { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("ke.credential"))}` } })).text();
  await request.post("/__test/analyse", { data: { item_id: id } });
  let stale = 1;
  await page.route("**/v1/items?*", (route) => (stale-- > 0 ? route.fulfill({ contentType: "application/json", body: old }) : route.continue()));
  // Anything that makes both ask again: here, another save.
  await openInbox(page);
  await page.locator(".inbox-box").fill("又一条 " + Date.now());
  await page.locator(".inbox-box").press("Meta+Enter");
  await expect(page.getByRole("complementary").locator("dt").first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator(`.waiting[data-item="${id}"]`)).toHaveCount(0, { timeout: 3000 });
});
