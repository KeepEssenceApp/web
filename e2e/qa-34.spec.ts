// The internal QA issue #34 as the web app sees it: the deep-dive queue on Notes. Every entry is
// a row with the item's title and, under it, its state; the state cannot be read as "the queue
// is empty"; every row opens something; and the count in the heading is the number of rows.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const list = (page: Page) => page.getByTestId("split-list");
const panel = (page: Page) => page.getByTestId("panel");
const summary = (page: Page) => panel(page).getByTestId("queue-summary");
const auth = async (page: Page) => ({ Authorization: `Bearer ${await credentialOf(page)}` });
const enqueue = async (page: Page, request: APIRequestContext, id: string) => request.put(`/v1/deep-read-queue/${id}`, { headers: await auth(page) });
const dequeue = async (page: Page, request: APIRequestContext, id: string) => request.delete(`/v1/deep-read-queue/${id}`, { headers: await auth(page) });
const path = (page: Page) => page.evaluate(() => location.pathname + location.search);

// The seed: one entry waiting, one being read, one with its deep read ready (newest first).
const SEED = [
  { id: "it_queued", state: "在队列里。等精读" },
  { id: "d3_q1", state: "在队列里。精读中" },
  { id: "d2_q1", state: "精读好了" },
];
const NONE = "在队列里。还没有助手做精读";

