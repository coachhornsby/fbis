/**
 * Durable research store. D1 is authoritative when bound.
 * Failures are recorded and returned — never silently ignored for callers.
 * Module-memory `health` is request-local diagnostics only. SYS reads D1.
 */

import { identityFieldsConflict, immutableFieldsConflict } from "./strategy.js";
import { immutableConflict, packExecutedBetRow } from "./executedBets.js";
import { identityFromName } from "./teams.js";

const health = {
  bound: false,
  lastError: null,
  lastWrite: null,
  lastCollect: null,
  lastHarvest: null,
  writes: 0,
  reads: 0,
  failedWrites: 0,
  failedHarvests: 0,
};

export function hasDb(env) {
  return Boolean(env?.DB?.prepare);
}

export function researchHealth() {
  return { ...health };
}

export async function persistMlbMarketProjections(env, rows = []) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", inserted: 0, already: 0, failed: rows.length || 1 };
  const sql = `INSERT OR IGNORE INTO mlb_market_projections (
    id, game_id, date, checkpoint, period, market_type, subject_type,
    subject_id, subject_name, team_id, opponent_id, line, p_over, p_under, average,
    projected_home, projected_away, p_home, p_away, source, source_market_key,
    source_market_name, source_as_of, source_request_id, model_version,
    lineups_official, frozen_at, book, book_line, book_over_price, book_under_price,
    priced, qualification_state, qualification_reason
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = (row) => [
    row.id, row.gameId, row.date, row.checkpoint, row.period, row.marketType, row.subjectType || "game",
    n(row.subjectId), n(row.subjectName), n(row.teamId), n(row.opponentId), n(row.line), n(row.pOver), n(row.pUnder), n(row.average),
    n(row.projectedHome), n(row.projectedAway), n(row.pHome), n(row.pAway), row.source || "ballpark-pal", n(row.sourceMarketKey),
    n(row.sourceMarketName), n(row.sourceAsOf), n(row.sourceRequestId), n(row.modelVersion),
    row.lineupsOfficial == null ? null : row.lineupsOfficial ? 1 : 0, row.frozenAt, n(row.book), n(row.bookLine),
    n(row.bookOverPrice), n(row.bookUnderPrice), row.priced ? 1 : 0,
    row.qualificationState || "PROP_WATCH", n(row.qualificationReason),
  ];
  const validRows = (rows || []).filter((row) => row?.id && row?.gameId && row?.marketType);
  if (typeof env.DB.batch === "function" && validRows.length) {
    let inserted = 0;
    let already = 0;
    try {
      for (let i = 0; i < validRows.length; i += 75) {
        const chunk = validRows.slice(i, i + 75).map((row) => env.DB.prepare(sql).bind(...values(row)));
        const results = await env.DB.batch(chunk);
        for (const res of results || []) {
          if ((Number(res?.meta?.changes) || 0) > 0) inserted += 1; else already += 1;
        }
      }
      markWrite();
      return { ok: true, inserted, already, failed: 0, reason: null };
    } catch (err) {
      markErr(err);
      return { ok: false, inserted, already, failed: validRows.length - inserted - already, reason: String(err?.message || err) };
    }
  }
  let inserted = 0;
  let already = 0;
  let failed = 0;
  const reasons = [];
  for (const row of rows || []) {
    if (!row?.id || !row?.gameId || !row?.marketType) continue;
    try {
      const res = await env.DB.prepare(sql).bind(...values(row)).run();
      const changes = Number(res?.meta?.changes) || 0;
      if (changes) inserted += 1;
      else already += 1;
      markWrite();
    } catch (err) {
      failed += 1;
      const reason = String(err?.message || err);
      reasons.push(reason);
      markErr(err);
    }
  }
  return { ok: failed === 0, inserted, already, failed, reason: [...new Set(reasons)].join("; ") || null };
}

export async function queryMlbMarketProjections(env, { date, gameId, limit = 500 } = {}) {
  if (!hasDb(env)) return [];
  const where = [];
  const binds = [];
  if (date) { where.push("date = ?"); binds.push(date); }
  if (gameId) { where.push("game_id = ?"); binds.push(String(gameId)); }
  const sql = `SELECT * FROM mlb_market_projections${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY frozen_at DESC LIMIT ?`;
  try {
    const res = await env.DB.prepare(sql).bind(...binds, Math.max(1, Math.min(2000, Number(limit) || 500))).all();
    return res?.results || [];
  } catch {
    return [];
  }
}

function markBound(env) {
  health.bound = hasDb(env);
}

function markErr(err, kind = "write") {
  health.lastError = String(err?.message || err);
  if (kind === "harvest") health.failedHarvests += 1;
  else health.failedWrites += 1;
}

function markWrite() {
  health.lastWrite = new Date().toISOString();
  health.writes += 1;
  health.lastError = null;
}

function markRead() {
  health.reads += 1;
  health.lastError = null;
}

export async function pingDb(env) {
  markBound(env);
  if (!hasDb(env)) {
    health.lastError = "D1 not bound";
    return { ok: false, reason: "unbound", ...researchHealth() };
  }
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    markRead();
    return { ok: true, ...researchHealth() };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), ...researchHealth() };
  }
}

export async function persistPipelineStage(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO pipeline_stage_runs
       (id, run_url, stage, sport, trigger_type, status, started_at, completed_at,
        attempt, http_status, error_summary, deployment_commit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      row.id, n(row.runUrl), row.stage, row.sport || "all", n(row.triggerType), row.status,
      row.startedAt, n(row.completedAt), Number(row.attempt) || 1, n(row.httpStatus),
      n(row.errorSummary), n(row.deploymentCommit)
    ).run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function queryPipelineStages(env, { limit = 50 } = {}) {
  if (!hasDb(env)) return [];
  try {
    const res = await env.DB.prepare(
      "SELECT * FROM pipeline_stage_runs ORDER BY started_at DESC LIMIT ?"
    ).bind(Math.max(1, Math.min(250, Number(limit) || 50))).all();
    return res.results || [];
  } catch {
    return [];
  }
}

export async function replaceAccuracyDailySummary(env, rows = []) {
  if (!hasDb(env)) return { ok: false, reason: "unbound", written: 0 };
  if (!rows.length) return { ok: true, written: 0 };
  const sql = `INSERT OR REPLACE INTO accuracy_daily_summary
    (id, sport, date, checkpoint, model_version, projected_n, graded_n,
     abs_total_error_sum, total_bias_sum, winner_correct_n, winner_graded_n,
     brier_sum, brier_n, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  try {
    const statements = rows.map((r) => env.DB.prepare(sql).bind(
      r.id, r.sport, r.date, r.checkpoint, r.modelVersion, r.projectedN, r.gradedN,
      r.absTotalErrorSum, r.totalBiasSum, r.winnerCorrectN, r.winnerGradedN,
      r.brierSum, r.brierN, r.updatedAt
    ));
    for (let i = 0; i < statements.length; i += 75) await env.DB.batch(statements.slice(i, i + 75));
    return { ok: true, written: rows.length };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err), written: 0 };
  }
}

export async function queryAccuracyDailySummary(env, { sport = "all", since, until, checkpoint, version } = {}) {
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [] };
  try {
    let sql = "SELECT * FROM accuracy_daily_summary WHERE 1=1";
    const binds = [];
    if (sport && sport !== "all") { sql += " AND sport = ?"; binds.push(sport); }
    if (since) { sql += " AND date >= ?"; binds.push(since); }
    if (until) { sql += " AND date <= ?"; binds.push(until); }
    if (checkpoint && checkpoint !== "LATEST") { sql += " AND checkpoint = ?"; binds.push(checkpoint); }
    if (version && version !== "all") { sql += " AND model_version = ?"; binds.push(version); }
    sql += " ORDER BY date DESC";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return { ok: true, rows: res.results || [] };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err), rows: [] };
  }
}

function n(v) {
  return v == null || v === "" ? null : v;
}

