// The internal QA issues #7 to #16, one or more tests each, named after the issue.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn, openInbox } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

const keptFor = (page: Page) => page.getByTestId("kept-for");
const analysedBy = (page: Page) => page.getByTestId("analysed-by");
const header = (page: Page) => page.locator("article header .quiet");
// Rule A6 (QA #94): the internal tag strings are never shown to the user.
const noRawTags = (page: Page) => expect(page.locator("article")).not.toContainText(/\b(assistant|expiry|source):/);
const setTier = async (page: Page, request: APIRequestContext, tier: string) =>
  request.post("/__test/set-tier", { data: { tier }, headers: { Authorization: `Bearer ${await credentialOf(page)}` } });

test("QA #7: one retention control; what the user set survives triage; header and control always agree", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/item/it_saved");
  // One control: the user's days, then "never" as the last choice. No separate button to mistake for "save".
  // Not sorted yet: nothing is decided (QA #32), and the choices are the user's days and "never".
  await expect(keptFor(page)).toHaveValue("");
  await expect(keptFor(page).locator("option")).toHaveText(["初筛时定", "7 天", "30 天", "90 天", "365 天", "收藏（不过期）"]);
  await expect(page.getByRole("button", { name: /收藏|Keep/ })).toHaveCount(0);

  // The user sets only who analyses it, before triage has run. One sentence says both values.
  await analysedBy(page).selectOption({ label: "阿读" });
  await expect(page.locator(".said")).toHaveText(/交给 阿读。 保留 30 天，到 .+ 删除。/);
  // Triage comes later and would have said the built-in assistant and 7 days: neither value moves.
  await request.post("/__test/triage", { data: { item_id: "it_saved", assistant_id: "as_builtin", expiry_days: 7 } });
  await page.reload();
  await expect(analysedBy(page)).toHaveValue("as_adu");
  await expect(keptFor(page)).toHaveValue("30");
  await expect(header(page)).toContainText("还剩 30 天");
  await noRawTags(page);

  // Never delete: said in one sentence; the header agrees.
  await keptFor(page).selectOption("never");
  await expect(page.locator(".said")).toHaveText("收藏了，不过期。");
  await expect(header(page)).toContainText("收藏了，不过期");
  await expect(keptFor(page)).toHaveValue("never");
  await noRawTags(page);

  // Choosing days on a kept item gives it an end date: the sentence names the days and the day.
  await keptFor(page).selectOption("90");
  await expect(page.locator(".said")).toHaveText(/^保留 90 天，到 .*\d+月\d+日 删除。$/);
  await expect(header(page)).toContainText("还剩 90 天");
  await expect(header(page)).not.toContainText("不过期");
  await expect(keptFor(page)).toHaveValue("90");
  await noRawTags(page);

  // It stays so after a reload.
  await page.reload();
  await expect(keptFor(page)).toHaveValue("90");
  await expect(header(page)).toContainText("还剩 90 天");
  await noRawTags(page);
});

test("QA #7: without the manage tier the button says what it does, never a bare Keep", async ({ page, request }) => {
  await signIn(page);
  await setTier(page, request, "read");
  await page.goto("/item/it_worth");
  await expect(keptFor(page)).toHaveCount(0);
  await page.getByRole("button", { name: "收藏（不过期）", exact: true }).click();
  await expect(page.locator(".said")).toHaveText("收藏了，不过期。");
  await expect(header(page)).toContainText("收藏了，不过期");
  await page.getByRole("button", { name: "改回有期限", exact: true }).click();
  await expect(page.locator(".said")).toHaveText(/^保留 30 天，到 .+ 删除。$/);
  await expect(header(page)).toContainText("还剩 30 天");
});

