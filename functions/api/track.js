import { buildTrackReport } from "../lib/projLedger.js";
import { gradeSnapshotsForGame, queryExecutedBets, queryStrategyTickets, updateExecutedBet, gradeStrategyTicket } from "../lib/store.js";
import { settleExecutedBet } from "../lib/executedBets.js";
import { gradeStrategyResult } from "../lib/strategy.js";
import { resolveFinalForTicket } from "../lib/projLedger.js";
import { resolveTeam } from "../lib/teams.js";

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
  const gamesRows = await env.DB.prepare("SELECT id, start FROM games WHERE start IS NOT NULL").all();
  const futureGameIds = new Set(
    (gamesRows.results || [])
      .filter((r) => isFutureStart(r.start))
      .map((r) => String(r.id))
  );
  let snapReset = 0;
  let predReset = 0;
  const ids = [...futureGameIds];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const placeholders = chunk.map(() => "?").join(", ");
    const snapOut = await env.DB
      .prepare(`UPDATE prediction_snapshots SET actual_home = NULL, actual_away = NULL, graded_at = NULL WHERE actual_home IS NOT NULL AND game_id IN (${placeholders})`)
      .bind(...chunk)
      .run();
    const predOut = await env.DB
      .prepare(`UPDATE predictions SET actual_home = NULL, actual_away = NULL, graded_at = NULL WHERE actual_home IS NOT NULL AND game_id IN (${placeholders})`)
      .bind(...chunk)
      .run();
    snapReset += Number(snapOut?.meta?.changes || 0);
    predReset += Number(predOut?.meta?.changes || 0);
  }

  let strategyReset = 0;
  const strategy = await queryStrategyTickets(env, {});
  for (const t of strategy || []) {
    if (!["WON", "LOST", "PUSH", "VOID"].includes(String(t.result || ""))) continue;
    if (!(t.gameId && futureGameIds.has(String(t.gameId)))) continue;
    await env.DB
      .prepare("UPDATE strategy_tickets SET result = 'OPEN', profit = NULL, clv = NULL, graded_at = NULL WHERE id = ?")
      .bind(t.id)
      .run();
    strategyReset += 1;
  }

  let betsReset = 0;
  const executed = await queryExecutedBets(env, { includeRaw: false });
  for (const b of executed.rows || []) {
    if (!["WON", "LOST", "PUSH", "VOID"].includes(String(b.result || ""))) continue;
    if (!(b.gameId && futureGameIds.has(String(b.gameId)))) continue;
    const out = await updateExecutedBet(
      env,
      b.id,
      { result: "OPEN", profit: null, settledReturn: null, gradedAt: null, voidReason: null },
      "cleanup-future-grade"
    );
    if (out?.ok) betsReset += 1;
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      snapshotRowsReset: snapReset,
      predictionRowsReset: predReset,
      strategyTicketsReset: strategyReset,
      executedBetsReset: betsReset,
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
  try {
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
    if (action !== "manual-final" && action !== "cleanup-future-grades") return json({ ok: false, error: "unknown action" }, 400);
    const result =
      action === "cleanup-future-grades"
        ? await cleanupFutureGrades({ DB: context.env.DB })
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
