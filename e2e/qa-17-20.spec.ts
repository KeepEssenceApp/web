// The internal QA issues #17 to #19 as the web app sees them, named after the issue.
// #17: the panel beside the list on wide screens. #18: the account's language. #19: titles.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const list = (page: Page) => page.getByTestId("split-list");
const panel = (page: Page) => page.getByTestId("panel");
const path = (page: Page) => page.evaluate(() => location.pathname + location.search);
const box = async (l: Locator) => (await l.boundingBox())!;
/** The rows of the list that open beside it, in the order they are shown. */
const rows = (page: Page) =>
  list(page).locator("[data-open]").evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute("data-open")));
const colour = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe("QA #17 at 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(({ isMobile }) => isMobile, "the panel is for wide screens");

  test("QA #17: Today — rail, a list of about 560 px, one line, the panel; an item opens beside the list and survives reload and back/forward", async ({ page }) => {
    await signIn(page);
    // Rail 212, list 560, then the panel takes the rest; one line between list and panel.
    const l = await box(list(page));
    const p = await box(panel(page));
    expect(Math.round(l.x)).toBe(212);
    expect(Math.round(l.width)).toBe(560);
    expect(Math.round(p.x)).toBe(772);
    expect(Math.round(p.x + p.width)).toBe(1440);
    expect(await colour(list(page), "border-right-width")).toBe("1px");
    expect(await colour(list(page), "border-right-style")).toBe("solid");

    // Nothing open: the month and today's counts.
    const rest = panel(page).getByTestId("panel-rest");
    await expect(rest.getByTestId("today-counts")).toHaveText("今天存入了 7 条 · 2 条在等");
    await expect(rest.locator(".month-card .cal-day").first()).toBeVisible();
    await expect(rest.locator(".month-card .cal-counts")).toContainText("存入了");
    await expect(list(page).locator("[aria-current]")).toHaveCount(0);

    // An analysis opens in the panel. The list stays; the address changes.
    const card = list(page).locator('[data-item="it_worth"]');
    await card.locator("h3 a").click();
    await expect(page).toHaveURL(/\/item\/it_worth$/);
    await expect(panel(page).locator(".item-title")).toContainText("租约与认领：一份活怎么只归一个人");
    await expect(list(page).locator(".inbox-box")).toBeVisible();
    await expect(list(page).locator('[data-item="it_know"]')).toBeVisible();
    // The same content and controls as the item page.
    await expect(panel(page).locator(".actions button")).toHaveText(["深挖", "不感兴趣", "看过了"]);
    await expect(panel(page).getByTestId("kept-for")).toHaveValue("30");
    await expect(panel(page).getByTestId("analysed-by")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "删除" })).toBeVisible();
    await expect(panel(page).locator(".original-body")).toContainText("任务队列里");
    // The selected row: a calm state in the text colour, not gold.
    await expect(card).toHaveAttribute("aria-current", "true");
    const text = await colour(page.locator("body"), "color");
    expect(await colour(card, "border-top-color")).toBe(text);
    expect(await colour(list(page).locator('[data-item="it_know"]'), "border-top-color")).not.toBe(text);
    expect(await colour(card, "border-top-color")).not.toBe("rgb(197, 162, 41)");
    await expect(list(page).locator('[aria-current="true"]')).toHaveCount(1);

    // A waiting item opens the same way, also by a click on the row beside its title.
    const waiting = list(page).locator('.waiting[data-item="it_triaged"]');
    await waiting.click({ position: { x: 300, y: 30 } });
    await expect(page).toHaveURL(/\/item\/it_triaged$/);
    await expect(panel(page).locator("section", { hasText: "解读" }).last()).toContainText("还没解读");
    await expect(waiting).toHaveAttribute("aria-current", "true");
    expect(await colour(waiting, "background-color")).not.toBe("rgba(0, 0, 0, 0)");
    await expect(card).not.toHaveAttribute("aria-current", "true");

    // Reload keeps the selection.
    await page.reload();
    await expect(page).toHaveURL(/\/item\/it_triaged$/);
    await expect(panel(page).locator(".item-title")).toContainText("读书会备忘");
    await expect(list(page).locator('.waiting[data-item="it_triaged"]')).toHaveAttribute("aria-current", "true");
    await expect(list(page).locator('[data-item="it_worth"]')).toBeVisible();

    // Back and forward walk through the selections.
    await page.goBack();
    await expect(page).toHaveURL(/\/item\/it_worth$/);
    await expect(panel(page).locator(".item-title")).toContainText("租约与认领");
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page).getByTestId("panel-rest")).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/item\/it_worth$/);
    await expect(list(page).locator('[data-item="it_worth"]')).toHaveAttribute("aria-current", "true");

    // "Close" in the panel clears the selection.
    await panel(page).getByTestId("panel-close").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(list(page).locator("[aria-current]")).toHaveCount(0);
  });

  test("QA #17: Today — what is done in the panel shows in the list, and the other way round", async ({ page }) => {
    await signIn(page);
    await list(page).locator('[data-item="it_know"] h3 a').click();
    await expect(panel(page).locator(".item-title")).toContainText("十分钟看懂向量检索");
    // Marked in the panel: the card leaves the list, the panel says the state.
    await panel(page).locator(".actions button", { hasText: "看过了" }).click();
    await expect(panel(page).getByTestId("item-state")).toContainText("看过了");
    await expect(list(page).locator('.card[data-item="it_know"]')).toHaveCount(0);
    // Marked in the list: the open item in the panel follows.
    await list(page).locator('[data-item="it_skip"] h3 a').click();
    await expect(panel(page).locator(".item-title")).toContainText("某构建工具发布 2.4 版");
    await list(page).locator('[data-item="it_skip"] .actions button', { hasText: "不感兴趣" }).click();
    await expect(panel(page).getByTestId("item-state")).toContainText("不感兴趣");
    // Deleting the open item clears the selection.
    await panel(page).getByRole("button", { name: "删除" }).click();
    await panel(page).locator(".confirm").getByRole("button", { name: "删除" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page).getByTestId("panel-rest")).toBeVisible();
  });

  test("QA #17: keyboard — up and down move the selection while the list has focus; Escape clears it", async ({ page }) => {
    await signIn(page);
    await expect(list(page).locator('[data-item="it_worth"]')).toBeVisible();
    const order = (await rows(page)) as string[];
    expect(order.length).toBeGreaterThanOrEqual(5);
    await list(page).locator(`[data-open="${order[0]}"] a`).first().click();
    await expect(page).toHaveURL(new RegExp(`${order[0]}$`));

    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(new RegExp(`${order[1]}$`));
    await expect(list(page).locator(`[data-open="${order[1]}"]`)).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(new RegExp(`${order[2]}$`));
    await expect(panel(page).locator("[data-open-item]")).toHaveAttribute("data-open-item", order[2].split("/").pop()!);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(page).toHaveURL(new RegExp(`${order[0]}$`));
    // The first row is the end: up stays there.
    await page.keyboard.press("ArrowUp");
    await expect(page).toHaveURL(new RegExp(`${order[0]}$`));
    // Focus stays in the list, on the selected row.
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="split-list"] [aria-current="true"]'))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await expect(list(page).locator("[aria-current]")).toHaveCount(0);
    await expect(panel(page).getByTestId("panel-rest")).toBeVisible();
    // From there the keys pick the list up again.
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(new RegExp(`${order[1]}$`));

    // Typing in the inbox is typing: the arrow keys there do not move the selection.
    await list(page).locator(".inbox-box").fill("two\nlines");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    expect(await path(page)).toBe(order[1]);
    // A dialog closes on Escape without clearing the selection.
    await panel(page).locator(".actions button", { hasText: "深挖" }).click();
    await expect(page.getByRole("dialog")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await path(page)).toBe(order[1]);
  });

  test("QA #17: Daily digest — a line's item opens beside the digest; with nothing open, the digests by date", async ({ page }) => {
    await signIn(page, "/digest");
    const day = await list(page).locator("article[data-day]").getAttribute("data-day");
    // Nothing open: the digests there are, by date, the open one marked.
    const dates = panel(page).locator(".digest-dates a");
    await expect(dates).toHaveCount(5);
    await expect(dates.first()).toHaveAttribute("data-day", day!);
    await expect(dates.first()).toHaveAttribute("aria-current", "true");
    await expect(dates.first()).toContainText("还没读");
    await expect(dates.nth(1)).toContainText("读了");
    const days = await dates.evaluateAll((els) => els.map((e) => e.getAttribute("data-day")!));
    expect([...days].sort().reverse()).toEqual(days);

    // A "worth" card opens its item in the panel; the digest stays on the left.
    const card = list(page).locator('.card.worth[data-item="d1_w1"]');
    await card.locator("h3 a").click();
    expect(await path(page)).toBe("/digest?item=d1_w1");
    await expect(panel(page).locator(".item-title")).toContainText("把评审意见写成可以执行的句子");
    await expect(panel(page).locator(".actions button")).toHaveCount(3);
    await expect(list(page).getByTestId("digest-header")).toBeVisible();
    await expect(card).toHaveAttribute("aria-current", "true");
    // Reload keeps the selection.
    await page.reload();
    expect(await path(page)).toBe("/digest?item=d1_w1");
    await expect(panel(page).locator(".item-title")).toContainText("把评审意见写成可以执行的句子");
    await expect(list(page).locator('.card.worth[data-item="d1_w1"]')).toHaveAttribute("aria-current", "true");
    // Escape clears it: the dates are back.
    await list(page).locator('.card.worth[data-item="d1_w1"] h3 a').focus();
    await page.keyboard.press("Escape");
    expect(await path(page)).toBe("/digest");
    await expect(panel(page).locator(".digest-dates")).toBeVisible();

    // A line of the rest opens its item too, and a reload shows the line (the rest unfolds for it).
    await list(page).locator('[data-part="rest"] summary').click();
    await list(page).locator('.rest-line[data-item="d1_r1"] a').click();
    expect(await path(page)).toBe("/digest?item=d1_r1");
    await expect(panel(page).locator("[data-open-item]")).toHaveAttribute("data-open-item", "d1_r1");
    await page.reload();
    await expect(list(page).locator('.rest-line[data-item="d1_r1"]')).toBeVisible();
    await expect(list(page).locator('.rest-line[data-item="d1_r1"]')).toHaveAttribute("aria-current", "true");
    await panel(page).getByTestId("panel-close").click();
    expect(await path(page)).toBe("/digest");

    // A date in the panel opens that day's digest on the left.
    await panel(page).locator(".digest-dates a").nth(2).click();
    await expect(page).toHaveURL(new RegExp(`/digest/${days[2]}$`));
    await expect(list(page).locator("article[data-day]")).toHaveAttribute("data-day", days[2]);
    await expect(panel(page).locator(`.digest-dates a[data-day="${days[2]}"]`)).toHaveAttribute("aria-current", "true");
    await list(page).locator(".card.worth h3 a").first().click();
    expect(await path(page)).toMatch(new RegExp(`^/digest/${days[2]}\\?item=d3_w1$`));
  });

  test("QA #17: Notes — the opened note or a queue entry's deep read shows beside the list; with nothing open, one sentence and the month card", async ({ page }) => {
    await signIn(page, "/notes");
    await expect(panel(page).getByTestId("panel-rest").locator(".sentence:not([aria-busy])")).toHaveText("打开一篇笔记或一份精读，在这里看。");
    await expect(panel(page).locator(".month-card .cal-counts")).toContainText("留下");
    // The month card is in the panel only.
    await expect(page.locator(".month-card")).toHaveCount(1);
    await expect(list(page).locator(".month-card")).toHaveCount(0);

    // A note opens in the panel; the list stays.
    const row = list(page).locator('.note-row[href="/notes/n2"]');
    await row.click();
    await expect(page).toHaveURL(/\/notes\/n2$/);
    await expect(panel(page).locator(".note-title")).toHaveText("评审意见的写法");
    await expect(panel(page).getByRole("button", { name: "下载" })).toBeVisible();
    await expect(row).toHaveAttribute("aria-current", "true");
    await expect(list(page).locator(".find")).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/notes\/n2$/);
    await expect(panel(page).locator(".note-title")).toHaveText("评审意见的写法");
    await expect(list(page).locator('.note-row[href="/notes/n2"]')).toHaveAttribute("aria-current", "true");
    // Down moves to the next note.
    await list(page).locator('.note-row[href="/notes/n2"]').focus();
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/\/notes\/n3$/);
    await expect(panel(page).locator(".note-title")).toHaveText("向量检索的边界");

    // A queue entry's deep read opens in the panel, not over the page.
    const ready = list(page).locator('.queue-row[data-item="d2_q1"]');
    await ready.getByRole("button", { name: "看精读" }).click();
    expect(await path(page)).toBe("/notes?read=d2_q1");
    await expect(page.locator(".scrim")).toHaveCount(0);
    await expect(panel(page).locator("[data-read] .label")).toHaveText(["读出来的", "另外查到的", "可以接着问的"]);
    await expect(panel(page).locator("[data-read] h1")).toHaveText("认领过期之后：重放安全的三种做法");
    await expect(ready).toHaveAttribute("aria-current", "true");
    await page.reload();
    expect(await path(page)).toBe("/notes?read=d2_q1");
    await expect(panel(page).locator("[data-read] .label")).toHaveCount(3);
    await page.goBack();
    await expect(page).toHaveURL(/\/notes\/n3$/);
    await page.goForward();
    await panel(page).getByTestId("panel-close").click();
    expect(await path(page)).toBe("/notes");
    await expect(panel(page).getByTestId("panel-rest")).toBeVisible();
  });

  test("QA #17: Assistants — the sections are the list, the section's content is in the panel", async ({ page }) => {
    await signIn(page, "/assistants");
    const tabs = list(page).locator(".tabs a");
    await expect(tabs).toHaveText(["助手", "规则", "设备", "我的月历", "通知", "账户"]);
    // One under the other, in the list column.
    const boxes = await tabs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y) })));
    expect(new Set(boxes.map((b) => b.x)).size).toBe(1);
    expect([...boxes].sort((a, b) => a.y - b.y)).toEqual(boxes);
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y + 20);
    await expect(panel(page).locator("[data-assistant]")).toHaveCount(3);
    await expect(list(page).locator("[data-assistant]")).toHaveCount(0);

    await tabs.nth(1).click();
    await expect(page).toHaveURL(/\/assistants\/rules$/);
    await expect(panel(page).locator('[data-section="rules"] textarea')).toBeVisible();
    await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(panel(page).locator('[data-section="rules"]')).toBeVisible();
    // The keys move between sections.
    await list(page).locator(".tabs a").nth(1).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/\/assistants\/devices$/);
    await expect(panel(page).locator('[data-section="devices"]')).toBeVisible();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(page).toHaveURL(/\/assistants$/);
  });
});

