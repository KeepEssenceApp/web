// Runs only against a real core (BASE_URL set): the paths the fake cannot prove, with the
// real authorization server, real short codes and a note saved by a real assistant credential.
import { expect, test } from "@playwright/test";
import crypto from "node:crypto";
import { FAKE, credentialOf, signIn } from "./helpers";

test.skip(FAKE, "needs a real core");

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("real core: save, see it in Today, status bar, calendar", async ({ page }) => {
  await signIn(page);
  const url = `https://example.com/real/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.locator(".inbox-box").fill(url);
  await page.locator(".inbox .btn").click();
  await expect(page.locator(".inbox-result")).toHaveText("已存入。");
  // Not analysed yet: listed after the analyses, lighter.
  await expect(page.locator(".waiting").first()).toBeVisible();
  await expect(page.locator(".page-head .status")).toContainText(/今天存入了 \d+ 条/);
  await expect(page.locator(".today-cal .cal-day").first()).toBeVisible();
  await page.locator(".waiting a").first().click();
  await expect(page).toHaveURL(/\/item\//);
  await expect(page.locator(".item-title")).toBeVisible();
  await page.goto("/digest");
  await expect(page.getByTestId("digest-none").or(page.getByTestId("digest-header"))).toBeVisible();
});

test("real core: an assistant connects through the allow page and saves a note", async ({ page, request, baseURL }) => {
  await signIn(page);
  const redirect = `${baseURL}/__assistant-callback`;
  // The assistant's side: register, then send the browser to the authorization endpoint.
  const client = await (await request.post("/oauth/register", { data: { client_name: "E2E Chat", redirect_uris: [redirect] } })).json();
  expect(client.client_id).toBeTruthy();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  await page.route("**/__assistant-callback*", (route) => route.fulfill({ contentType: "text/plain", body: "back at the assistant" }));
  const q = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope: "deep_dive" });
  await page.goto(`/oauth/authorize?${q}`);

  // The core redirected the browser to the app's allow page.
  await expect(page).toHaveURL(/\/authorize\?request=/);
  await expect(page.locator(".who")).toHaveText("E2E Chat 想接入");
  await expect(page.getByTestId("sent-to")).toContainText(new URL(baseURL!).hostname);
  await expect(page.locator('input[name="kind"][value="chat"]')).toBeChecked();
  const name = `阿聊${Date.now() % 100000}`;
  await page.locator('.standalone-box input[type="text"]').fill(name);
  await page.getByRole("button", { name: "允许" }).click();
  await page.waitForURL(/__assistant-callback\?/);
  const back = new URL(page.url());
  expect(back.searchParams.get("state")).toBe("s1");
  const code = back.searchParams.get("code")!;
  expect(code).toBeTruthy();

  const token = await (
    await request.post("/oauth/token", { form: { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirect, client_id: client.client_id } })
  ).json();
  expect(token.access_token).toBeTruthy();

  // The assistant saves a note (the user said so in the conversation).
  const title = `租约笔记 ${Date.now()}`;
  const saved = await request.post("/v1/assistant/notes", {
    headers: { Authorization: `Bearer ${token.access_token}`, "Idempotency-Key": crypto.randomUUID() },
    data: { title, body: "## 结论\n\n- 认领要带期限。\n- 交回要能重放。", sources: [{ title: "Leases", url: "https://example.com/leases" }] },
  });
  expect(saved.status()).toBe(201);

  await page.goto("/assistants");
  await expect(page.locator("[data-assistant]", { hasText: name })).toContainText("对话型");
  await page.goto("/notes");
  await page.locator(".find").fill(title);
  // Quick find matches by words, newest first.
  await expect(page.locator(".note-row b").first()).toHaveText(title);
  await page.locator(".note-row").first().click();
  await expect(page.locator(".note-title")).toHaveText(title);
  await expect(page.locator(".prose li")).toHaveCount(2);
  await expect(page.locator("article header")).toContainText(name);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "下载" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  // The day turned gold in the calendar.
  await page.goto("/calendar");
  await expect(page.locator(".cal-large .is-today.mark-note")).toHaveCount(1);

  // Revoke it again from Assistants.
  await page.goto("/assistants");
  const row = page.locator("[data-assistant]", { hasText: name });
  await row.getByRole("button", { name: "撤销" }).click();
  await row.locator(".confirm").getByRole("button", { name: "撤销" }).click();
  await expect(page.locator("[data-assistant]", { hasText: name })).toHaveCount(0);
});

test("real core: a client connects with a short code approved on the approve page", async ({ page, request }) => {
  const made = await (await request.post("/v1/device-codes", { data: { device_name: "E2E 扩展", client: "extension", requested_tier: "save" } })).json();
  expect(made.approve_url).toContain("/approve");
  await signIn(page, `/approve?code=${made.code}`);
  await expect(page.locator(".who")).toHaveText("E2E 扩展 想接入");
  await expect(page.getByTestId("short-code")).toHaveText(made.code);
  await page.getByRole("button", { name: "允许" }).click();
  await expect(page.getByTestId("approve-result")).toHaveText("已允许。E2E 扩展 可以用了。");
  const poll = await (await request.get(`/v1/device-codes/${made.code}`, { headers: { Authorization: `Bearer ${made.poll_secret}` } })).json();
  expect(poll.status).toBe("approved");
  expect(poll.grant.device.tier).toBe("save");
  expect(await page.content()).not.toContain(poll.grant.credential);

  await page.goto("/assistants/devices");
  const row = page.locator("[data-device]", { hasText: "E2E 扩展" }).first();
  await expect(row.locator("select")).toHaveValue("save");
  await row.getByRole("button", { name: "撤销" }).click();
  await row.locator(".confirm").getByRole("button", { name: "撤销" }).click();
  // The page's own request has to reach the core first; from then on the credential is dead.
  await expect.poll(async () => (await request.get("/v1/devices/me", { headers: { Authorization: `Bearer ${poll.grant.credential}` } })).status()).toBe(401);
});

test("real core: settings pages load and save; my calendar image is public once on", async ({ page }) => {
  await signIn(page, "/assistants");
  await expect(page.locator("[data-assistant]").first()).toBeVisible();
  await expect(page.locator('select[data-role="analysis"]')).toBeVisible();
  await page.goto("/assistants/connect");
  await expect(page.getByTestId("connect-address")).toHaveText(/\/mcp$/);
  await page.goto("/assistants/rules");
  await page.locator("textarea").fill("讲数据库的保留 90 天。");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".said")).toContainText("已保存。");
  await page.goto("/assistants/calendar");
  const sw = page.getByRole("switch", { name: "图片地址" });
  if ((await sw.getAttribute("aria-checked")) === "false") await sw.click();
  const address = await page.getByTestId("calendar-address").innerText();
  const img = await page.request.get(address);
  expect(img.ok()).toBe(true);
  expect(img.headers()["content-type"]).toContain("image/svg+xml");
  await sw.click();
  await expect.poll(async () => (await page.request.get(address)).status()).toBe(404);
  await page.goto("/assistants/notify");
  await expect(page.getByTestId("notify-state")).toBeVisible();
  expect((await credentialOf(page)).length).toBeGreaterThan(10);
});
