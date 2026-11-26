import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed");
test.beforeEach(async ({ request }) => reset(request));

test("W3: opens on the latest; four parts in order; unread dot; Read. Good night", async ({ page }) => {
  await signIn(page);
  // One dot on the entry while the latest digest is unread.
  await expect(page.getByTestId("digest-unread")).toHaveCount(1);
  await page.locator('[data-entry="digest"]').click();
  await expect(page.getByTestId("digest-header")).toHaveText(/这份每日摘要里有 \d+ 条。\d+ 条值得深挖的还没处理。/);
  const parts = await page.locator("[data-part]").evaluateAll((els) => els.map((e) => e.getAttribute("data-part")));
  expect(parts).toEqual(["summary", "worth", "rest", "question"]);
  await expect(page.locator("[data-part] .label, [data-part] summary.label")).toHaveText(["总结", "值得深挖的", /^其余的 · \d+ 条$/, "睡前一问"]);

  // Worth a deep dive: cards with the three actions. The rest: collapsed title lines.
  const worth = page.locator('[data-part="worth"] .card');
  await expect(worth).toHaveCount(2);
  await expect(worth.first().locator(".actions button")).toHaveText(["深挖", "不感兴趣", "看过了"]);
  await expect(page.locator('[data-part="rest"] details')).not.toHaveAttribute("open", "");
  await expect(page.locator(".rest-line").first()).toBeHidden();
  // Plain text: no images, no tags.
  await expect(page.locator("article img")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/\b(assistant|expiry|source):/);

  await page.getByRole("button", { name: "读了，晚安" }).click();
  await expect(page.getByRole("button", { name: "读了，晚安" })).toHaveCount(0);
  // In its place: a whole sentence, not a bare label (QA #89).
  await expect(page.getByTestId("digest-read-done")).toHaveText("这份每日摘要你读过了。");
  await expect(page.locator("article header .state")).toHaveText("读了");
  await expect(page.getByTestId("digest-unread")).toHaveCount(0);
});

test("W3: a line in the rest can be restored; an action moves a card to the rest", async ({ page }) => {
  await signIn(page, "/digest");
  const day = await page.locator("article[data-day]").getAttribute("data-day");
  expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.locator('[data-part="rest"] summary').click();
  const line = page.locator('.rest-line[data-item="d1_r3"]');
  await expect(line).toContainText("不感兴趣");
  await line.getByRole("button", { name: "挽回" }).click();
  await expect(page.locator('.rest-line[data-item="d1_r3"] button')).toHaveCount(0);

  await page.locator('[data-part="worth"] [data-item="d1_w1"] .actions button', { hasText: "看过了" }).click();
  await expect(page.locator('[data-part="worth"] [data-item="d1_w1"]')).toHaveCount(0);
  await expect(page.locator('.rest-line[data-item="d1_w1"]')).toContainText("看过了");
  await page.locator('.rest-line[data-item="d1_w1"]').getByRole("button", { name: "挽回" }).click();
  await expect(page.locator('[data-part="worth"] [data-item="d1_w1"]')).toBeVisible();
});

test("W3: page back and forth through earlier days", async ({ page }) => {
  await signIn(page, "/digest");
  const latest = await page.locator("article[data-day]").getAttribute("data-day");
  await expect(page.getByRole("link", { name: /更新的一份/ })).toHaveCount(0);
  await page.getByRole("link", { name: /更早的一份/ }).click();
  await expect(page.locator("article[data-day]")).not.toHaveAttribute("data-day", latest!);
  const earlier = await page.locator("article[data-day]").getAttribute("data-day");
  expect(earlier! < latest!).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/digest/${earlier}$`));
  await expect(page.locator("article header .state")).toHaveText("读了");
  await page.getByRole("link", { name: /更新的一份/ }).click();
  await expect(page.locator("article[data-day]")).toHaveAttribute("data-day", latest!);
});

test("with no daily digest there is one sentence and the reason", async ({ page, request }) => {
  await reset(request, { empty: true });
  await signIn(page, "/digest");
  await expect(page.getByTestId("digest-none")).toHaveText("还没有每日摘要。");
  await expect(page.getByTestId("digest-unread")).toHaveCount(0);
});
