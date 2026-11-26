// Internal QA #95: the web inbox has a way to choose a file, for a phone where nothing can be
// dropped or pasted. Run against the fake core; the browser's real file chooser is driven, but a
// real iPhone or Android photo library / Files app is not covered by this file.
import { expect, test, type Page } from "@playwright/test";
import { FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

// Made-up content only: a one-pixel picture and a one-line document.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

const choose = (page: Page) => page.getByRole("button", { name: "选择文件" });
const result = (page: Page) => page.locator(".inbox-result");
const files = (page: Page) => page.locator(".inbox-files li");

async function pick(page: Page, list: { name: string; mimeType: string; buffer: Buffer }[]) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), choose(page).click()]);
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(list);
}

test("QA #95: a visible button opens the file chooser; the input offers images, PDF and text", async ({ page }) => {
  await signIn(page);
  await expect(choose(page)).toBeVisible();
  await expect(choose(page)).toBeEnabled();
  const accept = (await page.getByTestId("inbox-file").getAttribute("accept")) ?? "";
  expect(accept.split(",")).toEqual(expect.arrayContaining(["image/*", "application/pdf", "text/plain", "text/markdown"]));
  // The old ways are still promised where they work.
  await expect(page.locator(".inbox-box")).toHaveAttribute("placeholder", /拖进来/);
});

test("QA #95: a chosen PNG and PDF wait in the list, are saved once, and the sentence says so", async ({ page, request }) => {
  await signIn(page);
  const before = (await state(request)).counts;
  await pick(page, [
    { name: "松木团队三页报告.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "示意图.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(files(page)).toHaveText([/松木团队三页报告\.pdf/, /示意图\.png/]);
  // Choosing does not save: nothing has been sent yet.
  expect((await state(request)).counts.items).toBe(before.items);

  await page.locator(".inbox .btn").click();
  await expect(result(page)).toHaveText("已存入。");
  await expect(files(page)).toHaveCount(0);
  const after = (await state(request)).counts;
  expect(after.items).toBe(before.items + 2);
  expect(after.assets).toBe(before.assets + 2);

  // They are shown afterwards, as items on Today, under their file names.
  await page.goto("/");
  await expect(page.getByText("松木团队三页报告.pdf").first()).toBeVisible();
  await expect(page.getByText("示意图.png").first()).toBeVisible();

  // Pressing Save again has nothing left to send.
  await expect(page.locator(".inbox .btn")).toBeDisabled();
  expect((await state(request)).counts.items).toBe(before.items + 2);
});

test("QA #95: cancelling the chooser sends nothing and adds nothing", async ({ page, request }) => {
  await signIn(page);
  const before = (await state(request)).counts;
  await pick(page, []);
  await expect(files(page)).toHaveCount(0);
  await expect(page.locator(".inbox .btn")).toBeDisabled();
  await expect(result(page)).toHaveText("");
  expect((await state(request)).counts).toEqual(before);
});

test("QA #95: a file taken out of the list can be chosen again", async ({ page }) => {
  await signIn(page);
  await pick(page, [{ name: "示意图.png", mimeType: "image/png", buffer: PNG }]);
  await expect(files(page)).toHaveCount(1);
  await page.locator(".inbox-files").getByRole("button", { name: "拿掉" }).click();
  await expect(files(page)).toHaveCount(0);
  await pick(page, [{ name: "示意图.png", mimeType: "image/png", buffer: PNG }]);
  await expect(files(page)).toHaveCount(1);
});

test("QA #95: a kind of file that cannot be saved is said so, and nothing is stored", async ({ page, request }) => {
  await signIn(page);
  const before = (await state(request)).counts;
  await pick(page, [{ name: "包.zip", mimeType: "application/zip", buffer: Buffer.from("PK") }]);
  await page.locator(".inbox .btn").click();
  await expect(result(page)).toContainText("这种文件存不了");
  await expect(result(page)).toHaveClass(/bad/);
  expect((await state(request)).counts.items).toBe(before.items);
  // It stays in the list, so the user sees what was not saved.
  await expect(files(page)).toHaveCount(1);
});

test("QA #95: dropping and pasting still work beside the button", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => {
    const drop = new DataTransfer();
    drop.items.add(new File(["x"], "dropped.txt", { type: "text/plain" }));
    document.querySelector(".inbox")!.dispatchEvent(new DragEvent("drop", { dataTransfer: drop, bubbles: true, cancelable: true }));
    const paste = new DataTransfer();
    paste.items.add(new File(["y"], "pasted.txt", { type: "text/plain" }));
    document.querySelector(".inbox-box")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: paste, bubbles: true, cancelable: true }));
  });
  await expect(files(page)).toHaveText([/dropped\.txt/, /pasted\.txt/]);
  await pick(page, [{ name: "chosen.txt", mimeType: "text/plain", buffer: Buffer.from("z") }]);
  await expect(files(page)).toHaveCount(3);
});
