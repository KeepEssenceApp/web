// QA #54: with no notes at all, quick find never explains its empty list with "no notes yet".
import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.skip(!FAKE, "relies on the fake's seed");
test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("QA #54: the empty sentence belongs to the words being looked for", async ({ page }) => {
  // An account without notes, and a core that takes its time.
  await page.route("**/v1/notes*", async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    await route.fulfill({ json: { notes: [], next_cursor: null } });
  });
  await signIn(page, "/notes");
  const empty = page.getByTestId("notes-empty");
  await expect(empty).toHaveText("还没有笔记。");

  // Every sentence the list shows from the first keystroke until the answer is in.
  await page.evaluate(() => {
    const seen: string[] = ((window as any).__seen = []);
    const look = () => {
      const text = document.querySelector('[data-testid="notes-empty"]')?.textContent;
      if (text && seen[seen.length - 1] !== text) seen.push(text);
    };
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.locator(".find").fill("probe");
  await expect(empty).toHaveText("没有找到笔记。", { timeout: 200 });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__seen)).toEqual(["没有找到笔记。"]);

  // Cleared: nothing claims "no note found" or "no notes yet" until the full list has answered.
  await page.locator(".find").fill("");
  await expect(empty).toHaveCount(0, { timeout: 200 });
  await expect(empty).toHaveText("还没有笔记。");
});

test("QA #55: a box emptied without typing is still read, and the list goes back", async ({ page }) => {
  await page.route("**/v1/notes*", (route) => route.fulfill({ json: { notes: [], next_cursor: null } }));
  await signIn(page, "/notes");
  const empty = page.getByTestId("notes-empty");
  await page.locator(".find").fill("digest");
  await expect(empty).toHaveText("没有找到笔记。");
  // The value is set from outside, with no input event, and the box is left.
  await page.locator(".find").evaluate((el: HTMLInputElement) => (el.value = ""));
  await page.locator(".find").blur();
  await expect(empty).toHaveText("还没有笔记。");
});
