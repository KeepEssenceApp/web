import { expect, test } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn } from "./helpers";

test.beforeEach(async ({ request }) => reset(request));

const PAGES = ["/", "/digest", "/notes", "/calendar", "/assistants", "/assistants/connect", "/assistants/rules", "/assistants/devices", "/assistants/calendar", "/assistants/notify", "/assistants/account", "/approve", "/share"];

test("W11: the credential never reaches the page: nothing to see, copy or type", async ({ page }) => {
  const seen: string[] = [];
  page.on("console", (m) => seen.push(m.text()));
  await signIn(page);
  const cred = await credentialOf(page);
  expect(cred.length).toBeGreaterThan(10);
  // It is kept in browser storage only: not in a cookie, not in the address.
  expect((await page.context().cookies()).map((c) => c.value).join(" ")).not.toContain(cred);

  for (const path of FAKE ? [...PAGES, "/item/it_worth", "/notes/n1", "/authorize?request=req_demo"] : PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const leaks = await page.evaluate((secret) => {
      const out: string[] = [];
      if (document.documentElement.outerHTML.includes(secret)) out.push("html");
      if (document.title.includes(secret) || location.href.includes(secret)) out.push("address");
      for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) if (el.value.includes(secret)) out.push("field");
      return out;
    }, cred);
    expect(leaks, path).toEqual([]);
    // No field asks for one, and the word is not used.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const word of ["token", "api key", "令牌", "密钥"]) expect(text, `${path}: ${word}`).not.toContain(word);
  }
  expect(seen.join("\n")).not.toContain(cred);

  // Everything the page offers to copy is one of the three things that are not credentials.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/assistants/connect");
  await page.getByRole("button", { name: "复制" }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain(cred);
});

test("W11: sign-in takes an email and a code, nothing else", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("input")).toHaveCount(1);
  await expect(page.locator("input")).toHaveAttribute("type", "email");
  await page.locator("input").fill("reader@example.com");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("input")).toHaveCount(1);
  await expect(page.locator("input")).toHaveAttribute("autocomplete", "one-time-code");
  if (FAKE) {
    await page.locator("input").fill("000000");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('[role="alert"]')).not.toBeEmpty();
    expect(await credentialOf(page)).toBe("");
  }
});
