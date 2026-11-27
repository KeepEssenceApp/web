// Internal QA #18, Cheney's option 2 (2026-11-26): an analysis and a daily digest follow the language of the
// item itself; the account's switch "Always use my language" makes new ones use the account's. The page says
// which it is, and it is a setting like the others: written through PATCH /v1/settings, kept across a reload,
// and not pretended when the core refuses. (Which language an analysis is actually written in is the core's;
// its tests cover that. Nothing here is a real model.)
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const mine = (page: Page, name = "总用我的语言") => page.getByRole("switch", { name });
const hint = (page: Page) => page.getByTestId("always-mine-hint");
const settingsOf = async (request: APIRequestContext) => (await state(request)).settings;

/** The next PATCH /v1/settings the page sends, so a test can say exactly what was sent. */
const patched = (page: Page) => page.waitForRequest((r) => r.method() === "PATCH" && new URL(r.url()).pathname === "/v1/settings");

test("QA #18: in Chinese the switch is off by default and says what each position means", async ({ page, request }) => {
  await signIn(page, "/assistants/account");
  await expect(mine(page)).toBeVisible();
  await expect(mine(page)).toHaveAttribute("aria-checked", "false");
  await expect(hint(page)).toHaveText("关：每条新解读用条目自己的语言写，每日摘要用当天多数解读的语言。");
  expect((await settingsOf(request)).always_my_language).toBe(false);

  // Turning it on sends exactly that, says one sentence, and the explanation follows.
  const [on] = await Promise.all([patched(page), mine(page).click()]);
  expect(on.postDataJSON()).toEqual({ always_my_language: true });
  await expect(mine(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".said")).toHaveText("新写的解读和每日摘要会用你的语言。");
  await expect(hint(page)).toHaveText("开：新写的解读和每日摘要都用上面选的语言，不管条目是什么语言。");
  expect((await settingsOf(request)).always_my_language).toBe(true);

  // It is the account's: it holds after a reload.
  await page.reload();
  await expect(mine(page)).toHaveAttribute("aria-checked", "true");
  await expect(hint(page)).toContainText("开：");

  const [off] = await Promise.all([patched(page), mine(page).click()]);
  expect(off.postDataJSON()).toEqual({ always_my_language: false });
  await expect(mine(page)).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".said")).toHaveText("新写的解读会再跟着条目的语言。");
  expect((await settingsOf(request)).always_my_language).toBe(false);
});

test("QA #18: in English the switch, its two explanations and its two sentences are in English", async ({ page, request }) => {
  await signIn(page, "/assistants/account");
  await page.getByTestId("language").selectOption("en");
  await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
  expect((await state(request)).user.lang).toBe("en");

  await expect(mine(page, "Always use my language")).toHaveAttribute("aria-checked", "false");
  await expect(hint(page)).toHaveText("Off: each new analysis is written in the language of the item itself, and a daily digest in the language most of the day's analyses are in.");
  await mine(page, "Always use my language").click();
  await expect(page.locator(".said")).toHaveText("New analyses and daily digests will be written in your language.");
  await expect(hint(page)).toHaveText("On: new analyses and daily digests are written in the language above, whatever language the item is in.");
  await mine(page, "Always use my language").click();
  await expect(page.locator(".said")).toHaveText("New analyses will follow the language of the item again.");
  // The two settings are separate: the language did not move, and the switch did not move the language.
  expect((await state(request)).user.lang).toBe("en");
});

test("QA #18: changing the language does not touch the switch, and the switch does not touch the language", async ({ page, request }) => {
  await signIn(page, "/assistants/account");
  await mine(page).click();
  await expect(mine(page)).toHaveAttribute("aria-checked", "true");
  expect((await state(request)).user.lang).toBe("zh");
  await page.getByTestId("language").selectOption("en");
  await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
  await expect(mine(page, "Always use my language")).toHaveAttribute("aria-checked", "true");
  expect((await settingsOf(request)).always_my_language).toBe(true);
});

test("QA #18: when the core refuses, the switch goes back and says so; nothing is pretended", async ({ page, request }) => {
  await signIn(page, "/assistants/account");
  await request.post("/__test/fail-next", { data: { method: "PATCH", path: "^/v1/settings$" } });
  await mine(page).click();
  await expect(page.locator(".said.bad")).toBeVisible();
  await expect(mine(page)).toHaveAttribute("aria-checked", "false");
  await expect(hint(page)).toContainText("关：");
  expect((await settingsOf(request)).always_my_language).toBe(false);
  // Pressing again works.
  await mine(page).click();
  await expect(mine(page)).toHaveAttribute("aria-checked", "true");
  expect((await settingsOf(request)).always_my_language).toBe(true);
});

test("QA #18: a device without the manage tier has no switch: settings are changed on a manage device", async ({ page, request }) => {
  await signIn(page);
  const cred = await credentialOf(page);
  expect((await request.post("/__test/set-tier", { data: { tier: "read" }, headers: { Authorization: `Bearer ${cred}` } })).ok()).toBe(true);
  await page.goto("/account");
  await expect(page.getByTestId("device-account")).toBeVisible();
  await expect(mine(page)).toHaveCount(0);
  await expect(page.getByTestId("needs-manage")).toBeVisible();
});

test("QA #18: the switch is in the account's download", async ({ page, request }) => {
  await signIn(page, "/assistants/account");
  await mine(page).click();
  await expect(mine(page)).toHaveAttribute("aria-checked", "true");
  const res = await request.get("/v1/export", { headers: { Authorization: `Bearer ${await credentialOf(page)}` } });
  expect(res.ok()).toBe(true);
  expect((await res.json()).settings).toMatchObject({ lang: "zh", always_my_language: true });
});
