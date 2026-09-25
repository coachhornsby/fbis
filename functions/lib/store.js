/**
 * Durable research store. D1 is authoritative when bound.
 * Failures are recorded and returned — never silently ignored for callers.
 * Module-memory `health` is request-local diagnostics only. SYS reads D1.
 */

import { identityFieldsConflict, immutableFieldsConflict } from "./strategy.js";
import { immutableConflict, packExecutedBetRow } from "./executedBets.js";
import { identityForSport } from "./teams.js";
import {
  EXPECTED_ROI_FORMULA_VERSION,
  PROBABILITY_SCHEMA_VERSION,
  expectedRoiMatches,
  readCanonicalProbability,
} from "./probability.js";
import { expectedRoi, validAmericanOdds } from "./pricing.js";

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

export async function gradeSnapshotsForGame(env, { gameId, actualHome, actualAway, f5ActualHome = null, f5ActualAway = null, gradedAt }) {
  markBound(env);
  if (!hasDb(env) || !gameId) return { ok: false, reason: "unbound" };
  if (actualHome == null) return { ok: false, reason: "no-final" };
  const at = gradedAt || new Date().toISOString();
  try {
    await env.DB.prepare(
      `UPDATE prediction_snapshots
       SET actual_home = COALESCE(actual_home, ?),
           actual_away = COALESCE(actual_away, ?),
           f5_actual_home = COALESCE(f5_actual_home, ?),
           f5_actual_away = COALESCE(f5_actual_away, ?),
           graded_at = COALESCE(graded_at, ?)
       WHERE game_id = ?`
    )
      .bind(n(actualHome), n(actualAway), n(f5ActualHome), n(f5ActualAway), n(at), String(gameId))
      .run();
    await env.DB.prepare(
      `UPDATE predictions
       SET actual_home = COALESCE(actual_home, ?),
           actual_away = COALESCE(actual_away, ?),
           f5_actual_home = COALESCE(f5_actual_home, ?),
           f5_actual_away = COALESCE(f5_actual_away, ?),
           graded_at = COALESCE(graded_at, ?)
       WHERE game_id = ?`
    )
      .bind(n(actualHome), n(actualAway), n(f5ActualHome), n(f5ActualAway), n(at), String(gameId))
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

export async function queryGamesByIds(env, ids = []) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [] };
  const clean = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!clean.length) return { ok: true, rows: [] };
  try {
    const rows = [];
    const chunkSize = 200;
    for (let i = 0; i < clean.length; i += chunkSize) {
      const chunk = clean.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(", ");
      const sql = `SELECT * FROM games WHERE id IN (${placeholders})`;
      const res = await env.DB.prepare(sql).bind(...chunk).all();
      for (const r of (res.results || [])) {
        rows.push({
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
        });
      }
    }
    markRead();
    return { ok: true, rows };
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

export async function queryDailyMetrics(
  env,
  { sport = "all", since = null, until = null, checkpoint = "LATEST", modelVersion = "all" } = {}
) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [] };
  try {
    let sql = "SELECT * FROM daily_metrics WHERE 1=1";
    const binds = [];
    if (since) {
      sql += " AND date >= ?";
      binds.push(since);
    }
    if (until) {
      sql += " AND date <= ?";
      binds.push(until);
    }
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    if (checkpoint && checkpoint !== "all") {
      sql += " AND checkpoint = ?";
      binds.push(checkpoint);
    }
    if (modelVersion && modelVersion !== "all") {
      sql += " AND model_version = ?";
      binds.push(modelVersion);
    }
    sql += " ORDER BY date DESC, sport ASC";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    return {
      ok: true,
      rows: (res.results || []).map((r) => ({
        date: r.date,
        sport: r.sport,
        modelVersion: r.model_version || "",
        checkpoint: r.checkpoint || "LATEST",
        n: Number(r.n) || 0,
        brier: r.brier == null ? null : Number(r.brier),
        logLoss: r.log_loss == null ? null : Number(r.log_loss),
        maeTotal: r.mae_total == null ? null : Number(r.mae_total),
        maeMargin: r.mae_margin == null ? null : Number(r.mae_margin),
        winnerHit: r.winner_hit == null ? null : Number(r.winner_hit),
      })),
    };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [] };
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
    f5ActualHome: r.f5_actual_home,
    f5ActualAway: r.f5_actual_away,
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

