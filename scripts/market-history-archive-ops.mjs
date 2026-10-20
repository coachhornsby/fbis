#!/usr/bin/env node
/**
 * Recurring verified market-history archive ops.
 * Runs archive-verify with optional writes + SHA readback.
 * Never deletes D1 rows — retention release stays fail-closed.
 */
import { appendFile } from "node:fs/promises";

const BASE = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
const SECRET = process.env.HARVEST_SECRET || "";
const ARCHIVE_WRITES = process.env.ARCHIVE_WRITES === "true";
const VERIFY_READBACK = process.env.VERIFY_READBACK !== "false";
const LIMIT = Math.min(500, Number(process.env.ARCHIVE_LIMIT) || 100);
const PARTITION = process.env.ARCHIVE_PARTITION || "MARKET_HISTORY_2026Q4_DB";

async function postTopology(operation, extra = {}) {
  if (!SECRET) throw new Error("HARVEST_SECRET_REQUIRED");
  const response = await fetch(`${BASE}/api/database-topology`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-harvest-secret": SECRET,
      "cache-control": "no-cache",
    },
    body: JSON.stringify({ operation, ...extra }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`TOPOLOGY_${operation}_INVALID_JSON_HTTP_${response.status}`);
  }
  if (response.status === 403) throw new Error("TOPOLOGY_FORBIDDEN");
  if (!response.ok) {
    throw new Error(`TOPOLOGY_${operation}_HTTP_${response.status}_${body?.error || body?.reason || "ERROR"}`);
  }
  return body;
}

const archive = await postTopology("market-history-archive-verify", {
  archiveWrites: ARCHIVE_WRITES,
  verifyReadback: VERIFY_READBACK,
  limit: LIMIT,
  partitionBinding: PARTITION,
});

const gate = await postTopology("retention-gate-evaluate", {
  proposal: {
    retentionReleaseAuthorized: false,
    sourceRowsDeleted: 0,
    archiveObjectKey: archive.objectKey || null,
    contentSha256: archive.contentSha256 || null,
    readbackVerified: archive.readbackVerified === true,
  },
});

const deletionBlocked = gate?.authorized !== true;
const failures = [];
if (archive.ok !== true) failures.push(archive.reason || "ARCHIVE_NOT_OK");
if (ARCHIVE_WRITES && VERIFY_READBACK && archive.readbackVerified !== true && archive.archived > 0) {
  failures.push("READBACK_SHA_MISMATCH");
}
if (archive.deletion && !String(archive.deletion).includes("NOT_PERFORMED")) {
  failures.push("UNEXPECTED_DELETION_ATTEMPT");
}
if (!deletionBlocked) failures.push("RETENTION_GATE_MUST_STAY_CLOSED");
if (archive.canAuthorizeWager === true || gate?.canAuthorizeWager === true) {
  failures.push("WAGER_AUTHORITY_MUST_STAY_FALSE");
}

const out = {
  ok: failures.length === 0,
  failures,
  archive: {
    ok: archive.ok === true,
    dryRun: archive.dryRun === true,
    archived: archive.archived ?? 0,
    scanned: archive.scanned ?? null,
    objectKey: archive.objectKey || null,
    manifestKey: archive.manifestKey || null,
    contentSha256: archive.contentSha256 || null,
    readbackVerified: archive.readbackVerified ?? null,
    deletion: archive.deletion || "NOT_PERFORMED_REQUIRES_RETENTION_GATE",
  },
  retentionGate: {
    authorized: gate?.authorized === true,
    blockedReason: gate?.blockedReason || null,
    deletionBlocked,
  },
  archiveWrites: ARCHIVE_WRITES,
  verifyReadback: VERIFY_READBACK,
  partition: PARTITION,
  canAuthorizeWager: false,
};

console.log(JSON.stringify(out, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "## Market-history verified archive ops",
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| ok | ${out.ok} |`,
    `| archived | ${out.archive.archived} |`,
    `| dryRun | ${out.archive.dryRun} |`,
    `| sha | ${(out.archive.contentSha256 || "n/a").slice(0, 16)}… |`,
    `| readbackVerified | ${out.archive.readbackVerified} |`,
    `| deletion | ${out.archive.deletion} |`,
    `| retentionGateAuthorized | ${out.retentionGate.authorized} |`,
    `| canAuthorizeWager | false |`,
    "",
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}

if (!out.ok) process.exit(1);