test.describe("QA #34 on a wide screen", () => {
  test.skip(({ isMobile }) => isMobile, "the panel beside the list exists on wide screens");

  test("QA #34: every state is a row with the item's title first and its state under it, in the panel and in the list", async ({ page, request }) => {
    await reset(request, { no_deep: true });
    await signIn(page, "/notes");
    // No assistant is set to do deep reads: an entry added now has the state "none".
    await enqueue(page, request, "it_worth");
    await page.reload();
    const all = [{ id: "it_worth", state: NONE }, ...SEED];
    for (const where of [summary(page), list(page)]) {
      for (const { id, state } of all) {
        const row = where.locator(`[data-item="${id}"]`);
        const title = row.locator(".title-clip");
        await expect(title).not.toBeEmpty();
        await expect(title).toBeVisible();
        await expect(row.locator(".state")).toHaveText(state);
        // The title stands above the state, and it is the heavier of the two.
        const [a, b] = [(await title.boundingBox())!, (await row.locator(".state").boundingBox())!];
        expect(a.y + a.height).toBeLessThanOrEqual(b.y + 1);
        expect(Number(await title.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
      }
    }
    await expect(summary(page).locator('[data-item="d2_q1"] .title-clip')).toHaveText("认领过期之后：重放安全的三种做法");
    // No row reads as if the queue were empty.
    await expect(page.getByText("没做精读")).toHaveCount(0);
  });

  test("QA #34: the count in the heading is the number of rows, and an empty queue has its sentence and no count", async ({ page, request }) => {
    await signIn(page, "/notes");
    await expect(summary(page).locator("h2")).toHaveText("深挖队列 · 3 条");
    await expect(summary(page).locator("li")).toHaveCount(3);
    await expect(list(page).locator(".queue-row")).toHaveCount(3);
    // One leaves, from the list: the heading, the panel's rows and the list's rows follow together.
    await list(page).locator('.queue-row[data-item="it_queued"]').getByRole("button", { name: "移出队列" }).click();
    await expect(summary(page).locator("h2")).toHaveText("深挖队列 · 2 条");
    await expect(summary(page).locator("li")).toHaveCount(2);
    await expect(list(page).locator(".queue-row")).toHaveCount(2);
    // An item that is deleted takes its entry with it.
    await request.delete("/v1/items/d3_q1", { headers: await auth(page) });
    await page.reload();
    await expect(summary(page).locator("h2")).toHaveText("深挖队列 · 1 条");
    await expect(summary(page).locator("li")).toHaveCount(1);
    await expect(list(page).locator(".queue-row")).toHaveCount(1);

    await dequeue(page, request, "d2_q1");
    await page.reload();
    await expect(summary(page).locator("h2")).toHaveText("深挖队列");
    await expect(summary(page)).toContainText("深挖队列里现在没有条目。");
    await expect(summary(page).locator("li")).toHaveCount(0);
    await expect(list(page).locator(".queue-row")).toHaveCount(0);
  });

  test("QA #34: a row with no deep read opens the item beside Notes — from the panel, from the list, and with the keyboard", async ({ page, request }) => {
    await reset(request, { no_deep: true });
    await signIn(page, "/notes");
    await enqueue(page, request, "it_worth");
    await page.reload();
    const open = panel(page).locator('[data-open-item="it_worth"]');
    const row = list(page).locator('.queue-row[data-item="it_worth"]');

    // The panel's row: anywhere on it, not only on the words.
    const line = summary(page).locator('[data-item="it_worth"]');
    const box = (await line.boundingBox())!;
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
    expect(await path(page)).toBe("/notes?item=it_worth");
    await expect(open.locator("h1")).toContainText("租约与认领");
    await expect(row).toHaveAttribute("aria-current", "true");
    // Still Notes: the list stays, and Close leads back to it.
    await expect(list(page).locator(".queue-row")).toHaveCount(4);
    await panel(page).getByTestId("panel-close").click();
    expect(await path(page)).toBe("/notes");

    // The list's row: its own edge, away from the title and the buttons.
    await row.click({ position: { x: 4, y: 4 } });
    expect(await path(page)).toBe("/notes?item=it_worth");
    await expect(open).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await path(page)).toBe("/notes");

    // The keyboard: the title is the row's link; Enter opens it.
    await row.locator("a.queue-title").focus();
    await page.keyboard.press("Enter");
    expect(await path(page)).toBe("/notes?item=it_worth");
    await expect(open).toBeVisible();
    // And the entries that wait or are being read open their items the same way.
    for (const id of ["it_queued", "d3_q1"]) {
      await list(page).locator(`.queue-row[data-item="${id}"]`).click({ position: { x: 4, y: 4 } });
      expect(await path(page)).toBe(`/notes?item=${id}`);
      await expect(panel(page).locator(`[data-open-item="${id}"]`)).toBeVisible();
    }
  });

  test("QA #34: a row whose deep read is ready opens the deep read — from the panel, from the list, and with the keyboard", async ({ page }) => {
    await signIn(page, "/notes");
    const read = panel(page).locator('[data-read="d2_q1"]');
    await summary(page).locator('[data-item="d2_q1"] a').click();
    expect(await path(page)).toBe("/notes?read=d2_q1");
    await expect(read.locator(".label")).toHaveText(["读出来的", "另外查到的", "可以接着问的"]);
    await panel(page).getByTestId("panel-close").click();

    const row = list(page).locator('.queue-row[data-item="d2_q1"]');
    await row.click({ position: { x: 4, y: 4 } });
    expect(await path(page)).toBe("/notes?read=d2_q1");
    await expect(read).toBeVisible();
    await expect(row).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");

    await row.locator("a.queue-title").focus();
    await page.keyboard.press("Enter");
    expect(await path(page)).toBe("/notes?read=d2_q1");
    await expect(read).toBeVisible();
    await expect(page.locator(".scrim")).toHaveCount(0);
  });

  test("QA #34: an entry whose item has no title is still a row with a name, and still opens", async ({ page }) => {
    await signIn(page, "/notes");
    await page.route("**/v1/deep-read-queue", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      for (const e of body.entries) if (e.item_id === "it_queued") e.title = "  ";
      await route.fulfill({ response: res, json: body });
    });
    await page.reload();
    await expect(summary(page).locator('[data-item="it_queued"] .title-clip')).toHaveText("没有标题的条目");
    await expect(list(page).locator('.queue-row[data-item="it_queued"] a.queue-title')).toHaveText("没有标题的条目");
    await expect(summary(page).locator("h2")).toHaveText("深挖队列 · 3 条");
    await summary(page).locator('[data-item="it_queued"] a').click();
    expect(await path(page)).toBe("/notes?item=it_queued");
    await expect(panel(page).locator('[data-open-item="it_queued"]')).toBeVisible();
  });
});

