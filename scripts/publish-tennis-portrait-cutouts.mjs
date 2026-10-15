#!/usr/bin/env node
/**
 * Publish reviewed transparent WebP cutouts for already-APPROVED tennis portraits.
 * Never scrapes photos and never spends Wikimedia quota. Requires HARVEST_SECRET.
 *
 * Usage:
 *   BASE=https://fbis-myz.pages.dev HARVEST_SECRET=... \
 *     node scripts/publish-tennis-portrait-cutouts.mjs --input-dir ops/tennis-portrait-cutouts/approved
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.BASE || "https://fbis-myz.pages.dev";
const secret = process.env.HARVEST_SECRET;

const args = process.argv.slice(2);
const dirFlag = args.find((a) => a.startsWith("--input-dir="));
const inputDir = dirFlag ? dirFlag.slice("--input-dir=".length) : "ops/tennis-portrait-cutouts/approved";
const dryRun = args.includes("--dry-run");
const only = args.filter((a) => a.startsWith("--player-id=")).map((a) => a.slice("--player-id=".length));
if (!dryRun && (!secret || secret.length < 24)) throw new Error("EXISTING_COLLECTION_AUTH_REQUIRED");

const files = (await readdir(inputDir))
  .filter((name) => name.endsWith(".webp") && name.startsWith("tennis:"))
  .filter((name) => !only.length || only.includes(name.replace(/\.webp$/, "")));

const results = [];
for (const name of files) {
  const playerId = name.replace(/\.webp$/, "");
  const bytes = await readFile(join(inputDir, name));
  const imageSha256 = createHash("sha256").update(bytes).digest("hex");
  if (dryRun) {
    results.push({ playerId, status: "DRY_RUN", bytes: bytes.length, imageSha256 });
    continue;
  }
  try {
    const res = await fetch(`${base}/api/tennis-portrait-cutout`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-harvest-secret": secret },
      body: JSON.stringify({
        playerId,
        imageSha256,
        dataBase64: bytes.toString("base64"),
      }),
      signal: AbortSignal.timeout(120000),
    });
    const body = await res.json().catch(() => ({ reason: "INVALID_JSON" }));
    results.push({ playerId, http: res.status, ...body });
  } catch (error) {
    results.push({ playerId, status: "PUBLISH_FAILED", reason: String(error?.message || error).slice(0, 200) });
  }
}

const summary = {
  ok: results.every((r) => r.status === "CUTOUT_PUBLISHED" || r.status === "DRY_RUN"),
  published: results.filter((r) => r.status === "CUTOUT_PUBLISHED").length,
  failed: results.filter((r) => r.status !== "CUTOUT_PUBLISHED" && r.status !== "DRY_RUN").length,
  dryRun,
  results,
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/tennis-portrait-cutout-publish.json", JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