export async function persistPrediction(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO predictions (
        id, game_id, sport, date, matchup, checkpoint, model_version, as_of,
        proj_home, proj_away, proj_total, proj_margin, pal_home, pal_away,
        p_home_final, p_away_final, p_market, p_espn, p_score, p_form, p_pal,
        weights_json, layers_json, pal_json, pal_as_of, lineups_official, data_quality,
        pin_home_ml, pin_away_ml, pin_vig, engine, actual_home, actual_away, graded_at,
        projection_state, projection_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        row.sport,
        row.date,
        n(row.matchup),
        n(row.checkpoint),
        n(row.modelVersion),
        row.asOf,
        n(row.projHome),
        n(row.projAway),
        n(row.projTotal),
        n(row.projMargin),
        n(row.palHome),
        n(row.palAway),
        n(row.pHomeFinal),
        n(row.pAwayFinal),
        n(row.pMarket),
        n(row.pEspn),
        n(row.pScore),
        n(row.pForm),
        n(row.pPal),
        n(row.weightsJson),
        n(row.layersJson),
        n(row.palJson),
        n(row.palAsOf),
        row.lineupsOfficial == null ? null : row.lineupsOfficial ? 1 : 0,
        n(row.dataQuality),
        n(row.pinHomeMl),
        n(row.pinAwayMl),
        n(row.pinVig),
        n(row.engine),
        n(row.actualHome),
        n(row.actualAway),
        n(row.gradedAt),
        n(row.projectionState),
        n(row.projectionKind)
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("projection_state") || msg.includes("projection_kind")) {
      return persistPredictionLegacy(env, row);
    }
    markErr(err);
    return { ok: false, reason: msg };
  }
}

async function persistPredictionLegacy(env, row) {
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO predictions (
        id, game_id, sport, date, matchup, checkpoint, model_version, as_of,
        proj_home, proj_away, proj_total, proj_margin, pal_home, pal_away,
        p_home_final, p_away_final, p_market, p_espn, p_score, p_form, p_pal,
        weights_json, layers_json, pal_json, pal_as_of, lineups_official, data_quality,
        pin_home_ml, pin_away_ml, pin_vig, engine, actual_home, actual_away, graded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        row.sport,
        row.date,
        n(row.matchup),
        n(row.checkpoint),
        n(row.modelVersion),
        row.asOf,
        n(row.projHome),
        n(row.projAway),
        n(row.projTotal),
        n(row.projMargin),
        n(row.palHome),
        n(row.palAway),
        n(row.pHomeFinal),
        n(row.pAwayFinal),
        n(row.pMarket),
        n(row.pEspn),
        n(row.pScore),
        n(row.pForm),
        n(row.pPal),
        n(row.weightsJson),
        n(row.layersJson),
        n(row.palJson),
        n(row.palAsOf),
        row.lineupsOfficial == null ? null : row.lineupsOfficial ? 1 : 0,
        n(row.dataQuality),
        n(row.pinHomeMl),
        n(row.pinAwayMl),
        n(row.pinVig),
        n(row.engine),
        n(row.actualHome),
        n(row.actualAway),
        n(row.gradedAt)
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

function flagsJson(row) {
  const flags = row.projectionFlags ?? row.qualityFlags ?? row.uncertainty?.flags ?? null;
  if (flags == null) return null;
  return typeof flags === "string" ? flags : JSON.stringify(flags);
}

function layersWithSnap(row) {
  let layers = {};
  try {
    layers = row.layersJson ? JSON.parse(row.layersJson) : {};
  } catch {
    layers = {};
  }
  layers._snap = {
    ...(layers._snap || {}),
    season: row.season ?? null,
    start: row.start ?? null,
    pinSpread: row.pinSpread ?? null,
    pinTotal: row.pinTotal ?? null,
    noVigHome: row.noVigHome ?? null,
    noVigAway: row.noVigAway ?? null,
    noVigOver: row.noVigOver ?? null,
    noVigUnder: row.noVigUnder ?? null,
    pOver: row.pOver ?? null,
    pSpreadHome: row.pSpreadHome ?? null,
    uncertainty: row.uncertainty ?? null,
    marketAt: row.marketAt ?? null,
    gameStatus: row.gameStatus ?? null,
    week: row.week ?? null,
    conference: row.conference ?? null,
    pAwayFinal: row.pAwayFinal ?? null,
    projectionState: row.projectionState ?? row.uncertainty?.projectionState ?? null,
    projectionKind: row.projectionKind ?? null,
    bettingAllowed: row.bettingAllowed ?? row.uncertainty?.bettingAllowed ?? null,
    priorVersion: row.priorVersion ?? row.uncertainty?.priorVersion ?? null,
    projectionFlags: flagsJson(row),
  };
  return JSON.stringify(layers);
}

export async function persistSnapshot(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound", inserted: 0, already: 0, failed: 1, conflict: false };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO prediction_snapshots (
        id, game_id, sport, date, matchup, checkpoint, model_version, frozen_at,
        proj_home, proj_away, proj_total, proj_margin, pal_home, pal_away,
        pal_f5_home, pal_f5_away, pal_p_home, pal_as_of, pal_request_id, pal_json, lineups_official,
        p_home_final, p_market, p_espn, p_score, p_form, p_pal,
        weights_json, layers_json, data_quality,
        pin_home_ml, pin_away_ml, pin_vig, engine, actual_home, actual_away, graded_at, deployment_commit,
        projection_state, projection_kind, projection_flags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        row.sport,
        row.date,
        n(row.matchup),
        row.checkpoint,
        n(row.modelVersion),
        row.frozenAt,
        n(row.projHome),
        n(row.projAway),
        n(row.projTotal),
        n(row.projMargin),
        n(row.palHome),
        n(row.palAway),
        n(row.palF5Home),
        n(row.palF5Away),
        n(row.palPHome),
        n(row.palAsOf),
        n(row.palRequestId),
        n(row.palJson),
        row.lineupsOfficial == null ? null : row.lineupsOfficial ? 1 : 0,
        n(row.pHomeFinal),
        n(row.pMarket),
        n(row.pEspn),
        n(row.pScore),
        n(row.pForm),
        n(row.pPal),
        n(row.weightsJson),
        layersWithSnap(row),
        n(row.dataQuality),
        n(row.pinHomeMl),
        n(row.pinAwayMl),
        n(row.pinVig),
        n(row.engine),
        n(row.actualHome),
        n(row.actualAway),
        n(row.gradedAt),
        n(row.deploymentCommit),
        n(row.projectionState),
        n(row.projectionKind),
        flagsJson(row)
      )
      .run();
    const changes = Number(res?.meta?.changes) || 0;
    markWrite();
    let conflict = false;
    if (!changes) {
      conflict = await snapshotProjectionConflicts(env, row);
    }
    if (row.actualHome != null || row.gameStatus) {
      const graded = await gradeSnapshot(env, row);
      if (!graded.ok && graded.reason !== "no-final") {
        return { ok: false, reason: graded.reason, inserted: changes, already: changes ? 0 : 1, failed: 1, conflict };
      }
    }
    if (conflict) {
      await recordWriteConflict(env, "prediction_snapshots", row.id, "immutable-projection-mismatch");
      if (row.actualHome != null || row.gameStatus) {
        return { ok: true, reason: "immutable-conflict", inserted: 0, already: 1, failed: 0, conflict: true };
      }
      return { ok: false, reason: "immutable-conflict", inserted: 0, already: 0, failed: 1, conflict: true };
    }
    return { ok: true, inserted: changes > 0 ? 1 : 0, already: changes > 0 ? 0 : 1, failed: 0, conflict: false };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("projection_state") || msg.includes("projection_kind") || msg.includes("projection_flags")) {
      return persistSnapshotLegacy(env, row);
    }
    if (msg.includes("deployment_commit")) {
      return persistSnapshotLegacy(env, row);
    }
    markErr(err);
    return { ok: false, reason: msg, inserted: 0, already: 0, failed: 1, conflict: false };
  }
}

function snapNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;
}

async function snapshotProjectionConflicts(env, row) {
  try {
    const existing = await env.DB.prepare(
      "SELECT proj_home, proj_away, p_home_final, pal_home, pal_away, model_version, checkpoint FROM prediction_snapshots WHERE id = ?"
    )
      .bind(row.id)
      .first();
    if (!existing) return false;
    const pairs = [
      [existing.proj_home, row.projHome],
      [existing.proj_away, row.projAway],
      [existing.p_home_final, row.pHomeFinal],
      [existing.pal_home, row.palHome],
      [existing.pal_away, row.palAway],
    ];
    for (const [a, b] of pairs) {
      const x = snapNum(a);
      const y = snapNum(b);
      if (x == null || y == null) continue;
      if (x !== y) return true;
    }
    if (existing.model_version && row.modelVersion && String(existing.model_version) !== String(row.modelVersion)) return true;
    if (existing.checkpoint && row.checkpoint && String(existing.checkpoint) !== String(row.checkpoint)) return true;
    return false;
  } catch {
    return false;
  }
}

