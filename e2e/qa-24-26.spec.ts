// The internal QA issues #24 to #26 as the web app sees them, named after the issue.
// #24: the app is capped and centred on very wide screens, idle panels are laid out, and the
// calendar has the two-column layout. #25: the account's data can be downloaded and the account
// deleted. #26: an open item and the Today list show an analysis when it lands.
import fs from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { EMAIL, FAKE, credentialOf, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const list = (page: Page) => page.getByTestId("split-list");
const panel = (page: Page) => page.getByTestId("panel");
const box = async (l: Locator) => (await l.boundingBox())!;
/** The seeded user lives in Asia/Shanghai. */
const dayAgo = (n: number) => new Date(Date.now() + 8 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);

// ---------------------------------------------------------------- QA #24

/** The app's outer box: at most 1440 px wide, the same margin on both sides, nothing scrolling sideways. */
async function expectFrame(page: Page, viewport: number) {
  const shell = await box(page.locator(".shell"));
  const width = Math.min(viewport, 1440);
  expect(Math.round(shell.width)).toBe(width);
  expect(Math.round(shell.x)).toBe((viewport - width) / 2);
  expect(Math.round(viewport - (shell.x + shell.width))).toBe((viewport - width) / 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Rail, list and panel sit inside it, in that order, with nothing left over to the right of the panel.
  const edge = viewport > 1440 ? 1 : 0; // the line that closes the app off from the margin
  const nav = await box(page.locator(".nav"));
  const l = await box(list(page));
  const p = await box(panel(page));
  expect(Math.round(nav.x)).toBe(Math.round(shell.x) + edge);
  expect(Math.round(l.x)).toBe(Math.round(nav.x + nav.width));
  expect(Math.round(p.x)).toBe(Math.round(l.x + l.width));
  expect(Math.round(p.x + p.width)).toBe(Math.round(shell.x + shell.width) - edge);
  return { shell, list: l, panel: p };
}

/**
 * What the panel shows starts at its top-left (36 px in, 28 px down: the page's own padding), and
 * the elements named by `inside` together reach across it (at least `share` of its inner width).
 */
async function expectFilled(page: Page, inside: string, share = 0.9) {
  const p = await box(panel(page));
  const reach = await panel(page).evaluate((el, selector) => {
    const of = (q: string) => [...el.querySelectorAll(q)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const first = of(".page > *");
    const rects = of(selector);
    return { left: Math.min(...first.map((r) => r.left)), top: Math.min(...first.map((r) => r.top)), from: Math.min(...rects.map((r) => r.left)), to: Math.max(...rects.map((r) => r.right)) };
  }, inside);
  expect(Math.round(reach.left - p.x)).toBe(36);
  expect(Math.round(reach.top - p.y)).toBe(28);
  expect(Math.round(reach.from - p.x)).toBe(36);
  expect(reach.to - reach.from).toBeGreaterThanOrEqual((p.width - 72) * share);
}

/** Elements that stand side by side: the same top, each to the right of the one before. */
async function expectInARow(items: Locator, n: number) {
  await expect(items).toHaveCount(n);
  const boxes = await items.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, right: r.right })));
  for (let i = 1; i < boxes.length; i++) {
    expect(Math.abs(boxes[i].y - boxes[0].y)).toBeLessThanOrEqual(8);
    expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].right - 1);
  }
}

