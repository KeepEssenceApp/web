// The interface follows the interaction prototype (spec: product/form.md "样子和位置", W6/W8): the reading before the
// original, what can be done at the foot and only what is true, gold ink for the one hint, no explaining paragraphs on
// the daily screens. The save controls and the notice have their tests in inbox.spec.ts; the width of the page in overflow.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const rgb = (page: Page, selector: string, prop = "color") => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p as "color"], prop);

test("an analysed item: the reading first, the original shut until it is asked for", async ({ page }) => {
  await signIn(page, "/item/it_worth");
  const reading = page.locator("section.read");
  const original = page.locator("details.original");
  await expect(reading.locator("dl.fields")).toBeVisible();
  await expect(original).not.toHaveAttribute("open", "");
  // The reading is above the original.
  const a = (await reading.boundingBox())!;
  const b = (await original.boundingBox())!;
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + 1);
  // The original's words are not on the screen until it is opened; opening shows them, and its link.
  await expect(page.locator(".original-body")).toBeHidden();
  await original.locator("> summary").click();
  await expect(page.locator(".original-body")).toBeVisible();
  await expect(original.getByRole("link", { name: "blog.example.dev" })).toBeVisible();
  await original.locator("> summary").click();
  await expect(page.locator(".original-body")).toBeHidden();
});

test("an item nobody has read yet: the original is open, and it says where the item is, not what to do", async ({ page }) => {
  await signIn(page, "/item/it_triaged");
  await expect(page.locator("details.original")).toHaveAttribute("open", "");
  await expect(page.locator(".original-body")).toBeVisible();
  await expect(page.getByTestId("item-stage")).toHaveText("等 阿读 解读");
  // Nothing to decide yet: no bar of actions.
  await expect(page.locator(".actionbar")).toHaveCount(0);
  await page.goto("/item/it_saved");
  await expect(page.getByTestId("item-stage")).toHaveText("刚存入，等分派");
  await expect(page.locator(".actionbar")).toHaveCount(0);
});

test("when the reading arrives while the page is open, the original stays as the user left it", async ({ page, request }) => {
  await signIn(page, "/item/it_triaged");
  await expect(page.locator("details.original")).toHaveAttribute("open", "");
  expect((await request.post("/__test/analyse", { data: { item_id: "it_triaged" } })).ok()).toBe(true);
  await expect(page.locator("section.read dl.fields")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("details.original")).toHaveAttribute("open", "");
  await expect(page.locator(".actionbar")).toBeVisible();
});

test("what the page could not read is said where the reading would be, whatever the original does", async ({ page }) => {
  await signIn(page, "/item/it_unavail");
  await expect(page.locator("section.read")).toContainText("没取到内容");
  await expect(page.getByTestId("unavailable-hint")).toBeVisible();
  await expect(page.locator("details.original")).not.toHaveAttribute("open", "");
});

test("the actions are at the foot, only for an item that has a reading, and follow what is true of it", async ({ page, isMobile }) => {
  await signIn(page, "/item/it_worth");
  const bar = page.locator(".actionbar");
  await expect(bar).toBeVisible();
  await expect(bar.locator(".actions button")).toHaveText(["深挖", "不感兴趣", "看过了"]);
  const vh = page.viewportSize()!.height;
  const box = (await bar.boundingBox())!;
  expect(box.y).toBeGreaterThan(vh / 2);
  if (isMobile) expect(box.y + box.height).toBeLessThanOrEqual((await page.locator("nav.nav").boundingBox())!.y + 0.5);
  // Deep dive is not started by pressing it: it opens the choice (the queue, or an assistant), as the product really works.
  await bar.getByRole("button", { name: "深挖" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "加入深挖队列" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Marked seen: the bar says so, with the way back, and no longer offers what was done.
  await bar.getByRole("button", { name: "看过了" }).click();
  await expect(page.getByTestId("item-state")).toContainText("看过了");
  await expect(bar.getByRole("button", { name: "挽回" })).toBeVisible();
  await expect(bar.locator(".actions button")).toHaveText(["深挖", "不感兴趣"]);
  await bar.getByRole("button", { name: "挽回" }).click();
  await expect(page.getByTestId("item-state")).toHaveCount(0);
});

test("gold ink is for the one hint: 'worth a deep dive' is in it, in light and in dark; the other verdicts are not", async ({ page, browser, baseURL }) => {
  await signIn(page, "/item/it_worth");
  await expect(page.locator("section.read .verdict-worth")).toHaveText("值得深挖");
  // Light theme: the darker gold the tokens name (never the brand gold itself as a word).
  expect(await rgb(page, "section.read .verdict-worth")).toBe("rgb(121, 86, 0)");
  await page.goto("/item/it_know");
  await expect(page.locator("section.read").getByText("知道就行")).toBeVisible();
  await expect(page.locator("section.read .verdict-worth")).toHaveCount(0);

  const ctx = await browser.newContext({ colorScheme: "dark", baseURL, locale: "zh-CN" });
  const dark = await ctx.newPage();
  await signIn(dark, "/item/it_worth");
  await expect(dark.locator("section.read .verdict-worth")).toBeVisible();
  expect(await rgb(dark, "section.read .verdict-worth")).toBe("rgb(242, 210, 125)");
  await ctx.close();
});

test("the daily screens carry no paragraph of instructions: the calendar page has its dots and its rule of what they count, not how to use them", async ({ page }) => {
  await signIn(page, "/calendar");
  await expect(page.getByTestId("cal-legend")).toBeVisible();
  await expect(page.locator(".calendar-page")).not.toContainText("有每日摘要的那天可以点开");
  await expect(page.locator(".calendar-page")).not.toContainText("选中一个圆点，右边显示那一天");
});

test("controls are as big as the tokens say, buttons are pills, cards are rounded by the scale, and nothing uses the old 6px", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".card.analysis").first()).toBeVisible();
  const sizes = await page.evaluate(() => {
    const px = (v: string) => parseFloat(v);
    const get = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel)!;
      const cs = getComputedStyle(el);
      return { h: el.getBoundingClientRect().height, radius: px(cs.borderTopLeftRadius) };
    };
    return { paste: get('[data-testid="inbox-paste"]'), card: get(".card.analysis"), type: get('[data-testid="inbox-open"]') };
  });
  expect(sizes.paste.h).toBeGreaterThanOrEqual(44);
  expect(sizes.paste.radius).toBeGreaterThanOrEqual(sizes.paste.h / 2 - 1);
  expect(sizes.type.h).toBeGreaterThanOrEqual(44);
  expect(sizes.card.radius).toBe(20);
});
