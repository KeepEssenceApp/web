// Internal QA #103: an item with a video. While what is said in it is read the item says so and is not
// analysed; what was recognized is shown apart from the author's words, with its note; a video that was not
// read is said once; none of it reaches the lists. The sentences are the core's (shared_rules.video).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE, reset, signIn, state, openOriginal } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const READING = "正在读视频里的话，读好了会接着解读。";
const NOTE = "从视频的声音识别出来的，可能有错字。";
const SAID = "周末我把阳台收拾了一遍，种了薄荷和罗勒，晚上泡了一杯薄荷茶，味道很清爽。这是视频里说的话。";
const AUTHOR = "阳台上的薄荷 #阳台 #薄荷";

type Body = { item_id?: string; title?: string; state?: string | null; recognized_text?: string | null; body?: string | null; stage?: "analysed" };
async function video(request: APIRequestContext, body: Body): Promise<string> {
  const res = await request.post("/__test/video", { data: body });
  expect(res.ok()).toBe(true);
  return (await res.json()).id;
}
const open = async (page: Page, id: string) => {
  await page.goto(`/item/${id}`);
  await expect(page.locator(`[data-open-item="${id}"]`)).toBeVisible();
};

test("QA #103: while the video is read the row and the item page say so, the author's words are there, and nothing is analysed", async ({ page, request }) => {
  await signIn(page);
  const id = await video(request, { title: "阳台上的薄荷", state: "reading", body: AUTHOR });
  await page.goto("/");
  const row = page.locator(`[data-item="${id}"]`);
  await expect(row).toContainText(READING);
  await open(page, id);
  const analysis = page.locator("section", { hasText: "解读" }).last();
  await expect(page.getByTestId("video-reading")).toHaveText(READING);
  await expect(analysis).not.toContainText("还没解读");
  await expect(page.locator(".original-body")).toHaveText(AUTHOR);
  await expect(page.getByTestId("recognized-text")).toHaveCount(0);
  await expect(page.getByTestId("video-state")).toHaveCount(0);
});

test("QA #103: what was recognized is a block of its own under the author's words, with its note under it", async ({ page, request }) => {
  await signIn(page);
  const id = await video(request, { title: "阳台上的薄荷", state: "recognized", recognized_text: SAID, body: AUTHOR, stage: "analysed" });
  await open(page, id);
  await openOriginal(page);
  const block = page.getByTestId("recognized-text");
  await expect(block.getByRole("heading", { name: "识别出来的文字" })).toBeVisible();
  await expect(block.locator(".original-body")).toHaveText(SAID);
  // The note is the line under the block's text.
  await expect(page.getByTestId("recognized-note")).toHaveText(NOTE);
  const order = await page.locator("[data-open-item] .original-body, [data-testid=recognized-note]").evaluateAll((els) => els.map((e) => e.textContent));
  expect(order).toEqual([AUTHOR, SAID, NOTE]);
  // The author's words are still the author's: the recognized text is not mixed into them.
  await expect(page.locator(".original-body").first()).not.toContainText("这是视频里说的话");
  // Nothing is "reading" any more.
  await expect(page.getByTestId("video-reading")).toHaveCount(0);
});

test("QA #103: a video that was not read is said once beside the author's words; the analysis stays", async ({ page, request }) => {
  await signIn(page);
  for (const [stateName, sentence] of [
    ["no_speech", "视频里没有识别出话语。"],
    ["too_long", "视频太长（超过 15 分钟），没读。"],
    ["unavailable", "视频里的话没取到。"],
  ] as const) {
    const id = await video(request, { title: `视频 ${stateName}`, state: stateName, body: AUTHOR, stage: "analysed" });
    await open(page, id);
    await expect(page.getByTestId("video-state")).toHaveText(sentence);
    await expect(page.getByTestId("recognized-text")).toHaveCount(0);
    await expect(page.getByTestId("video-reading")).toHaveCount(0);
    await expect(page.locator("section", { hasText: "解读" }).last()).not.toContainText("还没解读");
  }
});

test("QA #103: the recognized text is nowhere in the lists: not Today, not the cards", async ({ page, request }) => {
  await signIn(page);
  const id = await video(request, { title: "阳台上的薄荷", state: "recognized", recognized_text: SAID, body: AUTHOR, stage: "analysed" });
  await page.goto("/");
  await expect(page.locator(`[data-item="${id}"]`).first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText("这是视频里说的话");
  await expect(page.locator("main")).not.toContainText("识别出来的文字");
  await expect(page.locator("main")).not.toContainText(NOTE);
});

test("QA #103: the page that is open when the words are ready follows: the text and then the analysis appear in place", async ({ page, request }) => {
  await page.clock.install();
  await signIn(page);
  const id = await video(request, { title: "阳台上的薄荷", state: "reading", body: AUTHOR });
  await open(page, id);
  await expect(page.getByTestId("video-reading")).toHaveText(READING);
  await video(request, { item_id: id, state: "recognized", recognized_text: SAID });
  await page.clock.fastForward(15500);
  await expect(page.getByTestId("recognized-text").locator(".original-body")).toHaveText(SAID);
  await video(request, { item_id: id, stage: "analysed" });
  await page.clock.fastForward(15500);
  await expect(page.getByTestId("video-reading")).toHaveCount(0);
  await expect(page.locator("section", { hasText: "解读" }).last()).not.toContainText("还没解读");
});

test("QA #103: in English the same sentences, the limit from the core, and no Chinese on the page", async ({ page, request }) => {
  await signIn(page, "/assistants/account");
  await page.getByTestId("language").selectOption("en");
  await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
  expect((await state(request)).user.lang).toBe("en");
  const reading = await video(request, { title: "Mint on the balcony", state: "reading", body: "Mint on the balcony #mint" });
  const long = await video(request, { title: "A long video", state: "too_long", body: "A long one", stage: "analysed" });
  const done = await video(request, { title: "A short video", state: "recognized", recognized_text: "I spent the weekend on the balcony.", body: "A short one", stage: "analysed" });
  await open(page, reading);
  await expect(page.getByTestId("video-reading")).toHaveText("Reading what is said in the video. The analysis follows when it is done.");
  await open(page, long);
  await expect(page.getByTestId("video-state")).toHaveText("The video is too long (over 15 minutes) and was not read.");
  await open(page, done);
  await openOriginal(page);
  await expect(page.getByTestId("recognized-text").getByRole("heading", { name: "Recognized text" })).toBeVisible();
  await expect(page.getByTestId("recognized-note")).toHaveText("Recognized from the video's sound. It may contain mistakes.");
});
