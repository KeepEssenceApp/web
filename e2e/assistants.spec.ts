import { expect, test } from "@playwright/test";
import { FAKE, credentialOf, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed");
test.beforeEach(async ({ request }) => reset(request));

test("W5: the assistant list, who does which step, and the status bar opens it", async ({ page, isMobile }) => {
  await signIn(page);
  // Manage tier: pressing the status bar opens Assistants.
  if (!isMobile) {
    await page.locator("a.status-press").click();
    await expect(page).toHaveURL(/\/assistants$/);
  } else await page.goto("/assistants");
  await expect(page.locator(".tabs a")).toHaveText(["助手", "规则", "设备", "我的月历", "通知", "账户"]);
  await expect(page.locator("[data-assistant]")).toHaveCount(3);
  await expect(page.locator('[data-assistant="as_builtin"]')).toContainText("内置助手");
  await expect(page.locator('[data-assistant="as_adu"]')).toContainText("定时型");
  await expect(page.locator('[data-assistant="as_adu"]')).toContainText("内容送到 agent.example.com");
  await expect(page.locator('[data-assistant="as_ashen"]')).toContainText("对话型");
  // The built-in assistant cannot be renamed or revoked here.
  await expect(page.locator('[data-assistant="as_builtin"] button')).toHaveCount(0);

  // A chat assistant cannot be chosen for analysis, the digest or the deep read.
  const options = (role: string) => page.locator(`select[data-role="${role}"] option`).allInnerTexts();
  expect(await options("analysis")).toEqual(["无", "内置助手", "阿读"]);
  expect(await options("deep_read")).toEqual(["无", "阿读"]);
  expect(await options("deep_dive")).toEqual(["无", "阿读", "阿深"]);
  await page.locator('select[data-role="analysis"]').selectOption({ label: "阿读" });
  await expect(page.locator(".said")).toContainText("已保存。");
  await page.reload();
  await expect(page.locator('select[data-role="analysis"]')).toHaveValue("as_adu");

  // Rename, then revoke.
  const row = page.locator('[data-assistant="as_ashen"]');
  await row.getByRole("button", { name: "改名" }).click();
  await row.locator('input[type="text"]').fill("阿聊");
  await row.getByRole("button", { name: "保存" }).click();
  await expect(row).toContainText("阿聊");
  await row.getByRole("button", { name: "撤销" }).click();
  await row.locator(".confirm").getByRole("button", { name: "撤销" }).click();
  await expect(page.locator('[data-assistant="as_ashen"]')).toHaveCount(0);
});

test("W5: connect an assistant shows the address and the steps for each product", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "/assistants");
  await page.getByRole("link", { name: "接入一个助手" }).click();
  const address = page.getByTestId("connect-address");
  await expect(address).toHaveText(/\/mcp$/);
  await page.locator(".connect").getByRole("button", { name: "复制" }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await address.innerText());

  await expect(page.locator(".segments button")).toHaveText(["Claude", "ChatGPT", "Gemini", "自己部署的 agent"]);
  await expect(page.locator(".guide-steps li")).toHaveCount(4);
  await expect(page.locator(".guide")).toContainText("Add custom connector");
  await page.getByRole("tab", { name: "ChatGPT" }).click();
  await expect(page.locator(".guide")).toContainText("把结果贴回来");
  await page.getByRole("tab", { name: "自己部署的 agent" }).click();
  await expect(page.locator(".guide-steps li")).toHaveCount(3);
  // Not verified: no tab and no made-up steps, one line that names it.
  await expect(page.getByTestId("not-verified")).toHaveText("待验证：Muse。");
});

test("W5: rules and expiry options", async ({ page, request }) => {
  await signIn(page, "/assistants/rules");
  await page.locator("textarea").fill("讲数据库的交给阿读，保留 90 天。\n短帖保留 7 天。");
  await page.locator('input[inputmode="numeric"]').fill("7, 30, 400");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator('[role="alert"]')).toContainText("1 到 365");
  await page.locator('input[inputmode="numeric"]').fill("7, 14, 30, 365");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".said")).toContainText("已保存。");
  const s = (await state(request)).settings;
  expect(s.expiry_options).toEqual([7, 14, 30, 365]);
  expect(s.rules).toContain("短帖保留 7 天");
});