test("QA #8: the item page always shows the current state, the way back and the other actions", async ({ page }) => {
  await signIn(page);
  await page.goto("/item/it_know");
  const state = page.getByTestId("item-state");
  const actions = page.locator("article .actions button");
  await expect(state).toHaveCount(0);
  await expect(actions).toHaveText(["深挖", "不感兴趣", "看过了"]);

  await actions.filter({ hasText: "看过了" }).click();
  await expect(state).toContainText("看过了");
  await expect(actions).toHaveText(["深挖", "不感兴趣"]);
  // It can be changed from here.
  await actions.filter({ hasText: "不感兴趣" }).click();
  await expect(state).toContainText("不感兴趣");
  await expect(actions).toHaveText(["深挖", "看过了"]);
  await page.reload();
  await expect(state).toContainText("不感兴趣");
  await state.getByRole("button", { name: "挽回" }).click();
  await expect(state).toHaveCount(0);
  await expect(actions).toHaveText(["深挖", "不感兴趣", "看过了"]);

  // The deep-dive queue is a state too, with its own way back.
  await actions.filter({ hasText: "深挖" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "加入深挖队列" }).click();
  await expect(state).toContainText("在深挖队列里");
  await expect(actions).toHaveText(["不感兴趣", "看过了"]);
  await state.getByRole("button", { name: "移出队列" }).click();
  await expect(page.locator(".said")).toContainText("已移出队列。");
  await expect(state).toHaveCount(0);

  // On Today a handled analysis still leaves the list, with one sentence and Restore.
  await page.goto("/");
  await page.locator('[data-item="it_know"] .actions button', { hasText: "看过了" }).click();
  await expect(page.locator('.card[data-item="it_know"]')).toHaveCount(0);
  await expect(page.locator(".said")).toContainText("标了看过了。");
  await expect(page.locator(".said button", { hasText: "挽回" })).toBeVisible();
});

test("QA #9: Analysed by never offers None, and shows the current assistant from the first render", async ({ page }) => {
  await signIn(page);
  // The list of assistants arrives late: the control is already there with the current one.
  await page.route("**/v1/assistants", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await page.goto("/item/it_worth");
  await expect(analysedBy(page)).toHaveValue("as_builtin");
  await expect(analysedBy(page).locator("option:checked")).toHaveText("内置助手");
  await expect(analysedBy(page)).toBeDisabled();
  // Then it holds every assistant that can analyse: no chat assistant, and no "None".
  await expect(analysedBy(page)).toBeEnabled();
  await expect(analysedBy(page).locator("option")).toHaveText(["内置助手", "阿读"]);

  // Before dispatch nobody has it: that is shown as a state that cannot be chosen.
  await page.goto("/item/it_saved");
  await expect(analysedBy(page)).toBeEnabled();
  await expect(analysedBy(page).locator("option")).toHaveText(["还没分派", "内置助手", "阿读"]);
  await expect(analysedBy(page).locator("option").first()).toBeDisabled();
  await expect(analysedBy(page).locator("option:checked")).toHaveText("还没分派");
  await analysedBy(page).selectOption({ label: "内置助手" });
  await expect(analysedBy(page).locator("option")).toHaveText(["内置助手", "阿读"]);
});

test("QA #10: handled analyses are listed under Today, collapsed, each restorable; a calendar day with a digest opens it", async ({ page, isMobile }) => {
  await signIn(page);
  const handled = page.locator('[data-part="handled"]');
  // The seed has one item in the deep-dive queue.
  await expect(handled.locator("summary")).toHaveText("今天处理过的 · 1 条");
  await expect(handled.locator("details")).not.toHaveAttribute("open", "");
  await page.locator('[data-item="it_know"] .actions button', { hasText: "看过了" }).click();
  await page.locator('[data-item="it_skip"] .actions button', { hasText: "不感兴趣" }).click();
  await expect(handled.locator("summary")).toHaveText("今天处理过的 · 3 条");

  await handled.locator("summary").click();
  const line = handled.locator('.rest-line[data-handled="it_know"]');
  await expect(line).toContainText("十分钟看懂向量检索");
  await expect(line).toContainText("看过了");
  await expect(handled.locator('.rest-line[data-handled="it_skip"]')).toContainText("不感兴趣");
  await expect(handled.locator('.rest-line[data-handled="it_queued"]')).toContainText("在深挖队列里");
  // A line opens the item, where the state can be changed; and it can be restored right here.
  await expect(line.locator("a")).toHaveAttribute("href", "/item/it_know");
  await line.getByRole("button", { name: "挽回" }).click();
  await expect(page.locator('.card[data-item="it_know"]')).toBeVisible();
  await expect(handled.locator("summary")).toHaveText("今天处理过的 · 2 条");

  // It is still there after signing in afresh on a reload.
  await page.reload();
  await expect(handled.locator("summary")).toHaveText("今天处理过的 · 2 条");

  // The calendar: a day that has a daily digest opens that day's digest.
  // On a wide screen the digest opens beside the month (QA #24); on a narrow one as its own page.
  await page.goto("/calendar");
  const day = page.locator(".cal-large a.cal-day.mark-digest_unread, .cal-large a.cal-day.mark-digest_read").last();
  const date = await day.getAttribute("data-day");
  await day.click();
  await expect(page).toHaveURL(new RegExp(isMobile ? `/digest/${date}$` : `/calendar\\?day=${date}$`));
  await expect(page.locator("article[data-day]")).toHaveAttribute("data-day", date!);
});

test("QA #11: every action gives one sentence, and counts follow at once; cumulative counts say so", async ({ page, isMobile }) => {
  await signIn(page);
  const status = page.locator(".page-head .status");
  await expect(status).toContainText("2 条在等");
  await expect(page.locator("section", { hasText: "还没解读的条目" }).locator("h2")).toContainText("现有 2 条");
  const analyses = page.locator("section", { hasText: "新的在前" }).first().locator("h2");
  await expect(analyses).toContainText("现有 4 条");

  // Seen, and its restore, each say one sentence; the count next to the list follows.
  await page.locator('[data-item="it_know"] .actions button', { hasText: "看过了" }).click();
  await expect(page.locator(".said")).toContainText("标了看过了。");
  await expect(analyses).toContainText("现有 3 条");
  await page.locator(".said button", { hasText: "挽回" }).click();
  await expect(page.locator(".said")).toHaveText("已挽回。");
  await expect(analyses).toContainText("现有 4 条");

  // Delete: one sentence; "waiting" and the list count drop at once. "Saved today" counts saves,
  // so it stays, and says so.
  await page.goto("/item/it_triaged");
  await page.getByRole("button", { name: "删除" }).click();
  await page.locator(".confirm").getByRole("button", { name: "删除" }).click();
  await expect(page.locator(".said")).toHaveText("已删除。");
  await expect(page).toHaveURL(/\/$/);
  await expect(status).toContainText("1 条在等");
  await expect(status).toContainText("今天存入了 7 条");
  await expect(page.locator("section", { hasText: "还没解读的条目" }).locator("h2")).toContainText("现有 1 条");
  const hint = isMobile ? status : status.locator(".status-cell .quiet").first();
  await expect(hint).toHaveAttribute("title", "今天存入过几条。之后删除条目，这个数不变。");

  // The calendar states the same rule in words.
  await page.goto("/calendar");
  await expect(page.locator(".calendar-page")).toContainText("之后删除条目，圆点和数字都不变。");
});

test("QA #12: a switch moves at once, shows it is waiting, and goes back with a reason when the core refuses", async ({ page, request }) => {
  await signIn(page, "/assistants/notify");
  const sw = page.getByRole("switch", { name: "通知" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await request.post("/__test/delay", { data: { ms: 1500 } });
  await sw.click();
  // At once: the new position, busy, not pressable. No old state in between.
  await expect(sw).toHaveAttribute("aria-checked", "false", { timeout: 700 });
  await expect(sw).toHaveAttribute("aria-busy", "true", { timeout: 700 });
  await expect(sw).toBeDisabled();
  await expect(sw).toHaveAttribute("aria-busy", "false");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".said")).toHaveText("通知已关闭。");

  // Refused: it goes back to where it was and one sentence says why.
  await request.post("/__test/fail-next", { data: { method: "PATCH", path: "^/v1/settings$" } });
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 700 });
  await expect(page.locator(".said.bad")).toBeVisible();
  await expect(sw).toHaveAttribute("aria-busy", "false");
  await expect(sw).toHaveAttribute("aria-checked", "false");

  // The calendar image address switch behaves the same way.
  await page.goto("/assistants/calendar");
  const image = page.getByRole("switch", { name: "图片地址" });
  await image.click();
  await expect(image).toHaveAttribute("aria-checked", "true", { timeout: 700 });
  await expect(image).toHaveAttribute("aria-busy", "true", { timeout: 700 });
  await expect(page.getByTestId("calendar-address")).toBeVisible();
  await expect(image).toHaveAttribute("aria-busy", "false");
});

