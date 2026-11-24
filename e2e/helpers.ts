import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const FAKE = !process.env.BASE_URL || process.env.FAKE === "1";
export const EMAIL = process.env.LOGIN_EMAIL ?? "reader@example.com";

/** Put the fake back to its seed. Against a real core this does nothing. */
export async function reset(request: APIRequestContext, body: Record<string, unknown> = {}) {
  if (FAKE) expect((await request.post("/__test/reset", { data: body })).ok()).toBe(true);
}

/** The sign-in code: fixed in the fake; from the environment or the admin interface otherwise. */
export async function loginCode(request: APIRequestContext): Promise<string> {
  if (FAKE) return "246810";
  if (process.env.LOGIN_CODE) return process.env.LOGIN_CODE;
  const res = await request.get(`/admin/login-codes?email=${encodeURIComponent(EMAIL)}`, { headers: { Authorization: `Bearer ${process.env.ADMIN_SECRET ?? ""}` } });
  expect(res.ok(), "set LOGIN_CODE or ADMIN_SECRET to sign in against a real core").toBe(true);
  return (await res.json()).code;
}

export async function signIn(page: Page, path = "/") {
  await page.goto(path);
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('button[type="submit"]').click();
  await page.locator('input[name="code"]').fill(await loginCode(page.request));
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[name="code"]')).toHaveCount(0);
}

export const credentialOf = (page: Page) => page.evaluate(() => localStorage.getItem("ke.credential") ?? "");

export async function state(request: APIRequestContext) {
  return (await request.get("/__test/state")).json();
}

/** A real finger swipe through the browser's touch input. */
export async function swipe(page: Page, selector: string, dx: number) {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = (await page.locator(selector).first().boundingBox())!;
  const y = box.y + Math.min(60, box.height / 2);
  const x0 = box.x + box.width / 2;
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number) => [{ x, y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(x0) });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x0 + (dx * i) / 8) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