test("W5: devices: rename, change tier, revoke; the last manager is protected", async ({ page }) => {
  await signIn(page, "/assistants/devices");
  const ext = page.locator('[data-device="dev_ext"]');
  await expect(ext).toContainText("浏览器扩展");
  await expect(ext.locator("select")).toHaveValue("save");
  await ext.getByRole("button", { name: "改名" }).click();
  await ext.locator('input[type="text"]').fill("公司的 Chrome");
  await ext.getByRole("button", { name: "保存" }).click();
  await expect(ext).toContainText("公司的 Chrome");
  await ext.locator("select").selectOption("read");
  await expect(ext.locator("select")).toHaveValue("read");

  // This device is the only one with the manage tier: lowering or revoking it is refused, and said.
  const me = page.locator("[data-device]", { hasText: "这台设备" });
  await me.locator("select").selectOption("read");
  await expect(me.locator('[role="alert"]')).not.toBeEmpty();
  await expect(me.locator("select")).toHaveValue("manage");
  await me.getByRole("button", { name: "撤销" }).click();
  await me.locator(".confirm").getByRole("button", { name: "撤销" }).click();
  await expect(me.locator('[role="alert"]')).not.toBeEmpty();
  await expect(page.locator("nav.nav")).toBeVisible();

  await ext.getByRole("button", { name: "撤销" }).click();
  await ext.locator(".confirm").getByRole("button", { name: "撤销" }).click();
  await expect(page.locator('[data-device="dev_ext"]')).toHaveCount(0);
});

test("W5: approving a short code: who asks, which tier, may be lowered, allow", async ({ page, request }) => {
  const made = await (await request.post("/__test/device-code", { data: { device_name: "Kindle 墨水屏", client: "eink", requested_tier: "read" } })).json();
  // Not signed in yet: sign in first, then come back to the same page.
  await signIn(page, `/approve?code=${made.code}`);
  await expect(page.locator(".who")).toHaveText("Kindle 墨水屏 想接入");
  await expect(page.getByTestId("short-code")).toHaveText(made.code);
  await expect(page.locator(".standalone-box")).toContainText("它请求的权限：读");
  // The tier can be lowered, never raised above what was asked for.
  await expect(page.locator('input[name="tier"]')).toHaveCount(2);
  await expect(page.locator('input[name="tier"][value="read"]')).toBeChecked();
  await page.locator('input[name="tier"][value="save"]').check();
  await page.getByRole("button", { name: "允许" }).click();
  await expect(page.getByTestId("approve-result")).toHaveText("已允许。Kindle 墨水屏 可以用了。");

  // The waiting client gets its credential once; the device is listed with the lowered tier.
  const poll = await (await request.get(`/v1/device-codes/${made.code}`, { headers: { Authorization: `Bearer ${made.poll_secret}` } })).json();
  expect(poll.status).toBe("approved");
  expect(poll.grant.device.tier).toBe("save");
  await page.getByRole("link", { name: "设备" }).click();
  const row = page.locator("[data-device]", { hasText: "Kindle 墨水屏" });
  await expect(row.locator("select")).toHaveValue("save");
  // The page never showed the new device's credential.
  expect(await page.content()).not.toContain(poll.grant.credential);
});