test("QA #12: a verdict action shows and says its result at once, and is taken back when the core refuses", async ({ page, request }) => {
  await signIn(page);
  await expect(page.locator('.card[data-item="it_know"]')).toBeVisible();
  await request.post("/__test/delay", { data: { ms: 1500 } });
  await page.locator('[data-item="it_know"] .actions button', { hasText: "看过了" }).click();
  await expect(page.locator('.card[data-item="it_know"]')).toHaveCount(0, { timeout: 700 });
  await expect(page.locator(".said")).toContainText("标了看过了。", { timeout: 700 });
  await request.post("/__test/delay", { data: { ms: 0 } });

  await request.post("/__test/fail-next", { data: { method: "PUT", path: "^/v1/items/it_skip/signal$" } });
  await page.locator('[data-item="it_skip"] .actions button', { hasText: "不感兴趣" }).click();
  await expect(page.locator(".said.bad")).toBeVisible();
  await expect(page.locator('.card[data-item="it_skip"]')).toBeVisible();

  // A select that waits on the core is busy and not pressable until the answer.
  await page.goto("/item/it_worth");
  await expect(keptFor(page)).toBeEnabled();
  await request.post("/__test/delay", { data: { ms: 1500 } });
  await keptFor(page).selectOption("90");
  await expect(keptFor(page)).toHaveAttribute("aria-busy", "true", { timeout: 700 });
  await expect(keptFor(page)).toBeDisabled();
  await expect(page.locator(".said")).toContainText("保留 90 天");
  await expect(keptFor(page)).toBeEnabled();
});

