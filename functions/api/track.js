import { buildTrackReport } from "../lib/projLedger.js";
import { gradeSnapshotsForGame, queryExecutedBets, queryStrategyTickets, queryStrategyTicketsPaged, updateExecutedBet, gradeStrategyTicket, persistEvAuditRecords, queryEvAuditRecords, queryEvAuditTicketSummary, setMeta, readMeta, queryGamesByIds } from "../lib/store.js";
import { settleExecutedBet, summarizeExecutedBets } from "../lib/executedBets.js";
import { gradeStrategyResult, planCrossDateStrategyCleanup, STRATEGY_HC_V1 } from "../lib/strategy.js";
import { resolveFinalForTicket, reconstructAffectedTickets } from "../lib/projLedger.js";
import { resolveTeam } from "../lib/teams.js";
import { deriveHealthState, writeVerificationState } from "../lib/healthContract.js";
import { populationDescriptor, POPULATION_TYPE } from "../lib/populationDescriptor.js";
import { auditTicketEv, summarizeEvAudits, anomalyRuleDetails, ANOMALY_RULES } from "../lib/evAudit.js";
import { readCanonicalProbability } from "../lib/probability.js";
const MIGRATION_STATUS = {
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  UNVERIFIED: "UNVERIFIED",
};


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function normalizeName(s = "") {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function teamMatch(sport, left, right) {
  if (!left || !right) return false;
  if (normalizeName(left) === normalizeName(right)) return true;
  const a = resolveTeam(sport || "mlb", { name: left, displayName: left, fullName: left, school: left });
  const b = resolveTeam(sport || "mlb", { name: right, displayName: right, fullName: right, school: right });
  return Boolean(a?.id && b?.id && a.id === b.id);
}

function isFutureStart(value, nowMs = Date.now()) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return false;
  return ts > nowMs + 5 * 60 * 1000;
}

async function verifyEvAuditMigration(env) {
  if (!env?.DB?.prepare) return { ok: false, status: MIGRATION_STATUS.UNVERIFIED, reason: "D1 unbound" };
  try {
    const mig = await env.DB.prepare("SELECT id FROM schema_migrations WHERE id = '0012_ev_audit_records' LIMIT 1").first();
    if (!mig?.id) return { ok: false, status: MIGRATION_STATUS.UNVERIFIED, reason: "schema_migrations missing 0012_ev_audit_records" };
    await env.DB.prepare("SELECT id FROM ev_audit_records LIMIT 1").all();
    return { ok: true, status: MIGRATION_STATUS.VERIFIED, reason: null };
  } catch (err) {
    const reason = String(err?.message || err);
    if (/not authorized|authentication|permission/i.test(reason)) {
      return { ok: false, status: MIGRATION_STATUS.BLOCKED, reason };
    }
    if (/no such table|no such column|syntax/i.test(reason)) {
      return { ok: false, status: MIGRATION_STATUS.FAILED, reason };
    }
    return { ok: false, status: MIGRATION_STATUS.UNVERIFIED, reason };
  }
}

