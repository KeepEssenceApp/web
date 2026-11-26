// The internal QA issues #31 and #32 as the web app sees them, named after the issue.
// #31: the control of a saved file does something visible at once — a text file is downloaded
// (its text is on the page already), an image and a PDF open in a new tab.
// #32: how long an item is kept is decided when it is sorted. Until then no number of days is
// shown as if it were decided; afterwards the page says who set it, and says so when it happens
// while the page is open.
import crypto from "node:crypto";
import fs from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const item = (page: Page, id: string) => page.locator(`[data-open-item="${id}"]`);
const keptFor = (page: Page) => page.getByTestId("kept-for");
const analysedBy = (page: Page) => page.getByTestId("analysed-by");
const header = (page: Page) => page.locator("article header .quiet");
// Rule A6 (QA #94): the internal tag strings are never shown to the user.
const noRawTags = (page: Page) => expect(page.locator("article")).not.toContainText(/\b(assistant|expiry|source):/);
const chosen = (select: ReturnType<typeof keptFor>) => select.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent?.trim());
const auth = async (page: Page) => ({ Authorization: `Bearer ${await credentialOf(page)}` });
const triage = (request: APIRequestContext, item_id: string, expiry_days: number, assistant_id = "as_builtin") =>
  request.post("/__test/triage", { data: { item_id, assistant_id, expiry_days } });

/** Saves a short text the way the Today box does, and returns the new item's id. */
async function saveText(page: Page, request: APIRequestContext, text: string): Promise<string> {
  const res = await request.post("/v1/items", { headers: { ...(await auth(page)), "Idempotency-Key": crypto.randomUUID() }, data: { kind: "text", text, entry: "box" } });
  return (await res.json()).item_id;
}

/** Uploads a file the way the app does (ask, upload, complete) and saves it as an item. */
async function saveFile(page: Page, request: APIRequestContext, name: string, type: string, bytes: Buffer): Promise<string> {
  const headers = await auth(page);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const asset = await (await request.post("/v1/assets", { headers, data: { sha256, bytes: bytes.length, content_type: type } })).json();
  expect((await request.put(asset.upload_url, { headers: { "Content-Type": type }, data: bytes })).ok()).toBe(true);
  expect((await request.post(`/v1/assets/${asset.asset_id}/complete`, { headers })).ok()).toBe(true);
  const kind = type.startsWith("image/") ? "image" : "file";
  const res = await request.post("/v1/items", { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() }, data: { kind, title: name, asset_id: asset.asset_id, entry: "box" } });
  return (await res.json()).item_id;
}

const TEXT = Buffer.from("第一行：一个存入的文本文件。\nsecond line of the saved file\n");
// A made-up one-pixel picture and a made-up one-page document.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

// ---------------------------------------------------------------- QA #31