async function persistSnapshotLegacy(env, row) {
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO prediction_snapshots (
        id, game_id, sport, date, matchup, checkpoint, model_version, frozen_at,
        proj_home, proj_away, proj_total, proj_margin, pal_home, pal_away,
        pal_f5_home, pal_f5_away, pal_p_home, pal_as_of, pal_request_id, pal_json, lineups_official,
        p_home_final, p_market, p_espn, p_score, p_form, p_pal,
        weights_json, layers_json, data_quality,
        pin_home_ml, pin_away_ml, pin_vig, engine, actual_home, actual_away, graded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        row.sport,
        row.date,
        n(row.matchup),
        row.checkpoint,
        n(row.modelVersion),
        row.frozenAt,
        n(row.projHome),
        n(row.projAway),
        n(row.projTotal),
        n(row.projMargin),
        n(row.palHome),
        n(row.palAway),
        n(row.palF5Home),
        n(row.palF5Away),
        n(row.palPHome),
        n(row.palAsOf),
        n(row.palRequestId),
        n(row.palJson),
        row.lineupsOfficial == null ? null : row.lineupsOfficial ? 1 : 0,
        n(row.pHomeFinal),
        n(row.pMarket),
        n(row.pEspn),
        n(row.pScore),
        n(row.pForm),
        n(row.pPal),
        n(row.weightsJson),
        layersWithSnap(row),
        n(row.dataQuality),
        n(row.pinHomeMl),
        n(row.pinAwayMl),
        n(row.pinVig),
        n(row.engine),
        n(row.actualHome),
        n(row.actualAway),
        n(row.gradedAt)
      )
      .run();
    const changes = Number(res?.meta?.changes) || 0;
    markWrite();
    const conflict = changes ? false : await snapshotProjectionConflicts(env, row);
    if (row.actualHome != null || row.gameStatus) await gradeSnapshot(env, row);
    if (conflict) {
      await recordWriteConflict(env, "prediction_snapshots", row.id, "immutable-projection-mismatch");
      const grading = row.actualHome != null || row.gameStatus;
      return {
        ok: Boolean(grading),
        reason: "immutable-conflict",
        inserted: 0,
        already: 1,
        failed: grading ? 0 : 1,
        conflict: true,
      };
    }
    return { ok: true, inserted: changes > 0 ? 1 : 0, already: changes > 0 ? 0 : 1, failed: 0, conflict: false };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), inserted: 0, already: 0, failed: 1, conflict: false };
  }
}

