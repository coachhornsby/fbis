#!/usr/bin/env node
/**
 * Upload verified NFL training CSV + manifest to durable R2 via /api/nfl-training-archive.
 * Verifies SHA-256 against the research reproduction pin before upload.
 * Then GETs the manifest back and spot-checks retrieval.
 *
 * Env:
 *   BASE, HARVEST_SECRET
 *   TRAINING_CSV   path (default artifacts/nfl/nfl_game_training_2015_2026.csv)
 *   EXPECTED_SHA256 optional override; default from research pin file
 *   ARTIFACT_DIR
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const BASE = String(process.env.BASE || "https://fbis-myz.pages.dev").replace(/\/$/, "");
const SECRET = process.env.HARVEST_SECRET || "";
const CSV = process.env.TRAINING_CSV || "artifacts/nfl/nfl_game_training_2015_2026.csv";
const OUT = process.env.ARTIFACT_DIR || "artifacts/nfl-training-archive";
const PIN_FILE = "research/nfl/v1-1-reproduction-20261018/dataset-hashes.txt";

fs.mkdirSync(OUT, { recursive: true });

if (!SECRET) {
  console.error("HARVEST_SECRET required");
  process.exit(2);
}
if (!fs.existsSync(CSV)) {
  console.error(`training CSV missing: ${CSV}`);
  process.exit(2);
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

let expected = String(process.env.EXPECTED_SHA256 || "").toLowerCase();
if (!expected && fs.existsSync(PIN_FILE)) {
  const line = fs.readFileSync(PIN_FILE, "utf8").split("\n").find((l) => l.includes("nfl_game_training_2015_2026.csv"));
  expected = String(line?.split(/\s+/)[0] || "").toLowerCase();
}

const actual = sha256File(CSV);
const st = fs.statSync(CSV);
if (expected && actual !== expected) {
  console.error(JSON.stringify({ ok: false, error: "sha256-mismatch", expected, actual }));
  process.exit(1);
}

const manifest = {
  schema: "nfl-training-archive-manifest-v1",
  createdAt: new Date().toISOString(),
  dataset: "nfl_game_training_2015_2026.csv",
  objectKey: `nfl/training/datasets/${actual}.csv`,
  sha256: actual,
  bytes: st.size,
  pinSource: expected ? PIN_FILE : "computed",
  qaPath: "artifacts/nfl/nfl_game_training_2015_2026_qa.json",
  reproduction: "research/nfl/v1-1-reproduction-20261018/",
  rebuildScript: "scripts/build-nfl-training-dataset.py",
  governance: {
    researchOnly: true,
    canAuthorizeWager: false,
    championUnchanged: true,
  },
};

const putObj = await fetch(
  `${BASE}/api/nfl-training-archive?kind=object&sha256=${actual}`,
  {
    method: "PUT",
    headers: {
      "x-harvest-secret": SECRET,
      "content-type": "text/csv; charset=utf-8",
    },
    body: fs.readFileSync(CSV),
  }
);
const putObjBody = await putObj.json().catch(() => ({}));
fs.writeFileSync(path.join(OUT, "upload-object.json"), JSON.stringify({ http: putObj.status, ...putObjBody }, null, 2));
if (!putObj.ok || !putObjBody.ok) {
  console.error(JSON.stringify({ ok: false, phase: "upload-object", http: putObj.status, body: putObjBody }));
  process.exit(1);
}

const putMan = await fetch(`${BASE}/api/nfl-training-archive?kind=manifest`, {
  method: "PUT",
  headers: {
    "x-harvest-secret": SECRET,
    "content-type": "application/json",
  },
  body: JSON.stringify(manifest),
});
const putManBody = await putMan.json().catch(() => ({}));
fs.writeFileSync(path.join(OUT, "upload-manifest.json"), JSON.stringify({ http: putMan.status, ...putManBody }, null, 2));
if (!putMan.ok || !putManBody.ok) {
  console.error(JSON.stringify({ ok: false, phase: "upload-manifest", http: putMan.status, body: putManBody }));
  process.exit(1);
}

const getMan = await fetch(`${BASE}/api/nfl-training-archive?manifest=1`, {
  headers: { "x-harvest-secret": SECRET },
});
const getManBody = await getMan.json().catch(() => ({}));
fs.writeFileSync(path.join(OUT, "retrieve-manifest.json"), JSON.stringify({ http: getMan.status, ...getManBody }, null, 2));
if (!getMan.ok || getManBody?.manifest?.sha256 !== actual) {
  console.error(JSON.stringify({ ok: false, phase: "retrieve-manifest", http: getMan.status, body: getManBody }));
  process.exit(1);
}

const getCsv = await fetch(`${BASE}/api/nfl-training-archive?key=${encodeURIComponent(manifest.objectKey)}`, {
  headers: { "x-harvest-secret": SECRET },
});
if (!getCsv.ok) {
  console.error(JSON.stringify({ ok: false, phase: "retrieve-csv", http: getCsv.status }));
  process.exit(1);
}
const buf = Buffer.from(await getCsv.arrayBuffer());
const retrievedSha = crypto.createHash("sha256").update(buf).digest("hex");
fs.writeFileSync(path.join(OUT, "retrieve-csv-check.json"), JSON.stringify({
  http: getCsv.status,
  bytes: buf.length,
  sha256: retrievedSha,
  matches: retrievedSha === actual,
}, null, 2));
if (retrievedSha !== actual) {
  console.error(JSON.stringify({ ok: false, phase: "retrieve-csv-hash", expected: actual, actual: retrievedSha }));
  process.exit(1);
}

const summary = {
  ok: true,
  sha256: actual,
  bytes: st.size,
  objectKey: putObjBody.objectKey,
  latestManifestKey: putManBody.latestManifestKey,
  retrievedBytes: buf.length,
  retrievedShaMatches: true,
};
fs.writeFileSync(path.join(OUT, "archive-summary.json"), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(summary));
process.exit(0);
