// QA #28: Account has a way in for every tier, its addresses lead to it, and an unknown
// address says where it led.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { EMAIL, FAKE, credentialOf, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "needs the fake's seed and its set-tier hook");
test.beforeEach(async ({ request }) => reset(request));

const ENTRIES = ["今天", "每日摘要", "笔记", "助手设置"];
const UNKNOWN = "没有这个页面。这里是今天。";
const said = (page: Page) => page.locator(".said");

/** Signs in, then lowers this device to the read tier. Returns the device's name. */
async function asReadDevice(page: Page, request: APIRequestContext): Promise<string> {
  await signIn(page);
  const cred = await credentialOf(page);
  const res = await request.post("/__test/set-tier", { data: { tier: "read" }, headers: { Authorization: `Bearer ${cred}` } });
  expect(res.ok()).toBe(true);
  return (await res.json()).name;
}

test("QA #28: with the manage tier, /account, /settings, /devices and /rules lead to their section of Assistants", async ({ page }) => {
  await signIn(page);
  for (const [from, to, section] of [
    ["/account", "/assistants/account", "账户"],
    ["/settings", "/assistants/account", "账户"],
    ["/devices", "/assistants/devices", "设备"],
    ["/rules", "/assistants/rules", "规则"],
  ]) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to}$`));
    await expect(page.locator('.tabs a[aria-current="page"]')).toHaveText(section);
    await expect(page.locator('[data-entry="assistants"]')).toHaveAttribute("aria-current", "page");
    // These are real places: nothing says the page does not exist.
    await expect(said(page)).toHaveCount(0);
  }
  await page.goto("/account");
  await expect(page.getByTestId("account")).toBeVisible();
  await expect(page.getByTestId("delete-account")).toBeVisible();
  // The four entries are what they were.
  await expect(page.locator("nav.nav .nav-entry")).toHaveText(ENTRIES);
});

test("QA #28: with the read tier, /account is a small account page in the shell; /settings leads to it", async ({ page, request }) => {
  const name = await asReadDevice(page, request);
  for (const from of ["/account", "/settings", "/assistants/account"]) {
    await page.goto(from);
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId("device-account")).toBeVisible();
    await expect(said(page)).toHaveCount(0);
  }
  const account = page.getByTestId("device-account");
  await expect(account.locator("h1")).toHaveText("账户");
  await expect(account.getByTestId("device-name")).toHaveText(name);
  await expect(account.getByTestId("device-tier")).toContainText("读");
  // The language is shown, not changeable: changing settings needs the manage tier.
  await expect(account.getByTestId("language")).toHaveText("中文");
  await expect(account.locator("select")).toHaveCount(0);
  // No export and no deletion, and one sentence saying where they are.
  await expect(page.getByTestId("delete-account")).toHaveCount(0);
  await expect(page.locator('[data-part="data"]')).toHaveCount(0);
  await expect(account).not.toContainText("下载我的");
  await expect(account.getByTestId("needs-manage")).toHaveText("下载数据和删除账户，要用管理档的设备。");
  // Inside the normal shell, with three entries and none of them marked as this page.
  await expect(page.locator("nav.nav .nav-entry")).toHaveText(ENTRIES.slice(0, 3));
  await expect(page.locator('nav.nav .nav-entry[aria-current="page"]')).toHaveCount(0);
  // The sections of Assistants stay closed to this tier.
  for (const from of ["/devices", "/rules", "/assistants"]) {
    await page.goto(from);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".tabs")).toHaveCount(0);
  }
});

test("QA #28: an unknown address leads to Today and says so, once", async ({ page }) => {
  await signIn(page);
  await page.goto("/no-such-page");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-entry="today"]')).toHaveAttribute("aria-current", "page");
  await expect(said(page)).toHaveText(UNKNOWN);
  await expect(said(page)).toHaveCount(1);
  // Once: Today itself does not repeat it.
  await page.reload();
  await expect(page.locator(".page.today")).toBeVisible();
  await expect(said(page)).toHaveCount(0);
  // A known address says nothing.
  await page.goto("/notes");
  await expect(page.locator('[data-entry="notes"]')).toHaveAttribute("aria-current", "page");
  await expect(said(page)).toHaveCount(0);
});

test("QA #28: an unknown address says its sentence in English on an English account", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ locale: "en-US", baseURL });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/$/);
  await expect(said(page)).toHaveText("That page does not exist. This is Today.");
  await ctx.close();
});

test.describe("wide screen", () => {
  test.skip(({ isMobile }) => isMobile, "the rail is for wide screens");

  test("QA #28: the foot of the rail has a quiet line with the account's email that opens Account", async ({ page }) => {
    await signIn(page);
    const link = page.getByTestId("rail-account");
    await expect(link).toBeVisible();
    await expect(link).toHaveText(EMAIL);
    // Not a fifth entry: the entries are the same four, and the line sits below them at the foot.
    await expect(page.locator("nav.nav .nav-entry")).toHaveText(ENTRIES);
    await expect(link).not.toHaveClass(/nav-entry/);
    const nav = (await page.locator("nav.nav").boundingBox())!;
    const box = (await link.boundingBox())!;
    const last = (await page.locator("nav.nav .nav-entry").last().boundingBox())!;
    expect(box.y).toBeGreaterThan(last.y + last.height);
    expect(box.y + box.height).toBeGreaterThan(nav.y + nav.height - 60);
    expect(box.x + box.width).toBeLessThanOrEqual(nav.x + nav.width);
    // Quieter than an entry.
    const colour = (l: typeof link) => l.evaluate((el) => getComputedStyle(el).color);
    expect(await colour(link)).not.toBe(await colour(page.locator('[data-entry="digest"]')));
    // The link on Today is for phones only.
    await expect(page.getByTestId("today-account")).toBeHidden();

    await link.click();
    await expect(page).toHaveURL(/\/assistants\/account$/);
    await expect(page.getByTestId("account")).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");
    // It is there on every page of the shell.
    await page.goto("/notes");
    await expect(link).toHaveText(EMAIL);
    await expect(link).not.toHaveAttribute("aria-current", "page");
  });

  test("QA #28: with the read tier the rail's line shows the device's name and opens its account page", async ({ page, request }) => {
    const name = await asReadDevice(page, request);
    await page.goto("/");
    const link = page.getByTestId("rail-account");
    await expect(link).toHaveText(name);
    await expect(page.locator("nav.nav")).not.toContainText(EMAIL);
    await link.click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId("device-account")).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");
  });
});

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "the phone project");

  test("QA #28: on a phone the same quiet link is at the end of Today, below the lists", async ({ page }) => {
    await signIn(page);
    // The bottom bar keeps its four entries and gets nothing else.
    await expect(page.locator("nav.nav .nav-entry")).toHaveText(ENTRIES);
    await expect(page.getByTestId("rail-account")).toBeHidden();
    const link = page.getByTestId("today-account");
    await expect(page.locator(".today .cards")).toBeVisible();
    await expect(link).toHaveText(EMAIL);
    // Below everything else on the page, and clear of the bottom bar once scrolled to.
    const lowest = await page.locator(".page.today > *").last().evaluate((el) => el.contains(document.querySelector('[data-testid="today-account"]')));
    expect(lowest).toBe(true);
    await link.scrollIntoViewIfNeeded();
    const box = (await link.boundingBox())!;
    const bar = (await page.locator("nav.nav").boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
    await link.click();
    await expect(page).toHaveURL(/\/assistants\/account$/);
    await expect(page.getByTestId("account")).toBeVisible();
    // Account is still a section of Assistants.
    await expect(page.locator('.tabs a[aria-current="page"]')).toHaveText("账户");
  });

  test("QA #28: on a phone with the read tier, Today's link shows the device's name and opens its account page", async ({ page, request }) => {
    const name = await asReadDevice(page, request);
    await page.goto("/");
    const link = page.getByTestId("today-account");
    await expect(link).toHaveText(name);
    await link.click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId("device-account")).toBeVisible();
  });
});

test("QA #28: a device with the read tier can sign out", async ({ page, request }) => {
  await asReadDevice(page, request);
  const before: number = (await state(request)).counts.devices;
  await page.goto("/account");
  await page.getByTestId("sign-out").click();
  // Signed out: the sign-in page, no credential in the browser, and the core has revoked the device.
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator("nav.nav")).toHaveCount(0);
  expect(await credentialOf(page)).toBe("");
  expect((await state(request)).counts.devices).toBe(before - 1);
  await page.reload();
  await expect(page.locator('input[type="email"]')).toBeVisible();
});