export async function recordWriteConflict(env, entity, entityId, reason, detail) {
  if (!hasDb(env)) return { ok: false };
  try {
    await env.DB.prepare(
      "INSERT INTO write_conflicts (entity, entity_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(entity, n(entityId), n(reason), n(detail), new Date().toISOString())
      .run();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Attach finals only. Never rewrite frozen projection fields. */
export async function gradeSnapshot(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "unbound" };
  if (row.actualHome == null && !row.gameStatus) return { ok: false, reason: "no-final" };
  try {
    await env.DB.prepare(
      `UPDATE prediction_snapshots
       SET actual_home = COALESCE(actual_home, ?),
           actual_away = COALESCE(actual_away, ?),
           graded_at = COALESCE(graded_at, ?)
       WHERE id = ? AND actual_home IS NULL`
    )
      .bind(n(row.actualHome), n(row.actualAway), n(row.gradedAt || new Date().toISOString()), row.id)
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistOddsSnapshot(env, snap) {
  markBound(env);
  if (!hasDb(env) || !snap?.gameId) return { ok: false, reason: "unbound" };
  const capturedAt = snap.capturedAt || new Date().toISOString();
  const bindsBase = [
    snap.gameId,
    snap.sport,
    n(snap.date),
    n(snap.book),
    n(snap.market),
    n(snap.side),
    n(snap.line),
    n(snap.price),
    n(snap.implied),
    n(snap.noVig),
    capturedAt,
  ];
  try {
    await env.DB.prepare(
      `INSERT INTO odds_snapshots (
        game_id, sport, date, book, market, side, line, price, implied, no_vig, captured_at,
        period, event_id, game_start, checkpoint, rejected_post_start, paired
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        ...bindsBase,
        n(snap.period),
        n(snap.eventId),
        n(snap.gameStart),
        n(snap.checkpoint),
        snap.rejectedPostStart ? 1 : 0,
        snap.paired ? 1 : 0
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    const msg = String(err?.message || err);
    if (/no such column|period|event_id|game_start/i.test(msg)) {
      try {
        await env.DB.prepare(
          `INSERT INTO odds_snapshots (
            game_id, sport, date, book, market, side, line, price, implied, no_vig, captured_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(...bindsBase)
          .run();
        markWrite();
        return { ok: true, legacy: true };
      } catch (err2) {
        markErr(err2);
        return { ok: false, reason: String(err2?.message || err2) };
      }
    }
    markErr(err);
    return { ok: false, reason: msg };
  }
}

export async function queryOddsSnapshots(env, { gameId, sport, since, until } = {}) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [] };
  try {
    let sql = "SELECT * FROM odds_snapshots WHERE 1=1";
    const binds = [];
    if (gameId) {
      sql += " AND game_id = ?";
      binds.push(String(gameId));
    }
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    if (since) {
      sql += " AND date >= ?";
      binds.push(since);
    }
    if (until) {
      sql += " AND date <= ?";
      binds.push(until);
    }
    sql += " ORDER BY captured_at ASC";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    return {
      ok: true,
      rows: (res.results || []).map((r) => ({
        gameId: r.game_id,
        sport: r.sport,
        date: r.date,
        book: r.book,
        market: r.market,
        side: r.side,
        line: r.line,
        price: r.price,
        implied: r.implied,
        noVig: r.no_vig,
        capturedAt: r.captured_at,
        period: r.period || "fg",
        eventId: r.event_id || null,
        gameStart: r.game_start || null,
        checkpoint: r.checkpoint || null,
        rejectedPostStart: Boolean(r.rejected_post_start),
        paired: Boolean(r.paired),
      })),
    };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [] };
  }
}

export async function gradeSnapshotsForGame(env, { gameId, actualHome, actualAway, gradedAt }) {
  markBound(env);
  if (!hasDb(env) || !gameId) return { ok: false, reason: "unbound" };
  if (actualHome == null) return { ok: false, reason: "no-final" };
  const at = gradedAt || new Date().toISOString();
  try {
    await env.DB.prepare(
      `UPDATE prediction_snapshots
       SET actual_home = COALESCE(actual_home, ?),
           actual_away = COALESCE(actual_away, ?),
           graded_at = COALESCE(graded_at, ?)
       WHERE game_id = ? AND actual_home IS NULL`
    )
      .bind(n(actualHome), n(actualAway), n(at), String(gameId))
      .run();
    await env.DB.prepare(
      `UPDATE predictions
       SET actual_home = COALESCE(actual_home, ?),
           actual_away = COALESCE(actual_away, ?),
           graded_at = COALESCE(graded_at, ?)
       WHERE game_id = ? AND actual_home IS NULL`
    )
      .bind(n(actualHome), n(actualAway), n(at), String(gameId))
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistGame(env, game, date) {
  markBound(env);
  if (!hasDb(env) || !game?.id) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO games (id, sport, date, start, home_name, away_name, home_abbr, away_abbr, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        String(game.id),
        game.sport,
        date,
        n(game.start),
        n(game.home?.name),
        n(game.away?.name),
        n(game.home?.abbr),
        n(game.away?.abbr),
        new Date().toISOString()
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function queryGames(env, { sport, date, since } = {}) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [] };
  try {
    let sql = "SELECT * FROM games WHERE 1=1";
    const binds = [];
    if (date) {
      sql += " AND date = ?";
      binds.push(date);
    } else if (since) {
      sql += " AND date >= ?";
      binds.push(since);
    }
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    sql += " ORDER BY start ASC";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    return {
      ok: true,
      rows: (res.results || []).map((r) => ({
        id: r.id,
        sport: r.sport,
        date: r.date,
        start: r.start,
        home: { name: r.home_name, abbr: r.home_abbr },
        away: { name: r.away_name, abbr: r.away_abbr },
        homeName: r.home_name,
        awayName: r.away_name,
        homeAbbr: r.home_abbr,
        awayAbbr: r.away_abbr,
      })),
    };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [] };
  }
}

export async function persistDailyMetrics(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.date) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO daily_metrics (
        date, sport, model_version, checkpoint, n, brier, log_loss, mae_total, mae_margin, winner_hit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.date,
        row.sport,
        row.modelVersion || "",
        row.checkpoint || "LATEST",
        n(row.n),
        n(row.brier),
        n(row.logLoss),
        n(row.maeTotal),
        n(row.maeMargin),
        n(row.winnerHit)
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export function mapSnapshotRow(r) {
  if (!r) return null;
  let extra = {};
  let layers = {};
  try {
    extra = r.pal_json ? JSON.parse(r.pal_json) : {};
  } catch {
    extra = {};
  }
  try {
    layers = r.layers_json ? JSON.parse(r.layers_json) : {};
  } catch {
    layers = {};
  }
  const snap = layers._snap || {};
  const parsed = parseMatchup(r.matchup);
  return {
    id: r.game_id,
    gameId: r.game_id,
    sport: r.sport,
    date: r.date,
    matchup: r.matchup,
    checkpoint: r.checkpoint,
    modelVersion: r.model_version,
    frozenAt: r.frozen_at,
    projHome: r.proj_home,
    projAway: r.proj_away,
    projTotal: r.proj_total,
    projMargin: r.proj_margin,
    palHome: r.pal_home ?? extra.home ?? null,
    palAway: r.pal_away ?? extra.away ?? null,
    palF5Home: r.pal_f5_home ?? extra.f5Home ?? null,
    palF5Away: r.pal_f5_away ?? extra.f5Away ?? null,
    f5Home: r.pal_f5_home ?? extra.f5Home ?? null,
    f5Away: r.pal_f5_away ?? extra.f5Away ?? null,
    palPHome: r.pal_p_home ?? extra.pHome ?? null,
    palAsOf: r.pal_as_of ?? extra.asOf ?? null,
    palTotals: extra.totals || null,
    palRunLine: extra.runLine || extra.runLines || null,
    palPark: extra.park || extra.parkFactors || null,
    pHomeFinal: r.p_home_final,
    pHome: r.p_home_final,
    pAwayFinal: snap.pAwayFinal ?? (r.p_home_final != null ? 1 - r.p_home_final : null),
    impliedHome: r.p_market,
    pMarket: r.p_market,
    pEspn: r.p_espn,
    pScore: r.p_score,
    pForm: r.p_form,
    pPal: r.p_pal ?? extra.pHome ?? null,
    dataQuality: r.data_quality,
    pinHomeMl: r.pin_home_ml,
    pinAwayMl: r.pin_away_ml,
    pinVig: r.pin_vig,
    pinSpread: snap.pinSpread ?? null,
    pinTotal: snap.pinTotal ?? extra.pinTotal ?? null,
    marketProjHome: extra.marketProjHome ?? snap.marketProjHome ?? null,
    marketProjAway: extra.marketProjAway ?? snap.marketProjAway ?? null,
    noVigHome: snap.noVigHome ?? null,
    noVigAway: snap.noVigAway ?? null,
    noVigOver: snap.noVigOver ?? null,
    noVigUnder: snap.noVigUnder ?? null,
    pOver: snap.pOver ?? null,
    pSpreadHome: snap.pSpreadHome ?? null,
    uncertainty: snap.uncertainty ?? null,
    marketAt: snap.marketAt ?? r.frozen_at,
    gameStatus: snap.gameStatus ?? (r.actual_home != null ? "FINAL" : "OPEN"),
    week: snap.week ?? extra.week ?? null,
    conference: snap.conference ?? extra.conference ?? null,
    season: snap.season ?? extra.season ?? null,
    start: snap.start ?? extra.start ?? null,
    engine: r.engine,
    actualHome: r.actual_home,
    actualAway: r.actual_away,
    actualTotal: r.actual_home != null && r.actual_away != null ? r.actual_home + r.actual_away : null,
    gradedAt: r.graded_at,
    lineupsOfficial: r.lineups_official === 1 || extra.lineupsOfficial === true,
    park: extra.park || extra.parkName || "",
    homeSp: extra.homeSp || null,
    awaySp: extra.awaySp || null,
    homeAbbr: extra.homeAbbr || parsed.home,
    awayAbbr: extra.awayAbbr || parsed.away,
    homeName: extra.homeName || null,
    awayName: extra.awayName || null,
    layers,
    projectionState: r.projection_state ?? snap.projectionState ?? snap.uncertainty?.projectionState ?? null,
    projectionKind: r.projection_kind ?? snap.projectionKind ?? null,
    projectionFlags: r.projection_flags ?? snap.projectionFlags ?? snap.uncertainty?.flags ?? null,
    bettingAllowed: snap.bettingAllowed ?? snap.uncertainty?.bettingAllowed ?? null,
    priorVersion: snap.priorVersion ?? snap.uncertainty?.priorVersion ?? null,
  };
}

function parseMatchup(matchup) {
  const m = String(matchup || "").match(/^([A-Z0-9]+)\s*@\s*([A-Z0-9]+)$/i);
  if (!m) return { away: null, home: null };
  return { away: m[1], home: m[2] };
}

const HERITAGE_SNAPSHOT_COLS =
  "game_id, sport, date, checkpoint, model_version, frozen_at, proj_home, proj_away, p_home_final";

function mapHeritageSnapshotRow(r) {
  if (!r) return null;
  return {
    id: r.game_id,
    gameId: r.game_id,
    sport: r.sport,
    date: r.date,
    checkpoint: r.checkpoint,
    modelVersion: r.model_version,
    frozenAt: r.frozen_at,
    projHome: r.proj_home,
    projAway: r.proj_away,
    pHomeFinal: r.p_home_final,
  };
}

export async function querySnapshots(env, { sport, since, until, version, checkpoint, lite = false } = {}) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [] };
  try {
    const cols = lite ? HERITAGE_SNAPSHOT_COLS : "*";
    let sql = `SELECT ${cols} FROM prediction_snapshots WHERE date >= ?`;
    const binds = [since || "2000-01-01"];
    if (until) {
      sql += " AND date <= ?";
      binds.push(until);
    }
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    if (version && version !== "all") {
      sql += " AND model_version = ?";
      binds.push(version);
    }
    if (checkpoint && checkpoint !== "LATEST") {
      sql += " AND checkpoint = ?";
      binds.push(checkpoint);
    }
    sql += " ORDER BY date DESC";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    const map = lite ? mapHeritageSnapshotRow : mapSnapshotRow;
    return { ok: true, rows: (res.results || []).map(map) };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [] };
  }
}

export async function queryPredictions(env, { sport, since, until, version } = {}) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [] };
  try {
    let sql = "SELECT * FROM predictions WHERE date >= ?";
    const binds = [since || "2000-01-01"];
    if (until) {
      sql += " AND date <= ?";
      binds.push(until);
    }
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    if (version && version !== "all") {
      sql += " AND model_version = ?";
      binds.push(version);
    }
    sql += " ORDER BY date DESC";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    return {
      ok: true,
      rows: (res.results || []).map((r) =>
        mapSnapshotRow({
          ...r,
          frozen_at: r.as_of,
          pal_f5_home: null,
          pal_f5_away: null,
          pal_p_home: r.p_pal,
          pal_request_id: null,
        })
      ),
    };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [] };
  }
}

export async function queryVersions(env) {
  markBound(env);
  if (!hasDb(env)) return [];
  try {
    const a = await env.DB.prepare("SELECT DISTINCT model_version AS v FROM prediction_snapshots WHERE model_version IS NOT NULL").all();
    markRead();
    return (a.results || []).map((r) => r.v).filter(Boolean);
  } catch (err) {
    markErr(err);
    return [];
  }
}

export async function countToday(env, date) {
  markBound(env);
  if (!hasDb(env) || !date) {
    return { predictions: 0, graded: 0, awaiting: 0, failedWrites: health.failedWrites, failedHarvests: health.failedHarvests };
  }
  try {
    const a = await env.DB.prepare("SELECT COUNT(*) AS n FROM prediction_snapshots WHERE date = ?").bind(date).first();
    const b = await env.DB.prepare("SELECT COUNT(*) AS n FROM prediction_snapshots WHERE date = ? AND actual_home IS NOT NULL").bind(date).first();
    const c = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM prediction_snapshots WHERE actual_home IS NULL AND date <= ? AND date >= date(?, '-14 days')"
    )
      .bind(date, date)
      .first();
    markRead();
    const meta = await readMeta(env);
    return {
      predictions: Number(a?.n) || 0,
      graded: Number(b?.n) || 0,
      awaiting: Number(c?.n) || 0,
      failedWrites: health.failedWrites,
      failedHarvests: health.failedHarvests,
      lastCollect: meta.last_collect_at || health.lastCollect,
      lastHarvest: meta.last_harvest_at || health.lastHarvest,
      lastWrite: meta.last_write_at || health.lastWrite,
    };
  } catch (err) {
    markErr(err);
    return {
      predictions: 0,
      graded: 0,
      awaiting: 0,
      failedWrites: health.failedWrites,
      failedHarvests: health.failedHarvests,
    };
  }
}

