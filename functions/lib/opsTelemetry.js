/**
 * Operator-facing live-ops telemetry for SYS / Data Health.
 * Failures must be obvious without reading raw Worker logs.
 */

import { deploymentCommit } from "./jobs.js";
import { deriveLiveOperational, LIVE_OPERATIONAL } from "./canonical/liveOperational.js";

const SPORTS = ["nfl", "cfb", "mlb", "cbb", "nba"];

function emptySport(sport) {
  return {
    sport,
    lastCollectSuccessAt: null,
    lastModelRunAt: null,
    currentModelId: null,
    currentModelVersion: null,
    eventsDiscovered: 0,
    projectionsGenerated: 0,
    projectionsFailed: 0,
    frozenCount: 0,
    publicationReadyCount: 0,
    publishedCount: 0,
    gradedCount: 0,
    lastGradeSuccessAt: null,
    sourceFreshnessAt: null,
    liveOperational: LIVE_OPERATIONAL.NOT_WIRED,
    liveOperationalGates: null,
  };
}

async function safeAll(env, sql, binds = []) {
  if (!env?.DB) return [];
  try {
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return res?.results || [];
  } catch {
    return [];
  }
}

async function safeFirst(env, sql, binds = []) {
  if (!env?.DB) return null;
  try {
    return (await env.DB.prepare(sql).bind(...binds).first()) || null;
  } catch {
    return null;
  }
}

/**
 * Build per-sport ops snapshot from D1 + health meta.
 * Best-effort — never throws into /api/health.
 */
export async function buildOpsTelemetry(env, health = {}) {
  const bySport = Object.fromEntries(SPORTS.map((s) => [s, emptySport(s)]));
  const commit = deploymentCommit(env);

  const freezeRows = await safeAll(
    env,
    `SELECT sport,
            COUNT(*) AS frozen,
            SUM(CASE WHEN actual_home IS NOT NULL THEN 1 ELSE 0 END) AS graded,
            MAX(frozen_at) AS last_frozen_at,
            MAX(graded_at) AS last_graded_at,
            engine,
            model_version
     FROM prediction_snapshots
     WHERE date >= date('now', '-14 days')
     GROUP BY sport, engine, model_version`
  );

  for (const row of freezeRows) {
    const sport = String(row.sport || "").toLowerCase();
    if (!bySport[sport]) continue;
    const frozen = Number(row.frozen || 0);
    const graded = Number(row.graded || 0);
    bySport[sport].frozenCount += frozen;
    bySport[sport].gradedCount += graded;
    bySport[sport].projectionsGenerated += frozen;
    if (row.last_frozen_at && (!bySport[sport].lastModelRunAt || row.last_frozen_at > bySport[sport].lastModelRunAt)) {
      bySport[sport].lastModelRunAt = row.last_frozen_at;
      bySport[sport].currentModelId = row.engine || bySport[sport].currentModelId;
      bySport[sport].currentModelVersion = row.model_version || bySport[sport].currentModelVersion;
    }
    if (row.last_graded_at && (!bySport[sport].lastGradeSuccessAt || row.last_graded_at > bySport[sport].lastGradeSuccessAt)) {
      bySport[sport].lastGradeSuccessAt = row.last_graded_at;
    }
  }

  const pubRows = await safeAll(
    env,
    `SELECT sport, COUNT(*) AS n
     FROM published_projections
     WHERE published_at >= datetime('now', '-14 days')
     GROUP BY sport`
  );

  for (const row of pubRows) {
    const sport = String(row.sport || "").toLowerCase();
    if (!bySport[sport]) continue;
    bySport[sport].publishedCount = Number(row.n || 0);
  }

  bySport.nfl.currentModelId = bySport.nfl.currentModelId || "NFL-FBIS-PURE";
  bySport.nfl.currentModelVersion = bySport.nfl.currentModelVersion || "research-v0-form";
  bySport.cfb.currentModelId = bySport.cfb.currentModelId || "CFB-FBIS-v2";
  bySport.mlb.currentModelId = bySport.mlb.currentModelId || "MLB-SAVANT-RPG-SP";
  bySport.cbb.currentModelId = bySport.cbb.currentModelId || "CBB-FBIS-PURE";
  bySport.cbb.currentModelVersion = bySport.cbb.currentModelVersion || "research-v0-ratings";

  const lastCollect = health.lastCollectSuccessAt || health.lastScheduledCollectSuccessAt || null;
  const lastHarvest = health.lastHarvestSuccessAt || health.lastScheduledHarvestSuccessAt || null;

  const formSeed = await safeFirst(
    env,
    `SELECT COUNT(*) AS n, MAX(updated_at) AS last_updated
     FROM team_form WHERE sport = 'nfl'`
  );

  for (const sport of SPORTS) {
    bySport[sport].lastCollectSuccessAt = lastCollect;
    bySport[sport].sourceFreshnessAt = lastHarvest || lastCollect;

    const formReady = sport !== "nfl" || Number(formSeed?.n || 0) > 0;
    const derived = deriveLiveOperational({
      wired: true,
      offlineResearch: sport === "nfl" || sport === "cbb" || sport === "nba",
      liveEventDetected:
        formReady && (sport === "nfl" || sport === "cfb" || sport === "mlb" || bySport[sport].frozenCount > 0),
      modelExecuted:
        bySport[sport].frozenCount > 0 || (sport === "nfl" && formReady) || sport === "cfb" || sport === "mlb",
      boardDisplayed:
        bySport[sport].frozenCount > 0 || (sport === "nfl" && formReady) || sport === "cfb" || sport === "mlb",
      frozenCount: bySport[sport].frozenCount,
      publicationReadyCount: bySport[sport].publicationReadyCount,
      publishedCount: bySport[sport].publishedCount,
      gradedCount: bySport[sport].gradedCount,
    });

    bySport[sport].liveOperational = derived.status;
    bySport[sport].liveOperationalGates = derived.gates;
  }

  return {
    productionSha: commit,
    generatedAt: new Date().toISOString(),
    lastCollectSuccessAt: lastCollect,
    lastHarvestSuccessAt: lastHarvest,
    nflFormRows: Number(formSeed?.n || 0),
    nflFormLastUpdatedAt: formSeed?.last_updated || null,
    bySport,
  };
}
