/**
 * Cross-sport pipeline validation for scheduled collection, projections,
 * odds, model updates, and player props.
 */

import { BOARD_SPORTS } from "./slateEngineCore.js";
import { resolveOperationsDb } from "./databaseOwnership.js";
import { createHash } from "node:crypto";

export const PIPELINE_VALIDATION_SPORTS = Object.freeze([
  ...BOARD_SPORTS,
]);

export const PIPELINE_SURFACES = Object.freeze([
  "collection",
  "projections",
  "odds",
  "model_updates",
  "player_props",
]);

const FRESH_HOURS = {
  collection: 36,
  projections: 36,
  odds: 18,
  model_updates: 72,
  player_props: 36,
};

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function sha16(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
}

async function queryFirst(db, sql, ...binds) {
  if (!db?.prepare) return null;
  try {
    return (await db.prepare(sql).bind(...binds).first()) || null;
  } catch {
    return null;
  }
}

async function validateCollection(db, sport, nowIso) {
  const since = hoursAgoIso(FRESH_HOURS.collection);
  const row = await queryFirst(
    db,
    `SELECT MAX(completed_at) AS last_ok, COUNT(*) AS n
       FROM job_runs
      WHERE status = 'success'
        AND completed_at >= ?
        AND (
          lower(sport) = lower(?)
          OR sport = 'all'
          OR (dates_json IS NOT NULL AND instr(lower(dates_json), lower(?)) > 0)
        )
        AND job_type IN ('collect-cache','collect-full','collect','harvest')`,
    since,
    sport,
    sport
  );
  const ok = Number(row?.n || 0) > 0;
  return {
    surface: "collection",
    ok,
    lastSuccessAt: row?.last_ok || null,
    detail: ok ? "scheduled collect/harvest success within window" : "no successful collect/harvest in window",
    checkedAt: nowIso,
  };
}

async function validateProjections(db, sport, nowIso) {
  const since = hoursAgoIso(FRESH_HOURS.projections);
  const published = await queryFirst(
    db,
    `SELECT MAX(published_at) AS last_ok, COUNT(*) AS n
       FROM published_projections
      WHERE lower(sport) = lower(?)
        AND published_at >= ?`,
    sport,
    since
  );
  if (Number(published?.n || 0) > 0) {
    return {
      surface: "projections",
      ok: true,
      lastSuccessAt: published.last_ok,
      detail: "published projections present",
      checkedAt: nowIso,
    };
  }
  const snaps = await queryFirst(
    db,
    `SELECT MAX(created_at) AS last_ok, COUNT(*) AS n
       FROM prediction_snapshots
      WHERE lower(sport) = lower(?)
        AND created_at >= ?`,
    sport,
    since
  );
  const ok = Number(snaps?.n || 0) > 0;
  return {
    surface: "projections",
    ok,
    lastSuccessAt: snaps?.last_ok || null,
    detail: ok ? "prediction snapshots present" : "no recent projections/snapshots",
    checkedAt: nowIso,
  };
}

async function validateOdds(db, sport, nowIso) {
  const since = hoursAgoIso(FRESH_HOURS.odds);
  const market = await queryFirst(
    db,
    `SELECT MAX(collected_at) AS last_ok, COUNT(*) AS n
       FROM normalized_market_observations
      WHERE lower(sport) = lower(?)
        AND collected_at >= ?
        AND upper(COALESCE(snapshot_type,'CURRENT')) IN ('CURRENT','LIVE')`,
    sport,
    since
  );
  if (Number(market?.n || 0) > 0) {
    return {
      surface: "odds",
      ok: true,
      lastSuccessAt: market.last_ok,
      detail: "current market observations present",
      checkedAt: nowIso,
    };
  }
  const odds = await queryFirst(
    db,
    `SELECT MAX(captured_at) AS last_ok, COUNT(*) AS n
       FROM odds_snapshots
      WHERE lower(sport) = lower(?)
        AND captured_at >= ?`,
    sport,
    since
  );
  const ok = Number(odds?.n || 0) > 0;
  return {
    surface: "odds",
    ok,
    lastSuccessAt: odds?.last_ok || null,
    detail: ok ? "odds snapshots present" : "no recent odds/market observations",
    checkedAt: nowIso,
  };
}

async function validateModelUpdates(db, sport, nowIso) {
  const since = hoursAgoIso(FRESH_HOURS.model_updates);
  const row = await queryFirst(
    db,
    `SELECT MAX(completed_at) AS last_ok, COUNT(*) AS n
       FROM job_runs
      WHERE status IN ('success','partial')
        AND completed_at >= ?
        AND (
          lower(sport) = lower(?)
          OR sport = 'all'
        )
        AND (
          instr(lower(job_type), 'model') > 0
          OR instr(lower(job_type), 'learning') > 0
          OR instr(lower(job_type), 'projection') > 0
          OR instr(lower(job_type), 'collect') > 0
        )`,
    since,
    sport
  );
  const ok = Number(row?.n || 0) > 0;
  return {
    surface: "model_updates",
    ok,
    lastSuccessAt: row?.last_ok || null,
    detail: ok ? "model/learning/projection job activity present" : "no recent model update activity",
    checkedAt: nowIso,
  };
}

