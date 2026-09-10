import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(OUT, { recursive: true });

const BASE = "http://127.0.0.1:4173/?tab=board&sport=cfb&boardQa=1";

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("saved", file);
  return file;
}

async function measureOverflow(page) {
  return page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    cols: getComputedStyle(document.querySelector(".board-card-grid")).gridTemplateColumns.split(" ").length,
  }));
}

async function run() {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const results = {};

  // Desktop 1440 — fixtures + CFB board
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector(".game-card", { timeout: 60000 });
    await page.waitForTimeout(1500);
    results.d1440 = await measureOverflow(page);
    await shot(page, "cfb_board_1440_3col.png");

    // Glow fixtures should be first cards
    const tiers = await page.$$eval(".game-card", (els) =>
      els.slice(0, 6).map((el) => el.getAttribute("data-decision"))
    );
    results.fixtureTiers = tiers;
    await shot(page, "cfb_board_glow_fixtures.png");

    // Click MODEL DETAILS
    const btn = page.locator(".gc-details-btn").first();
    await btn.click();
    await page.waitForSelector(".gc-details", { timeout: 5000 });
    results.clickOpens = true;
    await shot(page, "cfb_model_details_click.png");

    // Keyboard Enter on second details button
    const btn2 = page.locator(".gc-details-btn").nth(1);
    await btn2.focus();
    await page.keyboard.press("Enter");
    const openCount = await page.locator(".gc-details").count();
    results.keyboardEnterOpens = openCount >= 2;

    // Space on third
    const btn3 = page.locator(".gc-details-btn").nth(2);
    await btn3.focus();
    await page.keyboard.press(" ");
    results.keyboardSpaceOpens = (await page.locator(".gc-details").count()) >= 3;

    // Side-by-side matchup present
    results.matchupRows = await page.locator(".gc-matchup-row").count();
    results.hasAt = (await page.locator(".gc-at").count()) > 0;

    // Card heights in first row (3 col)
    results.rowHeights = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".board-card-grid > [role='listitem']")].slice(0, 3);
      return cards.map((el) => Math.round(el.getBoundingClientRect().height));
    });

    await page.close();
  }

  for (const [w, h, name, expectCols] of [
    [1024, 900, "cfb_board_1024_2col.png", 2],
    [768, 900, "cfb_board_768_2col.png", 2],
    [430, 900, "cfb_board_430_1col.png", 1],
    [390, 844, "cfb_board_390_1col.png", 1],
  ]) {
    const context = await browser.newContext({
      viewport: { width: w, height: h },
      hasTouch: true,
      isMobile: w <= 430,
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector(".game-card", { timeout: 60000 });
    await page.waitForTimeout(800);
    const m = await measureOverflow(page);
    results[`w${w}`] = m;
    if (m.cols !== expectCols) console.warn("col mismatch", w, m.cols, "expected", expectCols);
    await shot(page, name);

    if (w === 390) {
      // Mobile tap MODEL DETAILS (touch-enabled context); fall back to click if needed.
      const details = page.locator(".gc-details-btn").first();
      try {
        await details.tap({ timeout: 3000 });
      } catch {
        await details.dispatchEvent("pointerdown", { pointerType: "touch" });
        await details.dispatchEvent("pointerup", { pointerType: "touch" });
        await details.click({ force: true });
      }
      await page.waitForSelector(".gc-details", { timeout: 5000 });
      results.mobileTapOpens = true;
      await shot(page, "cfb_model_details_mobile_tap.png");
    }
    await context.close();
  }

  // MLB side-by-side + SP on fixtures (qa mlb card is on cfb boardQa list)
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto("http://127.0.0.1:4173/?tab=board&sport=mlb&boardQa=1", {
      waitUntil: "networkidle",
      timeout: 90000,
    });
    await page.waitForSelector(".game-card", { timeout: 60000 });
    await page.waitForTimeout(1200);
    const mlbFixture = page.locator('[data-game-id="qa-mlb-sidebyside"]');
    if (await mlbFixture.count()) {
      await mlbFixture.scrollIntoViewIfNeeded();
      await shot(page, "mlb_sidebyside_sp_fixture.png");
      results.mlbStarter = await mlbFixture.locator(".gc-starter").count();
      results.mlbMatchup = await mlbFixture.locator(".gc-matchup-row").count();
    }
    // Live MLB cards if present
    const live = page.locator('.game-card[data-game-id]:not([data-game-id^="qa-"])').first();
    if (await live.count()) {
      await live.scrollIntoViewIfNeeded();
      await shot(page, "mlb_live_sidebyside.png");
    }
    await page.close();
  }

  fs.writeFileSync(path.join(OUT, "board_qa_results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
