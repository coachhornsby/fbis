/**
 * ACTION market-intelligence joins — Model Family Standard Part IV.
 *
 * Manual-correct use of ACTION:
 * - scheduled market snapshots
 * - model-vs-market / misprices research
 * - NEVER production odds router authority
 * - NEVER canQualify / canAuthorizeWager
 * - NEVER PURE-model feature input
 */

import { evaluateMisprice, rankMisprices, listChampions } from "./canonical/index.js";

export const ACTION_MARKET_ROLE = "market_intelligence";
export const ACTION_GOVERNANCE_MODE = "shadow";

/** Display champions for model-vs-market joins (wager gates unchanged). */
const CHAMPION_BY_SPORT = Object.freeze({
  cfb: "CFB-FBIS-v2",
  mlb: "MLB-SAVANT-RPG-SP",
  cbb: "CBB-FBIS-PURE",
  nfl: "NFL-PRO-v1",
  nba: "NBA-PINNACLE-IMPLIED",
});

const FRESH_MS = 6 * 60 * 60 * 1000;

function safeJson(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeActionSport(sport) {
  const s = String(sport || "").toLowerCase();
  if (s === "ncaaf" || s === "college-football" || s === "cfb") return "cfb";
  if (s === "ncaab" || s === "college-basketball" || s === "cbb") return "cbb";
  return s;
}

/**
 * Extract executable research lines from ACTION consensus.
 * Missing fields stay null — never invent lines.
 */
export function extractActionMarketLines(consensus) {
  const c = consensus && typeof consensus === "object" ? consensus : {};
  const spreadHome =
    numOrNull(c.spreadHome) ??
    numOrNull(c.spread_home) ??
    numOrNull(c.homeSpread) ??
    numOrNull(c.spread);
  const spreadHomeOdds =
    numOrNull(c.spreadHomeOdds) ??
    numOrNull(c.spread_home_odds) ??
    numOrNull(c.homeSpreadOdds);
  const total =
    numOrNull(c.total) ??
    numOrNull(c.totalLine) ??
    numOrNull(c.overUnder) ??
    numOrNull(c.ou);
  const overOdds = numOrNull(c.overOdds) ?? numOrNull(c.over_odds);
  return { spreadHome, spreadHomeOdds, total, overOdds };
}

export function championModelIdForSport(sport) {
  return CHAMPION_BY_SPORT[normalizeActionSport(sport)] || null;
}

export function actionPolicyFlags() {
  return {
    role: ACTION_MARKET_ROLE,
    governanceMode: ACTION_GOVERNANCE_MODE,
    inProductionRouter: false,
    decisionEligible: false,
    canQualify: false,
    canAuthorizeWager: false,
    pureFeatureAllowed: false,
    actionAuthoritative: false,
    commercialStatus: "COMMERCIAL_USE_REVIEW_REQUIRED",
  };
}

/**
 * Join one FBIS projection to one ACTION observation → misprice research rows.
 */
export function buildActionMispriceRows({
  sport,
  eventId,
  modelId = null,
  projMargin = null,
  projTotal = null,
  consensus = null,
  matchConfidence = null,
  marketTimestamp = null,
  informationCutoff = null,
  observationId = null,
  homeTeam = null,
  awayTeam = null,
  now = Date.now(),
} = {}) {
  const lines = extractActionMarketLines(consensus);
  const resolvedModelId = modelId || championModelIdForSport(sport);
  const identityResolved =
    Boolean(eventId) &&
    !["unmatched", "ambiguous", "low", "none", ""].includes(
      String(matchConfidence || "exact").toLowerCase()
    );
  const ts = marketTimestamp ? Date.parse(marketTimestamp) : NaN;
  const marketFresh = Number.isFinite(ts) ? now - ts <= FRESH_MS : true;

  const rows = [];
  const base = {
    sport: normalizeActionSport(sport),
    eventId: eventId || null,
    playerId: null,
    modelId: resolvedModelId,
    observationId: observationId || null,
    homeTeam,
    awayTeam,
    marketSource: "ACTION_APIFY",
    matchConfidence: matchConfidence || null,
    informationCutoff: informationCutoff || null,
    marketTimestamp: marketTimestamp || null,
    ...actionPolicyFlags(),
  };

  if (projMargin != null && Number.isFinite(Number(projMargin))) {
    const evaluated = evaluateMisprice({
      modelId: resolvedModelId,
      projection: Number(projMargin),
      marketLine: lines.spreadHome,
      marketPriceAmerican: lines.spreadHomeOdds,
      calibrationLocked: false,
      identityResolved,
      marketFresh,
      qualified: false,
      authorized: false,
    });
    rows.push({
      id: `${observationId || eventId || "row"}:spread`,
      marketType: "spread",
      projection: Number(projMargin),
      marketLine: lines.spreadHome,
      ...evaluated,
      ...base,
      canShowEv: false,
      modelProbability: null,
      expectedValue: null,
    });
  }

  if (projTotal != null && Number.isFinite(Number(projTotal))) {
    const evaluated = evaluateMisprice({
      modelId: resolvedModelId,
      projection: Number(projTotal),
      marketLine: lines.total,
      marketPriceAmerican: lines.overOdds,
      calibrationLocked: false,
      identityResolved,
      marketFresh,
      qualified: false,
      authorized: false,
    });
    rows.push({
      id: `${observationId || eventId || "row"}:total`,
      marketType: "total",
      projection: Number(projTotal),
      marketLine: lines.total,
      ...evaluated,
      ...base,
      canShowEv: false,
      modelProbability: null,
      expectedValue: null,
    });
  }

  return rows;
}

/**
 * Load latest matched ACTION observations and join to prediction projections.
 * Fail-open: returns [] when tables are missing or empty.
 */
export async function loadLiveActionMisprices(db, { sport = "all", limit = 200 } = {}) {
  if (!db?.prepare) return [];

  const sportKey = normalizeActionSport(sport);
  const obsSql =
    sportKey === "all"
      ? `SELECT id, sport, fbis_event_id, home_team, away_team, consensus_json,
                match_confidence, collected_at, source_observed_at, observed_at, scraped_at, created_at
         FROM shadow_market_observations
         WHERE fbis_event_id IS NOT NULL
           AND COALESCE(decision_eligible, 0) = 0
           AND COALESCE(can_qualify, 0) = 0
           AND COALESCE(can_authorize_wager, 0) = 0
         ORDER BY COALESCE(collected_at, created_at) DESC
         LIMIT ?`
      : `SELECT id, sport, fbis_event_id, home_team, away_team, consensus_json,
                match_confidence, collected_at, source_observed_at, observed_at, scraped_at, created_at
         FROM shadow_market_observations
         WHERE fbis_event_id IS NOT NULL
           AND lower(sport) = ?
           AND COALESCE(decision_eligible, 0) = 0
           AND COALESCE(can_qualify, 0) = 0
           AND COALESCE(can_authorize_wager, 0) = 0
         ORDER BY COALESCE(collected_at, created_at) DESC
         LIMIT ?`;

  let observations = [];
  try {
    const stmt =
      sportKey === "all"
        ? db.prepare(obsSql).bind(Math.max(1, Math.min(500, Number(limit) || 200)))
        : db.prepare(obsSql).bind(sportKey, Math.max(1, Math.min(500, Number(limit) || 200)));
    const res = await stmt.all();
    observations = res?.results || [];
  } catch {
    return [];
  }

  if (!observations.length) return [];

  const newestByEvent = new Map();
  for (const o of observations) {
    const eid = String(o.fbis_event_id || "");
    if (!eid || newestByEvent.has(eid)) continue;
    newestByEvent.set(eid, o);
  }

  const projections = new Map();
  for (const eventId of newestByEvent.keys()) {
    try {
      const pred = await db
        .prepare(
          `SELECT game_id, sport, model_version, proj_margin, proj_total, as_of
           FROM predictions
           WHERE game_id = ?
           ORDER BY as_of DESC
           LIMIT 1`
        )
        .bind(eventId)
        .first();
      if (pred) {
        projections.set(eventId, pred);
        continue;
      }
      const snap = await db
        .prepare(
          `SELECT game_id, sport, model_version, proj_margin, proj_total, frozen_at AS as_of
           FROM prediction_snapshots
           WHERE game_id = ?
           ORDER BY frozen_at DESC
           LIMIT 1`
        )
        .bind(eventId)
        .first();
      if (snap) projections.set(eventId, snap);
    } catch {
      // table may be absent in some environments
    }
  }

  const rows = [];
  const now = Date.now();
  for (const [eventId, obs] of newestByEvent) {
    const pred = projections.get(eventId);
    if (!pred) continue;
    const marketTimestamp =
      obs.source_observed_at || obs.observed_at || obs.scraped_at || obs.collected_at || obs.created_at;
    rows.push(
      ...buildActionMispriceRows({
        sport: obs.sport || pred.sport || sportKey,
        eventId,
        modelId: championModelIdForSport(obs.sport || pred.sport) || pred.model_version || null,
        projMargin: pred.proj_margin,
        projTotal: pred.proj_total,
        consensus: safeJson(obs.consensus_json),
        matchConfidence: obs.match_confidence || "exact",
        marketTimestamp,
        informationCutoff: pred.as_of || null,
        observationId: obs.id,
        homeTeam: obs.home_team,
        awayTeam: obs.away_team,
        now,
      })
    );
  }

  return rankMisprices(rows);
}

/**
 * Public health envelope for ACTION as live market intelligence (still shadow-governed).
 */
export function decorateActionMarketHealth(section = {}) {
  const lastSuccessAt = section.lastSuccessAt || section.lastRunAt || null;
  const collectionLive = Boolean(lastSuccessAt);
  return {
    ...section,
    ...actionPolicyFlags(),
    collectionLive,
    label: collectionLive
      ? "Live market intelligence (shadow-governed)"
      : "Market intelligence configured — awaiting first successful collection",
    note:
      "Manual-correct use: scheduled snapshots + model-vs-market / misprices. Not odds authority. Not PURE features. Not qualify/authorize.",
  };
}

export function listActionMarketChampions() {
  return listChampions().filter((m) => CHAMPION_BY_SPORT[normalizeActionSport(m.sport)]);
}