for (const [width, height] of [
  [1440, 900],
  [1920, 1080],
] as const) {
  test.describe(`QA #24 at ${width} × ${height}`, () => {
    test.use({ viewport: { width, height } });
    test.skip(({ isMobile }) => isMobile, "the panel is for wide screens");

    test(`QA #24: Today — the app is at most 1440 px wide and centred; idle, the panel shows today's counts, the month and what was handled; open, the item`, async ({ page, request }) => {
      await signIn(page);
      const rest = panel(page).getByTestId("panel-rest");
      await expect(rest.getByTestId("today-counts")).toBeVisible();
      await expectFrame(page, width);
      // Today's counts: four numbers in one row across the panel.
      await expect(rest.getByTestId("today-counts").locator(".stat-label")).toHaveText(["今天存入", "在等解读", "解读待看", "今天处理过的"]);
      await expect(rest.getByTestId("today-counts").locator(".stat-n")).toHaveText(["7", "2", "4", "1"]);
      await expectInARow(rest.getByTestId("today-counts").locator("> div"), 4);
      await expectFilled(page, '[data-testid="today-counts"] > div', 0.8);
      // The month: the dots, and beside them its four numbers; the card is as wide as the panel's content.
      const month = rest.getByTestId("month-panel");
      await expect(month.locator(".cal-day").first()).toBeVisible();
      await expect(month.getByTestId("month-counts").locator(".stat-label")).toHaveText(["存入", "每日摘要", "读了的摘要", "笔记"]);
      expect((await box(month)).width).toBeGreaterThanOrEqual((await box(panel(page))).width - 73);
      expect((await box(month.getByTestId("month-counts"))).x).toBeGreaterThan((await box(month.locator(".cal"))).x + 150);
      // "Handled today", when there is something: the seed has one item in the deep-dive queue.
      await expect(rest.getByTestId("rest-handled").locator("h2")).toHaveText("今天处理过的 · 1 条");
      await expect(rest.locator('[data-handled="it_queued"]')).toContainText("durable-harness");
      await expect(rest.locator('[data-handled="it_queued"]')).toContainText("在深挖队列里");
      // Marking one in the list adds it to the panel's list at once.
      await list(page).locator('[data-item="it_skip"] .actions button', { hasText: "看过了" }).click();
      await expect(rest.getByTestId("rest-handled").locator("h2")).toHaveText("今天处理过的 · 2 条");
      await expect(rest.getByTestId("today-counts").locator('[data-stat="handled"] .stat-n')).toHaveText("2");
      // A handled line opens its item, and the text of an open item is no wider than 720 px.
      await rest.locator('[data-handled="it_queued"]').click();
      await expect(page).toHaveURL(/\/item\/it_queued$/);
      await expect(panel(page).locator(".item-title")).toContainText("durable-harness");
      await expectFrame(page, width);
      expect((await box(panel(page).locator("article"))).width).toBeLessThanOrEqual(720);
      await expectFilled(page, "article");
      // With nothing handled there is no such list.
      await reset(request, { empty: true });
      await signIn(page);
      await expect(panel(page).getByTestId("today-counts")).toBeVisible();
      await expect(panel(page).getByTestId("rest-handled")).toHaveCount(0);
    });

    test("QA #24: Notes — idle, the panel shows the deep-dive queue in short beside the month card; open, the note", async ({ page }) => {
      await signIn(page, "/notes");
      const rest = panel(page).getByTestId("panel-rest");
      const queue = rest.getByTestId("queue-summary");
      await expect(queue.locator("h2")).toHaveText("深挖队列 · 3 条");
      await expectFrame(page, width);
      await expect(queue.locator("[data-state]")).toHaveText(["精读好了1", "精读中1", "等精读1"]);
      await expect(queue.locator("a")).toHaveText("看精读: 认领过期之后：重放安全的三种做法");
      // Two columns: the queue on the left, the month card beside it, both starting at the same height.
      await expectInARow(rest.locator(".panel-grid > *"), 2);
      await expect(rest.getByTestId("month-panel").getByTestId("month-counts").locator(".stat-n")).toHaveCount(4);
      await expectFilled(page, ".panel-grid > *");
      // The summary's line opens that deep read in the panel.
      await queue.locator("a").click();
      await expect(page).toHaveURL(/\/notes\?read=d2_q1$/);
      await expect(panel(page).getByRole("dialog")).toContainText("作者的结论是按内容去重最省事");
      // A note open: the frame is the same, the text within 720 px.
      await page.goto("/notes/n1");
      await expect(panel(page).locator("article.note")).toBeVisible();
      await expectFrame(page, width);
      expect((await box(panel(page).locator("article.note"))).width).toBeLessThanOrEqual(720);
      await expectFilled(page, "article.note");
    });

    test("QA #24: Daily digest — idle, the panel lists the digests by date across its width; open, the item behind a line", async ({ page }) => {
      await signIn(page, "/digest");
      const rest = panel(page).getByTestId("panel-rest");
      await expect(rest.locator(".digest-dates a")).toHaveCount(5);
      await expectFrame(page, width);
      await expect(rest.getByTestId("digest-counts").locator(".stat-n")).toHaveText(["5", "1"]);
      await expectFilled(page, ".digest-dates a");
      await list(page).locator(".card.worth h3 a").first().click();
      await expect(page).toHaveURL(/\/digest\?item=d1_w1$/);
      await expect(panel(page).locator("[data-open-item]")).toBeVisible();
      await expectFrame(page, width);
      expect((await box(panel(page).locator("article"))).width).toBeLessThanOrEqual(720);
    });

    test("QA #24: Calendar — the month with paging is on the left; the panel shows today, a chosen day with its counts and its daily digest, or the month's counts", async ({ page }) => {
      await signIn(page, "/calendar");
      const today = dayAgo(0);
      const day = panel(page).getByTestId("day-panel");
      // Nothing chosen: today, and under it the month in numbers.
      await expect(day).toHaveAttribute("data-day", today);
      await expectFrame(page, width);
      await expect(day.locator("h1")).toContainText(`${Number(today.slice(5, 7))}月${Number(today.slice(8))}日`);
      await expect(day.getByTestId("day-mark")).toHaveText("今天，存入了条目，还没有每日摘要");
      await expect(day.getByTestId("day-counts").locator(".stat-label")).toHaveText(["存入", "解读", "每日摘要", "笔记"]);
      await expect(day.getByTestId("day-counts").locator(".stat-n")).toHaveText(["7", "6", "0", "0"]);
      await expectInARow(day.getByTestId("day-counts").locator("> div"), 4);
      await expect(day.getByTestId("month-counts").locator(".stat-n")).toHaveCount(4);
      await expect(day.getByTestId("panel-close")).toHaveCount(0);
      await expect(list(page).locator(".cal-large [aria-current]")).toHaveCount(0);
      await expectFilled(page, '[data-testid="day-counts"] > div', 0.8);
      // The month is in the list column, with its paging; the grid is dots only, seven to a row.
      await expect(list(page).locator(".month-nav h1")).toBeVisible();
      await expect(list(page).locator(".month-nav a[rel=prev]")).toBeVisible();
      await expect(list(page).locator(".cal-large")).toHaveText("");
      const xs = await list(page).locator(".cal-large .cal-day").evaluateAll((els) => els.slice(0, 8).map((e) => Math.round(e.getBoundingClientRect().left)));
      expect(xs[7]).toBe(xs[0]);
      expect(new Set(xs.slice(0, 7)).size).toBe(7);

      // A day with a daily digest: its date, what happened as counts, and the digest with its actions.
      const yesterday = dayAgo(1);
      await list(page).locator(`.cal-large [data-day="${yesterday}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/calendar\\?day=${yesterday}$`));
      await expect(day).toHaveAttribute("data-day", yesterday);
      await expect(list(page).locator(`.cal-large [data-day="${yesterday}"]`)).toHaveAttribute("aria-current", "true");
      await expect(list(page).locator(".cal-large [aria-current]")).toHaveCount(1);
      await expect(day.locator("h1")).toContainText(`${Number(yesterday.slice(5, 7))}月${Number(yesterday.slice(8))}日`);
      await expect(day.getByTestId("day-mark")).toHaveText("留下了笔记");
      await expect(day.getByTestId("day-counts").locator(".stat-n")).toHaveText(["8", "7", "1", /^\d+$/]);
      await expect(day.getByTestId("month-counts")).toHaveCount(0);
      const digest = day.locator("article[data-day]");
      await expect(digest).toHaveAttribute("data-day", yesterday);
      await expect(digest.getByTestId("digest-header")).toHaveText("存入了 8 条。2 条值得深挖。");
      await expect(digest.locator('[data-part="worth"] .card')).toHaveCount(2);
      await expect(digest.locator(".card").first().locator(".actions button")).toHaveText(["深挖", "不感兴趣", "看过了"]);
      await expect(digest.locator('[data-part="question"]')).toContainText("如果只能留下今天读到的一句话");
      await expectFrame(page, width);
      await expectFilled(page, "article[data-day] > *");
      // Its actions work in the panel: a line is handled, the digest is marked read.
      await digest.locator(".card").first().locator(".actions button", { hasText: "看过了" }).click();
      await expect(digest.locator('[data-part="worth"] .card')).toHaveCount(1);
      await expect(digest.locator('[data-part="rest"] summary')).toHaveText("其余的 · 5 条");
      await digest.getByRole("button", { name: "读了，晚安" }).click();
      await expect(digest.getByRole("button", { name: "读了，晚安" })).toHaveCount(0);
      await expect(page.getByTestId("digest-unread")).toHaveCount(0);
      // A line of the digest opens its item beside that day's digest.
      await digest.locator(".card h3 a").first().click();
      await expect(page).toHaveURL(new RegExp(`/digest/${yesterday}\\?item=d1_w2$`));
      await page.goBack();

      // Reload keeps the chosen day; a day without a digest shows its counts and nothing more.
      await page.reload();
      await expect(day).toHaveAttribute("data-day", yesterday);
      const plain = dayAgo(6).startsWith(today.slice(0, 7)) ? dayAgo(6) : null;
      if (plain) {
        await list(page).locator(`.cal-large [data-day="${plain}"]`).click();
        await expect(day).toHaveAttribute("data-day", plain);
        await expect(day.getByTestId("day-counts")).toBeVisible();
        await expect(day.locator("article[data-day]")).toHaveCount(0);
        // Up and down move from day to day while the month has the focus.
        await page.keyboard.press("ArrowDown");
        await expect(day).toHaveAttribute("data-day", dayAgo(5));
        await page.keyboard.press("ArrowUp");
        await expect(day).toHaveAttribute("data-day", plain);
      }
      // "Close" (and Escape) clear the choice: today again.
      await day.getByTestId("panel-close").click();
      await expect(page).toHaveURL(/\/calendar$/);
      await expect(day).toHaveAttribute("data-day", today);

      // Another month, nothing chosen: that month's counts.
      await list(page).locator(".month-nav a[rel=prev]").click();
      const rest = panel(page).getByTestId("month-rest");
      await expect(rest).toBeVisible();
      await expect(rest.locator("h1")).toHaveText(await list(page).locator(".month-nav h1").innerText());
      await expect(rest).toContainText("在左边选一天，在这里看那一天。");
      await expect(rest.getByTestId("month-counts").locator(".stat-label")).toHaveText(["存入", "每日摘要", "读了的摘要", "笔记"]);
      await expectInARow(rest.getByTestId("month-counts").locator("> div"), 4);
      await expectFrame(page, width);
      // A day of that month can be chosen too.
      const earlier = list(page).locator(".cal-large .cal-day").nth(9);
      const date = (await earlier.getAttribute("data-day"))!;
      await earlier.click();
      await expect(page).toHaveURL(new RegExp(`/calendar/${date.slice(0, 7)}\\?day=${date}$`));
      await expect(day).toHaveAttribute("data-day", date);
      await expect(day.getByTestId("day-counts")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(new RegExp(`/calendar/${date.slice(0, 7)}$`));
      await expect(rest).toBeVisible();
    });

    test("QA #24: Assistants and Account — forms keep a readable width; short sections sit in two columns; the panel ends with its content", async ({ page }) => {
      await signIn(page, "/assistants");
      await expect(panel(page).locator('[data-section="assistants"]')).toBeVisible();
      await expectFrame(page, width);
      await page.goto("/assistants/rules");
      await expect(panel(page).locator("textarea")).toBeVisible();
      await expectFrame(page, width);
      expect((await box(panel(page).locator("textarea"))).width).toBeLessThanOrEqual(720);

      // Notifications: the switch for all devices beside this device's state.
      await page.goto("/assistants/notify");
      await expect(panel(page).getByTestId("notify-state")).toBeVisible();
      await expectInARow(panel(page).locator(".cols > *"), 2);

      // Account: language and time zone on the left; beside them signing out and the data section.
      await page.goto("/assistants/account");
      const account = panel(page).getByTestId("account");
      await expect(account.getByTestId("language")).toBeVisible();
      await expectFrame(page, width);
      await expectInARow(account.locator(".cols > *"), 2);
      const prefs = await box(account.locator('[data-part="prefs"]'));
      const session = await box(account.locator('[data-part="session"]'));
      const data = await box(account.locator('[data-part="data"]'));
      const del = await box(account.locator('[data-part="delete"]'));
      expect(session.x).toBeGreaterThan(prefs.x + prefs.width);
      expect(data.x).toBe(session.x);
      expect(data.y).toBeGreaterThan(session.y + session.height);
      // The delete area is below both columns, as wide as the panel's content, its text at a readable width.
      expect(del.y).toBeGreaterThan(Math.max(prefs.y + prefs.height, data.y + data.height));
      expect(Math.round(del.x)).toBe(Math.round(prefs.x));
      await expectFilled(page, '[data-part="delete"], .cols > *');
      const p = await box(panel(page));
      expect(data.x + data.width).toBeGreaterThanOrEqual(p.x + p.width - 37);
      expect((await box(account.getByTestId("delete-what"))).width).toBeLessThanOrEqual(520);
      expect((await box(account.getByTestId("language"))).width).toBeLessThanOrEqual(360);
      // The panel just ends: nothing is stretched to the bottom, and the section fits without an empty box under it.
      const section = await box(panel(page).locator('[data-section="account"]'));
      expect(section.height).toBeLessThanOrEqual(del.y + del.height - section.y + 81);
      // With the email typed in (the "open" state of the screenshots) the frame is the same.
      await account.locator('input[name="confirm_email"]').fill(EMAIL);
      await expect(account.getByTestId("delete-confirm")).toBeEnabled();
      await expectFrame(page, width);
    });
  });
}

