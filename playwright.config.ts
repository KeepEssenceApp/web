import { defineConfig, devices } from "@playwright/test";

// Without BASE_URL the tests build the app and run it behind the in-memory fake of the
// contract (dev/fake-core.mjs), which serves dist/ the way production does.
// With BASE_URL they run against whatever is there (a real core); tests that need the
// fake's seed and hooks are skipped.
const fake = !process.env.BASE_URL;
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:8803";

export default defineConfig({
  testDir: "e2e",
  // One backend with one user's state: tests take turns.
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: [["list"]],
  use: { baseURL, locale: "zh-CN", timezoneId: "Asia/Shanghai", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: fake
    ? { command: "npm run build && node dev/fake-core.mjs", url: `${baseURL}/v1/meta`, reuseExistingServer: !process.env.CI, timeout: 60000 }
    : undefined,
});