test("W5: typing a short code on the devices page, then refusing", async ({ page, request }) => {
  const made = await (await request.post("/__test/device-code", { data: { device_name: "Mac 菜单栏", client: "menubar", requested_tier: "save" } })).json();
  await signIn(page, "/assistants/devices");
  await page.locator('input[aria-label="短码"]').fill(made.code.toLowerCase());
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page).toHaveURL(/\/approve\?code=/);
  await expect(page.locator(".who")).toHaveText("Mac 菜单栏 想接入");
  await expect(page.locator('input[name="tier"]')).toHaveCount(1);
  await page.getByRole("button", { name: "拒绝" }).click();
  await expect(page.getByTestId("approve-result")).toHaveText("已拒绝。");
  const poll = await request.get(`/v1/device-codes/${made.code}`, { headers: { Authorization: `Bearer ${made.poll_secret}` } });
  expect(poll.status() === 410 || (await poll.json()).status === "denied").toBe(true);

  // An unknown code is said plainly, and /approve alone asks for the code.
  await page.goto("/approve?code=ZZZ-999");
  await expect(page.locator('[role="alert"]')).not.toBeEmpty();
  await page.goto("/approve");
  await expect(page.locator('input[aria-label="短码"]')).toBeVisible();
});

test("W5: my calendar: off by default, on, copy, look, rotate", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "/assistants/calendar");
  const sw = page.getByRole("switch", { name: "图片地址" });
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("calendar-address")).toHaveCount(0);
  await sw.click();
  const address = page.getByTestId("calendar-address");
  await expect(address).toHaveText(/\/c\/[\w-]+\.svg\?theme=light&range=month&counts=1$/);
  const first = await address.innerText();
  await page.getByRole("button", { name: "深色" }).click();
  await page.getByRole("button", { name: "最近十二个月" }).click();
  await page.getByLabel("带底下那行数字").uncheck();
  await expect(address).toHaveText(/\?theme=dark&range=year&counts=0$/);
  await page.getByRole("button", { name: "复制" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await address.innerText());
  // The image is public and loads.
  await expect.poll(() => page.locator(".mycal-preview").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "换一个地址" }).click();
  await expect(address).not.toHaveText(first.split("?")[0]);
  const old = await page.request.get(first);
  expect(old.status()).toBe(404);
  await sw.click();
  await expect(page.getByTestId("calendar-address")).toHaveCount(0);
});

test("W5: notifications: one switch; the browser is asked only after Notify me, once", async ({ page, request }) => {
  await page.addInitScript(() => {
    // A browser that has not been asked yet, and whose user then says no.
    const w = window as unknown as { asks: number; perm: NotificationPermission };
    w.asks = 0;
    w.perm = "default";
    if ("Notification" in window) {
      Object.defineProperty(Notification, "permission", { get: () => w.perm });
      Notification.requestPermission = async () => {
        w.asks++;
        w.perm = "denied";
        return "denied";
      };
    }
  });
  await signIn(page, "/assistants/notify");
  const sw = page.getByRole("switch", { name: "通知" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  // Visiting the page, or any page before it, did not ask.
  expect(await page.evaluate(() => (window as unknown as { asks: number }).asks)).toBe(0);
  await expect(page.getByTestId("notify-state")).toHaveText("这台设备还没开通知。");

  await page.getByRole("button", { name: "通知我" }).click();
  await expect(page.getByTestId("notify-state")).toHaveText("这台设备收不到通知：浏览器没有允许。");
  expect(await page.evaluate(() => (window as unknown as { asks: number }).asks)).toBe(1);
  // Not allowed: it is not asked again, here or after a reload.
  await expect(page.getByRole("button", { name: "通知我" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("notify-state")).toHaveText("这台设备收不到通知：浏览器没有允许。");
  await expect(page.getByRole("button", { name: "通知我" })).toHaveCount(0);

  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  expect((await state(request)).settings.notify).toBe(false);
});

test("W5: account: time zone, and sign out revokes this device", async ({ page, request }) => {
  await signIn(page, "/assistants/account");
  const cred = await credentialOf(page);
  expect(cred.length).toBeGreaterThan(10);
  await page.locator("label", { hasText: "时区" }).locator("select").selectOption("Europe/Berlin");
  await expect(page.locator(".said")).toContainText("已保存。");
  expect((await state(request)).user.timezone).toBe("Europe/Berlin");

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  expect(await credentialOf(page)).toBe("");
  const me = await request.get("/v1/devices/me", { headers: { Authorization: `Bearer ${cred}` } });
  expect(me.status()).toBe(401);
});
