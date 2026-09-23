/**
 * D1-backed Action/Apify candidate health + championship evidence.
 * Cold-start safe — longitudinal metrics must not depend on isolate memory.
 */

import { ACTION_APIFY_PROVIDER } from "./actionApifyShadow.js";
import { readCandidateConfig, candidateHealthSection } from "./actionApifyCandidateConfig.js";
import {
  buildPromotionReadinessScorecard,
  projectMonthlyStarterSufficiency,
  runProviderChampionship,
} from "./actionApifyChampionship.js";
import {
  loadSchedulerState,
  queryMonthToDateSpendUsd,
  schedulerScopeKey,
} from "./actionApifyDurableState.js";

function windowStartIso(window, now = new Date()) {
  const w = String(window || "7d").toLowerCase();
  const ms =
    w === "24h" ? 24 * 3600e3 :
    w === "14d" ? 14 * 24 * 3600e3 :
    w === "30d" ? 30 * 24 * 3600e3 :
    7 * 24 * 3600e3;
  return new Date(now.getTime() - ms).toISOString();
}

function safeJson(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

/**
 * Durable candidate health from D1 (+ config). Never marks production DOWN.
 */
export async function loadDurableCandidateHealth(env, db, {
  sport = "cfb",
  profile = "BASE",
  lifecycle = "pregame",
} = {}) {
  const cfg = readCandidateConfig(env);
  const base = candidateHealthSection(cfg, {});
  if (!db?.queryOne) {
    return {
      ...base,
      durable: false,
      readiness: "NOT_READY",
      note: "D1 unbound — health ephemeral only",
      affectsProductionOdds: false,
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
    };
  }

  const scopeKey = schedulerScopeKey(sport, profile, lifecycle);
  const sched = await loadSchedulerState(db, { scopeKey });
  const mtd = await queryMonthToDateSpendUsd(db);
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86400e3).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400e3).toISOString();

  const lastRun = await db.queryOne(
    `SELECT * FROM shadow_collection_runs WHERE provider = ? ORDER BY started_at DESC LIMIT 1`,
    [ACTION_APIFY_PROVIDER]
  );
  const lastSuccess = await db.queryOne(
    `SELECT * FROM shadow_collection_runs
     WHERE provider = ? AND (status LIKE 'success%' OR status = 'SUCCEEDED')
     ORDER BY started_at DESC LIMIT 1`,
    [ACTION_APIFY_PROVIDER]
  );
  const lastFail = await db.queryOne(
    `SELECT * FROM shadow_collection_runs
     WHERE provider = ? AND status NOT LIKE 'success%' AND status != 'SUCCEEDED'
     ORDER BY started_at DESC LIMIT 1`,
    [ACTION_APIFY_PROVIDER]
  );
  const rel24 = await db.queryOne(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS ok
     FROM shadow_provider_reliability WHERE created_at >= ?`,
    [dayAgo]
  );
  const rel7 = await db.queryOne(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS ok
     FROM shadow_provider_reliability WHERE created_at >= ?`,
    [weekAgo]
  );
  const costToday = await db.queryOne(
    `SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END), 0) AS usd
     FROM shadow_cost_ledger WHERE created_at >= ?`,
    [dayAgo]
  );
  const cost7 = await db.queryOne(
    `SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END), 0) AS usd
     FROM shadow_cost_ledger WHERE created_at >= ?`,
    [weekAgo]
  );
  const schema = await db.queryOne(
    `SELECT * FROM shadow_schema_fingerprints ORDER BY created_at DESC LIMIT 1`
  );

  const successRate24h = rel24?.n ? Number(rel24.ok || 0) / Number(rel24.n) : null;
  const successRate7d = rel7?.n ? Number(rel7.ok || 0) / Number(rel7.n) : null;
  const unmatchedRate =
    lastRun?.games_returned > 0
      ? Number(lastRun.games_unmatched || 0) / Number(lastRun.games_returned)
      : null;
  const circuitOpen =
    sched?.circuit_open_until && Date.parse(sched.circuit_open_until) > Date.now()
      ? sched.circuit_open_until
      : null;
  const projected30 = cost7?.usd != null ? (Number(cost7.usd) / 7) * 30 : null;

  let readiness = "COLLECTING";
  if (!lastRun) readiness = "NOT_READY";
  else if (schema?.drift_level === "BLOCK") readiness = "BLOCKED_SCHEMA_DRIFT";
  else if (circuitOpen) readiness = "BLOCKED_RELIABILITY";
  else if (mtd.mtdUsd >= Number(cfg.monthlyBudgetUsd || 0)) readiness = "BLOCKED_COST";
  else if ((rel7?.n || 0) < 10) readiness = "INSUFFICIENT_SAMPLE";
  else readiness = "SHADOW_ONLY";

  return {
    ...base,
    durable: true,
    lastRunAt: lastRun?.started_at || null,
    lastSuccessAt: lastSuccess?.started_at || null,
    lastFailedAt: lastFail?.started_at || null,
    lastErrorClass: lastFail?.error_class || sched?.last_error_class || null,
    lastErrorMessage: lastFail?.error_message || sched?.last_error_message || null,
    gamesLastRun: lastRun?.games_returned ?? null,
    latestSchemaStatus: schema?.drift_level || null,
    latestUnmatchedRate: unmatchedRate,
    runsLast24h: Number(rel24?.n || 0),
    successRate24h,
    successRate7d,
    costTodayUsd: Number(costToday?.usd || 0),
    cost7dUsd: Number(cost7?.usd || 0),
    costMtdUsd: mtd.mtdUsd,
    projected30DaySpendUsd: projected30,
    forecastBasis: cost7?.usd ? "observed_run_rate" : "default_assumption",
    circuitOpenUntil: circuitOpen,
    activeLease: sched?.active_run_id
      ? { runId: sched.active_run_id, expiresAt: sched.lease_expires_at, scopeKey }
      : null,
    readiness,
    monthStart: mtd.monthStart,
    affectsProductionOdds: false,
    inProductionRouter: false,
    canQualify: false,
    canAuthorizeWager: false,
  };
}