test("QA #13: with no assistant for deep reads or deep dives, the dialog says what queueing does and hides Go now", async ({ page, request }) => {
  await reset(request, { no_deep: true });
  await signIn(page);
  await page.locator('[data-item="it_worth"] .actions button', { hasText: "深挖" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "加入深挖队列" })).toBeVisible();
  await expect(sheet.getByTestId("queue-hint")).toContainText("还没有能精读或深挖的助手");
  await expect(sheet.getByTestId("queue-hint")).toContainText("在队列里期间它不会删除");
  await expect(sheet.getByTestId("queue-hint")).toContainText("没有人会读它");
  // "Go now" is not there at all, and nothing claims a deep read will happen.
  await expect(sheet.getByRole("button", { name: "开始深挖" })).toHaveCount(0);
  await expect(sheet.getByRole("radio")).toHaveCount(0);
  await expect(sheet).not.toContainText("精读助手下次来时");
  await expect(sheet.getByRole("link", { name: "接入一个助手" })).toHaveAttribute("href", "/assistants/connect");

  // Queueing still works.
  await sheet.getByRole("button", { name: "加入深挖队列" }).click();
  await expect(page.locator(".said")).toContainText("已加入深挖队列。");
  await page.goto("/notes");
  await expect(page.locator('.queue-row[data-item="it_worth"] .state')).toHaveText("在队列里。还没有助手做精读");

  // A device without the manage tier is not sent to a page it cannot open.
  await setTier(page, request, "read");
  await page.goto("/");
  await page.locator('[data-item="it_know"] .actions button', { hasText: "深挖" }).click();
  await expect(page.getByRole("dialog").getByTestId("queue-hint")).toContainText("还没有能精读或深挖的助手");
  await expect(page.getByRole("dialog").getByRole("link", { name: "接入一个助手" })).toHaveCount(0);
});