test.describe("QA #24 below 1100 px", () => {
  test.use({ viewport: { width: 1000, height: 800 } });
  test.skip(({ isMobile }) => isMobile, "phones are covered by the phone project");

  test("QA #24: under 1100 px nothing changed — one column, the calendar on its own, a digest day opens the digest page", async ({ page }) => {
    await signIn(page, `/calendar?day=${dayAgo(1)}`);
    await expect(page.locator(".cal-large .cal-day").first()).toBeVisible();
    await expect(page.getByTestId("panel")).toHaveCount(0);
    await expect(page.getByTestId("day-panel")).toHaveCount(0);
    const shell = await box(page.locator(".shell"));
    expect(Math.round(shell.width)).toBe(1000);
    expect(Math.round((await box(page.locator(".main"))).width)).toBe(1000 - 212);
    // Days without a digest are not links; a day with one opens the digest page.
    expect(await page.locator(".cal-large span.cal-day").count()).toBeGreaterThan(0);
    const day = page.locator(".cal-large a.cal-day").last();
    const date = await day.getAttribute("data-day");
    await expect(day).toHaveAttribute("href", `/digest/${date}`);
    await day.click();
    await expect(page).toHaveURL(new RegExp(`/digest/${date}$`));
    // Account: one column, the same sections in order.
    await page.goto("/assistants/account");
    await expect(page.getByTestId("delete-account")).toBeVisible();
    const tops = await page.locator('[data-part="prefs"], [data-part="session"], [data-part="data"], [data-part="delete"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops).toHaveLength(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test("QA #24: on a phone the calendar and the account are one column, as before", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the phone project");
  await signIn(page, "/calendar");
  await expect(page.locator(".cal-large .cal-day").first()).toBeVisible();
  await expect(page.getByTestId("panel")).toHaveCount(0);
  expect(await page.locator(".cal-large span.cal-day").count()).toBeGreaterThan(0);
  await page.goto("/assistants/account");
  await expect(page.getByTestId("delete-account")).toBeVisible();
  const parts = await page.locator('[data-part="prefs"], [data-part="session"], [data-part="data"], [data-part="delete"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y) })));
  expect(parts).toHaveLength(4);
  expect(new Set(parts.map((p) => p.x)).size).toBe(1);
  expect([...parts].sort((a, b) => a.y - b.y)).toEqual(parts);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// ---------------------------------------------------------------- QA #25

/** Presses a button that saves a file, and gives back the file's name and text. */
async function download(page: Page, button: Locator): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent("download"), button.click()]);
  return { name: file.suggestedFilename(), text: fs.readFileSync((await file.path())!, "utf8") };
}

test.describe("QA #25: the account's data and deleting the account", () => {
  test("QA #25: Account says what the download holds and what it does not, and “Download my data” saves the export as keepessence-export-YYYY-MM-DD.json", async ({ page }) => {
    await signIn(page, "/assistants/account");
    const data = page.getByTestId("your-data");
    await expect(data.getByTestId("data-in")).toHaveText("下载的文件里有：你的规则和各项选择、每一份每日摘要、每一篇笔记连同出处和来源、每一条还在的条目连同解读和标签。");
    await expect(data.getByTestId("data-out")).toHaveText("里面没有：已经删除的条目，和文件本身的内容。文件只列出名称、类型和大小，要到它所在的条目里单独下载。");
    const file = await download(page, data.getByTestId("download-data"));
    expect(file.name).toBe(`keepessence-export-${dayAgo(0)}.json`);
    // The file is the core's document, unchanged.
    const doc = JSON.parse(file.text);
    expect(Object.keys(doc)).toEqual(["version", "exported_at", "contents", "account", "settings", "digests", "notes", "items", "files"]);
    expect(doc.account.email).toBe(EMAIL);
    expect(doc.settings.rules).toContain("讲工程实践的长文交给阿读");
    expect(doc.digests).toHaveLength(5);
    expect(doc.notes.map((n: { id: string }) => n.id).sort()).toEqual(["n1", "n2", "n3", "n4"]);
    expect(doc.items.length).toBe((await state(page.request)).counts.items);
    expect(doc.items.find((i: { id: string }) => i.id === "it_worth").analysis.verdict).toBe("worth_deep_dive");
    expect(doc.items.find((i: { id: string }) => i.id === "it_worth").tags).toContain("source:web");
    expect(doc.contents.files).toContain("单独下载");
    await expect(data.getByTestId("downloaded")).toHaveText(`已下载：${file.name}`);
    await expect(page.locator(".said")).toContainText(file.name);
  });

  test("QA #25: “Download my notes” saves every note as one Markdown file, made in the browser from the export", async ({ page, request }) => {
    await signIn(page, "/assistants/account");
    const exports: string[] = [];
    page.on("request", (r) => r.url().endsWith("/v1/export") && exports.push(r.method()));
    const file = await download(page, page.getByTestId("download-notes"));
    expect(file.name).toBe(`keepessence-notes-${dayAgo(0)}.md`);
    expect(exports).toEqual(["GET"]);
    // Newest first, each with its title as a heading, its date, assistant, origin, sources and text.
    const titles = file.text.split("\n").filter((l) => l.startsWith("# "));
    expect(titles).toEqual(["# 一份活只归一个人：认领、租约、重放", "# 评审意见的写法", "# 向量检索的边界", "# 设计文档的开头只回答三个问题"]);
    const notes = file.text.split("\n---\n\n<!-- next note -->\n\n");
    expect(notes).toHaveLength(4);
    // The note was written 26 hours ago; its date is the day in the account's time zone.
    expect(notes[0]).toContain(`- 日期: ${new Date(Date.now() + (8 - 26) * 3600e3).toISOString().slice(0, 10)}`);
    expect(notes[0]).toContain("- 助手: 阿深");
    expect(notes[0]).toContain(`- 来自: [一次线上事故的完整复盘](https://read.example.com/d2_w1) · 出自 ${dayAgo(2)} 的每日摘要`);
    expect(notes[0]).toContain("- 出处:\n  - [Leases in job queues](https://blog.example.dev/leases)\n  - [Durable harness: intent, effect, result](https://code.example.com/example/durable-harness)");
    expect(notes[0]).toContain("三件事缺一件，另外两件都白做。\n\n## 结论\n\n1. 租约定 30 分钟");
    expect(notes[2]).toContain("- 助手: 阿深 (由用户交回)");
    // A source without an address is a plain line.
    expect(notes[3]).toContain("  - 写好一份设计文档的开头\n");
    expect(file.text.startsWith("<!-- 笔记: 4 · ")).toBe(true);

    // With no notes there is nothing to save, and the page says so.
    await reset(request, { empty: true });
    await signIn(page, "/assistants/account");
    let saved = false;
    page.on("download", () => (saved = true));
    await page.getByTestId("download-notes").click();
    await expect(page.locator(".said")).toHaveText("还没有笔记可下载。");
    expect(saved).toBe(false);
  });

  test("QA #25: “Delete my account” is red, asks for the account's email, and stays disabled until it matches", async ({ page, request }) => {
    await signIn(page, "/assistants/account");
    const zone = page.getByTestId("delete-account");
    await expect(zone.locator("h3")).toHaveText("删除我的账户");
    await expect(zone.getByTestId("delete-what")).toHaveText("这会删除你的账户和里面的一切：条目、解读、每日摘要、笔记、文件、设备和助手。删除后不能恢复。");
    await expect(zone).toContainText("想留下什么，请先下载你的数据。");
    // Red, from the token for what loses data: the sentence, the line above the area, the button.
    const danger = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--ke-danger)";
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    });
    const css = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
    expect(await css(zone.getByTestId("delete-what"), "color")).toBe(danger);
    expect(await css(zone, "border-top-color")).toBe(danger);
    expect(await css(zone.getByTestId("delete-confirm"), "background-color")).toBe(danger);
    // The data section above it is not red.
    expect(await css(page.getByTestId("data-in"), "color")).not.toBe(danger);

    const button = zone.getByTestId("delete-confirm");
    const field = zone.locator('input[name="confirm_email"]');
    await expect(field).toHaveValue("");
    await expect(button).toBeDisabled();
    await field.fill("someone-else@example.com");
    await expect(button).toBeDisabled();
    await expect(zone.getByTestId("delete-mismatch")).toHaveText("和这个账户的邮箱不一致。");
    await field.fill(EMAIL.slice(0, -1));
    await expect(button).toBeDisabled();
    // Pressing Enter in the field while it does not match deletes nothing.
    await field.press("Enter");
    expect((await state(request)).deleted_account).toBeNull();
    await field.fill(`  ${EMAIL.toUpperCase()} `);
    await expect(button).toBeEnabled();
    await expect(zone.getByTestId("delete-mismatch")).toHaveCount(0);
    expect((await state(request)).counts.notes).toBe(4);
  });

  test("QA #25: deleting the account clears the browser's session, and the sign-in page says in one sentence that it is deleted; the email can join again as new", async ({ page, request }) => {
    await signIn(page, "/assistants/account");
    const cred = await credentialOf(page);
    expect(cred.length).toBeGreaterThan(10);
    const sent: { method: string; body: string | null }[] = [];
    page.on("request", (r) => r.url().endsWith("/v1/account") && sent.push({ method: r.method(), body: r.postData() }));
    await page.locator('input[name="confirm_email"]').fill(EMAIL);
    await page.getByTestId("delete-confirm").click();

    // The sign-in page, with the one sentence; nothing of the session is left in the browser.
    await expect(page.getByTestId("account-deleted")).toHaveText("你的账户和里面的一切都已删除。");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(await credentialOf(page)).toBe("");
    expect(sent).toEqual([{ method: "DELETE", body: JSON.stringify({ confirm_email: EMAIL }) }]);
    // The core has deleted it: the old credential is refused, and everything is gone.
    expect((await request.get("/v1/devices/me", { headers: { Authorization: `Bearer ${cred}` } })).status()).toBe(401);
    const after = await state(request);
    expect(after.deleted_account.email).toBe(EMAIL);
    expect(after.counts).toMatchObject({ items: 0, notes: 0, digests: 0, queue: 0 });
    // A reload does not bring the session back.
    await page.reload();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    expect(await credentialOf(page)).toBe("");

    // Invited again, the same email signs in to a new, empty account; the sentence is gone.
    await signIn(page, "/");
    await expect(page.getByTestId("today-empty")).toBeVisible();
    await expect(page.getByTestId("account-deleted")).toHaveCount(0);
    expect((await credentialOf(page)).length).toBeGreaterThan(10);
    expect(await credentialOf(page)).not.toBe(cred);
  });

  test("QA #25: when the core refuses the deletion, the page says why and the account and the session stay", async ({ page, request }) => {
    await signIn(page, "/assistants/account");
    await request.post("/__test/fail-next", { data: { method: "DELETE", path: "^/v1/account$" } });
    await page.locator('input[name="confirm_email"]').fill(EMAIL);
    await page.getByTestId("delete-confirm").click();
    await expect(page.getByTestId("delete-account").getByRole("alert")).toHaveText("核心出了问题。");
    await expect(page.getByTestId("account-deleted")).toHaveCount(0);
    expect((await credentialOf(page)).length).toBeGreaterThan(10);
    expect((await state(request)).deleted_account).toBeNull();
    await expect(page.getByTestId("delete-confirm")).toBeEnabled();
  });

  test("QA #25: a device without the manage tier has no Account page, and the core refuses both calls with 403", async ({ page, request }) => {
    await signIn(page, "/assistants/account");
    const cred = await credentialOf(page);
    const headers = { Authorization: `Bearer ${cred}` };
    expect((await request.post("/__test/set-tier", { headers, data: { tier: "read" } })).ok()).toBe(true);
    expect((await request.get("/v1/export", { headers })).status()).toBe(403);
    expect((await request.delete("/v1/account", { headers, data: { confirm_email: EMAIL } })).status()).toBe(403);
    expect((await request.get("/v1/settings", { headers })).ok()).toBe(true);
    expect((await (await request.get("/v1/settings", { headers })).json()).email).toBeUndefined();
    await page.goto("/assistants/account");
    await expect(page.locator('[data-entry="today"]')).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("delete-account")).toHaveCount(0);
    await expect(page.locator('[data-entry="assistants"]')).toHaveCount(0);
    expect((await state(request)).deleted_account).toBeNull();
  });
});

