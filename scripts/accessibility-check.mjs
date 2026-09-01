import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const base = process.argv[2];
if (!base) throw new Error("Usage: node scripts/accessibility-check.mjs <base-url>");

const browser = await chromium.launch({ headless: true });
const report = { base, generatedAt: new Date().toISOString(), automated: [], manual: [] };

async function pushAutomated(name, pass, detail) {
  report.automated.push({ name, pass, detail });
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/?tab=today`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await pushAutomated("skip-link", (await page.locator('a[href="#main-content"]').count()) > 0, "Skip-to-content link exists.");
  await pushAutomated("main-landmark", (await page.locator("main#main-content").count()) > 0, "Main landmark exists.");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.outerHTML || "");
  await pushAutomated("keyboard-focus-moves", focused.length > 0, "Tab key moves focus.");

  await page.goto(`${base}/?tab=bets`, { waitUntil: "domcontentloaded", timeout: 45000 });
  const importBtn = page.getByRole("button", { name: /import heritage bet slip/i }).first();
  const hasImport = (await importBtn.count()) > 0;
  await pushAutomated("heritage-import-button-name", hasImport, "Import button has accessible name.");
  if (hasImport) {
    await importBtn.click();
    await page.waitForTimeout(300);
    const dialogVisible = await page.locator('[role="dialog"], dialog').count();
    await pushAutomated("modal-opens", dialogVisible > 0, "Heritage modal opens.");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const closed = (await page.locator('[role="dialog"], dialog').count()) === 0;
    await pushAutomated("escape-closes-modal", closed, "Escape closes modal.");
  }

  report.manual.push(
    { name: "contrast", status: "unverified", note: "Manual contrast review required with design tooling." },
    { name: "touch-target sizing", status: "unverified", note: "Requires manual mobile interaction pass." },
    { name: "screen reader announcement for loading/errors", status: "unverified", note: "Needs SR session (VoiceOver/NVDA)." },
    { name: "reduced motion ticker behavior", status: "unverified", note: "Needs manual prefers-reduced-motion verification." }
  );
} finally {
  await browser.close();
}

await mkdir("artifacts/accessibility", { recursive: true });
await writeFile("artifacts/accessibility/report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