export async function setMeta(env, k, v) {
  markBound(env);
  if (k === "last_collect_at") health.lastCollect = v;
  if (k === "last_harvest_at") health.lastHarvest = v;
  if (k === "last_write_at") health.lastWrite = v;
  if (!hasDb(env) || !k) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare("INSERT OR REPLACE INTO store_meta (k, v) VALUES (?, ?)").bind(k, String(v)).run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function readMeta(env) {
  markBound(env);
  if (!hasDb(env)) return {};
  try {
    const res = await env.DB.prepare("SELECT k, v FROM store_meta").all();
    markRead();
    const out = {};
    for (const row of res.results || []) out[row.k] = row.v;
    return out;
  } catch (err) {
    markErr(err);
    return {};
  }
}

function formKey(team) {
  if (team?.espnId) return `id:${team.espnId}`;
  if (team?.abbr) return `abbr:${String(team.abbr).toUpperCase()}`;
  return `name:${String(team?.name || "").toLowerCase()}`;
}

export async function loadTeamForm(env, sport, season) {
  const map = new Map();
  markBound(env);
  if (!hasDb(env)) return map;
  try {
    const res = await env.DB.prepare("SELECT * FROM team_form WHERE sport = ? AND season = ?")
      .bind(sport, Number(season))
      .all();
    markRead();
    for (const r of res.results || []) {
      const row = {
        teamKey: r.team_key,
        games: Number(r.games) || 0,
        pointsFor: Number(r.points_for) || 0,
        pointsAgainst: Number(r.points_against) || 0,
      };
      map.set(r.team_key, row);
    }
    return map;
  } catch (err) {
    markErr(err);
    return map;
  }
}

export async function upsertTeamForm(env, { sport, season, team, pointsFor, pointsAgainst }) {
  markBound(env);
  if (!hasDb(env) || !team) return { ok: false, reason: "unbound" };
  const key = formKey(team);
  try {
    await env.DB.prepare(
      `INSERT INTO team_form (sport, season, team_key, games, points_for, points_against, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(sport, season, team_key) DO UPDATE SET
         games = games + 1,
         points_for = points_for + excluded.points_for,
         points_against = points_against + excluded.points_against,
         updated_at = excluded.updated_at`
    )
      .bind(sport, Number(season), key, Number(pointsFor), Number(pointsAgainst), new Date().toISOString())
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function applyFinalToForm(env, { sport, season, gameId, date, home, away, homeScore, awayScore }) {
  markBound(env);
  if (!hasDb(env) || !gameId) return { ok: false, reason: "unbound" };
  if (homeScore == null || awayScore == null) return { ok: false, reason: "no-score" };
  try {
    const ins = await env.DB.prepare(
      "INSERT OR IGNORE INTO team_form_games (sport, game_id, date) VALUES (?, ?, ?)"
    )
      .bind(sport, String(gameId), date || null)
      .run();
    if (!ins?.meta?.changes) return { ok: true, skipped: true };
    await upsertTeamForm(env, { sport, season, team: home, pointsFor: homeScore, pointsAgainst: awayScore });
    await upsertTeamForm(env, { sport, season, team: away, pointsFor: awayScore, pointsAgainst: homeScore });
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistDailyReport(env, report) {
  markBound(env);
  if (!hasDb(env) || !report?.sport) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO daily_reports (date, sport, body, metrics_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        report.date || new Date().toISOString().slice(0, 10),
        report.sport,
        report.body || "",
        JSON.stringify({ n: report.n, over: report.over || null }),
        report.generatedAt || new Date().toISOString()
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function queryDailyReports(env, { sport, since } = {}) {
  markBound(env);
  if (!hasDb(env)) return [];
  try {
    let sql = "SELECT * FROM daily_reports WHERE date >= ?";
    const binds = [since || "2000-01-01"];
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    sql += " ORDER BY date DESC, sport LIMIT 12";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    return res.results || [];
  } catch (err) {
    markErr(err);
    return [];
  }
}

export async function persistStrategy(env, strategy) {
  markBound(env);
  if (!hasDb(env) || !strategy?.id) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT INTO strategies (id, name, version, rules_json, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         version = excluded.version,
         rules_json = excluded.rules_json,
         notes = excluded.notes`
    )
      .bind(
        strategy.id,
        strategy.name,
        strategy.version || 1,
        JSON.stringify(strategy.rules || {}),
        strategy.notes || "",
        new Date().toISOString()
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistStrategyTicket(env, row, opts = {}) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  const strict = opts.strictConflict !== false;
  try {
    const existing = await env.DB.prepare("SELECT * FROM strategy_tickets WHERE id = ?").bind(row.id).first();
    if (existing) {
      const mapped = mapStrategyTicket(existing);
      const clash = strict ? immutableFieldsConflict(mapped, row) : identityFieldsConflict(mapped, row);
      if (clash) {
        return { ok: false, conflict: true, reason: "duplicate-conflict" };
      }
      await fillNullStrategyFields(env, row);
      markWrite();
      return { ok: true, already: true };
    }
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO strategy_tickets (
        id, strategy_id, role, sport, date, game_id, matchup, market, side, pick, line,
        ev, edge, tag, pin_vig, pin_price, model_version, checkpoint, data_quality,
        result, profit, clv, traits_json, created_at, graded_at,
        qualified_at, execution_line, execution_price, benchmark_line, benchmark_price,
        entry_no_vig, closing_line, closing_price, closing_no_vig, stake, missing_execution_price,
        provenance, execution_book, benchmark_book, clv_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.strategyId,
        row.role,
        n(row.sport),
        n(row.date),
        n(row.gameId),
        n(row.matchup),
        n(row.market),
        n(row.side),
        n(row.pick),
        n(row.line),
        n(row.ev),
        n(row.edge),
        n(row.tag),
        n(row.pinVig),
        n(row.pinPrice ?? row.executionPrice ?? row.benchmarkPrice),
        n(row.modelVersion),
        n(row.checkpoint),
        n(row.dataQuality),
        n(row.result || "OPEN"),
        n(row.profit),
        n(row.clv),
        n(row.traitsJson),
        new Date().toISOString(),
        n(row.gradedAt),
        n(row.qualifiedAt),
        n(row.executionLine),
        n(row.executionPrice),
        n(row.benchmarkLine),
        n(row.benchmarkPrice),
        n(row.entryNoVig),
        n(row.closingLine),
        n(row.closingPrice),
        n(row.closingNoVig),
        n(row.stake),
        row.missingExecutionPrice ? 1 : 0,
        n(row.provenance),
        n(row.executionBook),
        n(row.benchmarkBook),
        n(row.clvVersion)
      )
      .run();
    markWrite();
    return { ok: true, inserted: (Number(res?.meta?.changes) || 0) > 0 };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

async function fillNullStrategyFields(env, row) {
  try {
    await env.DB.prepare(
      `UPDATE strategy_tickets SET
         ev = COALESCE(ev, ?),
         edge = COALESCE(edge, ?),
         tag = COALESCE(tag, ?),
         pin_vig = COALESCE(pin_vig, ?),
         pin_price = COALESCE(pin_price, ?),
         model_version = COALESCE(model_version, ?),
         checkpoint = COALESCE(checkpoint, ?),
         data_quality = COALESCE(data_quality, ?),
         traits_json = COALESCE(traits_json, ?),
         qualified_at = COALESCE(qualified_at, ?),
         execution_line = COALESCE(execution_line, ?),
         execution_price = COALESCE(execution_price, ?),
         benchmark_line = COALESCE(benchmark_line, ?),
         benchmark_price = COALESCE(benchmark_price, ?),
         entry_no_vig = COALESCE(entry_no_vig, ?),
         closing_line = COALESCE(closing_line, ?),
         closing_price = COALESCE(closing_price, ?),
         closing_no_vig = COALESCE(closing_no_vig, ?),
         stake = COALESCE(stake, ?),
         missing_execution_price = COALESCE(missing_execution_price, ?),
         provenance = COALESCE(provenance, ?),
         execution_book = COALESCE(execution_book, ?),
         benchmark_book = COALESCE(benchmark_book, ?),
         clv_version = COALESCE(clv_version, ?)
       WHERE id = ?`
    )
      .bind(
        n(row.ev),
        n(row.edge),
        n(row.tag),
        n(row.pinVig),
        n(row.pinPrice ?? row.executionPrice),
        n(row.modelVersion),
        n(row.checkpoint),
        n(row.dataQuality),
        n(row.traitsJson),
        n(row.qualifiedAt),
        n(row.executionLine),
        n(row.executionPrice),
        n(row.benchmarkLine),
        n(row.benchmarkPrice),
        n(row.entryNoVig),
        n(row.closingLine),
        n(row.closingPrice),
        n(row.closingNoVig),
        n(row.stake),
        row.missingExecutionPrice ? 1 : 0,
        n(row.provenance),
        n(row.executionBook),
        n(row.benchmarkBook),
        n(row.clvVersion),
        row.id
      )
      .run();
  } catch {
    /* columns may be missing until migration; identity insert still stands */
  }
}

export async function gradeStrategyTicket(env, id, { result, profit, clv, gradedAt, missingExecutionPrice } = {}) {
  markBound(env);
  if (!hasDb(env) || !id) return { ok: false, reason: "unbound" };
  try {
    const existing = await env.DB.prepare("SELECT result, profit, clv FROM strategy_tickets WHERE id = ?").bind(id).first();
    if (existing && existing.result && existing.result !== "OPEN") {
      const sameResult = existing.result === result;
      const sameProfit = String(existing.profit ?? "") === String(profit ?? "");
      const sameClv = String(existing.clv ?? "") === String(clv ?? "");
      if (!sameResult || !sameProfit || !sameClv) {
        return { ok: false, reason: "settled-immutable" };
      }
      return { ok: true, already: true };
    }
    await env.DB.prepare(
      `UPDATE strategy_tickets
       SET result = ?, profit = ?, clv = ?, graded_at = ?, missing_execution_price = COALESCE(?, missing_execution_price)
       WHERE id = ? AND (result IS NULL OR result = 'OPEN')`
    )
      .bind(
        n(result),
        n(profit),
        n(clv),
        n(gradedAt || new Date().toISOString()),
        missingExecutionPrice == null ? null : missingExecutionPrice ? 1 : 0,
        id
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function queryStrategyTickets(env, { strategyId, role } = {}) {
  markBound(env);
  if (!hasDb(env)) return [];
  try {
    let sql = "SELECT * FROM strategy_tickets WHERE 1=1";
    const binds = [];
    if (strategyId) {
      sql += " AND strategy_id = ?";
      binds.push(strategyId);
    }
    if (role) {
      sql += " AND role = ?";
      binds.push(role);
    }
    sql += " ORDER BY date DESC, created_at DESC";
    const res = binds.length ? await env.DB.prepare(sql).bind(...binds).all() : await env.DB.prepare(sql).all();
    markRead();
    return (res.results || []).map(mapStrategyTicket);
  } catch (err) {
    markErr(err);
    return [];
  }
}

function mapStrategyTicket(r) {
  let traits = {};
  try {
    traits = r.traits_json ? JSON.parse(r.traits_json) : {};
  } catch {
    traits = {};
  }
  return {
    id: r.id,
    strategyId: r.strategy_id,
    role: r.role,
    sport: r.sport,
    date: r.date,
    gameId: r.game_id,
    matchup: r.matchup,
    market: r.market,
    side: r.side,
    pick: r.pick,
    line: r.line,
    ev: r.ev,
    edge: r.edge,
    tag: r.tag,
    pinVig: r.pin_vig,
    pinPrice: r.pin_price,
    modelVersion: r.model_version,
    checkpoint: r.checkpoint,
    dataQuality: r.data_quality,
    result: r.result,
    profit: r.profit,
    clv: r.clv,
    traits,
    createdAt: r.created_at,
    gradedAt: r.graded_at,
    qualifiedAt: r.qualified_at || null,
    executionLine: r.execution_line ?? r.line ?? null,
    executionPrice: r.execution_price ?? null,
    benchmarkLine: r.benchmark_line ?? r.line ?? null,
    benchmarkPrice: r.benchmark_price ?? r.pin_price ?? null,
    entryNoVig: r.entry_no_vig ?? null,
    closingLine: r.closing_line ?? null,
    closingPrice: r.closing_price ?? null,
    closingNoVig: r.closing_no_vig ?? null,
    stake: r.stake ?? 1,
    missingExecutionPrice: r.missing_execution_price === 1 || r.execution_price == null,
    provenance: r.provenance || traits.provenance || null,
    executionBook: r.execution_book || null,
    benchmarkBook: r.benchmark_book || "Pinnacle",
    clvVersion: r.clv_version || null,
  };
}

export async function persistJobRun(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  const binds = [
    row.id,
    row.jobType,
    n(row.triggerType),
    n(row.startedAt),
    n(row.completedAt),
    n(row.status),
    n(row.sport),
    n(row.datesJson),
    n(row.gamesDiscovered),
    n(row.writesAttempted),
    n(row.writesSucceeded),
    n(row.writesFailed),
    n(row.finalsDiscovered),
    n(row.finalsGraded),
    n(row.errorSummary),
    n(row.deploymentCommit),
    n(row.modelVersion),
    n(row.projectionsGenerated),
    n(row.writesAlready),
    n(row.immutableConflicts),
    n(row.finalsAwaitingRetry),
  ];
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO job_runs (
        id, job_type, trigger_type, started_at, completed_at, status, sport, dates_json,
        games_discovered, writes_attempted, writes_succeeded, writes_failed,
        finals_discovered, finals_graded, error_summary, deployment_commit, model_version,
        projections_generated, writes_already, immutable_conflicts, finals_awaiting_retry
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(...binds)
      .run();
    markWrite();
    if (row.status === "success") {
      await setMeta(env, "last_d1_write_success_at", row.completedAt || new Date().toISOString());
    }
    return { ok: true };
  } catch (err) {
    try {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO job_runs (
          id, job_type, trigger_type, started_at, completed_at, status, sport, dates_json,
          games_discovered, writes_attempted, writes_succeeded, writes_failed,
          finals_discovered, finals_graded, error_summary, deployment_commit, model_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(...binds.slice(0, 17))
        .run();
      markWrite();
      return { ok: true, truncated: true };
    } catch (err2) {
      markErr(err2);
      return { ok: false, reason: String(err2?.message || err2) };
    }
  }
}

async function latestJob(env, jobPrefix, status) {
  try {
    const sql = status
      ? "SELECT * FROM job_runs WHERE job_type LIKE ? AND status = ? ORDER BY completed_at DESC LIMIT 1"
      : "SELECT * FROM job_runs WHERE job_type LIKE ? AND status != 'success' ORDER BY completed_at DESC LIMIT 1";
    const stmt = status
      ? env.DB.prepare(sql).bind(`${jobPrefix}%`, status)
      : env.DB.prepare(sql).bind(`${jobPrefix}%`);
    return (await stmt.first()) || null;
  } catch {
    return null;
  }
}

export async function queryJobHealth(env, { since } = {}) {
  const meta = await readMeta(env);
  const unbound = {
    source: hasDb(env) ? "d1" : "unbound",
    lastCollectSuccessAt: meta.last_collect_success_at || meta.last_collect_at || null,
    lastCollectAttemptAt: meta.last_collect_attempt_at || null,
    lastHarvestSuccessAt: meta.last_harvest_success_at || meta.last_harvest_at || null,
    lastHarvestAttemptAt: meta.last_harvest_attempt_at || null,
    lastD1WriteSuccessAt: meta.last_d1_write_success_at || meta.last_write_at || null,
    lastFailedCollectAt: meta.last_collect_error_at || null,
    lastFailedHarvestAt: meta.last_harvest_error_at || null,
    failedWrites: 0,
    failedHarvests: 0,
    lastJob: null,
  };
  if (!hasDb(env)) return unbound;
  try {
    const collectOk = await latestJob(env, "collect", "success");
    const harvestOk = await latestJob(env, "harvest", "success");
    const collectFail = await latestJob(env, "collect", null);
    const harvestFail = await latestJob(env, "harvest", null);
    const period = since || "1970-01-01";
    const failWrites = await env.DB.prepare(
      "SELECT COALESCE(SUM(writes_failed), 0) AS n FROM job_runs WHERE started_at >= ?"
    )
      .bind(period)
      .first();
    const failHarvests = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM job_runs WHERE job_type LIKE 'harvest%' AND status != 'success' AND started_at >= ?"
    )
      .bind(period)
      .first();
    const lastJob = await env.DB.prepare("SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 1").first();
    let conflictN = { n: 0 };
    let retryN = { n: 0 };
    try {
      conflictN = (await env.DB.prepare("SELECT COUNT(*) AS n FROM write_conflicts WHERE created_at >= ?").bind(period).first()) || { n: 0 };
    } catch {
      conflictN = { n: 0 };
    }
    try {
      retryN = (await env.DB.prepare("SELECT COUNT(*) AS n FROM harvest_retry_queue WHERE status = 'open'").first()) || { n: 0 };
    } catch {
      retryN = { n: 0 };
    }
    markRead();
    let lastScheduledCollect = null;
    let lastScheduledHarvest = null;
    try {
      lastScheduledCollect = await env.DB.prepare(
        "SELECT * FROM job_runs WHERE job_type LIKE 'collect%' AND trigger_type = 'schedule' AND status = 'success' ORDER BY completed_at DESC LIMIT 1"
      ).first();
      lastScheduledHarvest = await env.DB.prepare(
        "SELECT * FROM job_runs WHERE job_type LIKE 'harvest%' AND trigger_type = 'schedule' AND status = 'success' ORDER BY completed_at DESC LIMIT 1"
      ).first();
    } catch {
      lastScheduledCollect = null;
      lastScheduledHarvest = null;
    }
    return {
      source: "d1",
      lastCollectSuccessAt: collectOk?.completed_at || unbound.lastCollectSuccessAt,
      lastCollectAttemptAt: meta.last_collect_attempt_at || collectOk?.started_at || null,
      lastHarvestSuccessAt: harvestOk?.completed_at || unbound.lastHarvestSuccessAt,
      lastHarvestAttemptAt: meta.last_harvest_attempt_at || harvestOk?.started_at || null,
      lastManualCollectSuccessAt: meta.last_manual_collect_success_at || null,
      lastManualHarvestSuccessAt: meta.last_manual_harvest_success_at || null,
      lastScheduledCollectSuccessAt:
        lastScheduledCollect?.completed_at || meta.last_scheduled_collect_success_at || null,
      lastScheduledHarvestSuccessAt:
        lastScheduledHarvest?.completed_at || meta.last_scheduled_harvest_success_at || null,
      lastScheduledCollectAttemptAt: meta.last_scheduled_collect_attempt_at || null,
      lastScheduledHarvestAttemptAt: meta.last_scheduled_harvest_attempt_at || null,
      lastScheduledEventType: meta.last_scheduled_event_type || (lastScheduledCollect ? "schedule" : null),
      lastScheduledRunUrl: meta.last_scheduled_run_url || null,
      lastD1WriteSuccessAt: meta.last_d1_write_success_at || collectOk?.completed_at || harvestOk?.completed_at || null,
      lastFailedCollectAt: collectFail && collectFail.status !== "success" ? collectFail.completed_at : unbound.lastFailedCollectAt,
      lastFailedHarvestAt: harvestFail && harvestFail.status !== "success" ? harvestFail.completed_at : unbound.lastFailedHarvestAt,
      failedWrites: Number(failWrites?.n) || 0,
      failedHarvests: Number(failHarvests?.n) || 0,
      lastJob: lastJob
        ? {
            id: lastJob.id,
            jobType: lastJob.job_type,
            triggerType: lastJob.trigger_type,
            status: lastJob.status,
            startedAt: lastJob.started_at,
            completedAt: lastJob.completed_at,
            deploymentCommit: lastJob.deployment_commit,
            modelVersion: lastJob.model_version,
          }
        : null,
      immutableConflicts: Number(conflictN?.n) || 0,
      retryOpen: Number(retryN?.n) || 0,
    };
  } catch (err) {
    markErr(err);
    return { ...unbound, source: "d1-error", lastError: String(err?.message || err) };
  }
}

export async function recordMigration(env, id) {
  if (!hasDb(env) || !id) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)"
    )
      .bind(id, new Date().toISOString())
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function listAppliedMigrations(env) {
  if (!hasDb(env)) return [];
  try {
    const res = await env.DB.prepare("SELECT id, applied_at FROM schema_migrations ORDER BY id").all();
    return res.results || [];
  } catch {
    return [];
  }
}

export async function enqueueHarvestRetry(env, { sport, date, gameId, reason }) {
  markBound(env);
  if (!hasDb(env) || !sport || !date) return { ok: false, reason: "unbound" };
  const id = `${sport}:${date}:${gameId || "*"}`;
  try {
    await env.DB.prepare(
      `INSERT INTO harvest_retry_queue (id, sport, date, game_id, reason, attempts, last_attempt_at, created_at, status)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'open')
       ON CONFLICT(id) DO UPDATE SET
         attempts = attempts + 1,
         last_attempt_at = excluded.last_attempt_at,
         reason = excluded.reason,
         status = 'open'`
    )
      .bind(id, sport, date, n(gameId), n(reason), new Date().toISOString(), new Date().toISOString())
      .run();
    markWrite();
    return { ok: true, id };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function resolveHarvestRetry(env, { sport, date, gameId }) {
  if (!hasDb(env) || !sport || !date) return { ok: false };
  const id = `${sport}:${date}:${gameId || "*"}`;
  try {
    await env.DB.prepare("UPDATE harvest_retry_queue SET status = 'resolved' WHERE id = ? OR (sport = ? AND date = ? AND status = 'open' AND game_id IS NULL)")
      .bind(id, sport, date)
      .run();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function openHarvestRetries(env, sport) {
  if (!hasDb(env)) return [];
  try {
    let sql = "SELECT * FROM harvest_retry_queue WHERE status = 'open'";
    const binds = [];
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    const res = binds.length ? await env.DB.prepare(sql).bind(...binds).all() : await env.DB.prepare(sql).all();
    return res.results || [];
  } catch {
    return [];
  }
}

export async function persistHfaExternal(env, row) {
  if (!hasDb(env) || !row?.teamKey) return { ok: false };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO cfb_hfa_external (
        source, rating_year, team_key, team_name, conference, raw_hfa, smooth_hfa,
        supplied_date, methodology, limitations, benchmark_only
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
      .bind(
        row.source,
        row.ratingYear,
        row.teamKey,
        n(row.teamName),
        n(row.conference),
        n(row.rawHfa),
        n(row.smoothHfa),
        n(row.suppliedDate),
        n(row.methodology),
        n(row.limitations)
      )
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistHfaRating(env, row) {
  if (!hasDb(env) || !row?.teamKey) return { ok: false };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO cfb_hfa_ratings (
        method, as_of_season, team_key, national_baseline, raw_hfa, shrunken_hfa, uncertainty,
        games_used, home_n, road_n, seasons_used, n_eff, reliability, recency, method_version,
        available, flags_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.method,
        n(row.asOfSeason),
        row.teamKey,
        n(row.nationalBaseline),
        n(row.rawHfa),
        n(row.shrunkenHfa),
        n(row.uncertainty),
        n(row.gamesUsed),
        n(row.homeN),
        n(row.roadN),
        n(row.seasonsUsed),
        n(row.nEff),
        n(row.reliability),
        n(row.recency),
        n(row.methodVersion),
        row.available ? 1 : 0,
        n(row.flagsJson),
        new Date().toISOString()
      )
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function loadHfaRatings(env, method, asOfSeason) {
  const map = {};
  if (!hasDb(env)) return map;
  try {
    const res = await env.DB.prepare(
      "SELECT * FROM cfb_hfa_ratings WHERE method = ? AND as_of_season = ?"
    )
      .bind(method, Number(asOfSeason))
      .all();
    for (const r of res.results || []) {
      map[r.team_key] = {
        available: r.available === 1,
        raw: r.raw_hfa,
        shrunken: r.shrunken_hfa,
        uncertainty: r.uncertainty,
        sampleSize: r.games_used,
        homeN: r.home_n,
        roadN: r.road_n,
        seasons: r.seasons_used,
        nEff: r.n_eff,
        reliability: r.reliability,
        eligible: r.available === 1,
        flags: r.flags_json ? JSON.parse(r.flags_json) : [],
        methodVersion: r.method_version,
        closingSource: null,
      };
    }
    return map;
  } catch {
    return map;
  }
}

function mapExecutedBet(r) {
  if (!r) return null;
  return {
    id: r.id,
    externalTicketId: r.external_ticket_id,
    executionBook: r.execution_book,
    executedAt: r.executed_at,
    timezone: r.timezone,
    sport: r.sport,
    date: r.date,
    gameId: r.game_id,
    sourceEventId: r.source_event_id,
    sourceUrl: r.source_url,
    matchupText: r.matchup_text,
    awayTeam: r.away_team,
    homeTeam: r.home_team,
    awayIdentity: identityFromName(r.away_team),
    homeIdentity: identityFromName(r.home_team),
    market: r.market,
    period: r.period,
    selectedSide: r.selected_side,
    selectedTeam: r.selected_team,
    executionLine: r.execution_line,
    executionPrice: r.execution_price,
    riskAmount: r.risk_amount,
    toWinAmount: r.to_win_amount,
    potentialPayout: r.potential_payout,
    currency: r.currency,
    importedAt: r.imported_at,
    importSource: r.import_source,
    rawTextHash: r.raw_text_hash,
    matchStatus: r.match_status,
    matchConfidence: r.match_confidence,
    matchedPredictionId: r.matched_prediction_id,
    matchedStrategyTicketId: r.matched_strategy_ticket_id,
    recommendationStatus: r.recommendation_status,
    modelVersionAtEntry: r.model_version_at_entry,
    checkpointAtEntry: r.checkpoint_at_entry,
    result: r.result,
    settledReturn: r.settled_return,
    profit: r.profit,
    gradedAt: r.graded_at,
    voidReason: r.void_reason,
    heritageCurrentLine: r.heritage_current_line,
    heritageCurrentPrice: r.heritage_current_price,
    heritageCurrentAt: r.heritage_current_at,
    pinEntryLine: r.pin_entry_line,
    pinEntryPrice: r.pin_entry_price,
    pinEntryNoVig: r.pin_entry_no_vig,
    pinCloseLine: r.pin_close_line,
    pinClosePrice: r.pin_close_price,
    pinCloseNoVig: r.pin_close_no_vig,
    clv: r.clv,
    clvStatus: r.clv_status,
    clvMethodVersion: r.clv_method_version,
    attributionLabel: r.attribution_label,
  };
}

export async function persistExecutedBet(env, row) {
  markBound(env);
  const packed = packExecutedBetRow(row || {});
  if (!hasDb(env) || !packed?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    const existing = await env.DB.prepare(
      "SELECT * FROM executed_bets WHERE execution_book = ? AND external_ticket_id = ?"
    )
      .bind(packed.executionBook || "Heritage", packed.externalTicketId)
      .first();
    if (existing) {
      const mapped = mapExecutedBet(existing);
      if (immutableConflict(mapped, packed)) {
        await recordWriteConflict(env, "executed_bets", packed.id, "immutable-execution-mismatch");
        return { ok: false, conflict: true, already: true, reason: "duplicate-conflict", existing: mapped };
      }
      markWrite();
      return { ok: true, already: true, existing: mapped };
    }
    await env.DB.prepare(
      `INSERT INTO executed_bets (
        id, external_ticket_id, execution_book, executed_at, timezone, sport, date, game_id,
        source_event_id, source_url, matchup_text, away_team, home_team, market, period,
        selected_side, selected_team, execution_line, execution_price, risk_amount, to_win_amount,
        potential_payout, currency, imported_at, import_source, raw_text_hash, raw_text,
        match_status, match_confidence, matched_prediction_id, matched_strategy_ticket_id,
        recommendation_status, model_version_at_entry, checkpoint_at_entry, result, settled_return,
        profit, graded_at, void_reason, heritage_current_line, heritage_current_price, heritage_current_at,
        pin_entry_line, pin_entry_price, pin_entry_no_vig, pin_close_line, pin_close_price, pin_close_no_vig,
        clv, clv_status, clv_method_version, attribution_label
      ) VALUES (${Array(52).fill("?").join(",")})`
    )
      .bind(
        packed.id,
        packed.externalTicketId,
        packed.executionBook || "Heritage",
        n(packed.executedAt),
        n(packed.timezone),
        n(packed.sport),
        n(packed.date),
        n(packed.gameId),
        n(packed.sourceEventId),
        n(packed.sourceUrl),
        n(packed.matchupText),
        n(packed.awayTeam),
        n(packed.homeTeam),
        n(packed.market),
        n(packed.period),
        n(packed.selectedSide),
        n(packed.selectedTeam),
        n(packed.executionLine),
        n(packed.executionPrice),
        n(packed.riskAmount),
        n(packed.toWinAmount),
        n(packed.potentialPayout),
        n(packed.currency || "USD"),
        packed.importedAt || new Date().toISOString(),
        n(packed.importSource || "heritage-slip"),
        n(packed.rawTextHash),
        n(packed.rawText || null),
        n(packed.matchStatus),
        n(packed.matchConfidence),
        n(packed.matchedPredictionId),
        n(packed.matchedStrategyTicketId),
        n(packed.recommendationStatus),
        n(packed.modelVersionAtEntry),
        n(packed.checkpointAtEntry),
        n(packed.result || "OPEN"),
        n(packed.settledReturn),
        n(packed.profit),
        n(packed.gradedAt),
        n(packed.voidReason),
        n(packed.heritageCurrentLine),
        n(packed.heritageCurrentPrice),
        n(packed.heritageCurrentAt),
        n(packed.pinEntryLine),
        n(packed.pinEntryPrice),
        n(packed.pinEntryNoVig),
        n(packed.pinCloseLine),
        n(packed.pinClosePrice),
        n(packed.pinCloseNoVig),
        n(packed.clv),
        n(packed.clvStatus),
        n(packed.clvMethodVersion),
        n(packed.attributionLabel)
      )
      .run();
    markWrite();
    await appendExecutedBetAudit(env, {
      betId: packed.id,
      action: "import",
      detail: packed.matchStatus || "imported",
    });
    return { ok: true, inserted: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function queryExecutedBets(env, { date, sport, includeRaw = false } = {}) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [] };
  try {
    let sql = includeRaw ? "SELECT * FROM executed_bets WHERE 1=1" : "SELECT * FROM executed_bets WHERE 1=1";
    const binds = [];
    if (date) {
      sql += " AND date = ?";
      binds.push(date);
    }
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    sql += " ORDER BY executed_at DESC";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    return {
      ok: true,
      rows: (res.results || []).map((r) => {
        const mapped = mapExecutedBet(r);
        if (!includeRaw) mapped.rawText = undefined;
        else mapped.rawText = r.raw_text;
        return mapped;
      }),
    };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [] };
  }
}

export async function updateExecutedBet(env, id, patch, action = "correction") {
  markBound(env);
  if (!hasDb(env) || !id) return { ok: false, reason: "unbound" };
  try {
    const existing = await env.DB.prepare("SELECT * FROM executed_bets WHERE id = ?").bind(id).first();
    if (!existing) return { ok: false, reason: "not-found" };
    const mapped = { ...mapExecutedBet(existing), ...patch };
    await env.DB.prepare(
      `UPDATE executed_bets SET
        game_id = ?, selected_side = ?, match_status = ?, match_confidence = ?,
        result = ?, profit = ?, settled_return = ?, graded_at = ?, void_reason = ?,
        matched_prediction_id = ?, matched_strategy_ticket_id = ?, recommendation_status = ?,
        attribution_label = ?, clv = ?, clv_status = ?,
        pin_entry_line = ?, pin_entry_price = ?, pin_entry_no_vig = ?,
        pin_close_line = ?, pin_close_price = ?, pin_close_no_vig = ?
       WHERE id = ?`
    )
      .bind(
        n(mapped.gameId),
        n(mapped.selectedSide),
        n(mapped.matchStatus),
        n(mapped.matchConfidence),
        n(mapped.result),
        n(mapped.profit),
        n(mapped.settledReturn),
        n(mapped.gradedAt),
        n(mapped.voidReason),
        n(mapped.matchedPredictionId),
        n(mapped.matchedStrategyTicketId),
        n(mapped.recommendationStatus),
        n(mapped.attributionLabel),
        n(mapped.clv),
        n(mapped.clvStatus),
        n(mapped.pinEntryLine),
        n(mapped.pinEntryPrice),
        n(mapped.pinEntryNoVig),
        n(mapped.pinCloseLine),
        n(mapped.pinClosePrice),
        n(mapped.pinCloseNoVig),
        id
      )
      .run();
    markWrite();
    await appendExecutedBetAudit(env, { betId: id, action, detail: JSON.stringify(patch).slice(0, 500) });
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function appendExecutedBetAudit(env, { betId, action, detail }) {
  if (!hasDb(env) || !betId) return { ok: false };
  try {
    await env.DB.prepare(
      "INSERT INTO executed_bet_audit (bet_id, action, detail, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(betId, n(action), n(detail), new Date().toISOString())
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}
