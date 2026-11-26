// Internal QA #69 (public issue: web #5): an analysis that came back without a key point keeps the
// field and says so, on the cards and on the item. Nothing is made up; an unavailable analysis
// stays its single honest sentence.
import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const analyse = (request: any, body: Record<string, unknown>) => request.post("/__test/analyse", { data: body });

test("QA #69: no key point — the field stays on the Today card and on the item, with a sentence that says so", async ({ page, request }) => {
  await signIn(page);
  expect((await analyse(request, { item_id: "it_saved", points: [] })).ok()).toBe(true);
  await page.goto("/");
  const card = page.locator('[data-item="it_saved"]');
  await expect(card.locator("dt")).toHaveText(["内容概述", "关键事实", "要点", "判定"]);
  await expect(card.getByTestId("points-none")).toHaveText("解读里没有列出要点。");
  await expect(card.locator(".points li")).toHaveCount(0);

  await page.goto("/item/it_saved");
  const item = page.locator("[data-open-item]");
  await expect(item.locator("dt")).toHaveText(["内容概述", "关键事实", "要点", "判定"]);
  await expect(item.getByTestId("points-none")).toHaveText("解读里没有列出要点。");
});

test("QA #69: the same in English", async ({ page, request }) => {
  await signIn(page, "/assistants/account");
  await page.getByTestId("language").selectOption("en");
  await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
  expect((await state(request)).user.lang).toBe("en");
  await analyse(request, { item_id: "it_saved", points: [] });
  await page.goto("/");
  const card = page.locator('[data-item="it_saved"]');
  await expect(card.locator("dt")).toHaveText(["Summary", "Key fact", "Key points", "Verdict"]);
  await expect(card.getByTestId("points-none")).toHaveText("The analysis lists none.");
  await page.goto("/item/it_saved");
  await expect(page.locator("[data-open-item]").getByTestId("points-none")).toHaveText("The analysis lists none.");
});

test("QA #69: one to three key points still render as a list, and no empty-state sentence is added to them", async ({ page, request }) => {
  await signIn(page);
  await analyse(request, { item_id: "it_saved", points: ["只有一条。"] });
  await analyse(request, { item_id: "it_triaged", points: ["一。", "二。", "三。"] });
  await page.goto("/");
  const one = page.locator('[data-item="it_saved"]');
  await expect(one.locator(".points li")).toHaveText(["只有一条。"]);
  await expect(one.getByTestId("points-none")).toHaveCount(0);
  const three = page.locator('[data-item="it_triaged"]');
  await expect(three.locator(".points li")).toHaveText(["一。", "二。", "三。"]);
  await expect(three.getByTestId("points-none")).toHaveCount(0);
  await page.goto("/item/it_saved");
  await expect(page.locator("[data-open-item] .points li")).toHaveText(["只有一条。"]);
});

test("QA #69: an analysis that could not read the content stays one sentence: no fields, no empty key points", async ({ page, request }) => {
  await signIn(page);
  await analyse(request, { item_id: "it_saved", unavailable: "内容读不出来" });
  await page.goto("/item/it_saved");
  const item = page.locator("[data-open-item]");
  await expect(item.getByText("内容读不出来")).toBeVisible();
  await expect(item.getByTestId("points-none")).toHaveCount(0);
  await expect(item.locator("dl.fields")).toHaveCount(0);
});

test("QA #69: the seeded analyses (which have key points) are unchanged", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(page.locator('[data-item="it_worth"] .points li')).toHaveCount(3);
  await expect(page.locator('[data-item="it_worth"]').getByTestId("points-none")).toHaveCount(0);
});
