// Internal QA #94 (public issue: web #1): the item page never shows the internal tag strings (rule A6).
// The two controls that replaced them stay: who analyses it, how long it is kept.
import { expect, test, type Page } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const RAW = /\b(assistant|expiry|source):/;

/** Not sorted, sorted but not analysed, analysed. */
const ITEMS = ["it_saved", "it_triaged", "it_worth"];

async function expectNoTags(page: Page, heading: string) {
  const open = page.locator("[data-open-item]");
  await expect(open).toBeVisible();
  // Wait for the controls: the page has finished loading, so an absent block is not just "not yet".
  await expect(page.getByTestId("kept-for")).toBeVisible();
  await expect(page.getByTestId("analysed-by")).toBeVisible();
  await expect(open.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
  await expect(open).not.toContainText(RAW);
  expect(await page.evaluate(() => document.querySelectorAll(".tags, [aria-label='Tags'], [aria-label='标签']").length)).toBe(0);
}

test("QA #94: in Chinese, an item shows no tag heading and no tag strings, sorted or not, analysed or not", async ({ page }) => {
  await signIn(page);
  for (const id of ITEMS) {
    await page.goto(`/item/${id}`);
    await expectNoTags(page, "标签");
  }
});

test("QA #94: in English, an item shows no tag heading and no tag strings, sorted or not, analysed or not", async ({ page, request }) => {
  await signIn(page, "/assistants/account");
  await page.getByTestId("language").selectOption("en");
  await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
  expect((await state(request)).user.lang).toBe("en");
  for (const id of ITEMS) {
    await page.goto(`/item/${id}`);
    await expectNoTags(page, "Tags");
  }
});

// Cheney, 2026-11-26: not only is the tag string not shown, the user is not told that tags exist.
// Every page, in both languages: no 标签 / tag in what can be read (text, labels, titles, placeholders).
const PAGES = [
  "/", "/digest", "/notes", "/calendar", "/start", "/feedback", "/item/it_worth", "/item/it_triaged", "/item/it_saved",
  "/assistants", "/assistants/connect", "/assistants/rules", "/assistants/devices", "/assistants/calendar", "/assistants/notify", "/assistants/account",
];

async function mentionsTags(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const bad = /标签|\btags?\b/i;
    if (bad.test(document.body.innerText)) found.push(`text: ${document.body.innerText.split("\n").filter((l) => bad.test(l)).join(" | ")}`);
    for (const el of document.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
      for (const a of ["aria-label", "title", "placeholder", "alt"]) {
        const v = el.getAttribute(a);
        if (v && bad.test(v)) found.push(`${a}: ${v}`);
      }
    }
    return found;
  });
}

async function sweep(page: Page, paths: string[]) {
  for (const path of paths) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).not.toBeEmpty();
    expect(await mentionsTags(page), path).toEqual([]);
  }
}

test("QA #94 (A6): no page says anything about tags, in Chinese", async ({ page }) => {
  await signIn(page);
  await sweep(page, PAGES);
});

test("QA #94 (A6): no page says anything about tags, in English", async ({ page }) => {
  await signIn(page, "/assistants/account");
  await page.getByTestId("language").selectOption("en");
  await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
  await sweep(page, PAGES);
  // The sentence about the data download is the one that used to.
  await page.goto("/assistants/account");
  await expect(page.getByTestId("data-in")).toHaveText(/every item that still exists with its analysis\.$/);
});

test("QA #94 (A6): the Account page of a device without the manage tier says nothing about tags", async ({ page, request }) => {
  await signIn(page);
  expect((await request.post("/__test/set-tier", { data: { tier: "read" }, headers: { Authorization: `Bearer ${await credentialOf(page)}` } })).ok()).toBe(true);
  await sweep(page, ["/account", "/", "/item/it_worth"]);
});

test("QA #94: the assistant and the retention controls still work without the tags", async ({ page, request }) => {
  await signIn(page, "/item/it_worth");
  await expectNoTags(page, "标签");
  await page.getByTestId("analysed-by").selectOption({ label: "阿读" });
  await expect(page.locator(".said")).toContainText("交给 阿读。");
  await page.getByTestId("kept-for").selectOption("90");
  await expect(page.locator(".said")).toHaveText(/^保留 90 天，到 .+ 删除。$/);
  await expect(page.getByTestId("kept-for")).toHaveValue("90");
  await expect(page.getByTestId("analysed-by")).toHaveValue("as_adu");
  // The core did take both choices; they are only no longer shown as strings.
  const res = await request.get("/v1/items/it_worth", { headers: { Authorization: `Bearer ${await credentialOf(page)}` } });
  expect((await res.json()).tags).toEqual(expect.arrayContaining(["assistant:阿读", "expiry:90"]));
  await expectNoTags(page, "标签");
});
