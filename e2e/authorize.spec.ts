import { expect, test } from "@playwright/test";
import { FAKE, reset, signIn, state } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seeded authorization requests");
test.beforeEach(async ({ request }) => reset(request));

test("allow page: sign in first, see who and where, name it, pick the kind, untick steps, allow", async ({ page, request }) => {
  // The core sends the browser here; nobody is signed in yet.
  await page.goto("/authorize?request=req_agent");
  await expect(page.locator(".front-tagline")).toHaveText("先登录，再回到刚才那一页。");
  await signIn(page, "/authorize?request=req_agent");
  await expect(page).toHaveURL(/\/authorize\?request=req_agent$/);

  await expect(page.locator(".who")).toHaveText("My Agent 想接入");
  await expect(page.getByTestId("sent-to")).toHaveText("内容会被送到这个助手运行的地方：agent.example.com");
  await expect(page.locator('input[name="kind"][value="scheduled"]')).toBeChecked();
  await expect(page.locator('fieldset input[type="checkbox"]')).toHaveCount(4);

  // Chat can only deep dive.
  await page.locator('input[name="kind"][value="chat"]').check();
  await expect(page.locator('fieldset input[type="checkbox"]')).toHaveCount(1);
  await expect(page.locator('fieldset input[type="checkbox"]')).toHaveValue("deep_dive");
  await page.locator('input[name="kind"][value="scheduled"]').check();
  await page.locator('input[type="checkbox"][value="digest"]').uncheck();
  await page.locator('input[type="checkbox"][value="deep_read"]').uncheck();

  const name = page.locator('.standalone-box input[type="text"]');
  await expect(name).toHaveValue("My Agent");
  await name.fill("阿夜");
  await page.getByRole("button", { name: "允许" }).click();
  // The browser is sent to redirect_to.
  await expect(page).toHaveURL(/\/__test\/oauth-done\?allowed=1/);

  const s = await state(request);
  expect(s.decisions.at(-1)).toMatchObject({ allowed: true, name: "阿夜", assistant_kind: "scheduled", steps: ["analysis", "deep_dive"] });
  await page.goto("/assistants");
  await expect(page.locator("[data-assistant]", { hasText: "阿夜" })).toContainText("解读 · 深挖");
});

test("allow page: a chat assistant by default when it only asks to deep dive; refuse", async ({ page, request }) => {
  await signIn(page, "/authorize?request=req_demo");
  await expect(page.locator(".who")).toHaveText("Example Chat 想接入");
  await expect(page.getByTestId("sent-to")).toContainText("chat.example.com");
  await expect(page.locator('input[name="kind"][value="chat"]')).toBeChecked();
  await expect(page.locator('fieldset input[type="checkbox"]')).toHaveCount(1);
  // A name that is taken is refused by the core, and said.
  await page.locator('.standalone-box input[type="text"]').fill("阿读");
  await page.getByRole("button", { name: "允许" }).click();
  await expect(page.locator('[role="alert"]')).not.toBeEmpty();
  await page.getByRole("button", { name: "拒绝" }).click();
  await expect(page).toHaveURL(/\/__test\/oauth-done\?allowed=0/);
  expect((await state(request)).counts.assistants).toBe(3);

  // A request that was already decided is gone.
  await page.goto("/authorize?request=req_demo");
  await expect(page.locator('[role="alert"]')).not.toBeEmpty();
});

test("allow page: the authorization endpoint redirects the browser to it", async ({ page }) => {
  await signIn(page);
  await page.goto("/oauth/authorize?response_type=code&client_id=x&redirect_uri=https%3A%2F%2Fchat.example.com%2Fcb&code_challenge=abc&code_challenge_method=S256&state=xyz&scope=deep_dive");
  await expect(page).toHaveURL(/\/authorize\?request=/);
  await expect(page.locator(".who")).toBeVisible();
});
