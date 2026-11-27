// W14: the page is never wider than the screen. A phone that can be dragged sideways a few pixels "sways" under a
// thumb, and it is easy to cover by clipping the page (overflow-x: hidden). This test looks at the page itself:
// at each phone width, on each main page, with the box to type into open and with a very long word in the content,
// the document is no wider than the window, and nothing in it sticks out past either edge. It does not clip anything.
import { expect, test, type Page } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }, info) => {
  test.skip(info.project.name !== "desktop", "sets its own phone viewports");
  await reset(request);
});

const WIDTHS = [320, 360, 390, 430];
/** No spaces, no break points: what an address or a run of hashtags looks like to a line breaker. */
const LONG = "https://example.org/" + "very-long-path-segment-".repeat(14) + "end#" + "tag".repeat(60);

async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > window.innerWidth) out.push(`the document is ${root.scrollWidth}px wide in a ${window.innerWidth}px window`);
    const before = window.scrollX;
    window.scrollTo(240, window.scrollY);
    if (window.scrollX !== 0) out.push(`the page can be dragged sideways (${window.scrollX}px)`);
    window.scrollTo(before, window.scrollY);
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Inside something that scrolls on its own (the tabs, a code block) it may be wider; the scroller itself may not.
      let scroller = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden") {
          scroller = true;
          break;
        }
      }
      if (!scroller && (r.right > window.innerWidth + 0.5 || r.left < -0.5)) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} spans ${Math.round(r.left)}..${Math.round(r.right)} in ${window.innerWidth}px`);
      if (out.length > 6) break;
    }
    return out;
  });
}

for (const width of WIDTHS) {
  test(`W14: at ${width}px no page can be dragged sideways, and a very long word in the content does not widen it`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 800 });
    await signIn(page);
    // A saved text that is one long word, analysed, with a long word among its key points.
    await page.getByTestId("inbox-open").click();
    await page.getByTestId("inbox-sheet").locator("textarea").fill(LONG);
    expect(await overflow(page), "the box with a long word typed in it").toEqual([]);
    await page.getByTestId("inbox-save").click();
    await expect(page.locator(".said")).toBeVisible();
    const id = await page.locator("[data-item]").first().getAttribute("data-item");
    expect(id).toBeTruthy();
    expect((await request.post("/__test/analyse", { data: { item_id: id, points: [LONG, "a short one"] } })).ok()).toBe(true);

    const paths = ["/", `/item/${id}`, "/digest", "/notes", "/calendar", "/start", "/feedback", "/account"];
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await overflow(page), `${path} at ${width}px`).toEqual([]);
    }

    // The notice at the top, and the sheet that opens over the page, with the original open and a long word in it.
    await page.goto(`/item/${id}`);
    await page.locator("details.original > summary").click();
    expect(await overflow(page), `the item with its original open at ${width}px`).toEqual([]);
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();
    await page.getByTestId("inbox-open").click();
    await expect(page.getByTestId("inbox-sheet")).toBeVisible();
    expect(await overflow(page), `the box open at ${width}px`).toEqual([]);
    // The sheet itself stands inside the screen, on both sides.
    const box = await page.getByTestId("inbox-sheet").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
  });
}

test("W14: the sheet follows the visible part of the screen, sideways as well as up, and is not left behind by a zoom", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await signIn(page);
  await page.getByTestId("inbox-open").click();
  const sheet = page.getByTestId("inbox-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.locator(".inbox-box")).toBeFocused();
  // A browser with a visual viewport that has moved: 60px in from the left, narrower than the window, and a keyboard covering 300px.
  await page.evaluate(() => {
    const fake = Object.assign(new EventTarget(), { width: 330, height: 480, offsetLeft: 60, offsetTop: 0 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: fake });
    (window as unknown as { __vv: unknown }).__vv = fake;
  });
  // The hook reads the viewport it was given when it started; a fresh open reads the moved one.
  await page.keyboard.press("Escape");
  await page.getByTestId("inbox-open").click();
  await expect(sheet).toBeVisible();
  await expect(page.locator(".inbox-box")).toBeFocused();
  await expect.poll(async () => (await sheet.boundingBox())?.x).toBeCloseTo(60, 0);
  // It slides up into place: measure when it has stopped.
  await page.waitForTimeout(450);
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.width)).toBe(330);
  // Above the keyboard: its bottom edge is not lower than the visible part's.
  expect(box.y + box.height).toBeLessThanOrEqual(780 - (780 - 480) + 1);
  // The button that saves is inside the visible part.
  const save = (await page.getByTestId("inbox-save").boundingBox())!;
  expect(save.y + save.height).toBeLessThanOrEqual(480 + 1);
  expect(save.x).toBeGreaterThanOrEqual(60 - 1);
  expect(save.x + save.width).toBeLessThanOrEqual(60 + 330 + 1);
});