test.describe("QA #17 at 1920 × 1080", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test.skip(({ isMobile }) => isMobile, "the panel is for wide screens");

  test("QA #17: the panel fills the rest of a very wide screen and its text stays within 720 px", async ({ page }) => {
    await signIn(page, "/item/it_worth");
    const l = await box(list(page));
    const p = await box(panel(page));
    expect(Math.round(l.width)).toBe(560);
    expect(Math.round(p.x + p.width)).toBe(1920);
    expect(Math.round(p.width)).toBe(1920 - 212 - 560);
    const article = await box(panel(page).locator("article"));
    expect(article.width).toBeLessThanOrEqual(720);
    expect(article.width).toBeGreaterThan(640);
    await page.goto("/notes/n1");
    expect((await box(panel(page).locator("article.note"))).width).toBeLessThanOrEqual(720);
    // Nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("QA #17 at 1000 × 800", () => {
  test.use({ viewport: { width: 1000, height: 800 } });
  test.skip(({ isMobile }) => isMobile, "the phone layout has its own tests");

  test("QA #17: below 1100 px nothing changes — one column, and a click opens the item as its own page", async ({ page }) => {
    await signIn(page);
    await expect(page.locator(".inbox-box")).toBeVisible();
    await expect(page.getByTestId("panel")).toHaveCount(0);
    await expect(page.getByTestId("split-list")).toHaveCount(0);
    // One column, as before: the page is at most 860 px wide next to the rail.
    const today = await box(page.locator(".page.today"));
    expect(Math.round(today.x)).toBe(212);
    expect(Math.round(today.width)).toBe(1000 - 212);

    await page.locator('[data-item="it_worth"] h3 a').click();
    await expect(page).toHaveURL(/\/item\/it_worth$/);
    await expect(page.locator(".item-title")).toContainText("租约与认领");
    // The item is the page: Today's list is gone, and a link leads back to it.
    await expect(page.locator(".inbox-box")).toHaveCount(0);
    await expect(page.locator("a.back")).toHaveText("‹ 今天");
    await page.locator("a.back").click();
    await expect(page).toHaveURL(/\/$/);
    // A click beside the title does not open anything here.
    await page.locator('.waiting[data-item="it_triaged"]').click({ position: { x: 400, y: 30 } });
    await expect(page).toHaveURL(/\/$/);
    // The arrow keys do nothing.
    await page.locator('[data-item="it_worth"] h3 a').focus();
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/\/$/);

    // Notes: the month card under the list; a note is its own page; the deep read is a dialog.
    await page.goto("/notes");
    const notes = await box(page.locator(".note-list"));
    const card = await box(page.locator(".month-card"));
    expect(card.y).toBeGreaterThan(notes.y);
    await page.locator('.queue-row[data-item="d2_q1"]').getByRole("button", { name: "看精读" }).click();
    await expect(page.locator(".scrim [role=dialog][aria-modal=true] .label")).toHaveCount(3);
    await expect(page.locator(".scrim [role=dialog]")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".scrim")).toHaveCount(0);
    await page.locator('.note-row[href="/notes/n1"]').click();
    await expect(page.locator(".note-title")).toBeVisible();
    await expect(page.locator(".find")).toHaveCount(0);
    await expect(page.locator("a.back")).toHaveText("‹ 笔记");

    // The daily digest: a card's title opens the item page, and a line of the rest is only a line.
    await page.goto("/digest");
    await expect(page.locator('.card.worth[data-item="d1_w1"] h3 a')).toHaveAttribute("href", "/item/d1_w1");
    await page.locator('[data-part="rest"] summary').click();
    await expect(page.locator('.rest-line[data-item="d1_r1"] a')).toHaveCount(0);
    // Assistants: the sections are tabs in a row above the content.
    await page.goto("/assistants");
    await expect(page.locator(".tabs a")).toHaveCount(6);
    const tabs = await page.locator(".tabs a").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
    expect(new Set(tabs).size).toBe(1);
  });

  test("QA #17: an address with a selection, opened on a narrow screen, shows the page it belongs to", async ({ page }) => {
    await signIn(page, "/digest?item=d1_w1");
    await expect(page.getByTestId("digest-header")).toBeVisible();
    await expect(page.getByTestId("panel")).toHaveCount(0);
    await page.goto("/notes?read=d2_q1");
    await expect(page.locator(".note-list")).toBeVisible();
    // Growing the window past 1100 px brings the panel and the selection it names.
    await page.setViewportSize({ width: 1300, height: 800 });
    await expect(page.getByTestId("panel").locator("[data-read] .label")).toHaveCount(3);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(page.getByTestId("panel")).toHaveCount(0);
  });
});