async function ensureEvAuditMigration(env) {
  if (!env?.DB?.prepare) return { ok: false, status: MIGRATION_STATUS.UNVERIFIED, reason: "D1 unbound" };
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ev_audit_records (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        sport TEXT,
        market TEXT,
        side TEXT,
        model_version TEXT,
        qualification_rule_version TEXT,
        freeze_at TEXT,
        stored_ev REAL,
        recomputed_ev REAL,
        anomaly_reason TEXT NOT NULL,
        root_cause TEXT,
        qualified INTEGER,
        entered_strategy INTEGER,
        disposition TEXT NOT NULL,
        inputs_json TEXT,
        created_at TEXT NOT NULL
      )`
    ).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ev_audit_entity ON ev_audit_records (entity_type, entity_id)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ev_audit_reason ON ev_audit_records (anomaly_reason, created_at)").run();
    await env.DB.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0012_ev_audit_records', datetime('now'))").run();
    return verifyEvAuditMigration(env);
  } catch (err) {
    const reason = String(err?.message || err);
    if (/not authorized|authentication|permission/i.test(reason)) {
      return { ok: false, status: MIGRATION_STATUS.BLOCKED, reason };
    }
    return { ok: false, status: MIGRATION_STATUS.FAILED, reason };
  }
}

async function runEvAudit(env, payload = {}) {
  const migration = await ensureEvAuditMigration(env);
  if (!migration.ok) {
    return {
      ok: false,
      status: migration.status === MIGRATION_STATUS.BLOCKED ? 423 : 409,
      error: `EV audit persistence blocked: ${migration.status}. ${migration.reason || ""}`.trim(),
    };
  }
  const limit = Math.max(10, Math.min(200, Number(payload.limit) || 100));
  const cursor = payload.cursor && payload.cursor.id && payload.cursor.createdAt ? payload.cursor : null;
  const page = await queryStrategyTicketsPaged(env, { strategyId: "FBIS-HC-v1", role: "prospective", cursor, limit });
  if (!page.ok) return { ok: false, status: 502, error: page.reason || "strategy query failed" };
  const tickets = page.rows || [];
  const anomalies = [];
  for (const t of tickets || []) {
    const audit = auditTicketEv(t);
    for (const reason of audit.reasons || []) {
      anomalies.push({
        id: `strategy-ticket:${t.id}:${reason}`,
        entityType: "strategy-ticket",
        entityId: String(t.id),
        sport: t.sport || null,
        market: t.market || null,
        side: t.side || null,
        modelVersion: t.modelVersion || null,
        qualificationRuleVersion: "FBIS-HC-v1",
        freezeAt: t.qualifiedAt || null,
        storedEv: audit.storedEv,
        recomputedEv: audit.recomputedEv,
        anomalyReason: reason,
        rootCause: reason,
        qualified: Boolean(t.qualified || String(t.tag || "").toUpperCase() === "CONVICTION"),
        enteredStrategy: String(t.strategyId || "") === "FBIS-HC-v1",
        disposition: reason === "ev-over-100pct" && Number(audit.inputs?.price || 0) > 0 ? "valid-long-odds-candidate" : "quarantined",
        inputsJson: JSON.stringify(audit.inputs || {}),
        createdAt: new Date().toISOString(),
      });
    }
  }
  const persisted = await persistEvAuditRecords(env, anomalies);
  const nextCursor = page.nextCursor || null;
  const complete = !nextCursor;
  const meta = await readMeta(env);
  const prevScanned = Number(meta.ev_audit_scanned_total || 0);
  await setMeta(env, "ev_audit_scanned_total", String(prevScanned + tickets.length));
  await setMeta(env, "ev_audit_last_cursor", nextCursor ? JSON.stringify(nextCursor) : "");
  await setMeta(env, "ev_audit_last_run_at", new Date().toISOString());
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      scanned: tickets.length,
      anomalies: anomalies.length,
      byReason: summarizeEvAudits(anomalies.map((a) => ({ anomalyReason: a.anomalyReason }))),
      persisted: persisted.inserted || 0,
      nextCursor,
      complete,
      limit,
    },
  };
}

async function runD1Diagnostic(env, payload = {}) {
  const migration = await ensureEvAuditMigration(env);
  if (!migration.ok) {
    return {
      ok: false,
      status: migration.status === MIGRATION_STATUS.BLOCKED ? 423 : 409,
      error: `Diagnostic blocked: ${migration.status}. ${migration.reason || ""}`.trim(),
    };
  }
  const id = String(payload.id || `diagnostic:${new Date().toISOString()}`);
  const now = new Date().toISOString();
  try {
    if (payload.cleanup === true) {
      await env.DB.prepare("DELETE FROM ev_audit_records WHERE id = ?").bind(id).run();
      const verify = await env.DB.prepare("SELECT id FROM ev_audit_records WHERE id = ? LIMIT 1").bind(id).first();
      await setMeta(env, "last_d1_readback_success_at", new Date().toISOString());
      return { ok: true, status: 200, body: { ok: true, action: "cleanup", id, removed: !verify } };
    }
    await env.DB.prepare(
      `INSERT OR REPLACE INTO ev_audit_records (
         id, entity_type, entity_id, sport, market, side, model_version, qualification_rule_version,
         freeze_at, stored_ev, recomputed_ev, anomaly_reason, root_cause, qualified, entered_strategy,
         disposition, inputs_json, created_at
       ) VALUES (?, 'diagnostic', ?, 'system', 'DIAGNOSTIC', 'N/A', 'ops', 'ops', ?, 0, 0, 'diagnostic-check', 'ops-check', 0, 0, 'diagnostic', ?, ?)`
    )
      .bind(id, id, now, JSON.stringify({ source: "api/track", note: "d1-read-write-readback verification" }), now)
      .run();
    const row = await env.DB.prepare("SELECT id, anomaly_reason, disposition, created_at FROM ev_audit_records WHERE id = ? LIMIT 1").bind(id).first();
    await setMeta(env, "last_d1_write_success_at", new Date().toISOString());
    await setMeta(env, "last_d1_readback_success_at", new Date().toISOString());
    return { ok: true, status: 200, body: { ok: true, action: "insert-readback", id, readback: row || null } };
  } catch (err) {
    await setMeta(env, "last_d1_write_failure_at", new Date().toISOString());
    return { ok: false, status: 500, error: String(err?.message || err) };
  }
}

async function recomputeAffectedTickets(env, payload = {}) {
  const limit = Math.max(1, Math.min(100, Number(payload.limit) || 50));
  const cursor = payload.cursor ? String(payload.cursor) : null;
  const uniqueQ = cursor
    ? await env.DB
        .prepare(
          "SELECT entity_id FROM ev_audit_records WHERE entity_type = 'strategy-ticket' AND (qualified = 1 OR entered_strategy = 1) AND entity_id > ? GROUP BY entity_id ORDER BY entity_id LIMIT ?"
        )
        .bind(cursor, limit)
        .all()
    : await env.DB
        .prepare(
          "SELECT entity_id FROM ev_audit_records WHERE entity_type = 'strategy-ticket' AND (qualified = 1 OR entered_strategy = 1) GROUP BY entity_id ORDER BY entity_id LIMIT ?"
        )
        .bind(limit)
        .all();
  const ids = (uniqueQ.results || []).map((r) => String(r.entity_id || "")).filter(Boolean);
  if (!ids.length) {
    return { ok: true, status: 200, body: { ok: true, scanned: 0, nextCursor: null, rows: [] } };
  }
  const placeholders = ids.map(() => "?").join(", ");
  const ticketQ = await env.DB.prepare(`SELECT * FROM strategy_tickets WHERE id IN (${placeholders})`).bind(...ids).all();
  const tickets = (ticketQ.results || []).map(mapRawTicket);
  const rows = [];
  for (const t of tickets) {
    const recompute = recomputeTicketRoi(t);
    const reasons = recompute.reasons;
    const severity = highestSeverity(reasons);
    const disposition = severity === "INVALID" || severity === "QUARANTINED" ? "quarantined" : "warning";
    const affectsStrategy = String(t.strategyId || "") === "FBIS-HC-v1";
    const rec = {
      id: `ev-recompute:${t.id}`,
      entityType: "ev-recompute",
      entityId: String(t.id),
      sport: t.sport || null,
      market: t.market || null,
      side: t.side || null,
      modelVersion: t.modelVersion || null,
      qualificationRuleVersion: "FBIS-HC-v1",
      freezeAt: t.qualifiedAt || null,
      storedEv: t.ev == null ? null : Number(t.ev),
      recomputedEv: recompute.expectedRoi,
      anomalyReason: reasons[0] || "none",
      rootCause: reasons.join(",") || "none",
      qualified: Boolean(t.qualified || String(t.tag || "").toUpperCase() === "CONVICTION"),
      enteredStrategy: affectsStrategy,
      disposition,
      inputsJson: JSON.stringify({
        modelProbability: recompute.modelProbability,
        americanOdds: recompute.americanOdds,
        decimalOdds: recompute.decimalOdds,
        opposingPrice: t.benchmarkPrice ?? null,
        noVigProbability: t.entryNoVig ?? null,
        side: t.side,
        marketFamily: normalizeMarketFamily(t.market),
        periodFamily: normalizePeriodFamily(t.market),
        freezeAt: t.qualifiedAt || null,
        eventStart: t.start || null,
        severity,
        reasons,
      }),
      createdAt: new Date().toISOString(),
    };
    rows.push({
      ticketId: t.id,
      game: t.matchup || t.gameId,
      sport: t.sport,
      market: t.market,
      originalExpectedRoi: t.ev,
      recomputedExpectedRoi: recompute.expectedRoi,
      rootCause: reasons,
      severity,
      eligibilityDisposition: disposition,
      affectsStrategyRecord: affectsStrategy,
    });
    await persistEvAuditRecords(env, [rec]);
  }
  const nextCursor = ids.length === limit ? ids[ids.length - 1] : null;
  return { ok: true, status: 200, body: { ok: true, scanned: ids.length, nextCursor, rows } };
}

function mapRawTicket(r) {
  let traits = {};
  try {
    traits = r.traits_json ? JSON.parse(r.traits_json) : {};
  } catch {
    traits = {};
  }
  return {
    id: r.id,
    strategyId: r.strategy_id,
    sport: r.sport,
    gameId: r.game_id,
    matchup: r.matchup,
    market: r.market,
    side: r.side,
    modelVersion: r.model_version,
    checkpoint: r.checkpoint,
    result: r.result,
    ev: r.ev,
    tag: r.tag,
    qualified: String(r.tag || "").toUpperCase() === "CONVICTION",
    qualifiedAt: r.qualified_at,
    start: r.start,
    pinPrice: r.pin_price,
    benchmarkPrice: r.benchmark_price,
    executionPrice: r.execution_price,
    entryNoVig: r.entry_no_vig,
    traits,
    fair: r.model_probability ?? traits.modelProbability ?? null,
    modelProbability: r.model_probability ?? traits.modelProbability ?? null,
  };
}

function recomputeTicketRoi(ticket) {
  const canonical = readCanonicalProbability(ticket);
  const p = canonical.ok ? canonical.modelProbability : null;
  const americanOdds = Number(ticket.pinPrice ?? ticket.benchmarkPrice ?? ticket.executionPrice);
  const reasons = [];
  if (!canonical.ok) {
    const missingish = ["missing", "empty-string", "non-numeric", "nan", "infinite"].includes(String(canonical.reason || ""));
    reasons.push(missingish ? "missing-model-probability" : "probability-out-of-range");
  }
  if (!validAmerican(americanOdds)) reasons.push("invalid-american-odds");
  const decimalOdds = validAmerican(americanOdds) ? americanToDecimal(americanOdds) : null;
  const expectedRoi = canonical.ok && decimalOdds != null ? p * decimalOdds - 1 : null;
  const freezeTs = Date.parse(String(ticket.qualifiedAt || ""));
  const startTs = Date.parse(String(ticket.start || ""));
  if (!Number.isFinite(freezeTs)) reasons.push("missing-freeze-timestamp");
  if (Number.isFinite(freezeTs) && Number.isFinite(startTs) && freezeTs > startTs) reasons.push("post-start-freeze");
  if (!ticket.market) reasons.push("market-mismatch");
  return { modelProbability: p, americanOdds: validAmerican(americanOdds) ? americanOdds : null, decimalOdds, expectedRoi, reasons };
}

function validAmerican(v) {
  return Number.isFinite(Number(v)) && Number(v) !== 0;
}

function americanToDecimal(v) {
  const n = Number(v);
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function highestSeverity(reasons = []) {
  const rank = { INVALID: 4, QUARANTINED: 3, WARNING: 2, INFORMATIONAL: 1 };
  let best = "INFORMATIONAL";
  for (const reason of reasons || []) {
    const sev = anomalyRuleDetails(reason).severity || "INFORMATIONAL";
    if ((rank[sev] || 0) > (rank[best] || 0)) best = sev;
  }
  return best;
}

function normalizePeriodFamily(market) {
  const m = String(market || "").toUpperCase();
  if (m.includes("F5")) return "F5";
  if (m.includes("PROP")) return "player-prop";
  return "full-game";
}

async function deriveTargetGameIds(env, payload) {
  const ids = new Set();
  if (payload.gameId) ids.add(String(payload.gameId));
  if (!env?.DB || !payload.sport || !payload.date) return [...ids];
  const rows = await env.DB
    .prepare("SELECT DISTINCT game_id, home_name, away_name, home_abbr, away_abbr FROM prediction_snapshots WHERE sport = ? AND date = ?")
    .bind(payload.sport, payload.date)
    .all();
  for (const r of rows?.results || []) {
    const homeOk =
      teamMatch(payload.sport, payload.homeName, r.home_name) ||
      teamMatch(payload.sport, payload.homeName, r.home_abbr) ||
      teamMatch(payload.sport, payload.homeAbbr, r.home_name) ||
      teamMatch(payload.sport, payload.homeAbbr, r.home_abbr);
    const awayOk =
      teamMatch(payload.sport, payload.awayName, r.away_name) ||
      teamMatch(payload.sport, payload.awayName, r.away_abbr) ||
      teamMatch(payload.sport, payload.awayAbbr, r.away_name) ||
      teamMatch(payload.sport, payload.awayAbbr, r.away_abbr);
    if (homeOk && awayOk && r.game_id) ids.add(String(r.game_id));
  }
  return [...ids];
}

async function applyManualFinal(env, payload) {
  const nowMs = Date.now();
  const homeScore = Number(payload.homeScore);
  const awayScore = Number(payload.awayScore);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore < 0 || awayScore < 0) {
    return { ok: false, status: 400, error: "invalid final score" };
  }
  if (isFutureStart(payload.start, nowMs)) {
    return { ok: false, status: 409, error: "game has not started yet" };
  }
  const targetGameIds = await deriveTargetGameIds(env, payload);
  if (!targetGameIds.length) return { ok: false, status: 404, error: "no matching game ids found" };
  let eligibleIds = [...targetGameIds];
  try {
    const placeholders = targetGameIds.map(() => "?").join(", ");
    const startsQ = await env.DB
      .prepare(`SELECT game_id, MIN(start) AS start FROM prediction_snapshots WHERE game_id IN (${placeholders}) GROUP BY game_id`)
      .bind(...targetGameIds)
      .all();
    eligibleIds = (startsQ.results || [])
      .filter((r) => !isFutureStart(r.start, nowMs))
      .map((r) => String(r.game_id));
  } catch {
    if (isFutureStart(payload.start, nowMs)) eligibleIds = [];
  }
  if (!eligibleIds.length) {
    return { ok: false, status: 409, error: "manual final blocked before kickoff" };
  }
  const gradedAt = new Date().toISOString();
  const hasF5Home = payload.f5HomeScore !== undefined && payload.f5HomeScore !== null && String(payload.f5HomeScore).trim() !== "";
  const hasF5Away = payload.f5AwayScore !== undefined && payload.f5AwayScore !== null && String(payload.f5AwayScore).trim() !== "";
  const f5HomeScore = hasF5Home ? Number(payload.f5HomeScore) : null;
  const f5AwayScore = hasF5Away ? Number(payload.f5AwayScore) : null;
  if (hasF5Home !== hasF5Away || (hasF5Home && (!Number.isFinite(f5HomeScore) || !Number.isFinite(f5AwayScore) || f5HomeScore < 0 || f5AwayScore < 0))) {
    return { ok: false, status: 400, error: "enter both valid non-negative F5 scores" };
  }
  let snapshotsUpdated = 0;
  for (const gameId of eligibleIds) {
    const res = await gradeSnapshotsForGame(env, { gameId, actualHome: homeScore, actualAway: awayScore, gradedAt });
    if (res?.ok) snapshotsUpdated += 1;
  }

  const finalRef = {
    id: String(payload.gameId || eligibleIds[0]),
    sport: payload.sport || null,
    date: payload.date || null,
    start: payload.start || null,
    home: { name: payload.homeName || payload.homeAbbr || "Home", abbr: payload.homeAbbr || null, score: homeScore },
    away: { name: payload.awayName || payload.awayAbbr || "Away", abbr: payload.awayAbbr || null, score: awayScore },
    status: { completed: true, detail: "Manual Final" },
    f5Score: hasF5Home ? { home: f5HomeScore, away: f5AwayScore, complete: true } : null,
  };

  const strategy = await queryStrategyTickets(env, {});
  let strategyGraded = 0;
  for (const t of strategy || []) {
    if (t.result && t.result !== "OPEN") continue;
    if (isFutureStart(t.start, nowMs)) continue;
    const resolved = resolveFinalForTicket(t, [finalRef]);
    if (resolved?.start && isFutureStart(resolved.start, nowMs)) continue;
    const graded = gradeStrategyResult(t, resolved);
    if (!graded) continue;
    const out = await gradeStrategyTicket(env, t.id, graded);
    if (out?.ok) strategyGraded += 1;
  }

  const executed = await queryExecutedBets(env, { includeRaw: false });
  let betsGraded = 0;
  for (const b of executed.rows || []) {
    if (b.result && b.result !== "OPEN") continue;
    if (!b.gameId || !eligibleIds.includes(String(b.gameId))) continue;
    if (isFutureStart(b.start, nowMs)) continue;
    const settled = settleExecutedBet(b, finalRef);
    if (!settled || !settled.result || settled.result === "OPEN") continue;
    const out = await updateExecutedBet(
      env,
      b.id,
      {
        result: settled.result,
        profit: settled.profit,
        settledReturn: settled.settledReturn,
        gradedAt: settled.gradedAt,
        voidReason: settled.voidReason || null,
        finalAwayScore: awayScore,
        finalHomeScore: homeScore,
        f5AwayScore: hasF5Home ? f5AwayScore : null,
        f5HomeScore: hasF5Home ? f5HomeScore : null,
        settlementSource: "operator-final-score",
        settlementEvidence: { status: "final", source: "operator-final-score", capturedAt: gradedAt },
      },
      "manual-final-score"
    );
    if (out?.ok) betsGraded += 1;
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      gameIds: eligibleIds,
      snapshotsUpdated,
      strategyGraded,
      betsGraded,
      manualFinal: { homeScore, awayScore, f5HomeScore, f5AwayScore, gradedAt },
    },
  };
}

async function cleanupFutureGrades(env) {
  const nowIso = new Date().toISOString();
  const snapOut = await env.DB.prepare(
    `UPDATE prediction_snapshots
     SET actual_home = NULL, actual_away = NULL, graded_at = NULL
     WHERE actual_home IS NOT NULL
       AND game_id IN (SELECT id FROM games WHERE start IS NOT NULL AND start > ?)`
  ).bind(nowIso).run();
  const predOut = await env.DB.prepare(
    `UPDATE predictions
     SET actual_home = NULL, actual_away = NULL, graded_at = NULL
     WHERE actual_home IS NOT NULL
       AND game_id IN (SELECT id FROM games WHERE start IS NOT NULL AND start > ?)`
  ).bind(nowIso).run();
  // Reopen strategy grades for games that have not started yet.
  const stratOut = await env.DB.prepare(
    `UPDATE strategy_tickets
     SET result = 'OPEN', profit = NULL, clv = NULL, graded_at = NULL
     WHERE result IN ('WON','LOST','PUSH','VOID')
       AND game_id IN (SELECT id FROM games WHERE start IS NOT NULL AND start > ?)`
  ).bind(nowIso).run();
  // Also reopen when graded_at is strictly before the game start (cross-day series mismatch).
  const stratPrematureOut = await env.DB.prepare(
    `UPDATE strategy_tickets
     SET result = 'OPEN', profit = NULL, clv = NULL, graded_at = NULL
     WHERE result IN ('WON','LOST','PUSH','VOID')
       AND graded_at IS NOT NULL
       AND game_id IN (
         SELECT id FROM games
         WHERE start IS NOT NULL AND start > strategy_tickets.graded_at
       )`
  ).run();
  const betOut = await env.DB.prepare(
    `UPDATE executed_bets
     SET result = 'OPEN', profit = NULL, settled_return = NULL, graded_at = NULL, void_reason = NULL
     WHERE result IN ('WON','LOST','PUSH','VOID')
       AND game_id IN (SELECT id FROM games WHERE start IS NOT NULL AND start > ?)`
  ).bind(nowIso).run();

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      snapshotRowsReset: Number(snapOut?.meta?.changes || 0),
      predictionRowsReset: Number(predOut?.meta?.changes || 0),
      strategyTicketsReset:
        Number(stratOut?.meta?.changes || 0) + Number(stratPrematureOut?.meta?.changes || 0),
      executedBetsReset: Number(betOut?.meta?.changes || 0),
    },
  };
}

async function cleanupCrossDateStrategy(env) {
  const tickets = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id });
  const open = (tickets || []).filter((t) => !t.result || t.result === "OPEN");
  const gameIds = [...new Set(open.map((t) => t.gameId).filter(Boolean))];
  const gamesQ = await queryGamesByIds(env, gameIds);
  const gameById = new Map((gamesQ.rows || []).map((g) => [String(g.id), g]));
  const plan = planCrossDateStrategyCleanup(open, { gameById });
  const gradedAt = new Date().toISOString();
  let voided = 0;
  let failed = 0;
  for (const row of plan.void) {
    const out = await gradeStrategyTicket(env, row.id, {
      result: "VOID",
      profit: 0,
      clv: null,
      gradedAt,
    });
    if (out?.ok) {
      voided += 1;
      try {
        await env.DB.prepare(
          `UPDATE strategy_tickets
           SET validation_result = ?, validation_failure_reason = ?, validation_timestamp = ?
           WHERE id = ?`
        )
          .bind("VOID_CROSS_DATE", `cross-date-duplicate; canonical=${row.canonicalDate}`, gradedAt, row.id)
          .run();
      } catch {
        /* reason stamp is best-effort */
      }
    } else {
      failed += 1;
    }
  }
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      groupsScanned: plan.groups,
      keepN: plan.keep.length,
      voidPlanned: plan.void.length,
      voided,
      failed,
      sample: plan.void.slice(0, 12),
    },
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = url.searchParams.get("sport") || "all";
  const days = url.searchParams.get("days") || "season";
  const checkpoint = url.searchParams.get("checkpoint") || "LATEST";
  const version = url.searchParams.get("version") || "all";
  const model = url.searchParams.get("model") || "ensemble";
  const type = url.searchParams.get("type") || "perGame";
  const year = url.searchParams.get("year") || "";
  const team = url.searchParams.get("team") || "";
  const includeAnomalies = url.searchParams.get("includeAnomalies") === "1";
  try {
    const migration = await verifyEvAuditMigration({ DB: context.env.DB });
    const payload = await buildTrackReport(
      sport,
      days,
      {
        PARLAY_API_KEY: context.env.PARLAY_API_KEY,
        THEODDS_API_KEY: context.env.THEODDS_API_KEY,
        SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
        THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
        BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
        CFBD_API_KEY: context.env.CFBD_API_KEY,
        CBBD_API_KEY: context.env.CBBD_API_KEY,
        caches: caches.default,
        DB: context.env.DB,
      },
      { checkpoint, version, model, type, year, team }
    );
    const db = payload?.db || {};
    const writeVerification = writeVerificationState({
      readOk: db.ok === true,
      lastWriteSuccessAt: db.lastD1WriteSuccess || db.lastWrite || null,
      lastReadbackSuccessAt: db.lastD1ReadbackSuccessAt || db.lastD1WriteSuccess || null,
      lastFailureAt: db.lastD1FailureAt || db.lastFailedCollectAt || db.lastFailedHarvestAt || null,
      failedWrites: Number(db.failedWrites || 0) + Number(db.failedHarvests || 0),
      reason: db.reason || db.lastError || "",
    });
    const hasAuthoritativeData = db.ok === true && (payload.aggregateOnly || Array.isArray(payload.games));
    const semantic = deriveHealthState({
      hasAuthoritativeData,
      requiredChecks: [
        { name: "d1-binding", ok: db.bound !== false, source: db.source || "d1" },
        { name: "d1-read", ok: db.ok === true, source: db.healthSource || db.source || "d1", detail: db.reason || db.lastError || null },
        {
          name: "d1-write",
          ok: Number(db.failedWrites || 0) === 0 && Number(db.failedHarvests || 0) === 0,
          source: db.source || "d1",
          detail: `failedWrites=${Number(db.failedWrites || 0)} failedHarvests=${Number(db.failedHarvests || 0)}`,
        },
        {
          name: "scheduled-collect",
          ok: db.scheduled?.collect?.state === "healthy",
          source: db.source || "d1",
          detail: db.scheduled?.collect?.state || "unknown",
          lastSuccessAt: db.lastScheduledCollectSuccess || null,
          freshnessMs: 8 * 60 * 60 * 1000,
        },
        {
          name: "scheduled-harvest",
          ok: db.scheduled?.harvest?.state === "healthy",
          source: db.source || "d1",
          detail: db.scheduled?.harvest?.state || "unknown",
          lastSuccessAt: db.lastScheduledHarvestSuccess || null,
          freshnessMs: 8 * 60 * 60 * 1000,
        },
      ],
    });
    payload.health = {
      state: semantic.state,
      currentAttemptAt: new Date().toISOString(),
      checks: semantic.checks,
      failures: semantic.failures,
      staleChecks: semantic.staleChecks,
      writeVerification,
    };
    payload.population = {
      accuracy: populationDescriptor({
        populationType: POPULATION_TYPE.FROZEN_PROJECTION,
        sport: sport || "all",
        marketFamily: "mixed",
        periodFamily: "mixed",
        modelVersion: version === "all" ? null : version,
        qualificationRuleVersion: "FBIS-v1-qualified-gates",
        checkpoint,
        dateRange: { since: payload?.accuracySummary?.dateRange?.since || null, until: payload?.accuracySummary?.dateRange?.until || null },
        settledN: Number(payload?.accuracy?.n || 0),
        openN: Number((payload?.games || []).filter((g) => g.status === "OPEN").length),
        sourceHealth: semantic.state,
        freshness: { lastReadSuccessAt: db.lastCollectSuccess || db.lastCollect || null, lastWriteSuccessAt: db.lastD1WriteSuccess || db.lastWrite || null },
      }),
      strategy: populationDescriptor({
        populationType: POPULATION_TYPE.STRATEGY_TICKET,
        sport: sport || "all",
        marketFamily: "mixed",
        periodFamily: "mixed",
        strategyId: "FBIS-HC-v1",
        strategyVersion: 1,
        qualificationRuleVersion: "FBIS-HC-v1",
        dateRange: { since: payload?.accuracySummary?.dateRange?.since || null, until: payload?.accuracySummary?.dateRange?.until || null },
        settledN: Number(payload?.strategyPerformance?.settled || 0),
        openN: Number(payload?.strategyPerformance?.open || 0),
        clvN: Number(payload?.clv?.validClv || 0),
        sourceHealth: semantic.state,
        freshness: { lastReadSuccessAt: db.lastCollectSuccess || db.lastCollect || null },
      }),
    };
    const executedQ = await queryExecutedBets({ DB: context.env.DB }, { includeRaw: false });
    payload.executedBets = executedQ.ok
      ? { available: true, summary: summarizeExecutedBets(executedQ.rows || []) }
      : { available: false, reason: executedQ.reason || "executed-bet-query-failed", summary: null };
    payload.authoritative = {
      accuracy: semantic.state === "HEALTHY",
      strategy: semantic.state === "HEALTHY",
      anomalies: migration.ok && semantic.state === "HEALTHY",
    };
    const auditQ = includeAnomalies
      ? await queryEvAuditRecords({ DB: context.env.DB }, { limit: 5000 })
      : { ok: false, reason: "not-requested", rows: [] };
    // Summary counts are small and authoritative; only the bounded row sample
    // is optional. SYS must not display zero anomalies merely because the
    // operator has not requested detail rows.
    const anomalySummaryQ = migration.ok ? await queryEvAuditTicketSummary({ DB: context.env.DB }) : { ok: false };
    const meta = migration.ok ? await readMeta({ DB: context.env.DB }) : {};
    const sourceRowsScanned = Number(meta.ev_audit_scanned_total || 0);
    const uniqueAffectedTickets = Number(anomalySummaryQ?.summary?.uniqueAffectedTickets || uniqueCount((auditQ.rows || []).map((r) => r.entity_id)));
    const uniqueSourceWithoutAnomaly = sourceRowsScanned > 0 ? Math.max(0, sourceRowsScanned - uniqueAffectedTickets) : null;
    payload.anomalies = {
      migrationStatus: migration.status,
      available: anomalySummaryQ.ok && migration.ok,
      detailRowsLoaded: includeAnomalies && auditQ.ok,
      blockedReason: migration.ok
        ? (anomalySummaryQ.ok ? null : anomalySummaryQ.reason || "summary-unavailable")
        : migration.reason || MIGRATION_STATUS.UNVERIFIED,
      count: Number(anomalySummaryQ?.summary?.totalFindings || (auditQ.rows || []).length),
      totalCount: Number(auditQ.totalCount || 0),
      sourceRowsScanned,
      uniqueSourceTicketsWithoutAnomaly: uniqueSourceWithoutAnomaly,
      byReason: anomalySummaryQ?.summary?.byReason || summarizeEvAudits((auditQ.rows || []).map((r) => ({ anomalyReason: r.anomaly_reason || r.anomalyReason }))),
      bySport: anomalySummaryQ?.summary?.bySport || summarizeBy((auditQ.rows || []), (r) => r.sport || "unknown"),
      byMarketFamily: anomalySummaryQ?.summary?.byMarketFamily || summarizeBy((auditQ.rows || []), (r) => normalizeMarketFamily(r.market)),
      qualifiedCount: Number(anomalySummaryQ?.summary?.qualifiedAffectedTickets || 0),
      enteredStrategyCount: Number(anomalySummaryQ?.summary?.enteredStrategyTickets || 0),
      settledAffectedTickets: Number(anomalySummaryQ?.summary?.settledAffectedTickets || 0),
      openAffectedTickets: Number(anomalySummaryQ?.summary?.openAffectedTickets || 0),
      winningAffectedTickets: Number(anomalySummaryQ?.summary?.winningAffectedTickets || 0),
      losingAffectedTickets: Number(anomalySummaryQ?.summary?.losingAffectedTickets || 0),
      unresolvedAffectedTickets: Number(anomalySummaryQ?.summary?.unresolvedAffectedTickets || 0),
      uniqueAffectedTickets,
      averageFindingsPerAffectedTicket: Number(anomalySummaryQ?.summary?.averageFindingsPerAffectedTicket || averagePerUnique((auditQ.rows || []).map((r) => r.entity_id))),
      maxFindingsPerTicket: Number(anomalySummaryQ?.summary?.maxFindingsPerTicket || maxFindings((auditQ.rows || []).map((r) => r.entity_id))),
      ruleCatalog: ANOMALY_RULES,
      byModelVersion: anomalySummaryQ?.summary?.byModelVersion || summarizeBy((auditQ.rows || []), (r) => r.model_version || "unknown"),
      byQualificationRuleVersion: anomalySummaryQ?.summary?.byQualificationRuleVersion || summarizeBy((auditQ.rows || []), (r) => r.qualification_rule_version || "unknown"),
      byCheckpoint: anomalySummaryQ?.summary?.byCheckpoint || summarizeBy((auditQ.rows || []), (r) => r.inputs_json ? (safeJson(r.inputs_json)?.checkpoint || "unknown") : "unknown"),
      byDate: anomalySummaryQ?.summary?.byDate || summarizeBy((auditQ.rows || []), (r) => String(r.freeze_at || r.created_at || "").slice(0, 10) || "unknown"),
      byPeriodFamily: anomalySummaryQ?.summary?.byPeriodFamily || summarizeBy((auditQ.rows || []), (r) => normalizePeriodFamily(r.market)),
      rows: (auditQ.rows || []).slice(0, 50).map((r) => ({
        id: r.id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        sport: r.sport,
        market: r.market,
        side: r.side,
        storedEv: r.stored_ev,
        recomputedEv: r.recomputed_ev,
        anomalyReason: r.anomaly_reason,
        disposition: r.disposition,
        qualified: Boolean(r.qualified),
        enteredStrategy: Boolean(r.entered_strategy),
        createdAt: r.created_at,
      })),
    };
    payload.telemetry = {
      endpoint: "/api/track",
      requestCount: 1,
      queryCountEstimate: includeAnomalies ? 8 : 6,
      rowsReadEstimate: Number((payload.games || []).length) + Number((payload.finals || []).length) + Number((auditQ.rows || []).length),
      cacheStatus: payload.source || "unknown",
      dateRange: payload?.accuracySummary?.dateRange || null,
      paginationCursor: includeAnomalies ? null : "anomalies-not-requested",
      lastQuotaFailure: db.lastError || null,
    };
    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60",
        "access-control-allow-origin": "*",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err), games: [], finals: [], accuracy: { n: 0 } }),
      {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }
}

function summarizeBy(rows, keyFn) {
  const out = {};
  for (const row of rows || []) {
    const k = String(keyFn(row) || "unknown");
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function normalizeMarketFamily(market) {
  const m = String(market || "").toUpperCase();
  if (m.includes("F5")) return "F5";
  if (m.includes("PROP")) return "PLAYER_PROP";
  if (m.includes("SPREAD") || m.includes("RL")) return "SPREAD";
  if (m.includes("TOTAL")) return "TOTAL";
  if (m.includes("ML")) return "MONEYLINE";
  return m || "UNKNOWN";
}

export async function onRequestPost(context) {
  try {
    let body = {};
    try {
      body = await context.request.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    const action = String(body?.action || "").toLowerCase();
    if (
      action !== "manual-final" &&
      action !== "cleanup-future-grades" &&
      action !== "cleanup-cross-date-strategy" &&
      action !== "audit-ev" &&
      action !== "d1-diagnostic" &&
      action !== "recompute-ev" &&
      action !== "reconstruct-probability"
    )
      return json({ ok: false, error: "unknown action" }, 400);
    const result =
      action === "cleanup-future-grades"
        ? await cleanupFutureGrades({ DB: context.env.DB })
        : action === "cleanup-cross-date-strategy"
          ? await cleanupCrossDateStrategy({ DB: context.env.DB })
        : action === "audit-ev"
          ? await runEvAudit({ DB: context.env.DB }, body)
          : action === "d1-diagnostic"
            ? await runD1Diagnostic({ DB: context.env.DB }, body)
            : action === "recompute-ev"
              ? await recomputeAffectedTickets({ DB: context.env.DB }, body)
              : action === "reconstruct-probability"
                ? await (async () => {
                    const out = await reconstructAffectedTickets({ DB: context.env.DB });
                    return { ok: true, status: 200, body: out };
                  })()
          : await applyManualFinal({ DB: context.env.DB }, body);
    if (!result.ok) return json({ ok: false, error: result.error || "failed" }, result.status || 400);
    return json(result.body, 200);
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function uniqueCount(values = []) {
  return new Set((values || []).filter(Boolean).map(String)).size;
}

function averagePerUnique(values = []) {
  const n = uniqueCount(values);
  if (!n) return 0;
  return (values || []).length / n;
}

function maxFindings(values = []) {
  const counts = {};
  for (const v of values || []) {
    const k = String(v || "");
    if (!k) continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  return Math.max(0, ...Object.values(counts));
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
