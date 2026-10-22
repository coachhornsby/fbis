/**
 * Sport D1 migration qualification: record-level parity, sync lag, cutover package.
 * Never activates sport authority. Never deletes source rows.
 */
import { resolveSportDb, SPORT_DATABASES, productSportDbHandle, deployedSportDbMode } from "./databaseTopology.js";
import {
  SPORT_WORKING_TABLES,
  SPORT_PREFIX_TABLES,
  SPORT_SYNC_SPORTS,
  verifySportWorkingParity,
  verifySportPrefixParity,
  copySportWorkingTables,
  copySportPrefixTables,
} from "./sportWorkingCopy.js";
import { rehearseSportCutover } from "./sportCutoverRehearsal.js";
import { sha256Hex } from "./sha256Hex.js";

export const SPORT_MIGRATION_QUALIFY_CONTRACT = "fbis-sport-migration-qualify-v1";
export const MAX_SYNC_LAG_MS_DEFAULT = 45 * 60 * 1000;

async function metaGet(sportDb, key) {
  try {
    const row = await sportDb.prepare(
      "SELECT value_text, updated_at FROM fbis_sport_shard_meta WHERE key=? LIMIT 1"
    ).bind(key).first();
    return row || null;
  } catch {
    return null;
  }
}

function numEq(a, b) {
  if (a == null && b == null) return true;
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9;
}

/**
 * Field-level sample parity for games + prediction_snapshots (generic sport).
 */
export async function verifySportRecordLevelParity(env, sport, {
  sampleSize = 40,
  now = new Date(),
} = {}) {
  const key = String(sport || "").toLowerCase();
  const plan = SPORT_DATABASES[key];
  const primary = env?.DB;
  const sportDb = plan?.binding ? env?.[plan.binding] : null;
  if (!primary?.prepare) return { ok: false, reason: "PRIMARY_UNBOUND", sport: key, canAuthorizeWager: false };
  if (!sportDb?.prepare) return { ok: false, reason: "SPORT_DB_UNBOUND", sport: key, canAuthorizeWager: false };

  const limit = Math.min(200, Math.max(5, Number(sampleSize) || 40));
  const gameChecks = [];
  const predChecks = [];
  let gameMatched = 0;
  let predMatched = 0;

  const primaryGames = (await primary.prepare(
    `SELECT id,start,home_name,away_name,home_abbr,away_abbr
     FROM games WHERE sport=? ORDER BY start DESC LIMIT ?`
  ).bind(key, limit).all())?.results || [];

  for (const g of primaryGames) {
    const s = await sportDb.prepare(
      `SELECT id,start,home_name,away_name,home_abbr,away_abbr FROM games WHERE id=? LIMIT 1`
    ).bind(g.id).first();
    const equal = Boolean(s)
      && String(s.start || "") === String(g.start || "")
      && String(s.home_name || "") === String(g.home_name || "")
      && String(s.away_name || "") === String(g.away_name || "")
      && String(s.home_abbr || "") === String(g.home_abbr || "")
      && String(s.away_abbr || "") === String(g.away_abbr || "");
    if (equal) gameMatched += 1;
    gameChecks.push({
      id: g.id,
      status: !s ? "MISSING" : equal ? "MATCH" : "DIVERGED",
    });
  }

  const primaryPreds = (await primary.prepare(
    `SELECT id,game_id,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at
     FROM prediction_snapshots WHERE sport=? ORDER BY frozen_at DESC LIMIT ?`
  ).bind(key, limit).all())?.results || [];

  for (const p of primaryPreds) {
    const s = await sportDb.prepare(
      `SELECT id,game_id,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at
       FROM prediction_snapshots WHERE id=? LIMIT 1`
    ).bind(p.id).first();
    const equal = Boolean(s)
      && String(s.game_id || "") === String(p.game_id || "")
      && String(s.frozen_at || "") === String(p.frozen_at || "")
      && String(s.model_version || "") === String(p.model_version || "")
      && String(s.projection_kind || "") === String(p.projection_kind || "")
      && numEq(s.proj_total, p.proj_total)
      && numEq(s.proj_home, p.proj_home)
      && numEq(s.proj_away, p.proj_away)
      && numEq(s.p_home_final, p.p_home_final);
    if (equal) predMatched += 1;
    predChecks.push({
      id: p.id,
      status: !s ? "MISSING" : equal ? "MATCH" : "DIVERGED",
    });
  }

  const gamesOk = gameChecks.length === 0 || gameMatched === gameChecks.length;
  const predsOk = predChecks.length === 0 || predMatched === predChecks.length;
  const status = gamesOk && predsOk ? "RECORD_PARITY_OK" : "RECORD_PARITY_INCOMPLETE";

  return {
    contract: SPORT_MIGRATION_QUALIFY_CONTRACT,
    ok: status === "RECORD_PARITY_OK",
    sport: key,
    status,
    checkedAt: now instanceof Date ? now.toISOString() : String(now),
    sampleSize: limit,
    games: { sampled: gameChecks.length, matched: gameMatched, status: gamesOk ? "PARITY" : "DIVERGED" },
    predictions: { sampled: predChecks.length, matched: predMatched, status: predsOk ? "PARITY" : "DIVERGED" },
    mismatches: {
      games: gameChecks.filter((c) => c.status !== "MATCH").slice(0, 10),
      predictions: predChecks.filter((c) => c.status !== "MATCH").slice(0, 10),
    },
    productIoUsesSportDb: false,
    cutoverAuthorized: false,
    canAuthorizeWager: false,
  };
}

