import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.argv[2];
if (!base) throw new Error("Usage: node scripts/capture-viewports.mjs <base-url>");
const commit = process.argv[3] || "unknown-commit";
const deployment = process.argv[4] || "unknown-deployment";
const canonical = process.argv[5] || base;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const targets = [
  { page: "today", url: `${base}/?tab=today`, viewport: { width: 390, height: 844 } },
  { page: "today", url: `${base}/?tab=today`, viewport: { width: 768, height: 1024 } },
  { page: "today", url: `${base}/?tab=today`, viewport: { width: 1280, height: 720 } },
  { page: "today", url: `${base}/?tab=today`, viewport: { width: 1920, height: 1080 } },
  { page: "board-mlb", url: `${base}/?tab=board&sport=mlb`, viewport: { width: 390, height: 844 }, expandFirst: true },
  { page: "board-mlb", url: `${base}/?tab=board&sport=mlb`, viewport: { width: 768, height: 1024 }, expandFirst: true },
  { page: "board-mlb", url: `${base}/?tab=board&sport=mlb`, viewport: { width: 1280, height: 720 }, expandFirst: true },
  { page: "board-mlb", url: `${base}/?tab=board&sport=mlb`, viewport: { width: 1920, height: 1080 }, expandFirst: true },
  { page: "board-cfb-weekly", url: `${base}/?tab=board&sport=cfb`, viewport: { width: 390, height: 844 }, expandFirst: true },
  { page: "board-cfb-weekly", url: `${base}/?tab=board&sport=cfb`, viewport: { width: 768, height: 1024 }, expandFirst: true },
  { page: "board-cfb-weekly", url: `${base}/?tab=board&sport=cfb`, viewport: { width: 1280, height: 720 }, expandFirst: true },
  { page: "board-cfb-weekly", url: `${base}/?tab=board&sport=cfb`, viewport: { width: 1920, height: 1080 }, expandFirst: true },
  { page: "board-nfl", url: `${base}/?tab=board&sport=nfl`, viewport: { width: 390, height: 844 } },
  { page: "board-nfl", url: `${base}/?tab=board&sport=nfl`, viewport: { width: 1280, height: 720 } },
  { page: "board-nba", url: `${base}/?tab=board&sport=nba`, viewport: { width: 390, height: 844 } },
  { page: "board-nba", url: `${base}/?tab=board&sport=nba`, viewport: { width: 1280, height: 720 } },
  { page: "board-cbb", url: `${base}/?tab=board&sport=cbb`, viewport: { width: 390, height: 844 } },
  { page: "board-cbb", url: `${base}/?tab=board&sport=cbb`, viewport: { width: 1280, height: 720 } },
  { page: "bets", url: `${base}/?tab=bets`, viewport: { width: 390, height: 844 } },
  { page: "bets", url: `${base}/?tab=bets`, viewport: { width: 768, height: 1024 } },
  { page: "bets", url: `${base}/?tab=bets`, viewport: { width: 1280, height: 720 } },
  { page: "bets", url: `${base}/?tab=bets`, viewport: { width: 1920, height: 1080 } },
  { page: "sys-overview", url: `${base}/?tab=sys`, viewport: { width: 390, height: 844 } },
  { page: "sys-overview", url: `${base}/?tab=sys`, viewport: { width: 768, height: 1024 } },
  { page: "sys-overview", url: `${base}/?tab=sys`, viewport: { width: 1280, height: 720 } },
  { page: "sys-overview", url: `${base}/?tab=sys`, viewport: { width: 1920, height: 1080 } },
  { page: "sys-strategy", url: `${base}/?tab=sys`, viewport: { width: 390, height: 844 }, scrollTo: "#sys-strategy" },
  { page: "sys-strategy", url: `${base}/?tab=sys`, viewport: { width: 1280, height: 720 }, scrollTo: "#sys-strategy" },
  { page: "sys-anomalies", url: `${base}/?tab=sys`, viewport: { width: 390, height: 844 }, scrollTo: "#sys-anomalies" },
  { page: "sys-anomalies", url: `${base}/?tab=sys`, viewport: { width: 1280, height: 720 }, scrollTo: "#sys-anomalies" },
  { page: "heritage-modal", url: `${base}/?tab=bets`, viewport: { width: 390, height: 844 }, openModal: true },
  { page: "heritage-modal", url: `${base}/?tab=bets`, viewport: { width: 1280, height: 720 }, openModal: true },
];

await mkdir("artifacts/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true });
const manifest = [];
try {
  for (const t of targets) {
    const page = await browser.newPage({ viewport: t.viewport });
    try {
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (err) {
      console.error(`goto-failed:${t.page}:${t.viewport.width}x${t.viewport.height}:${String(err?.message || err)}`);
    }
    if (t.expandFirst) {
      const btn = page.locator("button.game-expand").first();
      if (await btn.count()) await btn.click().catch(() => {});
    }
    if (t.openModal) {
      const btn = page.getByRole("button", { name: /import heritage bet slip/i }).first();
      if (await btn.count()) await btn.click().catch(() => {});
    }
    if (t.scrollTo) {
      const locator = page.locator(t.scrollTo);
      if (await locator.count()) await locator.scrollIntoViewIfNeeded().catch(() => {});
    }
    const healthState = ((await page.locator(".overall-badge").first().innerText().catch(() => "unknown")) || "unknown")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();
    const vw = `${t.viewport.width}x${t.viewport.height}`;
    const safeBase = canonical.replace(/^https?:\/\//, "").replace(/[^\w.-]/g, "_");
    const filename = `${stamp}__${commit}__${deployment}__${safeBase}__${t.page}__${vw}__${healthState}.png`;
    const path = `artifacts/screenshots/${filename}`;
    await page.screenshot({ path, fullPage: true });
    manifest.push({
      file: path,
      page: t.page,
      url: t.url,
      viewport: t.viewport,
      healthState,
      commit,
      deployment,
      canonical,
      capturedAt: new Date().toISOString(),
    });
    await page.close();
    console.log(`${t.page}-${vw}:ok`);
  }
} finally {
  await browser.close();
}
await writeFile("artifacts/screenshots/manifest.json", JSON.stringify(manifest, null, 2));
