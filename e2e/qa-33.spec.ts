// The internal QA issue #33 as the web app sees it: in the Assistants forms an error goes as
// soon as what it was about is corrected, not at the next save; a value that is still wrong
// keeps it.
import { expect, test } from "@playwright/test";
import { EMAIL, FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");
test.beforeEach(async ({ request }) => reset(request));

test("QA #33: the expiry options' error goes when the value becomes valid, and stays while it is still invalid", async ({ page, request }) => {
  await signIn(page, "/assistants/rules");
  const field = page.locator('input[inputmode="numeric"]');
  const alert = page.locator('form [role="alert"]');
  const hint = page.locator("form p", { hasText: "1 到 6 个，每个 1 到 365 天，用逗号隔开。" });
  await expect(hint).toBeVisible();
  await field.fill("7, 30, 400");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(alert).toHaveText("要 1 到 6 个数，每个 1 到 365。");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(hint).toHaveCount(0);

  // Still wrong in other ways: the error stays.
  for (const wrong of ["7, 30, 40x", "", "0", "1, 2, 3, 4, 5, 6, 7", "7.5"]) {
    await field.fill(wrong);
    await expect(alert).toHaveText("要 1 到 6 个数，每个 1 到 365。");
  }
  // Right: the error goes at once and the hint is back. Nothing was saved for that.
  await field.fill("7, 30, 40");
  await expect(alert).toHaveCount(0);
  await expect(hint).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "false");
  expect((await state(request)).settings.expiry_options).toEqual([7, 30, 90, 365]);
  // Typing a wrong value again does not bring the error back before a save is tried.
  await field.fill("7, 30, 400");
  await expect(alert).toHaveCount(0);
  await field.fill("7, 30, 40");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".said")).toHaveText("已保存。");
  expect((await state(request)).settings.expiry_options).toEqual([7, 30, 40]);
});

test("QA #33: a save the core refused is no longer said once anything in the rules form is edited", async ({ page, request }) => {
  await signIn(page, "/assistants/rules");
  // Something has to differ from what is saved, or the save is not sent at all (QA #47).
  await page.locator("textarea").fill("先改一处。");
  for (const edit of [() => page.locator("textarea").fill("短帖保留 7 天。"), () => page.locator('input[inputmode="numeric"]').fill("7, 30")]) {
    await request.post("/__test/fail-next", { data: { method: "PATCH", path: "^/v1/settings$" } });
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.locator(".said.bad")).toHaveText("核心出了问题。");
    await edit();
    await expect(page.locator(".said")).toHaveCount(0);
  }
  // A sentence that is not a refusal is left alone.
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".said")).toHaveText("已保存。");
  await page.locator("textarea").fill("短帖保留 30 天。");
  await expect(page.locator(".said")).toHaveText("已保存。");
});

test("QA #33: renaming an assistant — the refusal goes when the name is edited", async ({ page, request }) => {
  await signIn(page, "/assistants");
  const row = page.locator('[data-assistant="as_ashen"]');
  await row.getByRole("button", { name: "改名" }).click();
  await row.locator('input[type="text"]').fill("阿聊");
  await request.post("/__test/fail-next", { data: { method: "PATCH", path: "^/v1/assistants/" } });
  await row.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".said.bad")).toHaveText("核心出了问题。");
  await row.locator('input[type="text"]').fill("阿聊天");
  await expect(page.locator(".said")).toHaveCount(0);
  await row.getByRole("button", { name: "保存" }).click();
  await expect(row).toContainText("阿聊天");
});

test("QA #33: a device's error goes when its name is edited or another change is tried", async ({ page }) => {
  await signIn(page, "/assistants/devices");
  // This device is the only one with the manage tier: lowering it is refused, and said in its row.
  const me = page.locator("[data-device]", { hasText: "这台设备" });
  await me.locator("select").selectOption("read");
  await expect(me.locator('[role="alert"]')).toHaveText("这是最后一台管理档的设备，不能降档或撤销。");
  // Opening the name field changes nothing yet; typing in it does.
  await me.getByRole("button", { name: "改名" }).click();
  await expect(me.locator('[role="alert"]')).toBeVisible();
  await me.locator('input[type="text"]').fill("书房的电脑");
  await expect(me.locator('[role="alert"]')).toHaveCount(0);
  await me.getByRole("button", { name: "保存" }).click();
  await expect(me).toContainText("书房的电脑");

  // The same refusal again, then a change to another device that works: the old error is gone.
  await me.locator("select").selectOption("read");
  await expect(me.locator('[role="alert"]')).toBeVisible();
  await page.locator('[data-device="dev_ext"] select').selectOption("read");
  await expect(page.locator(".said")).toHaveText("已保存。");
  await expect(page.locator('[data-device] [role="alert"]')).toHaveCount(0);
});

test("QA #33: deleting the account — the core's refusal goes when the email is edited", async ({ page, request }) => {
  await signIn(page, "/assistants/account");
  const zone = page.getByTestId("delete-account");
  const field = zone.locator('input[name="confirm_email"]');
  await field.fill(EMAIL);
  await request.post("/__test/fail-next", { data: { method: "DELETE", path: "^/v1/account$" } });
  await zone.getByTestId("delete-confirm").click();
  await expect(zone.locator('[role="alert"]')).toHaveText("核心出了问题。");
  // The account is still there, and the refusal is about what was typed then.
  expect((await state(request)).deleted_account).toBeNull();
  await field.fill(EMAIL.slice(0, -1));
  await expect(zone.locator('[role="alert"]')).toHaveCount(0);
  await expect(zone.getByTestId("delete-mismatch")).toBeVisible();
  await field.fill(EMAIL);
  await expect(zone.locator('[role="alert"]')).toHaveCount(0);
  await expect(zone.getByTestId("delete-confirm")).toBeEnabled();
});

test("QA #47: saving the rules with nothing changed says so, and sends nothing", async ({ page }) => {
  await signIn(page, "/assistants/rules");
  let sent = 0;
  page.on("request", (r) => {
    if (r.method() === "PATCH" && new URL(r.url()).pathname === "/v1/settings") sent++;
  });
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".said")).toHaveText("没有改动，规则还是原来保存的样子。");
  expect(sent).toBe(0);
});

test("QA #48: the sentence under the notifications switch follows the switch at once", async ({ page, request }) => {
  await signIn(page, "/assistants/notify");
  const sw = page.getByRole("switch", { name: "通知" });
  const off = page.getByText("通知关着，所有设备都不发。");
  await expect(off).toHaveCount(0);
  await request.post("/__test/delay", { data: { ms: 1500 } });
  await sw.click();
  await expect(off).toBeVisible({ timeout: 700 });
  await expect(sw).toHaveAttribute("aria-busy", "false");
  await request.post("/__test/delay", { data: { ms: 1500 } });
  await sw.click();
  await expect(off).toHaveCount(0, { timeout: 700 });
  await expect(page.locator(".said")).toHaveText("通知已打开。");
});
