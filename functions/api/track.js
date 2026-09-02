import { buildTrackReport } from "../lib/projLedger.js";
import { gradeSnapshotsForGame, queryExecutedBets, queryStrategyTickets, queryStrategyTicketsPaged, updateExecutedBet, gradeStrategyTicket, persistEvAuditRecords, queryEvAuditRecords, setMeta } from "../lib/store.js";
import { settleExecutedBet } from "../lib/executedBets.js";
import { gradeStrategyResult } from "../lib/strategy.js";
import { resolveFinalForTicket } from "../lib/projLedger.js";
import { resolveTeam } from "../lib/teams.js";
import { deriveHealthState, writeVerificationState } from "../lib/healthContract.js";
import { populationDescriptor, POPULATION_TYPE } from "../lib/populationDescriptor.js";
import { auditTicketEv, summarizeEvAudits } from "../lib/evAudit.js";
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
      manualFinal: { homeScore, awayScore, gradedAt },
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
  const stratOut = await env.DB.prepare(
    `UPDATE strategy_tickets
     SET result = 'OPEN', profit = NULL, clv = NULL, graded_at = NULL
     WHERE result IN ('WON','LOST','PUSH','VOID')
       AND game_id IN (SELECT id FROM games WHERE start IS NOT NULL AND start > ?)`
  ).bind(nowIso).run();
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
      strategyTicketsReset: Number(stratOut?.meta?.changes || 0),
      executedBetsReset: Number(betOut?.meta?.changes || 0),
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
    payload.authoritative = {
      accuracy: semantic.state === "HEALTHY",
      strategy: semantic.state === "HEALTHY",
      anomalies: includeAnomalies && semantic.state === "HEALTHY",
    };
    const auditQ = includeAnomalies
      ? await queryEvAuditRecords({ DB: context.env.DB }, { limit: 200 })
      : { ok: false, reason: "not-requested", rows: [] };
    payload.anomalies = {
      migrationStatus: migration.status,
      available: includeAnomalies && auditQ.ok && migration.ok,
      blockedReason: !includeAnomalies
        ? "not-requested"
        : migration.ok
          ? (auditQ.ok ? null : auditQ.reason || "unavailable")
          : migration.reason || MIGRATION_STATUS.UNVERIFIED,
      count: (auditQ.rows || []).length,
      byReason: summarizeEvAudits((auditQ.rows || []).map((r) => ({ anomalyReason: r.anomaly_reason || r.anomalyReason }))),
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

export async function onRequestPost(context) {
  try {
    let body = {};
    try {
      body = await context.request.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    const action = String(body?.action || "").toLowerCase();
    if (action !== "manual-final" && action !== "cleanup-future-grades" && action !== "audit-ev") return json({ ok: false, error: "unknown action" }, 400);
    const result =
      action === "cleanup-future-grades"
        ? await cleanupFutureGrades({ DB: context.env.DB })
        : action === "audit-ev"
          ? await runEvAudit({ DB: context.env.DB }, body)
          : await applyManualFinal({ DB: context.env.DB }, body);
    if (!result.ok) return json({ ok: false, error: result.error || "failed" }, result.status || 400);
    return json(result.body, 200);
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
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
