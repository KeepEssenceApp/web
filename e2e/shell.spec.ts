import { expect, test } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn } from "./helpers";

test.beforeEach(async ({ request }) => reset(request));

test("W1: four entries in a fixed order, rail on wide screens, bottom bar on phones", async ({ page, isMobile }) => {
  await signIn(page);
  const entries = page.locator("nav.nav .nav-entry");
  await expect(entries).toHaveText(["今天", "每日摘要", "笔记", "助手设置"]);
  const nav = (await page.locator("nav.nav").boundingBox())!;
  const view = page.viewportSize()!;
  if (isMobile) {
    expect(nav.y + nav.height).toBeGreaterThan(view.height - 2);
    expect(nav.width).toBeGreaterThan(view.width - 2);
    expect(nav.height).toBeLessThan(100);
  } else {
    expect(nav.x).toBe(0);
    expect(nav.width).toBeLessThan(260);
    expect(nav.height).toBeGreaterThan(view.height - 2);
  }
  const text = await page.locator("nav.nav").innerText();
  for (const word of ["首页", "搜索", "Home", "Search", "Settings"]) expect(text).not.toContain(word);
  expect(text.replace("助手设置", "")).not.toContain("设置");

  // Each entry opens its page and is marked as the current one.
  for (const [i, path] of [[1, "/digest"], [2, "/notes"], [3, "/assistants"], [0, "/"]] as const) {
    await entries.nth(i).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(entries.nth(i)).toHaveAttribute("aria-current", "page");
  }
});

test("W1/W5: a device with the read tier has no Assistants entry at all", async ({ page, request }) => {
  test.skip(!FAKE, "needs the fake's set-tier hook");
  await signIn(page);
  const cred = await credentialOf(page);
  await request.post("/__test/set-tier", { data: { tier: "read" }, headers: { Authorization: `Bearer ${cred}` } });
  await page.goto("/");
  await expect(page.locator("nav.nav .nav-entry")).toHaveText(["今天", "每日摘要", "笔记"]);
  await expect(page.locator('[data-entry="assistants"]')).toHaveCount(0);
  // The status bar is read-only for this tier.
  await expect(page.locator(".status").first()).toBeVisible();
  await expect(page.locator("a.status-press")).toHaveCount(0);
  // Typing the address does not get there either.
  await page.goto("/assistants/devices");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".tabs")).toHaveCount(0);
});

test("a save-only device has no reading interface, only the inbox", async ({ page, request }) => {
  test.skip(!FAKE, "needs the fake's set-tier hook");
  await signIn(page);
  const cred = await credentialOf(page);
  await request.post("/__test/set-tier", { data: { tier: "save" }, headers: { Authorization: `Bearer ${cred}` } });
  await page.goto("/notes");
  await expect(page.locator("nav.nav")).toHaveCount(0);
  await expect(page.locator(".inbox-box")).toBeVisible();
  await page.locator(".inbox-box").fill("https://example.com/from-a-save-only-device");
  await page.locator(".inbox .btn").click();
  await expect(page.locator(".inbox-result")).toHaveText("已存入。");
});

test("two languages: follows the browser, changeable in Account", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ locale: "en-US", baseURL });
  const page = await ctx.newPage();
  await signIn(page);
  await expect(page.locator("nav.nav .nav-entry")).toHaveText(["Today", "Daily digest", "Notes", "Assistants"]);
  await page.goto("/assistants/account");
  await page.getByTestId("language").selectOption("zh");
  await expect(page.locator("nav.nav .nav-entry")).toHaveText(["今天", "每日摘要", "笔记", "助手设置"]);
  await page.reload();
  await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("今天");
  await ctx.close();
});

test("light and dark follow the system", async ({ browser, baseURL }) => {
  const bg = async (scheme: "light" | "dark") => {
    const ctx = await browser.newContext({ colorScheme: scheme, baseURL, locale: "zh-CN" });
    const page = await ctx.newPage();
    await signIn(page);
    const colour = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await ctx.close();
    return colour;
  };
  expect(await bg("light")).toBe("rgb(245, 245, 243)");
  expect(await bg("dark")).toBe("rgb(11, 11, 11)");
});

test("sign-in: after 'use another email' the email field holds the address and takes typing", async ({ page }) => {
  await page.goto("/");
  const email = page.locator('input[type="email"]');
  await email.fill("first@example.com");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[name="code"]')).toBeVisible();
  await page.locator("button.link").click();
  await expect(email).toHaveValue("first@example.com");
  await expect(email).not.toHaveAttribute("pattern", /.+/);
  await expect(email).not.toHaveAttribute("maxlength", /.+/);
  await email.fill("");
  await email.pressSequentially("someone.else@example.com");
  await expect(email).toHaveValue("someone.else@example.com");
  expect(await email.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(true);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[name="code"]')).toBeVisible();
});
