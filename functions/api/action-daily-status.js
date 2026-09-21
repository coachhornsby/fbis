import { queryGames } from "../lib/store.js";
import { loadFbisSlateForMatching } from "../lib/actionApifyEvidence.js";

const TZ = "America/Chicago";
const PROFILE = "DAILY";
const LIFECYCLE = "daily";
const STALE_RUNNING_MS = 30 * 60 * 1000;
const SPORTS = Object.freeze(["mlb", "nfl", "nba", "nhl", "cfb", "cbb"]);

function localDay(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function deriveActionDailyStatus({
  run = null,
  persistedObservations = 0,
  expectedSlateGames = 0,
  coveredSlateGames = 0,
  now = Date.now(),
} = {}) {
  if (!run) {
    return {
      state: "MISSING",
      healthy: false,
      verifiedPersisted: false,
      verifiedSlateCoverage: false,
      reason: "no_daily_run_today",
    };
  }

  const status = String(run.status || "");
  const startedMs = Date.parse(String(run.started_at || ""));
  const ageMs = Number.isFinite(startedMs) ? Math.max(0, now - startedMs) : null;
  const persisted = Math.max(0, Number(persistedObservations || 0));
  const expected = Math.max(0, Number(expectedSlateGames || 0));
  const covered = Math.max(0, Number(coveredSlateGames || 0));

  if (status === "running_daily") {
    const stale = ageMs == null || ageMs > STALE_RUNNING_MS;
    return {
      state: stale ? "STALE" : "RUNNING",
      healthy: false,
      verifiedPersisted: false,
      verifiedSlateCoverage: false,
      reason: stale ? "daily_run_exceeded_running_window" : "daily_run_in_progress",
      ageMs,
    };
  }

  if (status.startsWith("success")) {
    const verifiedPersisted = persisted > 0;
    const verifiedSlateCoverage = expected === 0 ? verifiedPersisted : covered >= expected;
    const healthy = verifiedPersisted && verifiedSlateCoverage;
    return {
      state: healthy ? "HEALTHY" : "DEGRADED",
      healthy,
      verifiedPersisted,
      verifiedSlateCoverage,
      reason: healthy
        ? "daily_run_persisted_and_slate_covered"
        : !verifiedPersisted
          ? "success_without_persisted_observations"
          : "success_without_full_slate_coverage",
      ageMs,
    };
  }

  if (status.startsWith("failed")) {
    return {
      state: "FAILED",
      healthy: false,
      verifiedPersisted: false,
      verifiedSlateCoverage: false,
      reason: run.error_class || run.error_message || "daily_run_failed",
      ageMs,
    };
  }

  return {
    state: "DEGRADED",
    healthy: false,
    verifiedPersisted: false,
    verifiedSlateCoverage: false,
    reason: `unexpected_daily_status:${status || "unknown"}`,
    ageMs,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

async function loadTodayCoverage(env, runId, today) {
  const coverage = [];
  let expectedSlateGames = 0;
  let coveredSlateGames = 0;

  for (const sport of SPORTS) {
    let slate = { fbisEvents: [], gamesExpected: 0, slateError: null };
    try {
      slate = await loadFbisSlateForMatching(queryGames, env, { sport, date: today });
    } catch (err) {
      coverage.push({
        sport,
        expected: 0,
        covered: 0,
        missingEventIds: [],
        slateError: String(err?.message || err),
      });
      continue;
    }

    const ids = [...new Set((slate.fbisEvents || [])
      .map((g) => String(g?.id || g?.gameId || g?.eventId || "").trim())
      .filter(Boolean))];
    const expected = ids.length;
    expectedSlateGames += expected;

    if (!runId || !expected) {
      coverage.push({
        sport,
        expected,
        covered: 0,
        missingEventIds: ids,
        slateError: slate.slateError || null,
      });
      continue;
    }

    let coveredIds = [];
    try {
      const placeholders = ids.map(() => "?").join(",");
      const res = await env.DB.prepare(
        `SELECT DISTINCT fbis_event_id
         FROM shadow_market_observations
         WHERE run_id = ?
           AND fbis_event_id IN (${placeholders})`
      ).bind(runId, ...ids).all();
      coveredIds = (res?.results || []).map((r) => String(r.fbis_event_id || "")).filter(Boolean);
    } catch {
      coveredIds = [];
    }

    const coveredSet = new Set(coveredIds);
    const missingEventIds = ids.filter((id) => !coveredSet.has(id));
    const covered = expected - missingEventIds.length;
    coveredSlateGames += covered;
    coverage.push({
      sport,
      expected,
      covered,
      missingEventIds,
      slateError: slate.slateError || null,
    });
  }

  return { expectedSlateGames, coveredSlateGames, coverage };
}

export async function onRequestGet(context) {
  const db = context?.env?.DB;
  if (!db?.prepare) {
    return json({
      ok: false,
      state: "UNAVAILABLE",
      healthy: false,
      verifiedPersisted: false,
      verifiedSlateCoverage: false,
      reason: "d1_unavailable",
      generatedAt: new Date().toISOString(),
    }, 503);
  }

  const today = localDay(new Date());
  try {
    const run = await db.prepare(
      `SELECT
        id, status, apify_run_id, dataset_id, requested_max_items,
        games_returned, games_matched, games_unmatched, observations_written,
        malformed_rows, estimated_cost_usd, actual_cost_usd, error_class,
        error_message, started_at, finished_at, duration_ms
       FROM shadow_collection_runs
       WHERE sport='all' AND profile=? AND lifecycle=? AND substr(started_at,1,10)=?
       ORDER BY started_at DESC
       LIMIT 1`
    ).bind(PROFILE, LIFECYCLE, today).first();

    let persistedObservations = 0;
    if (run?.id) {
      const persisted = await db.prepare(
        "SELECT COUNT(*) AS n FROM shadow_market_observations WHERE run_id=?"
      ).bind(run.id).first();
      persistedObservations = Number(persisted?.n || 0);
    }

    const slate = await loadTodayCoverage(context.env, run?.id || null, today);
    const derived = deriveActionDailyStatus({
      run,
      persistedObservations,
      expectedSlateGames: slate.expectedSlateGames,
      coveredSlateGames: slate.coveredSlateGames,
      now: Date.now(),
    });

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      timezone: TZ,
      day: today,
      ...derived,
      expectedSlateGames: slate.expectedSlateGames,
      coveredSlateGames: slate.coveredSlateGames,
      coverage: slate.coverage,
      run: run ? {
        id: run.id,
        status: run.status,
        apifyRunId: run.apify_run_id || null,
        datasetId: run.dataset_id || null,
        requestedMaxItems: Number(run.requested_max_items || 0),
        gamesReturned: Number(run.games_returned || 0),
        gamesMatched: Number(run.games_matched || 0),
        gamesUnmatched: Number(run.games_unmatched || 0),
        observationsWrittenCounter: Number(run.observations_written || 0),
        persistedObservations,
        malformedRows: Number(run.malformed_rows || 0),
        estimatedCostUsd: run.estimated_cost_usd == null ? null : Number(run.estimated_cost_usd),
        actualCostUsd: run.actual_cost_usd == null ? null : Number(run.actual_cost_usd),
        errorClass: run.error_class || null,
        errorMessage: run.error_message || null,
        startedAt: run.started_at || null,
        finishedAt: run.finished_at || null,
        durationMs: run.duration_ms == null ? null : Number(run.duration_ms),
      } : null,
    });
  } catch (err) {
    return json({
      ok: false,
      state: "UNAVAILABLE",
      healthy: false,
      verifiedPersisted: false,
      verifiedSlateCoverage: false,
      reason: "daily_status_query_failed",
      error: String(err?.message || err),
      generatedAt: new Date().toISOString(),
      day: today,
    }, 500);
  }
}
