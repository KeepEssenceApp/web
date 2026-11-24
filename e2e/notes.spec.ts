import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed");
test.beforeEach(async ({ request }) => reset(request));

test("W4: quick find, the deep-dive queue, notes newest first, the calendar card", async ({ page }) => {
  await signIn(page, "/notes");
  // Order on the page: quick find, queue, notes, calendar card.
  const tops = await Promise.all([".find", ".queue", ".note-list", ".month-card"].map(async (s) => (await page.locator(s).boundingBox())!.y));
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);

  // Queue: the deep-read state as a dot plus words, and what can be done.
  const ready = page.locator('.queue-row[data-item="d2_q1"]');
  await expect(ready.locator(".state")).toHaveText("精读好了");
  await expect(ready.getByRole("button", { name: "看精读" })).toBeVisible();
  await expect(ready.getByRole("button", { name: "开始深挖" })).toBeVisible();
  // Only an entry the user went to offers these two.
  await expect(ready.getByRole("button", { name: "把结果贴回来" })).toBeVisible();
  await expect(ready.getByRole("button", { name: "移出队列" })).toBeVisible();
  const waiting = page.locator('.queue-row[data-item="it_queued"]');
  await expect(waiting.locator(".state")).toHaveText("等精读");
  await expect(waiting.getByRole("button", { name: "把结果贴回来" })).toHaveCount(0);
  await expect(page.locator('.queue-row[data-item="d3_q1"] .state')).toHaveText("精读中");

  await ready.getByRole("button", { name: "看精读" }).click();
  await expect(page.getByRole("dialog").locator(".label")).toHaveText(["读出来的", "另外查到的", "可以接着问的"]);
  await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();

  // Notes newest first.
  const hrefs = await page.locator(".note-row").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(hrefs).toEqual(["/notes/n1", "/notes/n2", "/notes/n3", "/notes/n4"]);

  // Quick find looks only at notes.
  await page.locator(".find").fill("租约");
  await expect(page.locator(".note-row")).toHaveCount(1);
  await expect(page.locator(".note-row")).toHaveAttribute("href", "/notes/n1");
  await page.locator(".find").fill("没有这样的字眼zzz");
  await expect(page.getByTestId("notes-empty")).toHaveText("没有找到笔记。");
});

test("W4: start a deep dive from the queue; remove from the queue", async ({ page }) => {
  await signIn(page, "/notes");
  const row = page.locator('.queue-row[data-item="it_queued"]');
  await row.getByRole("button", { name: "开始深挖" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "加入深挖队列" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "开始深挖" }).click();
  await expect(sheet.getByTestId("opening-line")).toContainText("深挖这一条：");
  await sheet.getByRole("button", { name: "关闭" }).click();
  // Now the user went: the two quiet exits appear.
  await expect(row.getByRole("button", { name: "把结果贴回来" })).toBeVisible();
  await row.getByRole("button", { name: "移出队列" }).click();
  await expect(page.locator('.queue-row[data-item="it_queued"]')).toHaveCount(0);
  await expect(page.locator(".said")).toContainText("已移出队列。");
});

test("W4: paste the result back saves a note", async ({ page, request }) => {
  await signIn(page, "/notes");
  const before = (await state(request)).counts.notes;
  await page.locator('.queue-row[data-item="d2_q1"]').getByRole("button", { name: "把结果贴回来" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.locator('input[type="text"]').fill("贴回来的结论");
  await sheet.locator("textarea").fill("## 结论\n\n- 第一条\n- 第二条\n\n**要紧的**在这里。");
  await sheet.getByRole("button", { name: "存成笔记" }).click();
  await expect(page).toHaveURL(/\/notes\/[\w-]+$/);
  await expect(page.locator(".note-title")).toHaveText("贴回来的结论");
  await expect(page.locator(".prose h3, .prose h2").first()).toHaveText("结论");
  await expect(page.locator(".prose li")).toHaveCount(2);
  await expect(page.locator("article header")).toContainText("由用户交回");
  expect((await state(request)).counts.notes).toBe(before + 1);
  // It left the queue and is first in the list.
  await page.goto("/notes");
  await expect(page.locator('.queue-row[data-item="d2_q1"]')).toHaveCount(0);
  await expect(page.locator(".note-row b").first()).toHaveText("贴回来的结论");
});

test("W4: a note opens as a readable page with download and share", async ({ page, context, isMobile }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "/notes");
  await page.locator('.note-row[href="/notes/n1"]').click();
  await expect(page.locator(".note-title")).toBeVisible();
  await expect(page.locator(".prose")).toBeVisible();
  const title = await page.locator(".note-title").innerText();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "下载" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const text = fs.readFileSync((await download.path())!, "utf8");
  expect(text.startsWith(`# ${title}`)).toBe(true);

  // Share: the system share sheet where there is one, otherwise the text is copied.
  const hasShare = await page.evaluate(() => typeof navigator.share === "function");
  if (hasShare) {
    await page.evaluate(() => {
      (window as unknown as { shared: unknown }).shared = null;
      navigator.share = async (data) => {
        (window as unknown as { shared: unknown }).shared = data;
      };
    });
    await page.getByRole("button", { name: "分享" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { shared: { title?: string } | null }).shared?.title)).toBe(title);
  } else {
    await page.getByRole("button", { name: "分享" }).click();
    await expect(page.locator(".said")).toContainText("已复制笔记的文字。");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`# ${title}`);
  }
  expect(isMobile).toBeDefined();
});

test("W4: the calendar card opens the large month; paging; a day opens its digest", async ({ page }) => {
  await signIn(page, "/notes");
  await expect(page.locator(".month-card .cal-counts")).toContainText(/存入了 \d+ 条 · 出了 \d+ 份每日摘要 · 读了 \d+ 份 · 留下 \d+ 篇笔记/);
  await page.locator(".month-card").click();
  await expect(page).toHaveURL(/\/calendar$/);
  const month = await page.locator("[data-month]").getAttribute("data-month");
  // One dot a day, none for the future; today has the thin square frame.
  const today = new Date(Date.now() + 8 * 3600e3).getUTCDate();
  await expect(page.locator(".cal-large .cal-day")).toHaveCount(today);
  await expect(page.locator(".cal-large .is-today")).toHaveCount(1);
  expect(await page.locator(".cal-large .mark-note").count()).toBeGreaterThan(0);
  // A day without a digest cannot be pressed.
  expect(await page.locator(".cal-large span.cal-day").count()).toBeGreaterThan(0);

  await page.getByRole("link", { name: /上个月/ }).click();
  await expect(page.locator("[data-month]")).not.toHaveAttribute("data-month", month!);
  await page.getByRole("link", { name: /下个月/ }).click();
  await expect(page.locator("[data-month]")).toHaveAttribute("data-month", month!);

  const day = page.locator(".cal-large a.cal-day").last();
  const href = await day.getAttribute("href");
  await day.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator("article[data-day]")).toHaveAttribute("data-day", href!.split("/").pop()!);
});
