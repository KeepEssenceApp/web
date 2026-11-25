// QA #30: every assistant's row opens in place and says what it is; the Devices page and its
// sentence agree about which assistants are devices.
import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.skip(!FAKE, "needs the fake's seed");
test.beforeEach(async ({ request }) => reset(request));

test("QA #30: the built-in assistant's row opens in place and says what it does, whose it is, when it came, where it runs and what it used", async ({ page }) => {
  await signIn(page, "/assistants");
  const row = page.locator('[data-assistant="as_builtin"]');
  const about = row.getByTestId("assistant-about");
  await expect(row.locator("summary")).toBeVisible();
  await expect(about).toBeHidden();

  await row.locator("summary").click();
  await expect(about).toBeVisible();
  // In place: no other page.
  await expect(page).toHaveURL(/\/assistants$/);
  await expect(about.locator('[data-about="steps"] dd')).toHaveText("解读 · 每日摘要");
  await expect(about.locator('[data-about="origin"] dd')).toHaveText("这个服务自带的，由我们运行。");
  await expect(about.locator('[data-about="came"] dd')).toHaveText(/来过$/);
  // It runs on the service; the API names no model provider, so none is named.
  await expect(about.locator('[data-about="sent"] dd')).toHaveText("它在这个服务上运行。");
  await expect(about).not.toContainText(/Anthropic|OpenAI|Google|Claude|GPT|Gemini/i);
  // Usage for the last 30 days, counted by the service: not labelled as self-reported.
  await expect(about.locator('[data-about="usage"] dt')).toHaveText("最近 30 天的用量");
  await expect(about.locator('[data-about="usage"] dd')).toHaveText("调用 40 次 · 条目 36 条 · 读入 52,000 词元 · 写出 8,100 词元");
  await expect(about.getByTestId("usage-self")).toHaveCount(0);
  // No rename, no steps to tick, no revoke; it says why and where a step is taken away from it.
  await expect(row.locator("button, input")).toHaveCount(0);
  await expect(about.getByTestId("built-in-fixed")).toHaveText("内置助手是这个服务的一部分，不能撤销。不想让它做某一步，就在「谁做哪一步」里把那一步交给别的助手，或设成「无」。");
  await expect(page.locator('select[data-role="digest"]')).toBeVisible();

  // Pressing the row again closes it.
  await row.locator("summary").click();
  await expect(about).toBeHidden();
});

test("QA #30: a connected assistant's row opens the same way, labels its numbers as self-reported, and keeps rename, steps and revoke", async ({ page }) => {
  await signIn(page, "/assistants");
  const row = page.locator('[data-assistant="as_adu"]');
  const about = row.getByTestId("assistant-about");
  await expect(about).toBeHidden();
  // Closed or open, what could be done before can still be done.
  await expect(row.getByRole("button", { name: "改名" })).toBeVisible();
  await expect(row.getByRole("button", { name: "撤销" })).toBeVisible();
  await expect(row.locator('.steps input[type="checkbox"]')).toHaveCount(4);

  await row.locator("summary").click();
  await expect(about.locator('[data-about="steps"] dd')).toHaveText("解读 · 每日摘要 · 精读 · 深挖");
  await expect(about.locator('[data-about="origin"] dd')).toHaveText("你接入的，20天前。");
  await expect(about.locator('[data-about="came"] dd')).toHaveText(/来过$/);
  await expect(about.locator('[data-about="sent"] dd')).toHaveText("内容送到 agent.example.com");
  await expect(about.locator('[data-about="usage"] dd')).toContainText("调用 28 次 · 条目 26 条 · 读入 43,000 词元 · 写出 6,600 词元");
  await expect(about.getByTestId("usage-self")).toHaveText("这些数字是助手自己报告的。");
  await expect(about.getByTestId("built-in-fixed")).toHaveCount(0);

  // Changing a step keeps the row open and the details current.
  // (The box follows the core's answer, so it is pressed, not "unchecked".)
  const dive = row.locator(".steps label", { hasText: "深挖" }).locator("input");
  await dive.click();
  await expect(page.locator(".said")).toContainText("已保存。");
  await expect(about).toBeVisible();
  await expect(about.locator('[data-about="steps"] dd')).toHaveText("解读 · 每日摘要 · 精读");
  await expect(dive).not.toBeChecked();
  await expect(row.getByRole("button", { name: "改名" })).toBeVisible();
  await expect(row.getByRole("button", { name: "撤销" })).toBeVisible();
});

test("QA #30: an assistant with nothing recorded says so instead of showing numbers", async ({ page }) => {
  await page.route("**/v1/usage*", (route) => route.fulfill({ json: { assistants: [] } }));
  await signIn(page, "/assistants");
  const row = page.locator('[data-assistant="as_ashen"]');
  await row.locator("summary").click();
  await expect(row.locator('[data-about="usage"] dd')).toHaveText("最近 30 天没有用量记录。");
  await expect(row.locator('[data-about="sent"] dd')).toHaveText("内容送到 chat.example.com");
});

test("QA #30: Devices lists every client and every connected assistant, not the built-in one, and its sentence says exactly that", async ({ page, request }) => {
  await signIn(page, "/assistants/devices");
  const hint = page.locator(".quiet.small", { hasText: "都是一个设备" });
  await expect(hint).toHaveText("你接入的每个客户端和每个助手都是一个设备。每个都可以在这里改名、单独撤销，马上生效，别的设备不受影响。内置助手是这个服务的一部分，不在这里列出。");
  // The connected assistants are there, each revocable; the built-in one is not.
  for (const id of ["as_adu", "as_ashen"]) {
    const row = page.locator(`[data-device="${id}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "撤销" })).toBeVisible();
  }
  await expect(page.locator('[data-device="as_builtin"]')).toHaveCount(0);
  await expect(page.locator("[data-device]", { hasText: "内置助手" })).toHaveCount(0);
  await expect(page.locator("[data-device]", { hasText: "这台设备" })).toHaveCount(1);

  // With only the built-in assistant, only clients are listed, and the sentence still holds.
  await reset(request, { no_deep: true });
  await signIn(page, "/assistants/devices");
  await expect(page.locator("[data-device]", { hasText: "这台设备" })).toHaveCount(1);
  await expect(page.locator("[data-device]", { hasText: "内置助手" })).toHaveCount(0);
  await expect(page.locator('[data-device^="as_"]')).toHaveCount(0);
  await expect(hint).toContainText("内置助手是这个服务的一部分，不在这里列出。");
});

test("QA #30: in English the row and the Devices sentence read the same way", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ locale: "en-US", baseURL });
  const page = await ctx.newPage();
  await signIn(page, "/assistants");
  const row = page.locator('[data-assistant="as_builtin"]');
  await row.locator("summary").click();
  await expect(row.locator('[data-about="origin"] dd')).toHaveText("Part of this service: we run it.");
  await expect(row.locator('[data-about="sent"] dd')).toHaveText("It runs on this service.");
  await expect(row.locator('[data-about="usage"] dd')).toHaveText("40 calls · 36 items · 52,000 word pieces read · 8,100 word pieces written");
  await expect(row.getByTestId("built-in-fixed")).toContainText("cannot be revoked");
  await page.goto("/assistants/devices");
  await expect(page.locator(".quiet.small", { hasText: "is a device" })).toHaveText(
    "Every client and every assistant you connected is a device. Each can be renamed and revoked here on its own; it takes effect at once and no other device is affected. The built-in assistant is part of the service and is not listed here.",
  );
  await ctx.close();
});