// ---------------------------------------------------------------- QA #26

const SUMMARY = "这是一份刚交回的解读，内容是编的。";
/** How the item's own requests are counted: the page asks `GET /v1/items/{id}`. */
function countItemRequests(page: Page, id: string) {
  const seen = { n: 0 };
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === `/v1/items/${id}`) seen.n++;
  });
  return seen;
}
const hide = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

test.describe("QA #26: an analysis that lands shows without a reload", () => {
  test("QA #26: the open item shows its analysis when it lands — in place, about 15 seconds later, keeping the scroll position and an open choice", async ({ page, request, isMobile }) => {
    await page.clock.install();
    // A short window, so that the item is longer than the screen and can be scrolled.
    await page.setViewportSize(isMobile ? { width: 412, height: 520 } : { width: 1280, height: 520 });
    await signIn(page, "/item/it_triaged");
    const item = page.locator('[data-open-item="it_triaged"]');
    await expect(item.locator("section", { hasText: "解读" }).last()).toContainText("还没解读");
    await expect(item.getByTestId("kept-for")).toBeEnabled();
    // A mark on the page that a reload would wipe, an open choice (the delete question), and a scroll position.
    await page.evaluate(() => ((window as unknown as { stayed: boolean }).stayed = true));
    await item.getByRole("button", { name: "删除" }).click();
    await expect(item.locator(".confirm")).toBeVisible();
    const scroller = isMobile ? "html" : '[data-testid="panel"]';
    const scrollTop = () => page.locator(scroller).evaluate((el) => (el === document.documentElement ? window.scrollY : el.scrollTop));
    await page.locator(scroller).evaluate((el) => (el === document.documentElement ? window.scrollTo(0, 99999) : (el.scrollTop = 99999)));
    const before = await scrollTop();
    expect(before).toBeGreaterThan(40);
    const asked = countItemRequests(page, "it_triaged");

    // The assistant hands the analysis in. Nothing is pressed.
    expect((await request.post("/__test/analyse", { data: { item_id: "it_triaged" } })).ok()).toBe(true);
    await page.clock.fastForward(5000);
    await expect(item).toContainText("还没解读");
    expect(asked.n).toBe(0);
    await page.clock.fastForward(11000);
    await expect(item.locator(".summary")).toHaveText(SUMMARY);
    await expect(item).not.toContainText("还没解读");
    await expect(item.locator(".actions button")).toHaveText(["深挖", "不感兴趣", "看过了"]);
    // The same page: not reloaded, the delete question still open, still scrolled down.
    expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
    await expect(item.locator(".confirm")).toBeVisible();
    expect(await scrollTop()).toBeGreaterThanOrEqual(before);
    await expect(page).toHaveURL(/\/item\/it_triaged$/);
    if (!isMobile) {
      // Beside the list: the item moved up into the analyses there as well.
      await expect(page.getByTestId("split-list").locator('.card[data-item="it_triaged"]')).toBeVisible();
      await expect(page.getByTestId("split-list").locator('.waiting[data-item="it_triaged"]')).toHaveCount(0);
    }

    // Analysed: the page stops asking.
    await page.waitForLoadState("networkidle");
    const settled = asked.n;
    await page.clock.fastForward(60000);
    await page.waitForLoadState("networkidle");
    expect(asked.n).toBe(settled);
  });

  test("QA #26: a waiting item is asked for only while the tab is visible, at once when the tab comes back, and no longer after 20 minutes", async ({ page, request }) => {
    await page.clock.install();
    await signIn(page, "/item/it_saved");
    const item = page.locator('[data-open-item="it_saved"]');
    await expect(item).toContainText("还没解读");
    await page.waitForLoadState("networkidle");
    const asked = countItemRequests(page, "it_saved");
    // Visible: one quiet request per 15 seconds, and the page does not flicker into "loading".
    await page.clock.fastForward(15500);
    await expect.poll(() => asked.n).toBe(1);
    await expect(item.locator('[aria-busy="true"]')).toHaveCount(0);
    await page.clock.fastForward(15000);
    await expect.poll(() => asked.n).toBe(2);

    // Hidden: nothing is asked.
    await hide(page, true);
    await page.clock.fastForward(15000);
    await page.clock.fastForward(15000);
    await page.clock.fastForward(15000);
    expect(asked.n).toBe(2);
    // The analysis lands while the tab is hidden; coming back shows it at once, without waiting for the interval.
    expect((await request.post("/__test/analyse", { data: { item_id: "it_saved" } })).ok()).toBe(true);
    await hide(page, false);
    await expect(item.locator(".summary")).toHaveText(SUMMARY);
    expect(asked.n).toBeGreaterThanOrEqual(3);

    // Another item that nobody analyses: after 20 minutes the page stops asking on its own.
    await page.goto("/item/it_triaged");
    const other = page.locator('[data-open-item="it_triaged"]');
    await expect(other).toContainText("还没解读");
    await page.waitForLoadState("networkidle");
    const again = countItemRequests(page, "it_triaged");
    await page.clock.fastForward(15500);
    await expect.poll(() => again.n).toBe(1);
    await page.clock.fastForward("21:00");
    await page.waitForLoadState("networkidle");
    const settled = again.n;
    for (let i = 0; i < 4; i++) await page.clock.fastForward(15000);
    await page.waitForLoadState("networkidle");
    expect(again.n).toBe(settled);
    // Coming back to the tab still asks once.
    await hide(page, true);
    await hide(page, false);
    await expect.poll(() => again.n).toBe(settled + 1);
  });

  test("QA #26: a failed quiet request changes nothing on the page", async ({ page, request }) => {
    await page.clock.install();
    await signIn(page, "/item/it_triaged");
    const item = page.locator('[data-open-item="it_triaged"]');
    await expect(item).toContainText("还没解读");
    await page.waitForLoadState("networkidle");
    await request.post("/__test/fail-next", { data: { method: "GET", path: "^/v1/items/it_triaged$" } });
    const failed = page.waitForResponse((r) => new URL(r.url()).pathname === "/v1/items/it_triaged" && r.status() === 500);
    await page.clock.fastForward(15500);
    await failed;
    await expect(item.locator(".item-title")).toContainText("读书会备忘");
    await expect(item).toContainText("还没解读");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".said")).toHaveCount(0);
    // The next one works again.
    await request.post("/__test/analyse", { data: { item_id: "it_triaged" } });
    await page.clock.fastForward(15000);
    await expect(item.locator(".summary")).toHaveText(SUMMARY);
  });

  test("QA #26: Today moves a waiting item up into the analyses when its analysis lands; what is typed in the inbox stays", async ({ page, request, isMobile }) => {
    await page.clock.install();
    await signIn(page);
    const waiting = page.locator('.waiting[data-item="it_triaged"]');
    await expect(waiting).toBeVisible();
    await expect(page.locator("section", { hasText: "还没解读的条目" }).locator("h2")).toContainText("现有 2 条");
    await page.evaluate(() => ((window as unknown as { stayed: boolean }).stayed = true));
    const inbox = page.locator(".inbox-box");
    await inbox.fill("写到一半的话");

    expect((await request.post("/__test/analyse", { data: { item_id: "it_triaged" } })).ok()).toBe(true);
    await page.clock.fastForward(15500);
    const card = page.locator('.card[data-item="it_triaged"]');
    await expect(card.locator(".summary")).toHaveText(SUMMARY);
    await expect(waiting).toHaveCount(0);
    await expect(page.locator("section", { hasText: "还没解读的条目" }).locator("h2")).toContainText("现有 1 条");
    await expect(inbox).toHaveValue("写到一半的话");
    expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
    // The numbers beside the list follow (wide screens: the panel's counts).
    if (!isMobile) await expect(page.getByTestId("today-counts").locator('[data-stat="waiting"] .stat-n')).toHaveText("1");

    // With nothing waiting the list no longer asks.
    expect((await request.post("/__test/analyse", { data: { item_id: "it_saved" } })).ok()).toBe(true);
    await page.clock.fastForward(15500);
    await expect(page.locator('.card[data-item="it_saved"]')).toBeVisible();
    await page.waitForLoadState("networkidle");
    let lists = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/v1/items") lists++;
    });
    for (let i = 0; i < 4; i++) await page.clock.fastForward(15000);
    await page.waitForLoadState("networkidle");
    expect(lists).toBe(0);
    await expect(inbox).toHaveValue("写到一半的话");
  });

  test("QA #26: the service worker's “refresh” message makes the open item ask again at once", async ({ page, request }) => {
    await page.clock.install();
    await signIn(page, "/item/it_triaged");
    const item = page.locator('[data-open-item="it_triaged"]');
    await expect(item).toContainText("还没解读");
    await page.waitForLoadState("networkidle");
    expect((await request.post("/__test/analyse", { data: { item_id: "it_triaged" } })).ok()).toBe(true);
    // What public/sw.js posts to an open, focused page when a notification arrives.
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "refresh" } })));
    await expect(item.locator(".summary")).toHaveText(SUMMARY);
    await expect(item).not.toContainText("还没解读");
  });
});
