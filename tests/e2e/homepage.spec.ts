import { test, expect } from "@playwright/test";

const BASE_URL = "https://podcast-translation.vercel.app";
const GOTO_OPTS = { waitUntil: "domcontentloaded" as const, timeout: 60_000 };

test.describe("Production Homepage", () => {
  test("page loads and renders hero section", async ({ page }) => {
    await page.goto(BASE_URL, GOTO_OPTS);

    await expect(page).toHaveTitle(/Podcast Translation/i);

    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("Paste one podcast link");

    await expect(page.locator("text=Demo / English to Chinese")).toBeVisible();

    await page.screenshot({ path: "artifacts/homepage-hero.png", fullPage: false });
  });

  test("three feature cards are visible", async ({ page }) => {
    await page.goto(BASE_URL, GOTO_OPTS);

    await expect(page.locator("text=Apple single-episode links")).toBeVisible();
    await expect(page.locator("text=Repeated links reuse")).toBeVisible();
    await expect(page.locator("text=OpenRouter handles transcript")).toBeVisible();
  });

  test("job creation form is present", async ({ page }) => {
    await page.goto(BASE_URL, GOTO_OPTS);

    await expect(page.locator("text=New Job")).toBeVisible();
    await expect(page.locator("text=Start a translation")).toBeVisible();

    const textarea = page.locator("#source-url");
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue(/podcasts\.apple\.com/);

    // Use exact match to avoid ambiguity with "English to Chinese only"
    await expect(page.getByText("Chinese only", { exact: true })).toBeVisible();

    const submitBtn = page.locator("button", { hasText: "Translate episode" });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    await page.screenshot({ path: "artifacts/homepage-form.png", fullPage: false });
  });

  test("sample link buttons work", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60_000 });

    const textarea = page.locator("#source-url");

    // Wait for React hydration by checking the Session ID is rendered
    // (it's computed client-side via useMemo, so its presence confirms hydration)
    await expect(page.locator("text=Session")).toBeVisible();
    await page.waitForTimeout(1000);

    // Click YouTube sample button and wait for value change
    const youtubeBtn = page.locator("button", { hasText: "YouTube / AI founders clip" });
    await youtubeBtn.click();
    await expect(textarea).toHaveValue(/youtube\.com/, { timeout: 10_000 });

    // Click Apple / Lex button
    const lexBtn = page.locator("button", { hasText: "Apple / Lex" });
    await lexBtn.click();
    await expect(textarea).toHaveValue(/podcasts\.apple\.com/, { timeout: 10_000 });
  });

  test("debug lab link navigates to /demo", async ({ page }) => {
    await page.goto(BASE_URL, GOTO_OPTS);

    const debugLink = page.locator("a", { hasText: "Open debug lab" });
    await expect(debugLink).toBeVisible();
    await expect(debugLink).toHaveAttribute("href", "/demo");
  });

  test("scope section renders", async ({ page }) => {
    await page.goto(BASE_URL, GOTO_OPTS);

    await expect(page.locator("text=Scope")).toBeVisible();
    await expect(page.locator("text=Supported inputs")).toBeVisible();
    await expect(page.locator("text=Processing stages")).toBeVisible();
  });

  test("recent jobs section renders", async ({ page }) => {
    await page.goto(BASE_URL, GOTO_OPTS);

    await expect(page.locator("text=Recent Jobs")).toBeVisible();
    await expect(page.locator("text=Latest processing history")).toBeVisible();

    await page.screenshot({ path: "artifacts/homepage-full.png", fullPage: true });
  });

  test("page is responsive on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL, GOTO_OPTS);

    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("#source-url")).toBeVisible();
    await expect(page.locator("button", { hasText: "Translate episode" })).toBeVisible();

    await page.screenshot({ path: "artifacts/homepage-mobile.png", fullPage: true });
  });
});