export async function ensureProbabilityIntegrityMigration(env) {
  if (!hasDb(env)) return { ok: false, reason: "unbound" };
  const alters = [
    "ALTER TABLE strategy_tickets ADD COLUMN model_probability REAL",
    "ALTER TABLE strategy_tickets ADD COLUMN probability_schema_version TEXT",
    "ALTER TABLE strategy_tickets ADD COLUMN expected_roi_formula_version TEXT",
    "ALTER TABLE strategy_tickets ADD COLUMN validation_timestamp TEXT",
    "ALTER TABLE strategy_tickets ADD COLUMN validation_result TEXT",
    "ALTER TABLE strategy_tickets ADD COLUMN validation_failure_reason TEXT",
    "ALTER TABLE strategy_tickets ADD COLUMN source_projection_id TEXT",
    "ALTER TABLE strategy_tickets ADD COLUMN market_snapshot_id TEXT",
    "ALTER TABLE strategy_tickets ADD COLUMN freeze_id TEXT",
    "ALTER TABLE strategy_tickets ADD COLUMN qualification_rule_version TEXT",
  ];
  for (const sql of alters) {
    try {
      await env.DB.prepare(sql).run();
    } catch (err) {
      const msg = String(err?.message || err);
      if (!/duplicate column|already exists/i.test(msg)) {
        /* keep going — some D1 drivers throw on duplicate */
      }
    }
  }
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS strategy_ticket_probability_corrections (
        id TEXT PRIMARY KEY,
        original_ticket_id TEXT NOT NULL,
        reconstructed_model_probability REAL,
        reconstruction_source TEXT,
        reconstruction_status TEXT NOT NULL,
        reconstruction_reason TEXT,
        expected_roi_recomputed REAL,
        freeze_id TEXT,
        source_projection_id TEXT,
        market_snapshot_id TEXT,
        inputs_json TEXT,
        created_at TEXT NOT NULL
      )`
    ).run();
    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_prob_corrections_ticket ON strategy_ticket_probability_corrections (original_ticket_id, created_at)"
    ).run();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS strategy_qualification_attempts (
        id TEXT PRIMARY KEY,
        game_id TEXT,
        sport TEXT,
        date TEXT,
        market TEXT,
        side TEXT,
        model_probability REAL,
        expected_roi REAL,
        validation_result TEXT NOT NULL,
        validation_failure_reason TEXT,
        freeze_id TEXT,
        source_projection_id TEXT,
        market_snapshot_id TEXT,
        canary INTEGER,
        created_at TEXT NOT NULL
      )`
    ).run();
    await env.DB.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0013_probability_integrity', datetime('now'))").run();
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
  return { ok: true };
}

export async function claimConvictionCanaryLock(env) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, claimed: false };
  try {
    const res = await env.DB.prepare("INSERT OR IGNORE INTO store_meta (k, v) VALUES (?, ?)").bind(
      "conviction_canary_lock",
      new Date().toISOString()
    ).run();
    markWrite();
    return { ok: true, claimed: (Number(res?.meta?.changes) || 0) > 0 };
  } catch (err) {
    markErr(err);
    return { ok: false, claimed: false, reason: String(err?.message || err) };
  }
}