async function validatePlayerProps(db, sport, nowIso) {
  const since = hoursAgoIso(FRESH_HOURS.player_props);
  const props = await queryFirst(
    db,
    `SELECT MAX(collected_at) AS last_ok, COUNT(*) AS n
       FROM normalized_market_observations
      WHERE lower(sport) = lower(?)
        AND collected_at >= ?
        AND (
          lower(COALESCE(market_family,'')) LIKE '%prop%'
          OR canonical_player_id IS NOT NULL
          OR provider_player_id IS NOT NULL
          OR player_name IS NOT NULL
        )`,
    sport,
    since
  );
  if (Number(props?.n || 0) > 0) {
    return {
      surface: "player_props",
      ok: true,
      lastSuccessAt: props.last_ok,
      detail: "player-prop market observations present",
      checkedAt: nowIso,
    };
  }
  let prizeRow = await queryFirst(
    db,
    `SELECT MAX(updated_at) AS last_ok, COUNT(*) AS n
       FROM prizepicks_prop_lines
      WHERE lower(sport) = lower(?)
        AND updated_at >= ?`,
    sport,
    since
  );
  if (!Number(prizeRow?.n || 0)) {
    prizeRow = await queryFirst(
      db,
      `SELECT MAX(retrieved_at) AS last_ok, COUNT(*) AS n
         FROM source_observations
        WHERE lower(COALESCE(sport,'')) = lower(?)
          AND retrieved_at >= ?
          AND instr(lower(source), 'prize') > 0`,
      sport,
      since
    );
  }
  const ok = Number(prizeRow?.n || 0) > 0;
  return {
    surface: "player_props",
    ok,
    lastSuccessAt: prizeRow?.last_ok || null,
    detail: ok ? "prop lines / prizepicks observations present" : "no recent player-prop coverage",
    checkedAt: nowIso,
  };
}

export async function validateSportPipeline(env, sport, { now = new Date() } = {}) {
  const db = env?.DB;
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const surfaces = await Promise.all([
    validateCollection(db, sport, nowIso),
    validateProjections(db, sport, nowIso),
    validateOdds(db, sport, nowIso),
    validateModelUpdates(db, sport, nowIso),
    validatePlayerProps(db, sport, nowIso),
  ]);
  const bySurface = Object.fromEntries(surfaces.map((s) => [s.surface, s]));
  const overallOk = surfaces.every((s) => s.ok);
  return {
    sport,
    validatedAt: nowIso,
    overallOk,
    collectionOk: bySurface.collection.ok,
    projectionsOk: bySurface.projections.ok,
    oddsOk: bySurface.odds.ok,
    modelUpdatesOk: bySurface.model_updates.ok,
    playerPropsOk: bySurface.player_props.ok,
    surfaces,
  };
}

export async function validateAllSportPipelines(env, { sports = PIPELINE_VALIDATION_SPORTS, now = new Date() } = {}) {
  const results = [];
  for (const sport of sports) {
    results.push(await validateSportPipeline(env, sport, { now }));
  }
  const failing = results.filter((r) => !r.overallOk);
  return {
    contract: "fbis-pipeline-validation-v1",
    validatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    sportsChecked: results.length,
    sportsPassing: results.length - failing.length,
    sportsFailing: failing.map((r) => r.sport),
    overallOk: failing.length === 0,
    results,
  };
}

export async function persistPipelineValidation(env, report, { deploymentSha = null } = {}) {
  const { db } = resolveOperationsDb(env);
  if (!db?.prepare) return { ok: false, reason: "operations-db-unbound", persisted: 0 };
  let persisted = 0;
  for (const row of report.results || []) {
    const runId = `pipeline:${row.sport}:${sha16(row.validatedAt + row.sport + String(row.overallOk))}`;
    await db.prepare(
      `INSERT OR REPLACE INTO fbis_pipeline_validation_runs (
        run_id, validated_at, sport, collection_ok, projections_ok, odds_ok,
        model_updates_ok, player_props_ok, overall_ok, detail_json, deployment_sha
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      runId,
      row.validatedAt,
      row.sport,
      row.collectionOk ? 1 : 0,
      row.projectionsOk ? 1 : 0,
      row.oddsOk ? 1 : 0,
      row.modelUpdatesOk ? 1 : 0,
      row.playerPropsOk ? 1 : 0,
      row.overallOk ? 1 : 0,
      JSON.stringify(row.surfaces),
      deploymentSha
    ).run();
    persisted += 1;
  }
  return { ok: true, persisted };
}
