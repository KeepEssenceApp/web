// Internal QA #98: first-run wording. Four things, in both languages:
//  1 an empty account is told the next step, not that the assistant "has not come yet";
//  2 the Rules page has examples, its range for the days, and says "triage";
//  3 the Devices page says what each permission is, as the core really treats it;
//  4 Account says the interface language changed, and promises nothing about later analyses (QA #18 is open).
import { expect, test, type Page } from "@playwright/test";
import { FAKE, reset, signIn } from "./helpers";

test.skip(!FAKE, "these rely on the fake's seed and hooks");

const status = (page: Page) => page.locator(".status").first();
const saveButton = (page: Page) => page.locator(".inbox").getByRole("button", { name: /^(存入|Save)$/ });

test.describe("QA #98 (1): an empty account", () => {
  test("in Chinese the status bar gives the next step, and does not say the assistant has not come", async ({ page, request }) => {
    await reset(request, { empty: true, never_came: true });
    await signIn(page);
    await expect(page.getByTestId("start")).toBeVisible();
    await expect(status(page)).toContainText("今天还没有存入。把链接或文字贴进「今天」最上面的框。");
    await expect(status(page)).not.toContainText("还没来过");
    // The same words as Getting started's first step.
    await expect(page.getByTestId("start")).toContainText("贴进「今天」最上面的框");
    await expect(page.locator(".status-cell").filter({ hasText: "还没来过" })).toHaveCount(0);
  });

  test("in English the status bar gives the next step, and does not say the assistant has not come", async ({ page, request }) => {
    await reset(request, { empty: true, never_came: true, account_lang: "en" });
    await signIn(page);
    await expect(page.getByTestId("start")).toBeVisible();
    await expect(status(page)).toContainText("Nothing saved today yet. Paste a link or some text into the box at the top of Today.");
    await expect(status(page)).not.toContainText(/has not come yet/i);
    await expect(page.getByTestId("start")).toContainText("into the box at the top of Today");
  });

  test("once something is waiting for an assistant that has never come, that is said, as it is true", async ({ page, request }) => {
    await reset(request, { empty: true, never_came: true });
    await signIn(page);
    await page.locator(".inbox-box").fill("https://example.com/first-thing-98");
    await saveButton(page).click();
    await expect(page.locator(".inbox-result")).toHaveText("已存入。");
    await expect(status(page)).toContainText("内置助手还没来过");
    await expect(status(page)).not.toContainText("今天还没有存入");
  });
});

test.describe("QA #98 (2): the Rules page", () => {
  test("in Chinese: two examples, the range for the days, and the saved rule is not replaced by the example", async ({ page, request }) => {
    await reset(request);
    await signIn(page, "/assistants/rules");
    const box = page.getByRole("textbox", { name: "规则" });
    await expect(box).toHaveAttribute("placeholder", "例如：\n订阅邮件和促销：保留 7 天。\n来自 arxiv.org 的：保留 365 天。");
    // What is saved stays in the box; the placeholder only shows when the box is empty.
    await expect(box).toHaveValue(/保留 90 天/);
    await expect(page.getByTestId("expiry-note")).toHaveText("1 到 6 个，每个 1 到 365 天，用逗号隔开。");
  });

  test("in English: examples, the range, and it says triage, not the dispatch step or a first sort", async ({ page, request }) => {
    await reset(request, { account_lang: "en" });
    await signIn(page, "/assistants/rules");
    const box = page.getByRole("textbox", { name: "Rules" });
    await expect(box).toHaveAttribute("placeholder", "For example:\nNewsletters and promotions: keep 7 days.\nAnything from arxiv.org: keep 365 days.");
    await expect(page.getByTestId("expiry-note")).toHaveText("1 to 6 values, each 1 to 365 days, separated by commas.");
    const main = page.locator("main");
    await expect(main).toContainText("What you tell triage:");
    await expect(main).toContainText("Where triage says nothing");
    await expect(main).not.toContainText(/dispatch step|first sort/i);
    // The range is enforced as it is said: seven values are refused with the sentence.
    const days = page.getByLabel(/Kept for/);
    await days.fill("1, 2, 3, 4, 5, 6, 7");
    await expect(page.getByTestId("expiry-note")).toHaveText("Enter 1 to 6 numbers, each from 1 to 365.");
  });

  test("an item page in English says triage where it spoke of the dispatch step", async ({ page, request }) => {
    await reset(request, { account_lang: "en" });
    await signIn(page, "/item/it_worth");
    await expect(page.locator("main")).toContainText("Once you change either of these, triage no longer changes them.");
    await expect(page.locator("main")).not.toContainText(/dispatch step/i);
  });
});

test.describe("QA #98 (3): the Devices page", () => {
  test("in Chinese each permission has one sentence, and the line under them says only what the core does", async ({ page, request }) => {
    await reset(request);
    await signIn(page, "/assistants/devices");
    const legend = page.getByTestId("tier-legend");
    await expect(legend.locator("li")).toHaveText([
      "只存入 · 只能存入，看不到任何内容",
      "读 · 能读，能对解读和每日摘要做动作",
      "管理 · 还能管理助手、规则、设备、条目和账户",
    ]);
    await expect(page.getByTestId("tier-hint")).toHaveText("这里随时可以改设备的权限。至少要留一台管理档的设备。");
    // The core lets a manager set any tier on an approved device, so the page does not say it cannot be raised.
    await expect(page.locator("main")).not.toContainText("不能调到");
  });

  test("in English the same three sentences and the line under them", async ({ page, request }) => {
    await reset(request, { account_lang: "en" });
    await signIn(page, "/assistants/devices");
    await expect(page.getByTestId("tier-legend").locator("li")).toHaveText([
      "Save only · can only save and sees no content",
      "Read · can read and act on analyses and daily digests",
      "Manage · can also manage assistants, rules, devices, items and the account",
    ]);
    await expect(page.getByTestId("tier-hint")).toHaveText("You can change a device's permission here at any time. At least one device keeps Manage.");
    await expect(page.locator("main")).not.toContainText(/above what it asked/i);
  });

  test("the last device with Manage cannot be lowered, as the line says", async ({ page, request }) => {
    await reset(request);
    await signIn(page, "/assistants/devices");
    const mine = page.locator("[data-device]").filter({ hasText: "这台设备" });
    await mine.getByRole("combobox").selectOption("read");
    await expect(page.locator("[data-device] .bad").first()).toBeVisible();
  });
});

test.describe("QA #98 (4): the language change", () => {
  test("it says the interface language changed and that what exists is not translated, and promises nothing more", async ({ page, request }) => {
    await reset(request);
    await signIn(page, "/assistants/account");
    await expect(page.getByTestId("language-changed")).toHaveCount(0);
    await expect(page.getByTestId("language-hint")).toHaveText("已有的解读和每日摘要不会重新翻译。");

    await page.getByTestId("language").selectOption("en");
    await expect(page.getByTestId("language-changed")).toHaveText("Interface language changed.");
    await expect(page.getByTestId("language-hint")).toHaveText("Analyses and daily digests that already exist are not translated.");
    // No word on what later analyses are written in: that is not promised while QA #18 is open.
    await expect(page.locator("main")).not.toContainText(/New analyses|written in this language|will be written/i);

    await page.getByTestId("language").selectOption("zh");
    await expect(page.getByTestId("language-changed")).toHaveText("界面语言已更改。");
    await expect(page.locator("main")).not.toContainText(/新的解读|用这种语言写/);
  });
});