export async function releaseConvictionCanaryLock(env) {
  markBound(env);
  if (!hasDb(env)) return { ok: false };
  try {
    await env.DB.prepare("DELETE FROM store_meta WHERE k = ?").bind("conviction_canary_lock").run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistQualificationAttempt(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "unbound" };
  await ensureProbabilityIntegrityMigration(env);
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO strategy_qualification_attempts (
        id, game_id, sport, date, market, side, model_probability, expected_roi,
        validation_result, validation_failure_reason, freeze_id, source_projection_id,
        market_snapshot_id, canary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        n(row.gameId),
        n(row.sport),
        n(row.date),
        n(row.market),
        n(row.side),
        n(row.modelProbability),
        n(row.expectedRoi),
        row.validationResult || "FAILED",
        n(row.validationFailureReason),
        n(row.freezeId),
        n(row.sourceProjectionId),
        n(row.marketSnapshotId),
        row.canary ? 1 : 0,
        row.createdAt || new Date().toISOString()
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistProbabilityCorrection(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "unbound" };
  await ensureProbabilityIntegrityMigration(env);
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO strategy_ticket_probability_corrections (
        id, original_ticket_id, reconstructed_model_probability, reconstruction_source,
        reconstruction_status, reconstruction_reason, expected_roi_recomputed,
        freeze_id, source_projection_id, market_snapshot_id, inputs_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.originalTicketId,
        n(row.reconstructedModelProbability),
        n(row.reconstructionSource),
        row.reconstructionStatus,
        n(row.reconstructionReason),
        n(row.expectedRoiRecomputed),
        n(row.freezeId),
        n(row.sourceProjectionId),
        n(row.marketSnapshotId),
        n(row.inputsJson),
        row.createdAt || new Date().toISOString()
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

function mapProbabilityCorrectionRow(r) {
  return {
    id: r.id,
    originalTicketId: r.original_ticket_id,
    reconstructedModelProbability: r.reconstructed_model_probability,
    reconstructionSource: r.reconstruction_source,
    status: r.reconstruction_status,
    reconstructionStatus: r.reconstruction_status,
    reconstructionReason: r.reconstruction_reason,
    expectedRoiRecomputed: r.expected_roi_recomputed,
    freezeId: r.freeze_id,
    sourceProjectionId: r.source_projection_id,
    marketSnapshotId: r.market_snapshot_id,
    createdAt: r.created_at,
    sport: null,
    market: null,
    date: null,
    result: null,
    clv: null,
  };
}

export async function queryProbabilityCorrections(env, { ticketIds } = {}) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, rows: [] };
  try {
    await ensureProbabilityIntegrityMigration(env);
    const res = await env.DB.prepare(
      "SELECT * FROM strategy_ticket_probability_corrections ORDER BY created_at ASC"
    ).all();
    markRead();
    const mapped = (res.results || []).map(mapProbabilityCorrectionRow);
    const ids = [...new Set((ticketIds || []).map((id) => String(id)).filter(Boolean))];
    const rows = ids.length ? mapped.filter((row) => ids.includes(String(row.originalTicketId))) : mapped;
    return { ok: true, rows };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [] };
  }
}

export async function persistStrategyTicketWithReadback(env, row, opts = {}) {
  const now = new Date().toISOString();
  const canonical = readCanonicalProbability(row);
  const price = row.pinPrice ?? row.benchmarkPrice ?? row.executionPrice;
  const recomputed = canonical.ok && validAmericanOdds(price) ? expectedRoi(canonical.modelProbability, price) : null;
  if (!canonical.ok || recomputed == null) {
    await persistQualificationAttempt(env, {
      id: `attempt:${row.id}:${now}`,
      gameId: row.gameId,
      sport: row.sport,
      date: row.date,
      market: row.market,
      side: row.side,
      modelProbability: canonical.modelProbability,
      expectedRoi: recomputed,
      validationResult: "FAILED",
      validationFailureReason: canonical.reason || "expected-roi-recompute-failed",
      freezeId: row.freezeId,
      sourceProjectionId: row.sourceProjectionId,
      marketSnapshotId: row.marketSnapshotId,
      canary: Boolean(opts.canary),
      createdAt: now,
    });
    return { ok: false, reason: canonical.reason || "expected-roi-recompute-failed", exposed: false };
  }
  const toInsert = {
    ...row,
    modelProbability: canonical.modelProbability,
    fair: canonical.modelProbability,
    ev: row.ev ?? recomputed,
    validationTimestamp: now,
    validationResult: "PENDING_READBACK",
    probabilitySchemaVersion: PROBABILITY_SCHEMA_VERSION,
    expectedRoiFormulaVersion: EXPECTED_ROI_FORMULA_VERSION,
  };
  const inserted = await persistStrategyTicket(env, toInsert, opts);
  if (!inserted.ok) {
    await persistQualificationAttempt(env, {
      id: `attempt:${row.id}:${now}`,
      gameId: row.gameId,
      sport: row.sport,
      date: row.date,
      market: row.market,
      side: row.side,
      modelProbability: canonical.modelProbability,
      expectedRoi: recomputed,
      validationResult: "FAILED",
      validationFailureReason: inserted.reason || "insert-failed",
      freezeId: row.freezeId,
      canary: Boolean(opts.canary),
      createdAt: now,
    });
    return { ...inserted, exposed: false };
  }
  const readbackRow = await env.DB.prepare("SELECT * FROM strategy_tickets WHERE id = ?").bind(row.id).first();
  const mapped = readbackRow ? mapStrategyTicket(readbackRow) : null;
  const readbackProb = mapped ? readCanonicalProbability(mapped) : { ok: false, reason: "readback-missing" };
  const readbackRoi = readbackProb.ok && validAmericanOdds(mapped.pinPrice ?? mapped.benchmarkPrice)
    ? expectedRoi(readbackProb.modelProbability, mapped.pinPrice ?? mapped.benchmarkPrice)
    : null;
  const roiOk = expectedRoiMatches(mapped?.ev, readbackRoi) || expectedRoiMatches(recomputed, readbackRoi);
  if (opts.requireFreezeReadback && (row.sourceProjectionId || row.freezeId || row.gameId)) {
    try {
      const freezeRow =
        (await env.DB.prepare(
          "SELECT game_id, p_home_final, frozen_at FROM prediction_snapshots WHERE game_id = ? OR id = ? LIMIT 1"
        )
          .bind(String(row.sourceProjectionId || row.gameId), String(row.sourceProjectionId || row.id || ""))
          .first()) || null;
      if (!freezeRow) {
        await persistQualificationAttempt(env, {
          id: `attempt:${row.id}:freeze:${now}`,
          gameId: row.gameId,
          sport: row.sport,
          date: row.date,
          market: row.market,
          side: row.side,
          modelProbability: canonical.modelProbability,
          expectedRoi: recomputed,
          validationResult: "FAILED",
          validationFailureReason: "frozen-record-readback-failed",
          freezeId: row.freezeId,
          sourceProjectionId: row.sourceProjectionId,
          canary: Boolean(opts.canary),
          createdAt: now,
        });
        return { ok: false, reason: "frozen-record-readback-failed", exposed: false, inserted: true };
      }
    } catch {
      return { ok: false, reason: "frozen-record-readback-failed", exposed: false, inserted: true };
    }
  }
  if (!readbackProb.ok || !roiOk) {
    try {
      await env.DB.prepare(
        `UPDATE strategy_tickets SET tag = ?, validation_result = ?, validation_failure_reason = ?, validation_timestamp = ?
         WHERE id = ? AND (result IS NULL OR result = 'OPEN')`
      )
        .bind("INVALID", "FAILED", readbackProb.reason || "readback-roi-mismatch", now, row.id)
        .run();
    } catch {
      /* audit-visible attempt still recorded below */
    }
    await persistQualificationAttempt(env, {
      id: `attempt:${row.id}:readback:${now}`,
      gameId: row.gameId,
      sport: row.sport,
      date: row.date,
      market: row.market,
      side: row.side,
      modelProbability: readbackProb.modelProbability,
      expectedRoi: readbackRoi,
      validationResult: "FAILED",
      validationFailureReason: readbackProb.reason || "readback-roi-mismatch",
      freezeId: row.freezeId,
      canary: Boolean(opts.canary),
      createdAt: now,
    });
    return { ok: false, reason: "readback-validation-failed", exposed: false, inserted: true };
  }
  try {
    await env.DB.prepare(
      `UPDATE strategy_tickets SET validation_result = ?, validation_timestamp = ?, validation_failure_reason = NULL WHERE id = ?`
    )
      .bind(opts.canary ? "CANARY_PASSED" : "PASSED", now, row.id)
      .run();
  } catch {
    /* column may not exist in tests */
  }
  if (opts.canary) {
    await persistQualificationAttempt(env, {
      id: `canary:${row.id}:${now}`,
      gameId: row.gameId,
      sport: row.sport,
      date: row.date,
      market: row.market,
      side: row.side,
      modelProbability: readbackProb.modelProbability,
      expectedRoi: readbackRoi,
      validationResult: "CANARY_PASSED",
      freezeId: row.freezeId,
      canary: true,
      createdAt: now,
    });
    await setMeta(env, "conviction_canary_passed_at", now);
    await setMeta(env, "conviction_canary_ticket_id", row.id);
  }
  return { ok: true, exposed: !opts.canary, readback: mapped, modelProbability: readbackProb.modelProbability, expectedRoi: readbackRoi };
}

export async function persistStrategyTicket(env, row, opts = {}) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  await ensureProbabilityIntegrityMigration(env);
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
        provenance, execution_book, benchmark_book, clv_version,
        model_probability, probability_schema_version, expected_roi_formula_version,
        validation_timestamp, validation_result, validation_failure_reason,
        source_projection_id, market_snapshot_id, freeze_id, qualification_rule_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        n(row.clvVersion),
        n(row.modelProbability ?? row.fair),
        n(row.probabilitySchemaVersion || PROBABILITY_SCHEMA_VERSION),
        n(row.expectedRoiFormulaVersion || EXPECTED_ROI_FORMULA_VERSION),
        n(row.validationTimestamp),
        n(row.validationResult),
        n(row.validationFailureReason),
        n(row.sourceProjectionId),
        n(row.marketSnapshotId),
        n(row.freezeId),
        n(row.qualificationRuleVersion)
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

export async function queryStrategyTicketsPaged(env, { strategyId, role, cursor = null, limit = 200 } = {}) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [], nextCursor: null };
  const max = Math.max(1, Math.min(500, Number(limit) || 200));
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
    if (cursor?.createdAt && cursor?.id) {
      sql += " AND (created_at < ? OR (created_at = ? AND id < ?))";
      binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
    binds.push(max);
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    const rows = (res.results || []).map(mapStrategyTicket);
    const last = rows.at(-1);
    return {
      ok: true,
      rows,
      nextCursor: rows.length === max && last ? { createdAt: last.createdAt || null, id: last.id } : null,
    };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [], nextCursor: null };
  }
}

