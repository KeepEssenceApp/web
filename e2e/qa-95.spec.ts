// Internal QA #95 (public issue: web #3): the inbox has a way to choose files, for a phone where
// nothing can be dragged or pasted. Drop and paste stay (W6 in inbox.spec.ts).
import { expect, test, type Page } from "@playwright/test";
import { FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these count what was saved through the fake");
test.beforeEach(async ({ request }) => reset(request));

// A made-up 1 x 1 PNG, and made-up text and PDF bytes.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n% a made-up document\n%%EOF\n");
const NOTE = Buffer.from("# a made-up note\n\nnothing real in here\n");

const pick = (page: Page) => page.getByTestId("inbox-pick");
const save = (page: Page) => page.getByTestId("inbox-save");
const result = (page: Page) => page.locator(".inbox-result");
const items = async (request: Parameters<typeof state>[0]) => (await state(request)).counts.items as number;

/** Press the button the way a keyboard does, and take the file chooser it opens. */
async function openPicker(page: Page) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), pick(page).press("Enter")]);
  return chooser;
}

test("QA #95: a Choose files button sits by Save, is a real button, and opens a multiple picker of the supported kinds", async ({ page }) => {
  await signIn(page);
  await expect(pick(page)).toHaveText("选择文件");
  await expect(pick(page)).toBeEnabled();
  expect(await pick(page).evaluate((el) => el.tagName)).toBe("BUTTON");
  // The same kinds the core takes, and Markdown by its extension because it often has no type.
  const accept = (await page.getByTestId("inbox-file").getAttribute("accept")) ?? "";
  for (const kind of ["image/webp", "image/png", "image/jpeg", "image/gif", "application/pdf", "text/plain", "text/markdown", ".md"]) expect(accept.split(",")).toContain(kind);
  await pick(page).focus();
  await expect(pick(page)).toBeFocused();
  const chooser = await openPicker(page);
  expect(chooser.isMultiple()).toBe(true);
});

