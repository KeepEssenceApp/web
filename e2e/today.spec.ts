import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed");
test.beforeEach(async ({ request }) => reset(request));

test("W2: status bar, analyses with four fields and three actions, lighter unanalysed items, the calendar behind", async ({ page, isMobile }) => {
  await signIn(page);
  // The status bar is always there: wide on wide screens, one line on phones.
  const status = page.locator(".page-head .status");
  await expect(status).toHaveAttribute("data-layout", isMobile ? "narrow" : "wide");
  await expect(status).toContainText("2 个助手在干活");
  await expect(status).toContainText("今天存入了 7 条");
  await expect(status).toContainText("2 条在等");
  if (!isMobile) {
    await expect(status.locator(".status-cell")).toHaveCount(4);
    await expect(status).toContainText("阿深");
    // Quiet is a hollow ring, recent a solid dot; no chip.
    await expect(status.locator(".status-cell", { hasText: "阿深" }).locator(".dot")).toHaveClass(/ring/);
    await expect(status.locator(".status-cell", { hasText: "阿读" }).locator(".dot")).toHaveClass(/solid/);
  }

  const card = page.locator('[data-item="it_worth"]');
  await expect(card.locator("dt")).toHaveText(["内容概述", "关键事实", "要点", "判定"]);
  expect(await card.locator(".points li").count()).toBeLessThanOrEqual(3);
  await expect(card.locator(".state")).toContainText("值得深挖");
  await expect(card.locator(".related")).toContainText("关联提示");
  // QA #52: the label and its text are two lines, never run together.
  expect(await card.locator(".related").innerText()).toMatch(/^关联提示\n+\S/);
  await expect(card.locator(".actions button")).toHaveText(["深挖", "不感兴趣", "看过了"]);
  await expect(card.locator("a.corner")).toHaveText("原文");
  await expect(card.locator("a.corner")).toHaveAttribute("href", /^https?:\/\//);
  // The raw address is not shown.
  await expect(card).not.toContainText("http");

  // Content that could not be fetched is said plainly, with no points and no verdict.
  const missing = page.locator('[data-item="it_unavail"]');
  await expect(missing).toContainText("没取到内容");
  await expect(missing.locator("dt")).toHaveCount(0);

  // Analyses first, then the unanalysed ones, lighter: no card.
  const order = await page.locator("[data-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-item")));
  expect(order.indexOf("it_worth")).toBeLessThan(order.indexOf("it_triaged"));
  expect(order).not.toContain("it_queued");
  const waiting = page.locator('.waiting[data-item="it_triaged"]');
  await expect(waiting).toContainText("等 阿读 解读");
  await expect(waiting).toContainText("还剩 30 天");
  await expect(page.locator('.waiting[data-item="it_saved"]')).toBeVisible();
  expect(await waiting.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

  // The month sits faint in the top-right background.
  const cal = page.locator(".today-cal");
  await expect(cal).toBeVisible();
  expect(Number(await cal.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
  const box = (await cal.boundingBox())!;
  expect(box.x + box.width / 2).toBeGreaterThan(page.viewportSize()!.width / 2);
  expect(box.y).toBeLessThan(120);
});

test("W2: the three actions, each said in one sentence and restorable", async ({ page }) => {
  await signIn(page);
  await page.locator('[data-item="it_know"] .actions button', { hasText: "看过了" }).click();
  await expect(page.locator('[data-item="it_know"]')).toHaveCount(0);
  await expect(page.locator(".said")).toContainText("标了看过了。");
  await page.locator(".said button", { hasText: "挽回" }).click();
  await expect(page.locator('[data-item="it_know"]')).toBeVisible();

  await page.locator('[data-item="it_skip"] .actions button', { hasText: "不感兴趣" }).click();
  await expect(page.locator('[data-item="it_skip"]')).toHaveCount(0);
  await expect(page.locator(".said")).toContainText("标了不感兴趣。");
});

test("W2: when everything is handled there is one sentence only", async ({ page, request }) => {
  await reset(request, { empty: true });
  await signIn(page);
  // A new account with nothing saved is shown how a day goes (QA #79), in words only.
  await expect(page.getByTestId("start")).toBeVisible();
  await expect(page.getByTestId("today-empty")).toHaveCount(0);
  await expect(page.locator(".card.analysis")).toHaveCount(0);
  await expect(page.locator(".page img, .page svg.illustration")).toHaveCount(0);

  await page.locator(".inbox-box").fill("https://example.com/one-thing");
  await page.locator(".inbox .btn").click();
  await expect(page.locator(".inbox-result")).toHaveText("已存入。");
  await expect(page.locator(".waiting")).toHaveCount(1);
  await request.post("/__test/analyse", { data: {} });
  await page.reload();
  await page.locator(".card.analysis .actions button", { hasText: "看过了" }).click();
  await expect(page.getByTestId("today-empty")).toHaveText("今天的都处理完了。");
});

test("W2: with no assistant working it shows, in red, what will be lost", async ({ page, request, isMobile }) => {
  await reset(request, { no_assistants: true });
  await signIn(page);
  const status = page.locator(".page-head .status");
  await expect(status).toContainText("没有助手在干活");
  await expect(status.locator(".dot.danger")).toHaveCount(1);
  if (!isMobile) {
    await expect(status.locator(".bad")).toContainText("删除");
    // The reason is about who is set to write the digest, never "no assistant came" (QA #29).
    await expect(status).toContainText("没有指定出每日摘要的助手");
  }
});

test("deep dive: add to the queue, or go now with a choice of assistant", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await page.locator('[data-item="it_worth"] .actions button', { hasText: "深挖" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "加入深挖队列" })).toBeVisible();
  await expect(sheet.getByRole("radio")).toHaveCount(2);
  // The default deep-dive assistant is chosen already; it can be changed.
  await expect(sheet.locator("label.option", { hasText: "阿深" }).getByRole("radio")).toBeChecked();
  await sheet.getByRole("button", { name: "开始深挖" }).click();
  const line = sheet.getByTestId("opening-line");
  await expect(line).toContainText("深挖这一条：");
  await sheet.getByRole("button", { name: "复制" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await line.innerText());
  await expect(sheet.getByRole("link", { name: "打开 阿深" })).toHaveAttribute("href", /^https:\/\/chat\.example\.com\//);
  await sheet.getByRole("button", { name: "关闭" }).click();

  await page.locator('[data-item="it_worth"] .actions button', { hasText: "深挖" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "加入深挖队列" }).click();
  await expect(page.locator(".said")).toContainText("已加入深挖队列。");
  await expect(page.locator('[data-item="it_worth"]')).toHaveCount(0);
  await page.goto("/notes");
  await expect(page.locator('.queue-row[data-item="it_worth"]')).toBeVisible();
});

test("opening an item: original, analysis, tags; manage can change who and how long, and delete", async ({ page, request }) => {
  await signIn(page);
  await page.locator('[data-item="it_triaged"] a').first().click();
  await expect(page).toHaveURL(/\/item\/it_triaged$/);
  await expect(page.locator(".tags code").first()).toContainText(":");
  await expect(page.locator("section", { hasText: "解读" }).last()).toContainText("还没解读");

  // One control for how long it is kept: the days, and "never" as its last choice.
  const kept = page.locator("label", { hasText: "保留多久" }).locator("select");
  await expect(kept).toHaveValue("30");
  await kept.selectOption("90");
  await expect(page.locator(".said")).toContainText("保留 90 天");
  await expect(page.locator("label", { hasText: "交给哪个助手" }).locator("select")).toBeVisible();
  await kept.selectOption("never");
  await expect(page.locator("header .quiet")).toContainText("收藏了，不过期");
  await kept.selectOption("30");
  await expect(page.locator("header .quiet")).toContainText("还剩 30 天");

  const before = (await state(request)).counts.items;
  await page.getByRole("button", { name: "删除" }).click();
  await expect(page.locator(".confirm")).toContainText("不能挽回");
  await page.locator(".confirm").getByRole("button", { name: "删除" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-item="it_triaged"]')).toHaveCount(0);
  expect((await state(request)).counts.items).toBe(before - 1);
});

test("status bar: one line on other wide pages; on a phone a small mark that opens the wide one", async ({ page, isMobile }) => {
  await signIn(page, "/notes");
  if (!isMobile) {
    await expect(page.locator(".page-head .status")).toHaveAttribute("data-layout", "narrow");
    await expect(page.locator(".page-head .status")).toContainText("2 个助手在干活 · 今天存入了 7 条 · 2 条在等");
    return;
  }
  const mark = page.locator(".status-mark");
  await expect(mark).toHaveText("2");
  await expect(mark.locator(".dot")).toHaveCount(1);
  await expect(page.locator(".status-pop")).toHaveCount(0);
  await mark.click();
  await expect(page.locator(".status-pop .status-cell")).toHaveCount(4);
  await expect(page.locator(".status-pop")).toContainText("阿深");
  // Manage tier: from here to Assistants.
  await page.locator(".status-pop a").click();
  await expect(page).toHaveURL(/\/assistants$/);
});
