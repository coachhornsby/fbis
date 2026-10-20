#!/usr/bin/env node
/**
 * Reclaim MARKET_HISTORY_DB write headroom by deleting aged Polymarket US
 * WebSocket shadow rows (primary remains authoritative). Default dry-run.
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
 *     node scripts/repair-market-history-headroom.mjs \
 *       [--apply] [--cutoff=2026-10-18T00:00:00Z] [--batch=4000] [--max-batches=50]
 */
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const MARKET_HISTORY_DB = "c32ccf06-c896-4d24-bb89-3e87a7412899";
if (!token || !account) throw new Error("CREDENTIALS_REQUIRED");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const cutoffArg = args.find((a) => a.startsWith("--cutoff="));
const batchArg = args.find((a) => a.startsWith("--batch="));
const maxArg = args.find((a) => a.startsWith("--max-batches="));
const cutoff = cutoffArg?.split("=")[1] || "2026-10-18T00:00:00Z";
const batch = Math.max(100, Math.min(5000, Number(batchArg?.split("=")[1] || 4000)));
const maxBatches = Math.max(1, Math.min(200, Number(maxArg?.split("=")[1] || 50)));
if (!Number.isFinite(Date.parse(cutoff))) throw new Error("INVALID_CUTOFF");

const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };

async function api(path, body) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error("CF_API_" + res.status + ":" + JSON.stringify(data.errors || data));
  return data.result;
}

async function query(sql, params = []) {
  const body = params.length ? { sql, params } : { sql };
  const result = await api(`/d1/database/${MARKET_HISTORY_DB}/query`, body);
  return result[0];
}

const before = await api(`/d1/database/${MARKET_HISTORY_DB}`);
const eligible = await query(
  `SELECT COUNT(*) AS n FROM normalized_market_observations WHERE source='Polymarket US WebSocket' AND collected_at < ?`,
  [cutoff],
);
const evidence = {
  contract: "fbis-market-history-headroom-repair-v1",
  startedAt: new Date().toISOString(),
  apply,
  cutoff,
  batch,
  maxBatches,
  databaseId: MARKET_HISTORY_DB,
  fileSizeBefore: before.file_size,
  eligibleRows: Number(eligible?.results?.[0]?.n || 0),
  deleted: 0,
  batches: 0,
  primaryAuthoritative: true,
  canAuthorizeWager: false,
};

if (!apply) {
  evidence.completed = true;
  evidence.mode = "DRY_RUN";
  console.log(JSON.stringify(evidence, null, 2));
  process.exit(0);
}

for (let i = 0; i < maxBatches; i++) {
  const row = await query(
    `DELETE FROM normalized_market_observations WHERE rowid IN (
      SELECT rowid FROM normalized_market_observations
      WHERE source='Polymarket US WebSocket' AND collected_at < ?
      ORDER BY collected_at ASC, rowid ASC LIMIT ${batch}
    )`,
    [cutoff],
  );
  const changes = Number(row?.meta?.changes || 0);
  evidence.deleted += changes;
  evidence.batches += 1;
  evidence.fileSizeAfter = row?.meta?.size_after ?? evidence.fileSizeAfter;
  if (changes === 0) break;
}

const after = await api(`/d1/database/${MARKET_HISTORY_DB}`);
const remain = await query(
  `SELECT COUNT(*) AS n FROM normalized_market_observations WHERE source='Polymarket US WebSocket' AND collected_at < ?`,
  [cutoff],
);
evidence.fileSizeAfter = after.file_size;
evidence.remainingEligible = Number(remain?.results?.[0]?.n || 0);
evidence.bytesFreed = Math.max(0, (evidence.fileSizeBefore || 0) - (evidence.fileSizeAfter || 0));
evidence.completed = true;
evidence.finishedAt = new Date().toISOString();
console.log(JSON.stringify(evidence, null, 2));
if (evidence.fileSizeAfter >= 9_900_000_000) process.exitCode = 2;