export async function persistEvAuditRecords(env, records = []) {
  markBound(env);
  if (!hasDb(env) || !records.length) return { ok: false, reason: hasDb(env) ? "no-records" : "unbound", inserted: 0 };
  let inserted = 0;
  for (const row of records || []) {
    if (!row?.id || !row?.entityType || !row?.entityId || !row?.anomalyReason) continue;
    try {
      const out = await env.DB.prepare(
        `INSERT OR REPLACE INTO ev_audit_records (
          id, entity_type, entity_id, sport, market, side, model_version, qualification_rule_version, freeze_at,
          stored_ev, recomputed_ev, anomaly_reason, root_cause, qualified, entered_strategy, disposition, inputs_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        row.id,
        row.entityType,
        row.entityId,
        n(row.sport),
        n(row.market),
        n(row.side),
        n(row.modelVersion),
        n(row.qualificationRuleVersion),
        n(row.freezeAt),
        n(row.storedEv),
        n(row.recomputedEv),
        row.anomalyReason,
        n(row.rootCause),
        row.qualified ? 1 : 0,
        row.enteredStrategy ? 1 : 0,
        row.disposition || "unresolved",
        n(row.inputsJson),
        row.createdAt || new Date().toISOString()
      ).run();
      if ((Number(out?.meta?.changes) || 0) > 0) inserted += 1;
      markWrite();
    } catch (err) {
      markErr(err);
    }
  }
  return { ok: true, inserted };
}

export async function queryEvAuditRecords(env, { since, limit = 1000 } = {}) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [], totalCount: 0 };
  try {
    const countSql = since
      ? "SELECT COUNT(*) AS n FROM ev_audit_records WHERE created_at >= ?"
      : "SELECT COUNT(*) AS n FROM ev_audit_records";
    const cnt = since
      ? await env.DB.prepare(countSql).bind(since).first()
      : await env.DB.prepare(countSql).first();
    const sql = since
      ? "SELECT * FROM ev_audit_records WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM ev_audit_records ORDER BY created_at DESC LIMIT ?";
    const res = since
      ? await env.DB.prepare(sql).bind(since, Math.max(1, Math.min(5000, Number(limit) || 1000))).all()
      : await env.DB.prepare(sql).bind(Math.max(1, Math.min(5000, Number(limit) || 1000))).all();
    markRead();
    return { ok: true, rows: res.results || [], totalCount: Number(cnt?.n || 0) };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [], totalCount: 0 };
  }
}

export async function queryEvAuditTicketSummary(env) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound" };
  try {
    const run = async (sql, binds = []) => {
      const q = await env.DB.prepare(sql).bind(...binds).all();
      return q.results || [];
    };
    const scalar = async (sql, binds = []) => {
      const q = await env.DB.prepare(sql).bind(...binds).first();
      return Number(q?.n || 0);
    };
    const totalFindings = await scalar("SELECT COUNT(*) AS n FROM ev_audit_records WHERE entity_type = 'strategy-ticket'");
    const uniqueAffectedTickets = await scalar("SELECT COUNT(DISTINCT entity_id) AS n FROM ev_audit_records WHERE entity_type = 'strategy-ticket'");
    const top = await run(
      "SELECT entity_id, COUNT(*) AS n FROM ev_audit_records WHERE entity_type = 'strategy-ticket' GROUP BY entity_id ORDER BY n DESC LIMIT 1"
    );
    const byReason = await run(
      "SELECT anomaly_reason AS key, COUNT(*) AS n FROM ev_audit_records WHERE entity_type = 'strategy-ticket' GROUP BY anomaly_reason ORDER BY n DESC"
    );
    const bySport = await run(
      "SELECT COALESCE(sport, 'unknown') AS key, COUNT(*) AS n FROM ev_audit_records WHERE entity_type = 'strategy-ticket' GROUP BY COALESCE(sport, 'unknown') ORDER BY n DESC"
    );
    const byMarketFamily = await run(
      `SELECT
         CASE
           WHEN UPPER(COALESCE(market, '')) LIKE '%PROP%' THEN 'PLAYER_PROP'
           WHEN UPPER(COALESCE(market, '')) LIKE 'F5%' THEN 'F5'
           WHEN UPPER(COALESCE(market, '')) LIKE '%SPREAD%' OR UPPER(COALESCE(market, '')) LIKE '%RL%' THEN 'SPREAD'
           WHEN UPPER(COALESCE(market, '')) LIKE '%TOTAL%' THEN 'TOTAL'
           WHEN UPPER(COALESCE(market, '')) LIKE '%ML%' THEN 'MONEYLINE'
           ELSE 'UNKNOWN'
         END AS key,
         COUNT(*) AS n
       FROM ev_audit_records
       WHERE entity_type = 'strategy-ticket'
       GROUP BY 1 ORDER BY n DESC`
    );
    const byPeriodFamily = await run(
      `SELECT
         CASE
           WHEN UPPER(COALESCE(market, '')) LIKE 'F5%' THEN 'F5'
           WHEN UPPER(COALESCE(market, '')) LIKE '%PROP%' THEN 'PLAYER_PROP'
           ELSE 'FULL_GAME'
         END AS key,
         COUNT(*) AS n
       FROM ev_audit_records
       WHERE entity_type = 'strategy-ticket'
       GROUP BY 1 ORDER BY n DESC`
    );
    const byModelVersion = await run(
      "SELECT COALESCE(model_version, 'unknown') AS key, COUNT(*) AS n FROM ev_audit_records WHERE entity_type = 'strategy-ticket' GROUP BY COALESCE(model_version, 'unknown') ORDER BY n DESC"
    );
    const byQualificationRuleVersion = await run(
      "SELECT COALESCE(qualification_rule_version, 'unknown') AS key, COUNT(*) AS n FROM ev_audit_records WHERE entity_type = 'strategy-ticket' GROUP BY COALESCE(qualification_rule_version, 'unknown') ORDER BY n DESC"
    );
    const byCheckpoint = await run(
      "SELECT COALESCE(st.checkpoint, 'unknown') AS key, COUNT(DISTINCT ear.entity_id) AS n FROM ev_audit_records ear LEFT JOIN strategy_tickets st ON st.id = ear.entity_id WHERE ear.entity_type = 'strategy-ticket' GROUP BY COALESCE(st.checkpoint, 'unknown') ORDER BY n DESC"
    );
    const byDate = await run(
      "SELECT SUBSTR(COALESCE(freeze_at, created_at), 1, 10) AS key, COUNT(*) AS n FROM ev_audit_records WHERE entity_type = 'strategy-ticket' GROUP BY SUBSTR(COALESCE(freeze_at, created_at), 1, 10) ORDER BY key DESC"
    );
    const qualifiedAffectedTickets = await scalar("SELECT COUNT(DISTINCT entity_id) AS n FROM ev_audit_records WHERE entity_type = 'strategy-ticket' AND qualified = 1");
    const enteredStrategyTickets = await scalar("SELECT COUNT(DISTINCT entity_id) AS n FROM ev_audit_records WHERE entity_type = 'strategy-ticket' AND entered_strategy = 1");
    const settledAffectedTickets = await scalar(
      "SELECT COUNT(DISTINCT ear.entity_id) AS n FROM ev_audit_records ear JOIN strategy_tickets st ON st.id = ear.entity_id WHERE ear.entity_type = 'strategy-ticket' AND UPPER(COALESCE(st.result,'')) IN ('WON','LOST','PUSH','VOID')"
    );
    const openAffectedTickets = await scalar(
      "SELECT COUNT(DISTINCT ear.entity_id) AS n FROM ev_audit_records ear JOIN strategy_tickets st ON st.id = ear.entity_id WHERE ear.entity_type = 'strategy-ticket' AND (st.result IS NULL OR UPPER(COALESCE(st.result,'')) = 'OPEN')"
    );
    const winningAffectedTickets = await scalar(
      "SELECT COUNT(DISTINCT ear.entity_id) AS n FROM ev_audit_records ear JOIN strategy_tickets st ON st.id = ear.entity_id WHERE ear.entity_type = 'strategy-ticket' AND UPPER(COALESCE(st.result,'')) = 'WON'"
    );
    const losingAffectedTickets = await scalar(
      "SELECT COUNT(DISTINCT ear.entity_id) AS n FROM ev_audit_records ear JOIN strategy_tickets st ON st.id = ear.entity_id WHERE ear.entity_type = 'strategy-ticket' AND UPPER(COALESCE(st.result,'')) = 'LOST'"
    );
    const unresolvedAffectedTickets = await scalar(
      "SELECT COUNT(DISTINCT ear.entity_id) AS n FROM ev_audit_records ear JOIN strategy_tickets st ON st.id = ear.entity_id WHERE ear.entity_type = 'strategy-ticket' AND UPPER(COALESCE(st.result,'')) = 'FINAL NOT MATCHED'"
    );
    markRead();
    return {
      ok: true,
      summary: {
        totalFindings,
        uniqueAffectedTickets,
        averageFindingsPerAffectedTicket: uniqueAffectedTickets ? totalFindings / uniqueAffectedTickets : 0,
        maxFindingsPerTicket: Number(top?.[0]?.n || 0),
        byReason: Object.fromEntries(byReason.map((r) => [r.key, Number(r.n || 0)])),
        bySport: Object.fromEntries(bySport.map((r) => [r.key, Number(r.n || 0)])),
        byMarketFamily: Object.fromEntries(byMarketFamily.map((r) => [r.key, Number(r.n || 0)])),
        byPeriodFamily: Object.fromEntries(byPeriodFamily.map((r) => [r.key, Number(r.n || 0)])),
        byModelVersion: Object.fromEntries(byModelVersion.map((r) => [r.key, Number(r.n || 0)])),
        byQualificationRuleVersion: Object.fromEntries(byQualificationRuleVersion.map((r) => [r.key, Number(r.n || 0)])),
        byCheckpoint: Object.fromEntries(byCheckpoint.map((r) => [r.key, Number(r.n || 0)])),
        byDate: Object.fromEntries(byDate.map((r) => [r.key || "unknown", Number(r.n || 0)])),
        qualifiedAffectedTickets,
        enteredStrategyTickets,
        settledAffectedTickets,
        openAffectedTickets,
        winningAffectedTickets,
        losingAffectedTickets,
        unresolvedAffectedTickets,
      },
    };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
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
    modelProbability: r.model_probability ?? traits.modelProbability ?? null,
    probabilitySchemaVersion: r.probability_schema_version || traits.probabilitySchemaVersion || null,
    expectedRoiFormulaVersion: r.expected_roi_formula_version || traits.expectedRoiFormulaVersion || null,
    validationTimestamp: r.validation_timestamp || null,
    validationResult: r.validation_result || null,
    validationFailureReason: r.validation_failure_reason || null,
    sourceProjectionId: r.source_projection_id || null,
    marketSnapshotId: r.market_snapshot_id || null,
    freezeId: r.freeze_id || null,
    qualificationRuleVersion: r.qualification_rule_version || traits.qualificationRuleVersion || null,
    fair: r.model_probability ?? traits.modelProbability ?? null,
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
      // Prove that the exact job row written above is immediately readable.
      // Historical failure counters remain diagnostic, but cannot make a
      // newer successful write/readback look broken forever.
      try {
        const readback = await env.DB.prepare(
          "SELECT id, status FROM job_runs WHERE id = ? LIMIT 1"
        ).bind(row.id).first();
        if (readback?.id === row.id && readback?.status === row.status) {
          await setMeta(env, "last_d1_readback_success_at", row.completedAt || new Date().toISOString());
          markRead();
        }
      } catch {
        // The job write remains valid, but health stays unverified until a
        // later exact readback succeeds.
      }
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
      lastD1ReadbackSuccessAt: meta.last_d1_readback_success_at || null,
      lastD1FailureAt:
        meta.last_d1_write_failure_at ||
        collectFail?.completed_at ||
        harvestFail?.completed_at ||
        null,
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

/** Mark open retries terminal (missed / post-kickoff / auth) without inventing market snapshots. */
export async function closeHarvestRetry(env, { id, sport, date, gameId, status = "terminal", reason = null }) {
  if (!hasDb(env)) return { ok: false };
  const allowed = new Set(["terminal", "missed", "post_kickoff", "resolved"]);
  const next = allowed.has(String(status)) ? String(status) : "terminal";
  const rowId = id || (sport && date ? `${sport}:${date}:${gameId || "*"}` : null);
  if (!rowId && !(sport && date)) return { ok: false };
  try {
    if (rowId) {
      await env.DB.prepare(
        "UPDATE harvest_retry_queue SET status = ?, reason = COALESCE(?, reason), last_attempt_at = ? WHERE id = ? AND status = 'open'"
      )
        .bind(next, n(reason), new Date().toISOString(), rowId)
        .run();
    } else {
      await env.DB.prepare(
        "UPDATE harvest_retry_queue SET status = ?, reason = COALESCE(?, reason), last_attempt_at = ? WHERE sport = ? AND date = ? AND status = 'open'"
      )
        .bind(next, n(reason), new Date().toISOString(), sport, date)
        .run();
    }
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
    awayIdentity: identityForSport(r.sport, r.away_team),
    homeIdentity: identityForSport(r.sport, r.home_team),
    market: r.market,
    period: r.period,
    selectedSide: r.selected_side,
    selectedTeam: r.selected_team,
    playerName: r.player_name || r.selected_team,
    propType: r.prop_type,
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
    propActual: r.prop_actual,
    propStatSource: r.prop_stat_source,
    finalAwayScore: r.final_away_score,
    finalHomeScore: r.final_home_score,
    f5AwayScore: r.f5_away_score,
    f5HomeScore: r.f5_home_score,
    settlementSource: r.settlement_source,
    entryId: r.entry_id,
    legIndex: r.leg_index,
    legCount: r.leg_count,
    legResult: r.leg_result,
    advisorDecision: r.advisor_decision,
    advisorConfidence: r.advisor_confidence,
    advisorReason: r.advisor_reason,
    advisorReviewedAt: r.advisor_reviewed_at,
    advisorSnapshotHash: r.advisor_snapshot_hash,
    exceptionCode: r.exception_code,
    settlementEvidence: (() => {
      try { return r.settlement_evidence_json ? JSON.parse(r.settlement_evidence_json) : null; } catch { return null; }
    })(),
    trackerMetadata: (() => {
      try { return r.tracker_metadata_json ? JSON.parse(r.tracker_metadata_json) : null; } catch { return null; }
    })(),
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
        clv, clv_status, clv_method_version, attribution_label, player_name, prop_type,
        prop_actual, prop_stat_source, tracker_metadata_json,
        entry_id, leg_index, leg_count, leg_result,
        advisor_decision, advisor_confidence, advisor_reason, advisor_reviewed_at, advisor_snapshot_hash, exception_code
      ) VALUES (${Array(67).fill("?").join(",")})`
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
        n(packed.attributionLabel),
        n(packed.playerName),
        n(packed.propType),
        n(packed.propActual),
        n(packed.propStatSource),
        packed.trackerMetadata ? JSON.stringify(packed.trackerMetadata) : null,
        n(packed.entryId), n(packed.legIndex), n(packed.legCount), n(packed.legResult),
        n(packed.advisorDecision), n(packed.advisorConfidence), n(packed.advisorReason),
        n(packed.advisorReviewedAt), n(packed.advisorSnapshotHash), n(packed.exceptionCode)
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
        pin_close_line = ?, pin_close_price = ?, pin_close_no_vig = ?,
        prop_actual = ?, prop_stat_source = ?,
        final_away_score = ?, final_home_score = ?, f5_away_score = ?, f5_home_score = ?,
        settlement_source = ?, settlement_evidence_json = ?,
        entry_id = ?, leg_index = ?, leg_count = ?, leg_result = ?,
        advisor_decision = ?, advisor_confidence = ?, advisor_reason = ?, advisor_reviewed_at = ?,
        advisor_snapshot_hash = ?, exception_code = ?
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
        n(mapped.propActual),
        n(mapped.propStatSource),
        n(mapped.finalAwayScore),
        n(mapped.finalHomeScore),
        n(mapped.f5AwayScore),
        n(mapped.f5HomeScore),
        n(mapped.settlementSource),
        mapped.settlementEvidence ? JSON.stringify(mapped.settlementEvidence) : null,
        n(mapped.entryId), n(mapped.legIndex), n(mapped.legCount), n(mapped.legResult),
        n(mapped.advisorDecision), n(mapped.advisorConfidence), n(mapped.advisorReason),
        n(mapped.advisorReviewedAt), n(mapped.advisorSnapshotHash), n(mapped.exceptionCode),
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


export async function upsertExecutedBetEntry(env, row = {}) {
  markBound(env);
  if (!hasDb(env) || !row.id) return { ok: false, reason: "unbound-or-no-id" };
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO executed_bet_entries (
      id, execution_book, entry_type, executed_at, sport, risk_amount, to_win_amount, potential_payout,
      result, settled_return, profit, leg_count, legs_won, legs_lost, legs_push, graded_at,
      funding_type, source_ticket_id, tracker_metadata_json, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      result=excluded.result, settled_return=excluded.settled_return, profit=excluded.profit,
      legs_won=excluded.legs_won, legs_lost=excluded.legs_lost, legs_push=excluded.legs_push,
      graded_at=excluded.graded_at, tracker_metadata_json=excluded.tracker_metadata_json, updated_at=excluded.updated_at`)
      .bind(row.id, row.executionBook || "Unknown", n(row.entryType), n(row.executedAt), n(row.sport),
        n(row.riskAmount), n(row.toWinAmount), n(row.potentialPayout), row.result || "OPEN",
        n(row.settledReturn), n(row.profit), Number(row.legCount || 1), Number(row.legsWon || 0),
        Number(row.legsLost || 0), Number(row.legsPush || 0), n(row.gradedAt),
        row.fundingType || "CASH", n(row.sourceTicketId),
        row.trackerMetadata ? JSON.stringify(row.trackerMetadata) : null, now, now).run();
    markWrite(); return { ok: true };
  } catch (err) { markErr(err); return { ok:false, reason:String(err?.message||err) }; }
}

export async function queryExecutedBetEntries(env) {
  markBound(env);
  if (!hasDb(env)) return { ok:false, rows:[] };
  try {
    const res=await env.DB.prepare("SELECT * FROM executed_bet_entries ORDER BY executed_at DESC").all();
    markRead(); return { ok:true, rows:res.results||[] };
  } catch(err){ markErr(err); return {ok:false,rows:[],reason:String(err?.message||err)}; }
}

export async function persistAdvisorReview(env, row = {}) {
  markBound(env);
  if (!hasDb(env) || !row.id || !row.gameId || !row.snapshotHash) return {ok:false,reason:"missing-advisor-key"};
  try {
    await env.DB.prepare(`INSERT INTO advisor_reviews
      (id, game_id, sport, date, decision, confidence, reason, model_version, snapshot_hash, snapshot_json, reviewed_at, provider, model)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(game_id, snapshot_hash) DO UPDATE SET
      decision=excluded.decision, confidence=excluded.confidence, reason=excluded.reason,
      reviewed_at=excluded.reviewed_at, provider=excluded.provider, model=excluded.model`)
      .bind(row.id,String(row.gameId),row.sport,row.date,row.decision,n(row.confidence),n(row.reason),
        n(row.modelVersion),row.snapshotHash,JSON.stringify(row.snapshot||{}),row.reviewedAt||new Date().toISOString(),
        row.provider||"openai",n(row.model)).run();
    markWrite(); return {ok:true};
  } catch(err){ markErr(err); return {ok:false,reason:String(err?.message||err)}; }
}

export async function queryAdvisorReviews(env, { date, sport } = {}) {
  markBound(env); if(!hasDb(env)) return {ok:false,rows:[]};
  try {
    let sql="SELECT * FROM advisor_reviews WHERE 1=1"; const binds=[];
    if(date){sql+=" AND date = ?";binds.push(date);} if(sport&&sport!=="all"){sql+=" AND sport = ?";binds.push(sport);}
    sql+=" ORDER BY reviewed_at DESC";
    const res=await env.DB.prepare(sql).bind(...binds).all(); markRead(); return {ok:true,rows:res.results||[]};
  } catch(err){markErr(err);return {ok:false,rows:[],reason:String(err?.message||err)};}
}


export async function reconcileExecutedBetEntries(env) {
  const betsQ=await queryExecutedBets(env,{includeRaw:false});
  const groups=new Map();
  for(const b of betsQ.rows||[]){
    if(!b.entryId) continue;
    if(!groups.has(b.entryId)) groups.set(b.entryId,[]);
    groups.get(b.entryId).push(b);
  }
  const outcomes=[];
  for(const [entryId,legs] of groups){
    legs.sort((a,b)=>Number(a.legIndex||0)-Number(b.legIndex||0));
    const primary=legs.find(x=>Number(x.riskAmount)>0)||legs[0];
    const meta=primary.trackerMetadata||{};
    const entryType=meta.entryType|| (legs.length>1?"PARLAY":"STRAIGHT");
    const results=legs.map(x=>String(x.legResult||x.result||"OPEN").toUpperCase());
    const won=results.filter(x=>x==="WON").length, lost=results.filter(x=>x==="LOST").length, push=results.filter(x=>x==="PUSH"||x==="VOID").length;
    const allTerminal=results.every(x=>["WON","LOST","PUSH","VOID"].includes(x));
    let result="OPEN", profit=null, settledReturn=null, exceptionCode=null;
    if(lost>0){ result="LOST"; profit=-Math.abs(Number(meta.cardRiskAmount??primary.riskAmount??0)); settledReturn=0; }
    else if(allTerminal && push===0){ result="WON"; profit=Number(meta.cardToWinAmount??primary.toWinAmount??0); settledReturn=Number(meta.cardPotentialPayout??primary.potentialPayout??0); }
    else if(allTerminal && push>0){
      result="MANUAL_REVIEW"; exceptionCode="NEEDS_SETTLEMENT";
    }
    if(String(entryType).includes("FLEX") && allTerminal){ result="MANUAL_REVIEW"; exceptionCode="NEEDS_SETTLEMENT"; profit=null; settledReturn=null; }
    const row={id:entryId,executionBook:primary.executionBook,entryType,executedAt:primary.executedAt,sport:primary.sport,
      riskAmount:Number(meta.cardRiskAmount??primary.riskAmount??0),toWinAmount:Number(meta.cardToWinAmount??primary.toWinAmount??0),
      potentialPayout:Number(meta.cardPotentialPayout??primary.potentialPayout??0),result,profit,settledReturn,legCount:legs.length,
      legsWon:won,legsLost:lost,legsPush:push,gradedAt:allTerminal?new Date().toISOString():null,
      fundingType:meta.fundingType||"CASH",sourceTicketId:primary.externalTicketId,
      trackerMetadata:{...meta,exceptionCode}};
    outcomes.push(await upsertExecutedBetEntry(env,row));
    for(const leg of legs){
      const legResult=String(leg.result||"OPEN").toUpperCase();
      const legException=legResult==="OPEN" ? (String(leg.market).toUpperCase()==="PLAYER_PROP"?"NEEDS_STAT":"NEEDS_SETTLEMENT") : null;
      if(leg.legResult!==legResult || leg.exceptionCode!==legException){
        await updateExecutedBet(env,leg.id,{legResult,exceptionCode:legException},"entry-reconcile");
      }
    }
  }
  return {ok:outcomes.every(x=>x.ok),entries:groups.size};
}
