// QA #51: one choice of language applies the first time, in both directions.
import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("QA #51: the language follows one choice, both ways, every time", async ({ page }) => {
  await signIn(page, "/assistants/account");
  const pick = page.getByTestId("language");
  const hint = page.getByTestId("language-hint");
  const EN = "New analyses and digests are written in this language.";
  for (const [value, en] of [["en", true], ["zh", false], ["en", true], ["zh", false], ["en", true]] as const) {
    await pick.selectOption(value);
    await expect(pick).toHaveAttribute("aria-busy", "false");
    await expect(pick).toHaveValue(value);
    if (en) await expect(hint).toHaveText(EN, { timeout: 1500 });
    else await expect(hint).not.toHaveText(EN, { timeout: 1500 });
    // It stays: nothing that arrives later puts the old language back.
    await page.waitForTimeout(2500);
    if (en) await expect(hint).toHaveText(EN);
    else await expect(hint).not.toHaveText(EN);
  }
});

test("QA #51: while the core is asked, the control keeps the choice and says it is changing", async ({ page, request }) => {
  test.skip(!FAKE, "needs the fake's delay hook");
  await signIn(page, "/assistants/account");
  const pick = page.getByTestId("language");
  const hint = page.getByTestId("language-hint");
  await request.post("/__test/delay", { data: { ms: 1500 } });
  await pick.selectOption("en");
  await expect(pick).toHaveValue("en");
  await expect(hint).toHaveText("正在换语言…", { timeout: 700 });
  await expect(hint).toHaveText("New analyses and digests are written in this language.");
  await request.post("/__test/delay", { data: { ms: 1500 } });
  await pick.selectOption("zh");
  await expect(pick).toHaveValue("zh");
  await expect(hint).toHaveText("Changing the language…", { timeout: 700 });
  await expect(pick).toHaveAttribute("aria-busy", "false");
  await expect(hint).not.toHaveText("Changing the language…");
});
