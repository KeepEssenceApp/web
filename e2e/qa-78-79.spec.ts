// QA #78: feedback from inside the app. QA #79: a new account is shown how to use it.
import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "relies on the fake's seed and state");

test("QA #79: an account that has never saved anything sees how a day goes, with the ways to save", async ({ page, request }) => {
  await reset(request, { empty: true });
  await signIn(page, "/");
  const start = page.getByTestId("start");
  await expect(start).toBeVisible();
  await expect(start.locator(".start-steps li")).toHaveCount(5);
  await expect(start.locator(".start-ways dt")).toHaveText(["在这个网页上", "安卓", "iPhone", "浏览器扩展（Chrome、Edge、Brave）"]);
  await expect(page.getByTestId("today-empty")).toHaveCount(0);
  // The first save: the guide makes way for the item.
  await page.locator(".inbox-box").fill("第一条");
  await page.locator(".inbox-box").press("Meta+Enter");
  await expect(start).toHaveCount(0);
});

test("QA #79: the guide stays reachable, and an account with items is not shown it on Today", async ({ page, request, isMobile }) => {
  await reset(request);
  await signIn(page, "/");
  await expect(page.getByTestId("start")).toHaveCount(0);
  await page.getByTestId(isMobile ? "today-help" : "rail-help").getByRole("link", { name: "开始用" }).click();
  await expect(page).toHaveURL(/\/start$/);
  await expect(page.getByRole("heading", { level: 1, name: "开始用" })).toBeVisible();
  await expect(page.getByTestId("start").locator(".start-steps li")).toHaveCount(5);
  // No horizontal scrolling on any screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test("QA #78: feedback is sent from inside the app with what was written, and says so", async ({ page, request, isMobile }) => {
  await reset(request);
  await signIn(page, "/");
  await page.getByTestId(isMobile ? "today-help" : "rail-help").getByRole("link", { name: "反馈" }).click();
  await expect(page).toHaveURL(/\/feedback$/);
  const send = page.getByRole("button", { name: "发送" });
  await expect(send).toBeDisabled();
  await page.getByTestId("feedback-where").selectOption("android");
  await page.getByTestId("feedback-doing").fill("刚登录进来。");
  await page.getByTestId("feedback-wrong").fill("不知道从哪里开始。");
  await page.getByTestId("feedback-wish").fill("给一个指引。");
  await send.click();
  await expect(page.getByTestId("feedback-sent")).toContainText("收到了");
  const got = (await state(request)).feedback;
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({ where: "android", doing: "刚登录进来。", wrong: "不知道从哪里开始。", wish: "给一个指引。", email: "reader@example.com" });
});

test("QA #78: a refusal is said and what was written is kept", async ({ page, request }) => {
  await reset(request);
  await signIn(page, "/feedback");
  await page.getByTestId("feedback-wrong").fill("写了很久的一段话。");
  await request.post("/__test/fail-next", { data: { method: "POST", path: "^/v1/feedback$" } });
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".feedback-page [role=alert]")).toBeVisible();
  await expect(page.getByTestId("feedback-wrong")).toHaveValue("写了很久的一段话。");
  expect((await state(request)).feedback).toHaveLength(0);
});