/**
 * Championship scorecard from persisted D1 evidence (no live incumbent spend).
 */
export async function loadPersistedChampionshipScorecard(db, {
  window = "7d",
  sport = null,
  plan = "free",
} = {}) {
  if (!db?.queryAll) {
    return {
      evidenceBasis: "NONE",
      scorecard: buildPromotionReadinessScorecard({ sampleRuns: 0 }),
      note: "D1 unbound",
    };
  }
  const since = windowStartIso(window);
  const sportClause = sport ? "AND sport = ?" : "";
  const sportParams = sport ? [sport] : [];

  const runs = await db.queryAll(
    `SELECT * FROM shadow_collection_runs
     WHERE provider = ? AND started_at >= ? ${sportClause}
     ORDER BY started_at DESC`,
    [ACTION_APIFY_PROVIDER, since, ...sportParams]
  );
  const costs = await db.queryAll(
    `SELECT * FROM shadow_cost_ledger WHERE created_at >= ? ${sport ? "AND sport = ?" : ""}`,
    sport ? [since, sport] : [since]
  );
  const reliability = await db.queryAll(
    `SELECT * FROM shadow_provider_reliability WHERE created_at >= ? ${sport ? "AND sport = ?" : ""}`,
    sport ? [since, sport] : [since]
  );
  const observations = await db.queryAll(
    `SELECT * FROM shadow_market_observations WHERE created_at >= ? ${sport ? "AND sport = ?" : ""} LIMIT 5000`,
    sport ? [since, sport] : [since]
  );
  const schemaBlocks = await db.queryAll(
    `SELECT * FROM shadow_schema_fingerprints WHERE created_at >= ? AND drift_level = 'BLOCK'`,
    [since]
  );

  const successRuns = reliability.filter((r) => Number(r.success) === 1).length;
  const successRate7d = reliability.length ? successRuns / reliability.length : null;
  const sampleRuns = runs.length;
  const matched = runs.reduce((s, r) => s + Number(r.matched_events ?? r.games_matched ?? 0), 0);
  const returned = runs.reduce((s, r) => s + Number(r.action_events_returned ?? r.games_returned ?? 0), 0);
  const ambiguous = runs.reduce((s, r) => s + Number(r.ambiguous_events ?? 0), 0);
  const fbisExpected = runs.reduce((s, r) => s + Number(r.fbis_events_expected ?? r.games_expected ?? 0), 0);

  const actionRows = observations.map((o) => ({
    actionGameId: o.action_game_id,
    homeTeam: o.home_team,
    awayTeam: o.away_team,
    startTime: o.start_time,
    scrapedAt: o.scraped_at,
    observedAt: o.source_observed_at || o.observed_at,
    consensus: safeJson(o.consensus_json),
    publicBetting: safeJson(o.public_betting_json),
    lineMovement: safeJson(o.line_movement_json),
    books: [],
    fbisEventId: o.fbis_event_id,
    matchConfidence: o.match_confidence,
  }));

  const championship = runProviderChampionship({ actionRows, incumbents: {} });

  const meanCost = costs.length
    ? costs.reduce((s, c) => s + Number(c.actual_total_usd != null ? c.actual_total_usd : c.estimated_total_usd || 0), 0) / costs.length
    : null;
  const meanGames = runs.length
    ? runs.reduce((s, r) => s + Number(r.games_returned || 0), 0) / runs.length
    : null;

  const costWindows = {
    projected30DaySpend: meanCost != null ? meanCost * 30 : null,
    costPerRun: meanCost,
    costPerGame: meanCost != null && meanGames ? meanCost / meanGames : null,
    forecastBasis: costs.length ? "observed_run_rate" : "default_assumption",
  };

  const observedByProfile = {};
  for (const c of costs) {
    const p = String(c.profile || "BASE");
    if (!observedByProfile[p]) observedByProfile[p] = { sum: 0, n: 0 };
    observedByProfile[p].sum += Number(c.actual_total_usd != null ? c.actual_total_usd : c.estimated_total_usd || 0);
    observedByProfile[p].n += 1;
  }
  const observedCostPerRunByProfile = Object.fromEntries(
    Object.entries(observedByProfile).map(([k, v]) => [k, v.n ? v.sum / v.n : 0])
  );

  const scorecard = buildPromotionReadinessScorecard({
    championship,
    reliability: { successRate7d },
    costWindows,
    schemaDriftLevel: schemaBlocks.length ? "BLOCK" : null,
    sampleRuns,
    unmatchedEventRate: returned ? (returned - matched) / returned : null,
    ambiguousMatchRate: returned ? ambiguous / returned : null,
    plan,
  });

  scorecard.thresholdMode = "advisory";
  scorecard.hardIntegrityBlockers = (scorecard.blockers || []).filter((b) =>
    ["BLOCKED_SCHEMA_DRIFT", "BLOCKED_TEMPORAL_INTEGRITY"].includes(b.code)
  );
  scorecard.advisoryWarnings = (scorecard.blockers || []).filter((b) =>
    ["BLOCKED_RELIABILITY", "BLOCKED_COST"].includes(b.code)
  );
  if (["PRIMARY_CANDIDATE", "CO_PRIMARY_CANDIDATE"].includes(scorecard.status)) {
    scorecard.status = "READY_FOR_REVIEW";
  }

  const reliabilityByLifecycle = {};
  for (const r of reliability) {
    const key = r.lifecycle || "unknown";
    if (!reliabilityByLifecycle[key]) reliabilityByLifecycle[key] = { runs: 0, success: 0 };
    reliabilityByLifecycle[key].runs += 1;
    reliabilityByLifecycle[key].success += Number(r.success) === 1 ? 1 : 0;
  }
  for (const k of Object.keys(reliabilityByLifecycle)) {
    const x = reliabilityByLifecycle[k];
    x.successRate = x.runs ? x.success / x.runs : null;
  }

  return {
    evidenceBasis: "PERSISTED-EVIDENCE BACKED",
    window,
    sport: sport || "all",
    sampleRuns,
    observations: observations.length,
    denominators: {
      fbisEventsExpected: fbisExpected,
      actionEventsReturned: returned,
      matchedEvents: matched,
      ambiguousEvents: ambiguous,
      actionToFbisMatchRate: returned ? matched / returned : null,
      fbisCoverageRate: fbisExpected ? matched / fbisExpected : null,
      ambiguousRate: returned ? ambiguous / returned : null,
    },
    reliabilityByLifecycle,
    costWindows,
    monthlyStarterModel: projectMonthlyStarterSufficiency({ observedCostPerRunByProfile }),
    championship,
    scorecard,
    schemaBlockCount: schemaBlocks.length,
  };
}