test("QA #13: with assistants for both, the dialog is as before", async ({ page }) => {
  await signIn(page);
  await page.locator('[data-item="it_worth"] .actions button', { hasText: "深挖" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByTestId("queue-hint")).toContainText("精读助手下次来时先精读这一条");
  await expect(sheet.getByRole("button", { name: "开始深挖" })).toBeVisible();
  await expect(sheet).not.toContainText("还没有能深挖的助手");
});

test("QA #14: a product that is not verified has no tab, only one line that names it", async ({ page }) => {
  await signIn(page, "/assistants/connect");
  await expect(page.getByRole("tab")).toHaveText(["Claude", "ChatGPT", "Gemini", "自己部署的 agent"]);
  await expect(page.getByRole("tab", { name: "Muse" })).toHaveCount(0);
  await expect(page.getByTestId("not-verified")).toHaveText("另外这些产品还没验证过接入步骤，所以没有列出：Muse。");
  // Every tab that is there has real steps.
  for (const name of ["Claude", "ChatGPT", "Gemini", "自己部署的 agent"]) {
    await page.getByRole("tab", { name }).click();
    expect(await page.locator(".guide-steps li").count()).toBeGreaterThanOrEqual(3);
  }
});

test("QA #15: the calendar pages by month with the month named, digest days open, and a day says its date", async ({ page, isMobile }) => {
  await signIn(page, "/calendar");
  const nav = page.locator(".month-nav");
  const month = (await page.locator("[data-month]").getAttribute("data-month"))!;
  const [y, m] = month.split("-").map(Number);
  await expect(nav.locator("h1")).toHaveText(`${y}年${m}月`);
  // This month: there is no later month, and the control says so instead of vanishing.
  await expect(nav.locator('[rel="next"], [aria-disabled="true"]').last()).toHaveAttribute("aria-disabled", "true");
  await expect(nav.locator('[aria-disabled="true"]')).toHaveAttribute("title", "没有更晚的月份");

  // Today is named without pointing at anything.
  const readout = page.getByTestId("cal-readout");
  await expect(readout).toContainText("今天，");
  // Any day says its date on hover or focus.
  const first = page.locator(".cal-large .cal-day").first();
  if (isMobile) await first.focus();
  else await first.hover();
  await expect(readout).toHaveText(new RegExp(`^${m}月1日: `));
  await expect(first).toHaveAttribute("title", new RegExp(`^${m}月1日: `));

  // A day with a daily digest can be pressed, and its label carries the date. On a wide screen
  // (QA #24) every day can be chosen and shows beside the month, so the label is the day itself.
  const day = page.locator(".cal-large a.cal-day.mark-digest_unread, .cal-large a.cal-day.mark-digest_read").last();
  const date = (await day.getAttribute("data-day"))!;
  await expect(day).toHaveAttribute("aria-label", new RegExp(`${Number(date.slice(5, 7))}月${Number(date.slice(8))}日${isMobile ? ".*打开这天的每日摘要" : ": 有每日摘要|: 每日摘要读了"}`));

  // By design the grid is dots only: seven to a row by date, no weekday columns, no printed numbers.
  await expect(page.locator(".cal-large")).toHaveText("");
  const xs = await page.locator(".cal-large .cal-day").evaluateAll((els) => els.slice(0, 8).map((e) => Math.round(e.getBoundingClientRect().left)));
  if (xs.length === 8) expect(xs[7]).toBe(xs[0]);

  // Previous month, and back.
  await nav.getByRole("link", { name: /上个月/ }).click();
  await expect(page.locator("[data-month]")).not.toHaveAttribute("data-month", month);
  const prev = m === 1 ? `${y - 1}年12月` : `${y}年${m - 1}月`;
  await expect(nav.locator("h1")).toHaveText(prev);
  await nav.getByRole("link", { name: /下个月/ }).click();
  await expect(page.locator("[data-month]")).toHaveAttribute("data-month", month);

  await day.click();
  await expect(page).toHaveURL(new RegExp(isMobile ? `/digest/${date}$` : `/calendar/${month}\\?day=${date}$`));
});

test("QA #16: with no daily digest the page says when one comes, what it needs, how today stands, and where to read meanwhile", async ({ page, request }) => {
  await reset(request, { empty: true, no_digest_reason: "not_yet_time" });
  await signIn(page, "/digest");
  await expect(page.getByTestId("digest-none")).toHaveText("还没有每日摘要。");
  await expect(page.getByTestId("digest-when")).toContainText("21:00（Asia/Shanghai）之后出");
  await expect(page.getByTestId("digest-when")).toContainText("已经解读过的条目");
  await expect(page.getByTestId("digest-why")).toHaveText("今天的还没到时间。今天到现在有 0 条解读。");
  // Nothing is made on demand: no button here, only the way to today's analyses.
  await expect(page.locator(".digest [data-reason] button")).toHaveCount(0);
  await expect(page.locator(".digest").getByRole("link", { name: "去「今天」看今天的解读" })).toHaveAttribute("href", "/");

  // The count is the current one.
  await page.goto("/");
  await openInbox(page);
  await page.locator(".inbox-box").fill("https://example.com/for-tonight");
  await page.getByTestId("inbox-save").click();
  await expect(page.locator(".said")).toHaveText("已存入。");
  await request.post("/__test/analyse", { data: {} });
  await page.goto("/digest");
  await expect(page.getByTestId("digest-why")).toHaveText("今天的还没到时间。今天到现在有 1 条解读。");
});

test("QA #16: each reason has its own sentence, and earlier digests can be reached from the empty state", async ({ page, request }) => {
  await reset(request, { empty: true, no_digest_reason: "no_assistant" });
  await signIn(page, "/digest");
  await expect(page.getByTestId("digest-why")).toContainText("没有指定出每日摘要的助手");
  await expect(page.locator(".digest [data-reason]").getByRole("link", { name: "去助手设置" })).toHaveAttribute("href", "/assistants");

  await reset(request, { empty: true, no_digest_reason: "nothing_analysed" });
  await signIn(page, "/digest");
  await expect(page.getByTestId("digest-why")).toHaveText("已经过了 21:00，但今天还没有解读，所以今天没有每日摘要。");

  // A day without a digest, while earlier ones exist: the way to the latest one is there.
  await reset(request, { no_digest_reason: "waiting_for_assistant" });
  await signIn(page, "/digest/2020-01-01");
  await expect(page.getByTestId("digest-none")).toHaveText("这一天没有每日摘要。");
  await expect(page.getByTestId("digest-why")).toContainText("助手下次来时出");
  await page.locator(".digest").getByRole("link", { name: /看最近的一份/ }).click();
  await expect(page.locator("article[data-day]")).toBeVisible();
});
