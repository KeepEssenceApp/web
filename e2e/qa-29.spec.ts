// QA #29: with no daily digest, no sentence says or implies that no assistant has come.
// Each of the core's four reasons has its own sentence, on the digest page and in the status bar.
import { expect, test, type Page } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn } from "./helpers";

test.skip(!FAKE, "needs the fake's seed and its no_digest_reason hook");

const why = (page: Page) => page.getByTestId("digest-why");
/** The status bar's line about the digest: on Today's wide layout. */
const inStatus = (page: Page) => page.locator(".page-head .status").getByTestId("status-no-digest");
/** What the old sentences said or implied: that no assistant has come, or that one is awaited. */
const CONTRADICTION = /没有助手来|助手还没来|等助手|no assistant (has )?c[ao]me|waiting for an assistant/i;

async function clean(page: Page) {
  await expect(page.locator(".digest [data-reason]")).not.toContainText(CONTRADICTION);
}

test("QA #29: not_yet_time — before 21:00 the sentences speak of the time, not of an assistant", async ({ page, request, isMobile }) => {
  await reset(request, { empty: true, no_digest_reason: "not_yet_time" });
  await signIn(page, "/digest");
  await expect(why(page)).toHaveText("今天的还没到时间。今天到现在有 0 条解读。");
  await expect(page.getByTestId("digest-when")).toContainText("21:00（Asia/Shanghai）之后出");
  await expect(page.getByTestId("digest-writer")).toHaveCount(0);
  await clean(page);
  if (!isMobile) {
    await page.goto("/");
    await expect(inStatus(page)).toHaveText("今天的每日摘要还没到时间");
    await expect(page.locator(".page-head .status")).not.toContainText(CONTRADICTION);
  }
});

test("QA #29: nothing_analysed — after 21:00 with no analysis, the sentences say there is nothing to write from", async ({ page, request, isMobile }) => {
  await reset(request, { empty: true, no_digest_reason: "nothing_analysed" });
  await signIn(page, "/digest");
  await expect(why(page)).toHaveText("已经过了 21:00，但今天还没有解读，所以今天没有每日摘要。");
  await expect(page.getByTestId("digest-writer")).toHaveCount(0);
  await clean(page);
  if (!isMobile) {
    await page.goto("/");
    await expect(inStatus(page)).toHaveText("今天还没有解读，所以没有每日摘要");
    await expect(page.locator(".page-head .status")).not.toContainText(CONTRADICTION);
  }
});

test("QA #29: no_assistant — nobody is set to write the digest; the sentences do not say that no assistant came", async ({ page, request, isMobile }) => {
  await reset(request, { no_digest_reason: "no_assistant" });
  await signIn(page, "/digest/2020-01-01");
  await expect(why(page)).toContainText("没有指定出每日摘要的助手，所以不会出。");
  await expect(page.locator(".digest [data-reason]").getByRole("link", { name: "去助手设置" })).toHaveAttribute("href", "/assistants");
  await expect(page.getByTestId("digest-writer")).toHaveCount(0);
  await clean(page);
  if (!isMobile) {
    await page.goto("/");
    // The built-in assistant came minutes ago, and the bar says so right beside the reason.
    await expect(page.locator(".page-head .status .status-cell", { hasText: "内置助手" })).toContainText("来过");
    await expect(inStatus(page)).toHaveText("没有指定出每日摘要的助手，所以今天不会出");
    await expect(page.locator(".page-head .status")).not.toContainText(CONTRADICTION);
  }
});

test("QA #29: waiting_for_assistant — the digest is due, and the assistant that writes it is named with its next visit", async ({ page, request, isMobile }) => {
  await reset(request, { no_digest_reason: "waiting_for_assistant" });
  await signIn(page, "/digest/2020-01-01");
  await expect(why(page)).toHaveText(/^已经过了 21:00，今天有 \d+ 条解读，今天的每日摘要该出了：内置助手下次来时出。$/);
  // When it last came is said in a way that agrees with the sentence above it.
  await expect(page.getByTestId("digest-writer")).toHaveText(/^内置助手上次是.+来的。$/);
  await clean(page);
  if (!isMobile) {
    await page.goto("/");
    await expect(inStatus(page)).toHaveText("今天的每日摘要该出了：内置助手下次来时出");
    await expect(page.locator(".page-head .status .status-cell", { hasText: "内置助手" })).toContainText("来过");
    await expect(page.locator(".page-head .status")).not.toContainText(CONTRADICTION);
  }

  // The name is the one of whoever holds the daily digest role.
  const headers = { Authorization: `Bearer ${await credentialOf(page)}` };
  expect((await page.request.patch("/v1/settings", { headers, data: { roles: { digest: "as_adu" } } })).ok()).toBe(true);
  await page.goto("/digest/2020-01-01");
  await expect(why(page)).toContainText("今天的每日摘要该出了：阿读下次来时出。");
  await expect(page.getByTestId("digest-writer")).toHaveText(/^阿读上次是.+来的。$/);

  // A device with the read tier is told the same.
  expect((await page.request.post("/__test/set-tier", { headers, data: { tier: "read" } })).ok()).toBe(true);
  await page.goto("/digest/2020-01-01");
  await expect(why(page)).toContainText("阿读下次来时出。");
});

test("QA #29: in English the four reasons read the same way", async ({ browser, baseURL, request }) => {
  const ctx = await browser.newContext({ locale: "en-US", baseURL });
  const page = await ctx.newPage();
  const texts: Record<string, RegExp> = {
    not_yet_time: /^It is not time for today's yet\. Analyses so far today: \d+\.$/,
    nothing_analysed: /^It is past 21:00, but today has no analysis, so there is no daily digest today\.$/,
    no_assistant: /^No assistant is set to write the daily digest, so none will be written\. Analyses so far today: \d+\.$/,
    waiting_for_assistant: /^It is past 21:00 and today has analyses \(\d+\), so today's daily digest is due\. 内置助手 writes it on its next visit\.$/,
  };
  for (const [reason, text] of Object.entries(texts)) {
    await reset(request, { no_digest_reason: reason });
    await signIn(page, "/digest/2020-01-01");
    await expect(why(page)).toHaveText(text);
    await expect(page.locator(".digest [data-reason]")).not.toContainText(CONTRADICTION);
    await page.evaluate(() => localStorage.clear());
  }
  await ctx.close();
});