test("QA #95: a PNG, a PDF and a Markdown file chosen together wait in the list, and Save sends each once", async ({ page, request }) => {
  await signIn(page);
  const before = await items(request);
  const chooser = await openPicker(page);
  await chooser.setFiles([
    { name: "diagram.png", mimeType: "image/png", buffer: PNG },
    { name: "paper.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "notes.md", mimeType: "", buffer: NOTE },
  ]);
  await expect(page.locator(".inbox-files li")).toHaveCount(3);
  await expect(page.locator(".inbox-files")).toContainText("diagram.png");
  await expect(page.locator(".inbox-files")).toContainText("paper.pdf");
  await expect(page.locator(".inbox-files")).toContainText("notes.md");
  // Choosing sends nothing: that is what Save is for.
  expect(await items(request)).toBe(before);
  await save(page).click();
  await expect(result(page)).toHaveText("已存入。");
  await expect(page.locator(".inbox-files li")).toHaveCount(0);
  expect(await items(request)).toBe(before + 3);
  expect((await state(request)).counts.assets).toBe(3);
  // They are shown afterwards, on Today, under their file names (the picture and the PDF).
  await page.goto("/");
  await expect(page.getByText("diagram.png").first()).toBeVisible();
  await expect(page.getByText("paper.pdf").first()).toBeVisible();
  // And nothing is left to send: Save has nothing to do.
  await expect(save(page)).toBeDisabled();
  expect(await items(request)).toBe(before + 3);
});

test("QA #95: cancelling the picker sends nothing and changes nothing", async ({ page, request }) => {
  await signIn(page);
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/v1/")) sent.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  const before = await items(request);
  const chooser = await openPicker(page);
  await chooser.setFiles([]);
  await expect(page.locator(".inbox-files li")).toHaveCount(0);
  await expect(save(page)).toBeDisabled();
  await expect(result(page)).toHaveText("");
  expect(sent).toEqual([]);
  expect(await items(request)).toBe(before);
});

test("QA #95: a file taken out of the list can be chosen again", async ({ page }) => {
  await signIn(page);
  const file = { name: "once.txt", mimeType: "text/plain", buffer: Buffer.from("made-up words") };
  await (await openPicker(page)).setFiles([file]);
  await expect(page.locator(".inbox-files li")).toHaveCount(1);
  await page.locator(".inbox-files").getByRole("button", { name: "拿掉" }).click();
  await expect(page.locator(".inbox-files li")).toHaveCount(0);
  await (await openPicker(page)).setFiles([file]);
  await expect(page.locator(".inbox-files li")).toHaveCount(1);
});

test("QA #95: a kind of file the core does not take is said plainly, and is not saved", async ({ page, request }) => {
  await signIn(page);
  const before = await items(request);
  // The system's picker can still show "all files": the page says no for itself.
  await (await openPicker(page)).setFiles([{ name: "tool.bin", mimeType: "application/octet-stream", buffer: Buffer.from("made-up bytes") }]);
  await save(page).click();
  await expect(result(page)).toContainText("这种文件存不了");
  await expect(result(page)).toHaveClass(/bad/);
  expect(await items(request)).toBe(before);
  // It stays in the list, named, so the user can tell which one was not saved and take it out.
  await expect(page.locator(".inbox-files li")).toHaveCount(1);
  await expect(page.locator(".inbox-files")).toContainText("tool.bin");
  await expect(page.locator(".inbox-files").getByRole("button", { name: "拿掉" })).toBeVisible();
});

test("QA #95: a dropped file, a pasted file and a chosen file wait in the same list, and none replaces another", async ({ page, request }) => {
  await signIn(page);
  const before = await items(request);
  // Drop and paste are the old ways (W6 in inbox.spec.ts); here they and the new button share the list.
  await page.evaluate(() => {
    const drop = new DataTransfer();
    drop.items.add(new File(["made-up"], "dropped.txt", { type: "text/plain" }));
    document.querySelector(".inbox")!.dispatchEvent(new DragEvent("drop", { dataTransfer: drop, bubbles: true, cancelable: true }));
    const paste = new DataTransfer();
    paste.items.add(new File(["made-up"], "pasted.txt", { type: "text/plain" }));
    document.querySelector(".inbox-box")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: paste, bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".inbox-files li")).toHaveCount(2);
  await (await openPicker(page)).setFiles([{ name: "chosen.txt", mimeType: "text/plain", buffer: Buffer.from("made-up") }]);
  const list = page.locator(".inbox-files");
  await expect(page.locator(".inbox-files li")).toHaveCount(3);
  await expect(list).toContainText("dropped.txt");
  await expect(list).toContainText("pasted.txt");
  await expect(list).toContainText("chosen.txt");
  // Nothing was sent by adding; Save sends the three, once each.
  expect(await items(request)).toBe(before);
  await save(page).click();
  await expect(result(page)).toHaveText("已存入。");
  expect(await items(request)).toBe(before + 3);
});

test("QA #95: files chosen and text typed go together; the text is saved once too", async ({ page, request }) => {
  await signIn(page);
  const before = await items(request);
  await page.locator(".inbox-box").fill("一句made-up的话，和一个文件一起存。");
  await (await openPicker(page)).setFiles([{ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("made-up") }]);
  await save(page).click();
  await expect(result(page)).toHaveText("已存入。");
  expect(await items(request)).toBe(before + 2);
});

test("QA #95: in English the button, the placeholder and Getting started tell what can really be done", async ({ page }) => {
  await signIn(page, "/assistants/account");
  await page.getByTestId("language").selectOption("en");
  await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
  await page.goto("/");
  await expect(pick(page)).toHaveText("Choose files");
  await expect(page.locator(".inbox-box")).toHaveAttribute("placeholder", "Paste a link or text, or choose images and files");
  await page.goto("/start");
  await expect(page.locator("main")).toContainText("Choose files");
  await expect(page.locator("main")).not.toContainText(/drop an image or a file/i);
});

test("QA #95: in Chinese the placeholder and Getting started no longer promise a drag", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".inbox-box")).toHaveAttribute("placeholder", "粘贴链接或文字，或者选择图片、文件");
  await page.goto("/start");
  await expect(page.locator("main")).toContainText("选择文件");
  await expect(page.locator("main")).not.toContainText("把图片、文件拖进去");
});

test("QA #95: the button fits the row beside Save and is big enough to press, on a narrow screen too", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 360, height: 740 });
  const box = (await pick(page).boundingBox())!;
  const saveBox = (await save(page).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(32);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(360);
  // The two do not sit on top of each other.
  expect(box.x + box.width).toBeLessThanOrEqual(saveBox.x + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