test.describe("QA #18: the account's language", () => {
  test("QA #18: (a) changing the language in Account writes it through PATCH /v1/settings, and says what it is for", async ({ page, request }) => {
    await signIn(page, "/assistants/account");
    expect((await state(request)).user.lang).toBe("zh");
    await expect(page.getByTestId("language-hint")).toHaveText("新的解读和每日摘要用这种语言写。");
    const [patch] = await Promise.all([
      page.waitForRequest((r) => r.method() === "PATCH" && new URL(r.url()).pathname === "/v1/settings"),
      page.getByTestId("language").selectOption("en"),
    ]);
    expect(patch.postDataJSON()).toEqual({ lang: "en" });
    await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
    await expect(page.getByTestId("language-hint")).toHaveText("New analyses and digests are written in this language.");
    await expect(page.getByTestId("language")).toHaveValue("en");
    expect((await state(request)).user.lang).toBe("en");
    // It holds after a reload: the account says English, and so does this device.
    await page.reload();
    await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
    await expect(page.getByTestId("language")).toHaveValue("en");
  });

  test("QA #18: (a) when the core refuses, the interface does not pretend: language and account stay as they were", async ({ page, request }) => {
    await signIn(page, "/assistants/account");
    await request.post("/__test/fail-next", { data: { method: "PATCH", path: "^/v1/settings$" } });
    await page.getByTestId("language").selectOption("en");
    await expect(page.locator(".said.bad")).toBeVisible();
    await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("今天");
    await expect(page.getByTestId("language")).toHaveValue("zh");
    expect((await state(request)).user.lang).toBe("zh");
  });

  test("QA #18: (c) the sign-in page sends its language with the code request, and a new account starts in it", async ({ browser, baseURL, request }) => {
    const ctx = await browser.newContext({ locale: "en-US", baseURL });
    const page = await ctx.newPage();
    await page.goto("/");
    const [asked] = await Promise.all([
      page.waitForRequest((r) => new URL(r.url()).pathname === "/v1/auth/email-codes"),
      (async () => {
        await page.locator('input[type="email"]').fill("reader@example.com");
        await page.locator('button[type="submit"]').click();
      })(),
    ]);
    expect(asked.postDataJSON()).toEqual({ email: "reader@example.com", lang: "en" });
    await page.locator('input[name="code"]').fill("246810");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
    expect((await state(request)).user.lang).toBe("en");
    await ctx.close();
  });

  test("QA #18: a device follows the language of the account it signs in to, so the two cannot differ unseen", async ({ page, request }) => {
    // The account exists and writes in English; this browser prefers Chinese.
    await reset(request, { account_lang: "en" });
    await signIn(page, "/assistants/account");
    await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("Today");
    await expect(page.getByTestId("language")).toHaveValue("en");
    expect((await state(request)).user.lang).toBe("en");
    // Choosing Chinese changes the account, and with it what new analyses are written in.
    await page.getByTestId("language").selectOption("zh");
    await expect(page.locator("nav.nav .nav-entry").first()).toHaveText("今天");
    expect((await state(request)).user.lang).toBe("zh");
  });
});