test.describe("QA #31: the control of a saved file does something visible at once", () => {
  test("QA #31: a text file shows its text under Original and is downloaded under its own name", async ({ page, request, context }) => {
    await signIn(page);
    const id = await saveFile(page, request, "retest-file.txt", "text/plain", TEXT);
    await page.goto(`/item/${id}`);
    const original = item(page, id).locator("section").first();
    await expect(original.locator(".original-body")).toHaveText(TEXT.toString("utf8").trim());
    // The control names what it does. It is not a link that opens a tab which closes again.
    const control = original.getByTestId("saved-file");
    await expect(control).toHaveText("下载这个文件");
    await expect(original.getByText("打开存入的文件")).toHaveCount(0);

    const [download] = await Promise.all([page.waitForEvent("download"), control.click()]);
    expect(download.suggestedFilename()).toBe("retest-file.txt");
    expect(fs.readFileSync(await download.path()).equals(TEXT)).toBe(true);
    await expect(page.locator(".said")).toHaveText("已下载：retest-file.txt");
    // The page stays where it is and no tab is opened.
    await expect(page).toHaveURL(new RegExp(`/item/${id}$`));
    expect(context.pages()).toHaveLength(1);
    await expect(control).toBeEnabled();
  });

  test("QA #31: the address is asked for at the press, so a page open longer than its five minutes still downloads", async ({ page, request }) => {
    await signIn(page);
    const id = await saveFile(page, request, "notes.md", "text/markdown", Buffer.from("# A saved note\n\nIts text.\n"));
    await page.goto(`/item/${id}`);
    const control = item(page, id).getByTestId("saved-file");
    await expect(control).toHaveText("下载这个文件");
    // Every address handed out so far is past its time, as after five minutes on the page.
    const old = await (await request.get(`/v1/assets/${(await (await request.get(`/v1/items/${id}`, { headers: await auth(page) })).json()).asset_id}`, { headers: await auth(page) })).json();
    await request.post("/__test/expire-downloads");
    expect((await request.get(old.download_url)).status()).toBe(401);

    const [download] = await Promise.all([page.waitForEvent("download"), control.click()]);
    expect(download.suggestedFilename()).toBe("notes.md");
    expect(fs.readFileSync(await download.path(), "utf8")).toBe("# A saved note\n\nIts text.\n");
  });

  test("QA #31: an image shows in place, and Open the image opens it in a new tab", async ({ page, request, context }) => {
    await signIn(page);
    const id = await saveFile(page, request, "diagram.png", "image/png", PNG);
    await page.goto(`/item/${id}`);
    const original = item(page, id).locator("section").first();
    await expect(original.locator("img.original-image")).toBeVisible();
    expect(await original.locator("img.original-image").evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth))).toBe(1);
    const control = original.getByTestId("saved-file");
    await expect(control).toHaveText("打开图片");

    // The tab opens in the press itself, before the core has answered.
    await request.post("/__test/delay", { data: { ms: 500 } });
    const [tab] = await Promise.all([context.waitForEvent("page"), control.click()]);
    await expect(control).toHaveAttribute("aria-busy", "true");
    await expect(control).toBeDisabled();
    await request.post("/__test/delay", { data: { ms: 0 } });
    // Then it shows the picture itself.
    await expect.poll(() => tab.url()).toMatch(/^blob:/);
    expect(await tab.evaluate(() => document.contentType)).toBe("image/png");
    expect(await tab.evaluate(() => (document.images[0] as HTMLImageElement).decode().then(() => document.images[0].naturalWidth))).toBe(1);
    await expect(control).toBeEnabled();
    await expect(control).toHaveAttribute("aria-busy", "false");
    await expect(page).toHaveURL(new RegExp(`/item/${id}$`));
  });

  test("QA #31: a PDF opens in a new tab at the press", async ({ page, request, context }) => {
    await signIn(page);
    const id = await saveFile(page, request, "paper.pdf", "application/pdf", PDF);
    await page.goto(`/item/${id}`);
    const control = item(page, id).getByTestId("saved-file");
    await expect(control).toHaveText("打开存入的文件");
    // No picture and no text of it on the page: the control is the way to it.
    await expect(item(page, id).locator("img.original-image")).toHaveCount(0);

    // The page hands the tab the document: its bytes, as a PDF.
    await page.evaluate(() => {
      const make = URL.createObjectURL.bind(URL);
      const w = window as unknown as { handed: Promise<{ type: string; head: string; size: number }> };
      let done: (v: { type: string; head: string; size: number }) => void;
      w.handed = new Promise((r) => (done = r));
      URL.createObjectURL = (blob: Blob) => {
        void blob.text().then((text) => done({ type: blob.type, head: text.slice(0, 8), size: blob.size }));
        return make(blob);
      };
    });
    const [tab] = await Promise.all([context.waitForEvent("page"), control.click()]);
    expect(tab).toBeTruthy();
    expect(await page.evaluate(() => (window as unknown as { handed: Promise<unknown> }).handed)).toEqual({ type: "application/pdf", head: "%PDF-1.4", size: PDF.length });
    await expect(control).toBeEnabled();
    await expect(page.locator(".said.bad")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/item/${id}$`));
  });

  test("QA #31: when the file cannot be fetched the control says why, and no empty tab is left", async ({ page, request, context }) => {
    await signIn(page);
    const pdf = await saveFile(page, request, "paper.pdf", "application/pdf", PDF);
    await page.goto(`/item/${pdf}`);
    const control = item(page, pdf).getByTestId("saved-file");
    await expect(control).toBeVisible();
    await request.post("/__test/fail-next", { data: { method: "GET", path: "^/v1/assets/" } });
    const [tab] = await Promise.all([context.waitForEvent("page"), control.click()]);
    await expect(page.locator(".said.bad")).toHaveText("核心出了问题。");
    await expect.poll(() => tab.isClosed()).toBe(true);
    await expect(control).toBeEnabled();

    // The same for a download: one sentence, nothing downloaded.
    const txt = await saveFile(page, request, "retest-file.txt", "text/plain", TEXT);
    await page.goto(`/item/${txt}`);
    const download = item(page, txt).getByTestId("saved-file");
    await expect(download).toBeVisible();
    let downloads = 0;
    page.on("download", () => downloads++);
    await request.post("/__test/fail-next", { data: { method: "GET", path: "^/v1/assets/" } });
    await download.click();
    await expect(page.locator(".said.bad")).toHaveText("核心出了问题。");
    expect(downloads).toBe(0);
  });

  test("QA #31: in English the three controls say what they do", async ({ browser, baseURL, request }) => {
    const ctx = await browser.newContext({ locale: "en-US", baseURL });
    const page = await ctx.newPage();
    await signIn(page);
    for (const [name, type, bytes, label] of [
      ["retest-file.txt", "text/plain", TEXT, "Download the file"],
      ["diagram.png", "image/png", PNG, "Open the image"],
      ["paper.pdf", "application/pdf", PDF, "Open the saved file"],
    ] as const) {
      const id = await saveFile(page, request, name, type, bytes);
      await page.goto(`/item/${id}`);
      await expect(item(page, id).getByTestId("saved-file")).toHaveText(label);
    }
    await ctx.close();
  });
});

// ---------------------------------------------------------------- QA #32

test.describe("QA #32: how long an item is kept is decided when it is sorted, and the page says so", () => {
  test("QA #32: a freshly saved item shows no days left and no expiry tag; the control says it is decided when the item is sorted", async ({ page, request }) => {
    await signIn(page);
    const id = await saveText(page, request, "random-click probe 18:00");
    // Today: the row says it waits, and names no number of days.
    await page.goto("/");
    const row = page.locator(`[data-item="${id}"]`);
    await expect(row).toContainText("刚存入，等分派");
    await expect(row).not.toContainText("还剩");

    await page.goto(`/item/${id}`);
    const open = item(page, id);
    await expect(keptFor(page)).toBeEnabled();
    await expect(header(page)).not.toContainText("还剩");
    // "30 days", not the minutes of a time of day such as 20:30.
    await expect(header(page)).not.toHaveText(/(^|[^:\d])30\s*天/);
    await noRawTags(page);
    // The control: a state as its current value, the user's days and "never" to choose from.
    await expect(keptFor(page)).toHaveValue("");
    expect(await chosen(keptFor(page))).toBe("初筛时定");
    await expect(keptFor(page).locator("option")).toHaveText(["初筛时定", "7 天", "30 天", "90 天", "365 天", "收藏（不过期）"]);
    await expect(keptFor(page).locator("option").first()).toBeDisabled();
    await expect(open.getByTestId("retention-undecided")).toHaveText("你不选的话，保留多久在初筛时定：30 天，或者按你的规则。");
    // Who analyses it is in the same state, and nothing claims to have been set by sorting.
    expect(await chosen(analysedBy(page))).toBe("还没分派");
    await expect(open.getByTestId("retention-note")).toHaveCount(0);
    await expect(open.getByTestId("assistant-note")).toHaveCount(0);
  });

  test("QA #32: sorted while the page is open — the days arrive with one sentence and a note that says who set them", async ({ page, request }) => {
    await page.clock.install();
    await signIn(page);
    const id = await saveText(page, request, "random-click probe 18:00");
    await page.goto(`/item/${id}`);
    const open = item(page, id);
    await expect(keptFor(page)).toHaveValue("");
    await expect(header(page)).not.toContainText("还剩");
    await expect(page.locator(".said")).toHaveCount(0);

    // The dispatch step sorts it: the built-in assistant, 7 days. Nobody touches the page.
    expect((await triage(request, id, 7)).ok()).toBe(true);
    await page.clock.fastForward(15500);
    await expect(page.locator(".said")).toHaveText("这一条初筛过了：保留 7 天。");
    await expect(header(page)).toContainText("还剩 7 天");
    await expect(keptFor(page)).toHaveValue("7");
    await expect(keptFor(page).locator("option")).toHaveText(["7 天", "30 天", "90 天", "365 天", "收藏（不过期）"]);
    await noRawTags(page);
    await expect(open.getByTestId("retention-undecided")).toHaveCount(0);
    await expect(open.getByTestId("retention-note")).toHaveText("初筛时定的。另选一个就改。");
    await expect(analysedBy(page)).toHaveValue("as_builtin");
    await expect(open.getByTestId("assistant-note")).toHaveText("初筛时定的。另选一个就改。");
    // The Today list follows: the row now names the assistant and the days.
    await page.goto("/");
    await expect(page.locator(`[data-item="${id}"]`)).toContainText("还剩 7 天");
  });

  test("QA #32: an item that is already sorted says who set each value; choosing one removes its note", async ({ page, request }) => {
    await signIn(page);
    const id = await saveText(page, request, "random-click probe 18:00");
    await triage(request, id, 7);
    await page.goto(`/item/${id}`);
    const open = item(page, id);
    await expect(keptFor(page)).toHaveValue("7");
    await expect(header(page)).toContainText("还剩 7 天");
    await expect(open.getByTestId("retention-note")).toHaveText("初筛时定的。另选一个就改。");
    await expect(open.getByTestId("assistant-note")).toHaveText("初筛时定的。另选一个就改。");
    // It was sorted before the page opened: nothing is announced.
    await expect(page.locator(".said")).toHaveCount(0);

    await keptFor(page).selectOption("90");
    await expect(page.locator(".said")).toHaveText(/^保留 90 天，到 .+ 删除。$/);
    await expect(open.getByTestId("retention-note")).toHaveCount(0);
    await expect(open.getByTestId("assistant-note")).toBeVisible();
    await analysedBy(page).selectOption({ label: "阿读" });
    await expect(page.locator(".said")).toContainText("交给 阿读。");
    await expect(open.getByTestId("assistant-note")).toHaveCount(0);
    await expect(header(page)).toContainText("还剩 90 天");
  });

  test("QA #32: a value chosen before the item is sorted applies at once, survives sorting, and carries no note", async ({ page, request }) => {
    await page.clock.install();
    await signIn(page);
    const id = await saveText(page, request, "random-click probe 18:00");
    await page.goto(`/item/${id}`);
    const open = item(page, id);
    await expect(keptFor(page)).toBeEnabled();
    await keptFor(page).selectOption("90");
    await expect(page.locator(".said")).toHaveText(/^保留 90 天，到 .+ 删除。$/);
    // It is the user's decision now: shown as one, in the header and the control.
    await expect(keptFor(page)).toHaveValue("90");
    await expect(keptFor(page).locator("option")).toHaveText(["7 天", "30 天", "90 天", "365 天", "收藏（不过期）"]);
    await expect(header(page)).toContainText("还剩 90 天");
    await noRawTags(page);
    await expect(open.getByTestId("retention-undecided")).toHaveCount(0);

    // Sorting would have said 7 days. The user's 90 stay, and the sentence says what is true.
    await triage(request, id, 7);
    await page.clock.fastForward(15500);
    await expect(page.locator(".said")).toHaveText("这一条初筛过了：保留 90 天。");
    await expect(keptFor(page)).toHaveValue("90");
    await expect(header(page)).toContainText("还剩 90 天");
    await expect(open.getByTestId("retention-note")).toHaveCount(0);
    // A reload before sorting keeps showing the choice as a choice.
    const other = await saveText(page, request, "a second probe");
    await page.goto(`/item/${other}`);
    await keptFor(page).selectOption("never");
    await expect(page.locator(".said")).toHaveText("收藏了，不过期。");
    await page.reload();
    await expect(keptFor(page)).toHaveValue("never");
    await expect(header(page)).toContainText("收藏了，不过期");
  });

  test("QA #32: in English the placeholder, the sentence under it, the note and the announcement read as decided", async ({ browser, baseURL, request }) => {
    const ctx = await browser.newContext({ locale: "en-US", baseURL });
    const page = await ctx.newPage();
    await page.clock.install();
    await signIn(page);
    const id = await saveText(page, request, "random-click probe 18:00");
    await page.goto(`/item/${id}`);
    const open = item(page, id);
    expect(await chosen(keptFor(page))).toBe("Decided when it is sorted");
    expect(await chosen(analysedBy(page))).toBe("Not assigned yet");
    await expect(open.getByTestId("retention-undecided")).toHaveText("Unless you choose, how long this is kept is decided when the item is sorted: 30 days, or what your rules say.");
    await expect(header(page)).not.toContainText("days left");

    await triage(request, id, 7);
    await page.clock.fastForward(15500);
    await expect(page.locator(".said")).toHaveText("This item was sorted: it is kept for 7 days.");
    await expect(header(page)).toContainText("7 days left");
    await expect(open.getByTestId("retention-note")).toHaveText("Set when the item was sorted. Choose another to change it.");
    await expect(open.getByTestId("assistant-note")).toHaveText("Set when the item was sorted. Choose another to change it.");
    await ctx.close();
  });
});