/**
 * Prior successful/compatible schema fingerprint for drift comparison.
 */
export async function loadPriorSchemaFingerprint(db) {
  if (!db?.queryOne) return null;
  return (
    (await db.queryOne(
      `SELECT * FROM shadow_schema_fingerprints
       WHERE drift_level IN ('INFO','WARN')
       ORDER BY created_at DESC LIMIT 1`
    )) || null
  );
}

/**
 * Map queryGames rows into matchEventWithConfidence candidate shape.
 */
export function mapGamesToFbisEvents(rows = []) {
  return (rows || []).map((r) => ({
    id: r.id,
    sport: r.sport,
    date: r.date,
    homeTeam: r.homeName || r.home?.name,
    awayTeam: r.awayName || r.away?.name,
    home: r.homeName || r.home?.name,
    away: r.awayName || r.away?.name,
    homeAbbr: r.homeAbbr || r.home?.abbr,
    awayAbbr: r.awayAbbr || r.away?.abbr,
    startTime: r.start,
    status: r.status || null,
  }));
}

/** YYYY-MM-DD in America/Chicago (board-local slate day). */
export function calendarDateChicago(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Default FBIS slate dates when caller omits `date`.
 * Today + tomorrow in America/Chicago — never an undated season dump.
 *
 * Football (nfl/cfb): extend through +3 Chicago calendar days so Friday/Saturday
 * collections still see Sunday NFL kickoffs. MLB and others stay today+tomorrow.
 *
 * Important: do NOT use a fixed +36h offset. On Chicago evening, +36h can
 * skip the next calendar day (e.g. Fri 22:00 CT → Sun), dropping Saturday's
 * board date from the matching universe.
 */
export function defaultFbisSlateDates(now = new Date(), { sport } = {}) {
  const today = calendarDateChicago(now);
  const s = String(sport || "").toLowerCase();
  const football = s === "nfl" || s === "cfb" || s === "ncaaf" || s === "college-football";
  // Football boards need the full upcoming week: early-week collections must
  // still see Saturday CFB and Sunday/Monday NFL games.
  const horizonDays = football ? 7 : 1;
  const dates = new Set([today]);
  let cursor = now.getTime();
  let last = today;
  // Advance hour-by-hour collecting distinct Chicago calendar days (DST-safe).
  for (let i = 0; i < 24 * (horizonDays + 2) && dates.size < horizonDays + 1; i += 1) {
    cursor += 60 * 60 * 1000;
    const d = calendarDateChicago(new Date(cursor));
    if (d !== last) {
      dates.add(d);
      last = d;
    }
  }
  return [...dates].sort();
}

/**
 * The games table is append-oriented and can retain rows whose collection date
 * no longer matches their actual kickoff date. ACTION sizing/matching must use
 * the event clock, not that historical collection partition.
 */
export function filterActionMatchingWindow(rows = [], { sport, date, now = new Date() } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const explicitDate = String(date || "").trim();
  const s = String(sport || "").toLowerCase();
  const football = s === "nfl" || s === "cfb" || s === "ncaaf" || s === "college-football";
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const lowerMs = nowMs - 2 * 60 * 60 * 1000;
  const upperMs = nowMs + (football ? 8 : 2) * 24 * 60 * 60 * 1000;

  return list.filter((row) => {
    const startMs = Date.parse(row?.start || row?.startTime || "");
    if (!Number.isFinite(startMs)) return false;
    if (explicitDate) return calendarDateChicago(new Date(startMs)) === explicitDate;
    return startMs >= lowerMs && startMs <= upperMs;
  });
}

/**
 * Collapse duplicate storage aliases for the same physical event.
 *
 * The games store can contain both a provider/ESPN id and synthetic board ids
 * for the same matchup. ACTION collection and coverage denominators operate on
 * physical games, not storage aliases. Kickoff minute remains part of the key
 * so doubleheaders remain distinct events.
 */
function normalizedEventTeam(row, side) {
  const abbr = row?.[`${side}Abbr`] || row?.[side]?.abbr;
  if (abbr) return String(abbr).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const name = row?.[`${side}Name`] || row?.[side]?.name || row?.[side];
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function actionPhysicalEventKey(row, sport = "") {
  const startMs = Date.parse(row?.start || row?.startTime || "");
  if (!Number.isFinite(startMs)) return null;
  const kickoffMinute = new Date(Math.floor(startMs / 60000) * 60000).toISOString();
  const home = normalizedEventTeam(row, "home");
  const away = normalizedEventTeam(row, "away");
  if (!home || !away) return null;
  return [String(sport || row?.sport || "").toLowerCase(), away, home, kickoffMinute].join("|");
}

function canonicalEventPreference(row) {
  const id = String(row?.id || "");
  const numeric = /^\d+$/.test(id) ? 2 : 0;
  const syntheticPenalty = /_b\d+(?:_|$)/i.test(id) ? -1 : 0;
  return numeric + syntheticPenalty;
}

export function dedupeActionPhysicalEvents(rows = [], sport = "") {
  const byPhysical = new Map();
  const aliases = new Map();
  for (const row of rows || []) {
    if (!row?.id) continue;
    const key = actionPhysicalEventKey(row, sport) || `id|${row.id}`;
    const prior = byPhysical.get(key);
    if (!prior || canonicalEventPreference(row) > canonicalEventPreference(prior)) {
      if (prior?.id) {
        const list = aliases.get(String(row.id)) || [];
        list.push(String(prior.id), ...(aliases.get(String(prior.id)) || []));
        aliases.set(String(row.id), [...new Set(list)]);
      }
      byPhysical.set(key, row);
    } else {
      const list = aliases.get(String(prior.id)) || [];
      list.push(String(row.id));
      aliases.set(String(prior.id), [...new Set(list)]);
    }
  }
  return {
    rows: [...byPhysical.values()],
    aliases,
    rawCount: (rows || []).length,
    physicalCount: byPhysical.size,
  };
}

/**
 * Load FBIS games for Action matching. Never returns an undated season dump.
 */
export async function loadFbisSlateForMatching(queryGamesFn, env, { sport, date, now } = {}) {
  const clock = now || new Date();
  const requestedDate = date ? String(date) : null;
  // The games table is append/partition oriented. A late-evening kickoff can be
  // stored under an adjacent UTC/feed partition even though its Chicago board
  // date is today. Query neighboring partitions, then let the kickoff clock be
  // the authority for the requested board date.
  const adjacentDates = (d) => {
    const [y,m,day] = d.split("-").map(Number);
    const base = new Date(Date.UTC(y,m-1,day,12));
    return [-1,0,1].map((delta) => {
      const x=new Date(base); x.setUTCDate(x.getUTCDate()+delta); return x.toISOString().slice(0,10);
    });
  };
  const dates = requestedDate ? adjacentDates(requestedDate) : defaultFbisSlateDates(clock, { sport });
  const byId = new Map();
  let lastError = null;
  for (const d of dates) {
    const games = await queryGamesFn(env, { sport, date: d });
    if (!games?.ok) {
      lastError = games?.reason || "slate-unavailable";
      continue;
    }
    const activeRows = filterActionMatchingWindow(games.rows || [], {
      sport,
      date: requestedDate,
      now: clock,
    });
    for (const row of activeRows) {
      if (row?.id) byId.set(String(row.id), row);
    }
  }
  // Bounded fallback for stale collection partitions: query forward from the
  // earliest queried partition whenever the date-partition probes found no
  // active games. This must also run for implicit "current slate" requests:
  // scheduled health/catch-up calls omit date, and stale append partitions can
  // otherwise make a live slate look empty (expectedSlateGames=0), suppressing
  // paid ACTION collection even while the board itself has games.
  if (byId.size === 0) {
    const fallback = await queryGamesFn(env, { sport, since: dates[0] });
    if (fallback?.ok) {
      const activeRows = filterActionMatchingWindow(fallback.rows || [], {
        sport,
        date: requestedDate,
        now: clock,
      });
      for (const row of activeRows) {
        if (row?.id) byId.set(String(row.id), row);
      }
    } else if (!lastError) {
      lastError = fallback?.reason || "slate-unavailable";
    }
  }
  if (!byId.size && lastError) {
    return { fbisEvents: [], gamesExpected: null, slateError: lastError, slateDates: dates };
  }
  const physical = dedupeActionPhysicalEvents([...byId.values()], sport);
  const fbisEvents = mapGamesToFbisEvents(physical.rows);
  return {
    fbisEvents,
    gamesExpected: fbisEvents.length,
    rawSlateAliases: physical.rawCount,
    collapsedAliases: Math.max(0, physical.rawCount - physical.physicalCount),
    eventAliases: Object.fromEntries(physical.aliases),
    slateError: null,
    slateDates: dates,
  };
}