test.describe("QA #34 on a narrow screen", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    if (!isMobile) await page.setViewportSize({ width: 1000, height: 800 });
  });

  test("QA #34: every state is a row with its title and state; a row with no deep read opens the item as its page", async ({ page, request }) => {
    await reset(request, { no_deep: true });
    await signIn(page, "/notes");
    await enqueue(page, request, "it_worth");
    await page.reload();
    await expect(page.getByTestId("panel")).toHaveCount(0);
    for (const { id, state } of [{ id: "it_worth", state: NONE }, ...SEED]) {
      const row = page.locator(`.queue-row[data-item="${id}"]`);
      await expect(row.locator("a.queue-title")).not.toBeEmpty();
      await expect(row.locator(".state")).toHaveText(state);
    }
    const row = page.locator('.queue-row[data-item="it_worth"]');
    // Anywhere on the row.
    await row.click({ position: { x: 4, y: 4 } });
    await expect(page).toHaveURL(/\/item\/it_worth$/);
    await expect(page.locator('[data-open-item="it_worth"] h1')).toContainText("租约与认领");
    await page.goBack();
    // The keyboard.
    await row.locator("a.queue-title").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/item\/it_worth$/);
    // A button inside the row still does its own job, not the row's.
    await page.goBack();
    await row.getByRole("button", { name: "移出队列" }).click();
    await expect(page.locator(".said")).toContainText("已移出队列。");
    await expect(page).toHaveURL(/\/notes$/);
  });

  test("QA #34: a row whose deep read is ready opens the deep read, by a press anywhere on it or by the keyboard", async ({ page }) => {
    await signIn(page, "/notes");
    const row = page.locator('.queue-row[data-item="d2_q1"]');
    const sheet = page.locator(".scrim");
    await row.click({ position: { x: 4, y: 4 } });
    await expect(sheet.locator(".label")).toHaveText(["读出来的", "另外查到的", "可以接着问的"]);
    await expect(page).toHaveURL(/\/notes$/);
    // The dialog takes the focus once it is up; then Escape closes it.
    await expect(sheet.getByRole("dialog")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await row.locator("a.queue-title").focus();
    await page.keyboard.press("Enter");
    await expect(sheet.locator(".label")).toHaveCount(3);
    await expect(page).toHaveURL(/\/notes$/);
  });

  test("QA #34: the address of an item opened beside Notes shows the item as its page here", async ({ page }) => {
    await signIn(page, "/notes?item=it_queued");
    await expect(page.locator('[data-open-item="it_queued"]')).toBeVisible();
    await expect(page.locator("a.back")).toHaveAttribute("href", "/notes");
    await expect(page.locator("a.back")).toContainText("笔记");
  });
});

test("QA #34: in English no state reads as an empty queue", async ({ browser, baseURL, request }) => {
  await reset(request, { no_deep: true });
  const ctx = await browser.newContext({ locale: "en-US", baseURL, viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await signIn(page, "/notes");
  await enqueue(page, request, "it_worth");
  await page.reload();
  await expect(list(page).locator(".queue-row .state")).toHaveText([
    "Queued. No assistant is set to do deep reads",
    "Queued. Waiting for a deep read",
    "Queued. Being read",
    "Deep read ready",
  ]);
  await expect(summary(page).locator("h2")).toHaveText("Deep-dive queue · 4");
  await expect(summary(page).locator("li")).toHaveCount(4);
  await expect(page.getByText("No deep read", { exact: true })).toHaveCount(0);
  await ctx.close();
});

test("QA #41: while something is typed in quick find the queue is not in the list, whatever the word", async ({ page }) => {
  await signIn(page, "/notes");
  const queue = page.locator(".page.notes section ul.queue");
  await expect(queue).toHaveCount(1);
  const find = page.locator(".page.notes input.find");
  for (const word of ["milk", "test", "q"]) {
    await find.fill(word);
    // Checked at once, before the request for the notes goes out.
    await expect(queue).toHaveCount(0, { timeout: 150 });
    await page.waitForTimeout(400);
    await expect(queue).toHaveCount(0);
    await find.fill("");
    await expect(queue).toHaveCount(1);
  }
});
