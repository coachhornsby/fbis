/**
 * CORE dashboard summaries for cross-sport boards.
 * When sport D1s become authoritative, boards must still read complete summaries
 * from CORE_DB (falling back to primary) — never fan-out query every sport DB.
 *
 * Fail-closed: missing sport entries are incomplete (never default complete:true).
 */
import { resolveCoreDb } from "./databaseTopology.js";
import { FBIS_SPORTS } from "./databaseTopology.js";

export const CORE_BOARD_SUMMARY_KEY = "cross_sport_board_snapshot";

export function buildCrossSportBoardSummary({
  asOf = new Date().toISOString(),
  sports = {},
  sourceBinding = "DB",
} = {}) {
  const rows = [];
  for (const sport of FBIS_SPORTS) {
    const entry = sports[sport];
    if (!entry || typeof entry !== "object") {
      rows.push({
        sport,
        gameCount: 0,
        projectionCount: 0,
        freshestStart: null,
        freshestFrozenAt: null,
        authority: "UNKNOWN",
        complete: false,
        reason: "SPORT_ENTRY_MISSING",
      });
      continue;
    }
    rows.push({
      sport,
      gameCount: Number(entry.gameCount) || 0,
      projectionCount: Number(entry.projectionCount) || 0,
      freshestStart: entry.freshestStart || null,
      freshestFrozenAt: entry.freshestFrozenAt || null,
      authority: entry.authority || "PRIMARY",
      // Fail-closed: require explicit complete:true (missing/false → incomplete).
      complete: entry.complete === true,
      reason: entry.complete === true ? null : (entry.reason || "SPORT_INCOMPLETE"),
    });
  }
  const incomplete = rows.filter((r) => !r.complete).map((r) => r.sport);
  return {
    schemaVersion: 1,
    summaryKey: CORE_BOARD_SUMMARY_KEY,
    asOf,
    sourceBinding,
    sports: rows,
    complete: incomplete.length === 0,
    incompleteSports: incomplete,
    canAuthorizeWager: false,
  };
}

export async function collectPrimarySportBoardStats(env, sport) {
  const db = env?.DB;
  if (!db?.prepare) return { sport, complete: false, reason: "PRIMARY_UNBOUND" };
  try {
    const games = await db.prepare(
      "SELECT COUNT(*) n, MAX(start) freshest FROM games WHERE sport=?"
    ).bind(sport).first();
    const preds = await db.prepare(
      "SELECT COUNT(*) n, MAX(frozen_at) freshest FROM prediction_snapshots WHERE sport=?"
    ).bind(sport).first();
    return {
      sport,
      gameCount: Number(games?.n) || 0,
      projectionCount: Number(preds?.n) || 0,
      freshestStart: games?.freshest || null,
      freshestFrozenAt: preds?.freshest || null,
      authority: "PRIMARY",
      complete: true,
    };
  } catch (error) {
    return { sport, complete: false, reason: String(error?.message || error).slice(0, 160) };
  }
}

export async function publishCrossSportBoardSummary(env, { now = new Date() } = {}) {
  const core = resolveCoreDb(env);
  if (!core.db?.prepare) return { ok: false, reason: "CORE_UNBOUND", canAuthorizeWager: false };

  const sports = {};
  for (const sport of FBIS_SPORTS) {
    sports[sport] = await collectPrimarySportBoardStats(env, sport);
  }
  const asOf = now.toISOString();
  const summary = buildCrossSportBoardSummary({
    asOf,
    sports,
    sourceBinding: core.binding,
  });

  // Refuse to publish an incomplete snapshot as "ok" — still persist for diagnosis.
  try {
    await core.db.prepare(
      `INSERT OR REPLACE INTO fbis_dashboard_summaries(summary_key,as_of,sport,payload_json,source_binding,created_at)
       VALUES(?,?,NULL,?,?,?)`
    ).bind(CORE_BOARD_SUMMARY_KEY, asOf, JSON.stringify(summary), core.binding, asOf).run();
  } catch (error) {
    return {
      ok: false,
      reason: "CORE_SUMMARY_WRITE_FAILED",
      error: String(error?.message || error).slice(0, 240),
      summary,
      canAuthorizeWager: false,
    };
  }

  return {
    ok: summary.complete === true,
    summary,
    coreBinding: core.binding,
    incompleteSports: summary.incompleteSports,
    canAuthorizeWager: false,
  };
}

export async function readCrossSportBoardSummary(env) {
  const core = resolveCoreDb(env);
  if (!core.db?.prepare) return { ok: false, reason: "CORE_UNBOUND", canAuthorizeWager: false };
  try {
    const row = await core.db.prepare(
      `SELECT summary_key,as_of,payload_json,source_binding
       FROM fbis_dashboard_summaries
       WHERE summary_key=?
       ORDER BY as_of DESC LIMIT 1`
    ).bind(CORE_BOARD_SUMMARY_KEY).first();
    if (!row) return { ok: false, reason: "SUMMARY_MISSING", canAuthorizeWager: false };
    const payload = JSON.parse(row.payload_json || "null");
    if (!payload || payload.complete !== true) {
      return {
        ok: false,
        reason: "SUMMARY_INCOMPLETE",
        asOf: row.as_of,
        sourceBinding: row.source_binding,
        summary: payload,
        incompleteSports: payload?.incompleteSports || [],
        canAuthorizeWager: false,
      };
    }
    return {
      ok: true,
      asOf: row.as_of,
      sourceBinding: row.source_binding,
      summary: payload,
      canAuthorizeWager: false,
    };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error).slice(0, 240), canAuthorizeWager: false };
  }
}