/**
 * Sync freshness / lag from sport shard meta cursors.
 */
export async function buildSportSyncHealth(env, sport, {
  now = new Date(),
  maxLagMs = MAX_SYNC_LAG_MS_DEFAULT,
} = {}) {
  const key = String(sport || "").toLowerCase();
  const plan = SPORT_DATABASES[key];
  const sportDb = plan?.binding ? env?.[plan.binding] : null;
  const product = productSportDbHandle(env, key);
  if (!sportDb?.prepare) {
    return {
      ok: false,
      sport: key,
      reason: "SPORT_DB_UNBOUND",
      productStillPrimary: product.productIoUsesSportDb !== true,
      cutoverAuthorized: false,
      canAuthorizeWager: false,
    };
  }

  const lastCopy = await metaGet(sportDb, "last_copy_at");
  const lastPrefix = await metaGet(sportDb, "last_prefix_copy_at");
  const parseTs = (row) => {
    const raw = row?.value_text || row?.updated_at || null;
    const ms = raw ? Date.parse(String(raw)) : NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  const copyMs = parseTs(lastCopy);
  const prefixMs = parseTs(lastPrefix);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const lagMs = copyMs == null ? null : Math.max(0, nowMs - copyMs);
  const lagOk = lagMs != null && lagMs <= maxLagMs;

  const prefixExpected = (SPORT_PREFIX_TABLES[key] || []).length;
  let prefixPresent = 0;
  for (const table of SPORT_PREFIX_TABLES[key] || []) {
    try {
      await sportDb.prepare(`SELECT 1 AS ok FROM ${table} LIMIT 1`).first();
      prefixPresent += 1;
    } catch { /* missing */ }
  }

  const mode = deployedSportDbMode(env, key);
  return {
    contract: SPORT_MIGRATION_QUALIFY_CONTRACT,
    ok: lagOk && product.productIoUsesSportDb !== true,
    sport: key,
    binding: plan?.binding || null,
    mode: mode || "shadow",
    lastCopyAt: lastCopy?.value_text || null,
    lastPrefixCopyAt: lastPrefix?.value_text || null,
    lagMs,
    maxLagMs,
    lagOk,
    prefixTables: { expected: prefixExpected, present: prefixPresent },
    workingTables: SPORT_WORKING_TABLES.map((t) => t.table),
    productStillPrimary: product.productIoUsesSportDb !== true,
    cutoverAuthorized: false,
    canAuthorizeWager: false,
  };
}

/**
 * Full qualification package for one sport. Never activates authority.
 */
export async function qualifySportMigration(env, sport, {
  now = new Date(),
  sampleSize = 40,
  runDeltaSync = false,
  includePrefix = true,
  runCutoverRehearsal = false,
} = {}) {
  const key = String(sport || "").toLowerCase();
  if (!SPORT_SYNC_SPORTS.includes(key)) {
    return { ok: false, reason: "SPORT_NOT_SYNC_ELIGIBLE", sport: key, canAuthorizeWager: false };
  }

  let sync = null;
  if (runDeltaSync) {
    sync = await copySportWorkingTables(env, key, {
      pageSize: 250,
      maxPages: 8,
      resume: true,
    });
    if (includePrefix) {
      sync = {
        ...sync,
        prefix: await copySportPrefixTables(env, key, {
          pageSize: 150,
          maxPages: 12,
          resume: true,
          skipCaughtUp: true,
        }),
      };
    }
  }

  const countParity = await verifySportWorkingParity(env, key, { now });
  const recordParity = await verifySportRecordLevelParity(env, key, { sampleSize, now });
  const prefixParity = await verifySportPrefixParity(env, key, { now });
  const health = await buildSportSyncHealth(env, key, { now });

  let cutover = null;
  if (runCutoverRehearsal && ["nfl", "cfb", "nhl", "nba"].includes(key)) {
    // Happy-path rehearsal first: proves consumers/writes/model preservation/rollback
    // with an in-process receipt (never mutates live SPORT_DB_MODE_*).
    cutover = await rehearseSportCutover(env, key, {
      injectMissingBinding: false,
      injectPartialSport: false,
      injectStaleCore: false,
    });
    // Fail-closed probes: missing binding + partial sport data must not look healthy.
    const failClosed = await rehearseSportCutover(env, key, {
      injectMissingBinding: true,
      injectPartialSport: true,
      injectStaleCore: false,
    });
    cutover = {
      ...cutover,
      failClosedProbes: {
        ok: failClosed.ok === true,
        steps: (failClosed.steps || []).map((s) => ({ step: s.step, ok: s.ok })),
      },
      ok: cutover.ok === true && failClosed.ok === true,
    };
  }

  // Empty=empty equality is useful for sync diagnostics but is NOT evidence
  // that a league has any production data, especially NPB and KBO.
  const hasSourceData = [
    ...(countParity.tables || []),
    ...(prefixParity.tables || []),
  ].some(row => Number(row.primaryCount) > 0);
  const hasDeclaredResearchScope = Number(prefixParity.tableCount) > 0;
  const gates = {
    countParity: countParity.ok === true,
    recordParity: recordParity.ok === true,
    sourceCoverage: hasSourceData && hasDeclaredResearchScope,
    // Working-set parity ≠ complete sport migration — prefix research must catch up too.
    prefixParity: prefixParity.ok === true && hasDeclaredResearchScope && hasSourceData,
    // An absent sync timestamp does not qualify a never-synced database.
    syncLag: health.lagOk === true && health.lastCopyAt != null,
    productStillPrimary: health.productStillPrimary === true,
    cutoverRehearsal: cutover ? cutover.ok === true : null,
    cutoverAuthorized: false,
    deletionAuthorized: false,
  };

  const readyForCutoverReview = gates.countParity
    && gates.recordParity
    && gates.sourceCoverage
    && gates.prefixParity
    && gates.syncLag
    && gates.productStillPrimary
    && (cutover ? cutover.ok === true : false);

  const packageBody = {
    contract: SPORT_MIGRATION_QUALIFY_CONTRACT,
    sport: key,
    generatedAt: now instanceof Date ? now.toISOString() : String(now),
    gates,
    readyForCutoverReview,
    // Explicit: this package never activates sport mode.
    activationPerformed: false,
    cutoverAuthorized: false,
    deletionAuthorized: false,
    sync,
    countParity,
    recordParity,
    prefixParity,
    health,
    cutoverRehearsal: cutover,
    rollbackPlan: {
      steps: [
        "Keep SPORT_DB_MODE_* = shadow (or unset)",
        "Do not write SPORT_CUTOVER_RECEIPT_*",
        "Product reads remain on PRIMARY",
        "Re-run sport-delta-sync + record/prefix parity after any failed rehearsal",
        "Confirm model_version set and board fingerprint match baseline before approval",
      ],
    },
    migrationCompleteness: {
      workingSetOnly: gates.countParity && gates.recordParity && !gates.prefixParity,
      fullSportIncludingPrefix: gates.countParity && gates.recordParity && gates.sourceCoverage && gates.prefixParity && gates.syncLag,
      note: "Do not treat games/predictions parity as a complete sport migration",
    },
    canAuthorizeWager: false,
  };

  packageBody.contentSha256 = sha256Hex(JSON.stringify({
    sport: key,
    gates,
    countParity: countParity.status,
    recordParity: recordParity.status,
    prefixParity: prefixParity.status,
    lagMs: health.lagMs,
  }));

  return {
    ok: gates.countParity && gates.recordParity && gates.productStillPrimary,
    productStillPrimary: gates.productStillPrimary,
    ...packageBody,
  };
}

/**
 * Multi-sport health rollup for operator dashboard / CI receipts.
 */
export async function buildAllSportSyncHealth(env, { now = new Date(), sports = SPORT_SYNC_SPORTS } = {}) {
  const rows = [];
  for (const sport of sports) {
    const health = await buildSportSyncHealth(env, sport, { now });
    const parity = await verifySportWorkingParity(env, sport, { now });
    rows.push({
      sport,
      healthOk: health.ok === true,
      lagMs: health.lagMs,
      lagOk: health.lagOk,
      lastCopyAt: health.lastCopyAt,
      parityOk: parity.ok === true,
      parityStatus: parity.status,
      prefixPresent: health.prefixTables?.present ?? 0,
      prefixExpected: health.prefixTables?.expected ?? 0,
      productStillPrimary: health.productStillPrimary,
      mode: health.mode,
    });
  }
  const okCount = rows.filter((r) => r.parityOk && r.productStillPrimary).length;
  return {
    contract: SPORT_MIGRATION_QUALIFY_CONTRACT,
    generatedAt: now instanceof Date ? now.toISOString() : String(now),
    sportCount: rows.length,
    parityOkCount: okCount,
    allProductPrimary: rows.every((r) => r.productStillPrimary),
    cutoverAuthorized: false,
    deletionAuthorized: false,
    sports: rows,
    canAuthorizeWager: false,
  };
}