test.describe("QA #19: titles", () => {
  const LONG = "Mixed language test 混合语言测试 — Please review the Q3 report 第三季度报告 before Friday 周五之前。" + " 还有很长的一段后续说明文字，用来确认标题在列表里被截断时带有省略号".repeat(3);

  test("QA #19: a long title is clamped with an ellipsis in the list, carries the full title, and is shown whole on the item", async ({ page, request }) => {
    await signIn(page);
    const saved = await request.post("/v1/items", {
      data: { kind: "text", text: "Body of the long one.", title: LONG, entry: "inbox" },
      headers: { Authorization: `Bearer ${await credentialOf(page)}`, "Idempotency-Key": `qa19-${Date.now()}` },
    });
    expect(saved.status()).toBe(201);
    const id = (await saved.json()).item_id as string;
    await page.reload();

    // In the list: at most two lines, the cut marked by the browser's ellipsis, the whole title one hover away.
    const title = page.locator(`[data-item="${id}"] a.title-clip`);
    await expect(title).toHaveAttribute("title", LONG);
    await expect(title).toHaveText(LONG);
    const clip = await title.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { clamp: cs.getPropertyValue("-webkit-line-clamp"), overflow: cs.overflowY, ellipsis: cs.textOverflow, cut: el.scrollHeight > el.clientHeight + 1, lines: Math.round(el.clientHeight / parseFloat(cs.lineHeight)) };
    });
    expect(clip).toEqual({ clamp: "2", overflow: "hidden", ellipsis: "ellipsis", cut: true, lines: 2 });

    // On the item: the full title, wrapped, never clipped.
    await title.click();
    await expect(page).toHaveURL(new RegExp(`/item/${id}$`));
    const heading = page.locator("h1.item-title");
    await expect(heading).toContainText(LONG);
    const whole = await heading.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { overflow: cs.overflow, clamp: cs.getPropertyValue("-webkit-line-clamp"), nowrap: cs.whiteSpace === "nowrap", fitsX: el.scrollWidth <= el.clientWidth, fitsY: el.scrollHeight <= el.clientHeight, lines: Math.round(el.clientHeight / parseFloat(cs.lineHeight)) };
    });
    expect(whole.overflow).toBe("visible");
    expect(whole.clamp).toBe("none");
    expect(whole.nowrap).toBe(false);
    expect(whole.fitsX).toBe(true);
    expect(whole.fitsY).toBe(true);
    expect(whole.lines).toBeGreaterThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("QA #19: a title the core made from a long first sentence ends with its ellipsis, in the list and on the item", async ({ page }) => {
    await signIn(page);
    const text = "Mixed language test 混合语言测试 — Please review the Q3 report 第三季度报告 before Friday 周五之前。";
    await page.locator(".inbox-box").fill(text);
    await page.locator(".inbox .btn").click();
    await expect(page.locator(".inbox-result")).toHaveText("已存入。");
    const row = page.locator(".waiting", { hasText: "Mixed language test" });
    await expect(row.locator("a.title-clip")).toHaveText("Mixed language test 混合语言测试 — Please review the Q3 report 第三季度报告 before Friday…");
    await row.locator("a.title-clip").click();
    await expect(page.locator("h1.item-title")).toContainText("before Friday…");
    // Nothing is lost: the whole text is under Original.
    await expect(page.locator(".original-body")).toHaveText(text);
  });

  test("QA #19: other list titles carry their full title too", async ({ page }) => {
    await signIn(page, "/notes");
    await expect(page.locator('.note-row[href="/notes/n1"] b.title-clip')).toHaveAttribute("title", "一份活只归一个人：认领、租约、重放");
    await expect(page.locator('.queue-row[data-item="d2_q1"] a.title-clip')).toHaveAttribute("title", "认领过期之后：重放安全的三种做法");
    await page.goto("/digest");
    await expect(page.locator('.card.worth[data-item="d1_w1"] a.title-clip')).toHaveAttribute("title", "把评审意见写成可以执行的句子");
  });
});

test("QA #20: an analysis the assistant gave up on says so in its own words", async ({ page, request }) => {
  // The core hands such an item in as unavailable with a sentence of its own; the card shows it.
  await signIn(page);
  await request.post("/__test/analyse", { data: { item_id: "it_triaged", unavailable: "内容读不出来" } });
  await page.reload();
  await expect(page.locator('.card[data-item="it_triaged"] .summary')).toHaveText("内容读不出来");
  await expect(page.locator('.card[data-item="it_triaged"] dt')).toHaveCount(0);
});
