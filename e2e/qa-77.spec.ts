// QA #77: a page whose script file is gone (a new version went out in between) is not left blank.
import { expect, test } from "@playwright/test";
import { reset, signIn } from "./helpers";

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("QA #77: a script that fails to load once is asked for again, and the page appears", async ({ page }) => {
  await signIn(page, "/");
  let failed = 0;
  await page.route("**/assets/*.js", (route) => (failed++ === 0 ? route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" }) : route.continue()));
  await page.goto("/item/no_such_item");
  await expect(page.locator(".bad, [role=alert]").first()).toBeVisible();
  expect(failed).toBeGreaterThanOrEqual(2);
});

test("QA #77: when it keeps failing, the page says so instead of staying blank", async ({ page }) => {
  await page.route("**/assets/*.js", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" }));
  await page.goto("/");
  await expect(page.locator("#app")).toContainText("could not be loaded");
});
