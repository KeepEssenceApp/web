// QA #49: the header's "saved today" count moves with the save, not later.
import { expect, test } from "@playwright/test";
import { reset, signIn } from "./helpers";

test.beforeEach(async ({ request }) => {
  await reset(request);
});

const count = async (text: string) => Number(/今天存入了 (\d+) 条/.exec(text)?.[1] ?? NaN);

test("QA #49: the header count follows a save at once", async ({ page }) => {
  await signIn(page, "/");
  const head = page.locator('[role="status"]').first();
  await expect(head).toContainText("今天存入了");
  const before = await count((await head.textContent()) ?? "");
  for (let i = 1; i <= 3; i++) {
    await page.locator(".inbox-box").fill(`第 ${i} 条，用来数数 ${Date.now()}`);
    await page.locator(".inbox-box").press("Meta+Enter");
    await expect(head).toContainText(`今天存入了 ${before + i} 条`, { timeout: 3000 });
  }
});
