import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.argv[2];
if (!base) throw new Error("Usage: node scripts/capture-viewports.mjs <base-url>");

const targets = [
  { name: "today-390x844", url: `${base}/?tab=today`, viewport: { width: 390, height: 844 } },
  { name: "sys-390x844", url: `${base}/?tab=sys`, viewport: { width: 390, height: 844 } },
  { name: "bets-390x844", url: `${base}/?tab=bets`, viewport: { width: 390, height: 844 } },
  { name: "today-768x1024", url: `${base}/?tab=today`, viewport: { width: 768, height: 1024 } },
  { name: "sys-1280x720", url: `${base}/?tab=sys`, viewport: { width: 1280, height: 720 } },
  { name: "today-1920x1080", url: `${base}/?tab=today`, viewport: { width: 1920, height: 1080 } },
];

await mkdir("artifacts/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const t of targets) {
    const page = await browser.newPage({ viewport: t.viewport });
    await page.goto(t.url, { waitUntil: "networkidle", timeout: 30000 });
    await page.screenshot({ path: `artifacts/screenshots/${t.name}.png`, fullPage: true });
    await page.close();
    console.log(`${t.name}:ok`);
  }
} finally {
  await browser.close();
}
