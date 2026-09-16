/**
 * ACTION → board playerMarkets (research / market_intelligence only).
 *
 * Preferred source for FBIS player-props display.
 * Never qualifies, never authorizes, never enters PURE features.
 *
 * Read hierarchy:
 *   1. action_market_book_observations (player rows)
 *   2. shadow_market_observations.research_fields_json.playerProps
 *   3. none → empty (never fabricate lines/prices)
 */

import {
  canonicalizeFootballPropMarket,
  toStablePlayerPropContract,
} from "./actionApifyPropContract.js";
import { actionPolicyFlags } from "./actionMarketIntelligence.js";

const GAME_MARKET_TYPES = new Set([
  "spread",
  "moneyline",
  "ml",
  "h2h",
  "total",
  "over_under",
  "ou",
  "run_line",
  "puck_line",
  "rl",
]);

/** MLB + shared prop aliases beyond the football contract map. */
export const ACTION_MLB_PROP_MARKET_ALIASES = Object.freeze({
  strikeouts: "strikeouts",
  pitcher_strikeouts: "strikeouts",
  player_strikeouts: "strikeouts",
  batter_strikeouts: "strikeouts",
  ks: "strikeouts",
  "k's": "strikeouts",
  hits: "hits",
  player_hits: "hits",
  batter_hits: "hits",
  batting_hits: "hits",
  total_bases: "total_bases",
  tb: "total_bases",
  player_total_bases: "total_bases",
  batter_total_bases: "total_bases",
  rbis: "rbis",
  player_rbis: "rbis",
  batter_rbis: "rbis",
  runs: "runs",
  player_runs: "runs",
  batter_runs: "runs",
  walks: "walks",
  player_walks: "walks",
  batter_walks: "walks",
  home_runs: "home_runs",
  player_home_runs: "home_runs",
  batter_home_runs: "home_runs",
  hrs: "home_runs",
  outs: "outs",
  pitcher_outs: "outs",
  hits_runs_rbis: "hits_runs_rbis",
  "hits+runs+rbis": "hits_runs_rbis",
  player_hits_runs_rbis: "hits_runs_rbis",
  batter_hits_runs_rbis: "hits_runs_rbis",
  earned_runs: "earned_runs",
  player_earned_runs: "earned_runs",
  pitcher_earned_runs: "earned_runs",
});

export function canonicalizeActionPropMarket(raw) {
  const football = canonicalizeFootballPropMarket(raw);
  if (football) return football;
  if (raw == null || raw === "") return null;
  const original = String(raw).trim().toLowerCase();
  const key = original.replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const compact = key.replace(/\s+/g, "_");
  return (
    ACTION_MLB_PROP_MARKET_ALIASES[key] ||
    ACTION_MLB_PROP_MARKET_ALIASES[compact] ||
    ACTION_MLB_PROP_MARKET_ALIASES[original] ||
    null
  );
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function safeJson(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function playerNameFromRow(row = {}) {
  if (row.player && typeof row.player === "object") {
    return (
      strOrNull(row.player.name) ||
      strOrNull(row.player.fullName) ||
      strOrNull(row.player.playerName) ||
      null
    );
  }
  return (
    strOrNull(row.playerName) ||
    strOrNull(row.player_name) ||
    strOrNull(typeof row.player === "string" ? row.player : null) ||
    strOrNull(row.name) ||
    null
  );
}

function isPlayerPropMarketType(marketType) {
  const m = String(marketType || "").toLowerCase();
  if (!m) return false;
  if (GAME_MARKET_TYPES.has(m)) return false;
  if (
    m.includes("player_") ||
    m.includes("batter_") ||
    m.includes("pitcher_") ||
    m.includes("prop")
  ) {
    return true;
  }
  return canonicalizeActionPropMarket(m) != null;
}

/**
 * Map one ACTION prop row → board playerMarket.
 */
export function toBoardPlayerMarket(row = {}, ctx = {}) {
  const marketRaw = row.market || row.marketType || row.market_type || null;
  const marketCanonical =
    row.marketCanonical || canonicalizeActionPropMarket(marketRaw) || null;
  const contract = toStablePlayerPropContract(
    {
      ...row,
      market: marketRaw,
      marketCanonical,
      providerPlayerId:
        row.providerPlayerId || row.provider_player_id || row.playerId || row.player_id,
      playerName: playerNameFromRow(row),
      line: row.line ?? row.point,
      overOdds: row.overOdds ?? row.over_odds,
      underOdds: row.underOdds ?? row.under_odds,
      price: row.price ?? row.americanPrice ?? row.american_price,
      book: row.book || row.sportsbook,
      side: row.side || row.selection,
      observedAt: row.observedAt || row.providerTimestamp || row.provider_timestamp,
    },
    {
      providerGameId: ctx.providerEventId || row.providerEventId || row.provider_event_id,
      fbisEventId: ctx.eventId || row.canonicalEventId || row.canonical_event_id,
      scrapedAt: ctx.collectedAt || row.collectedAt || row.collected_at,
      collectedAt: ctx.collectedAt || row.collectedAt || row.collected_at,
      gameIdentityConfidence: ctx.matchConfidence || "HIGH",
    }
  );

  return {
    ...contract,
    marketCanonical: contract.marketCanonical || marketCanonical,
    provider: "ACTION_APIFY",
    role: "market_intelligence",
    governanceMode: "shadow",
    displayOnly: true,
    decisionEligible: false,
    canQualify: false,
    canAuthorizeWager: false,
    source: ctx.source || "action",
    ...actionPolicyFlags(),
  };
}

/**
 * Collapse over/under observation pairs into one board market row.
 */
export function collapsePropObservations(rows = [], ctx = {}) {
  const groups = new Map();
  for (const row of rows || []) {
    const name = playerNameFromRow(row);
    const hasPlayer =
      row.canonical_player_id ||
      row.canonicalPlayerId ||
      row.provider_player_id ||
      row.providerPlayerId ||
      name;
    if (!hasPlayer && !isPlayerPropMarketType(row.market_type || row.marketType || row.market)) {
      continue;
    }
    const playerKey =
      strOrNull(row.canonical_player_id || row.canonicalPlayerId) ||
      strOrNull(row.provider_player_id || row.providerPlayerId) ||
      strOrNull(name) ||
      "unknown";
    const marketKey =
      canonicalizeActionPropMarket(row.market_type || row.marketType || row.market) ||
      strOrNull(row.market_type || row.marketType || row.market) ||
      "unknown";
    const book = strOrNull(row.sportsbook || row.book) || "action";
    const line = numOrNull(row.line);
    const key = `${playerKey}|${marketKey}|${book}|${line ?? ""}`;
    const prev = groups.get(key) || {
      providerPlayerId: row.provider_player_id || row.providerPlayerId || null,
      fbisPlayerId: row.canonical_player_id || row.canonicalPlayerId || null,
      playerName: name,
      team: row.team || null,
      position: row.position || null,
      market: row.market_type || row.marketType || row.market || null,
      marketCanonical: marketKey === "unknown" ? null : marketKey,
      book,
      line,
      overOdds: null,
      underOdds: null,
      price: null,
      side: null,
      observedAt: row.provider_timestamp || row.providerTimestamp || null,
      collectedAt: row.collected_at || row.collectedAt || null,
      imageUrl: row.image_url || row.imageUrl || null,
    };
    const selection = String(row.selection || row.side || "").toLowerCase();
    const price = numOrNull(row.american_price ?? row.americanPrice ?? row.price);
    if (selection === "over") prev.overOdds = price ?? prev.overOdds;
    else if (selection === "under") prev.underOdds = price ?? prev.underOdds;
    else if (price != null) {
      prev.price = price;
      prev.side = selection || prev.side;
    }
    const ts = strOrNull(row.provider_timestamp || row.providerTimestamp || row.collected_at);
    if (ts && (!prev.observedAt || ts > prev.observedAt)) prev.observedAt = ts;
    if (!prev.playerName && name) prev.playerName = name;
    groups.set(key, prev);
  }
  return [...groups.values()]
    .map((g) => toBoardPlayerMarket(g, ctx))
    .filter((m) => m.playerName || m.providerPlayerId);
}

export function playerMarketsFromActionPropList(props = [], ctx = {}) {
  return (Array.isArray(props) ? props : [])
    .map((p) =>
      toBoardPlayerMarket(
        {
          ...p,
          marketCanonical: p.marketCanonical || canonicalizeActionPropMarket(p.market),
        },
        ctx
      )
    )
    .filter((m) => m.playerName || m.providerPlayerId);
}

async function queryAll(db, sql, binds = []) {
  if (!db?.prepare) return [];
  try {
    const res = await db.prepare(sql).bind(...binds).all();
    return res?.results || res?.rows || [];
  } catch {
    return [];
  }
}

/**
 * Load ACTION playerMarkets for canonical FBIS event ids.
 * @returns {Promise<Map<string, object[]>>}
 */
export async function loadActionPlayerMarketsByEventIds(db, eventIds = []) {
  const map = new Map();
  if (!db?.prepare) return map;
  const ids = [...new Set((eventIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return map;

  const chunkSize = 40;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const ph = chunk.map(() => "?").join(",");

    const seriesRows = await queryAll(
      db,
      `SELECT *
       FROM action_market_book_observations
       WHERE canonical_event_id IN (${ph})
         AND (
           canonical_player_id IS NOT NULL
           OR provider_player_id IS NOT NULL
         )
         AND COALESCE(decision_eligible, 0) = 0
         AND COALESCE(can_qualify, 0) = 0
         AND COALESCE(can_authorize_wager, 0) = 0
       ORDER BY COALESCE(provider_timestamp, collected_at, created_at) ASC`,
      chunk
    );
    const byEventSeries = new Map();
    for (const row of seriesRows) {
      const eid = strOrNull(row.canonical_event_id);
      if (!eid) continue;
      if (!byEventSeries.has(eid)) byEventSeries.set(eid, []);
      byEventSeries.get(eid).push(row);
    }
    for (const eid of chunk) {
      const rows = byEventSeries.get(eid) || [];
      if (!rows.length) continue;
      const markets = collapsePropObservations(rows, {
        eventId: eid,
        source: "action-durable-series",
        collectedAt: rows[rows.length - 1]?.collected_at || null,
      });
      if (markets.length) map.set(eid, markets);
    }

    const missing = chunk.filter((id) => !map.has(id));
    if (!missing.length) continue;
    const mph = missing.map(() => "?").join(",");
    const shadowRows = await queryAll(
      db,
      `SELECT fbis_event_id, research_fields_json, collected_at, match_confidence
       FROM shadow_market_observations
       WHERE fbis_event_id IN (${mph})
         AND COALESCE(decision_eligible, 0) = 0
         AND COALESCE(can_qualify, 0) = 0
         AND COALESCE(can_authorize_wager, 0) = 0
       ORDER BY COALESCE(collected_at, created_at) DESC`,
      missing
    );
    for (const row of shadowRows) {
      const eid = strOrNull(row.fbis_event_id);
      if (!eid || map.has(eid)) continue;
      const research = safeJson(row.research_fields_json) || {};
      const props = research.playerProps || research.props || [];
      if (!Array.isArray(props) || !props.length) continue;
      const markets = playerMarketsFromActionPropList(props, {
        eventId: eid,
        source: "action-shadow-research",
        collectedAt: row.collected_at || null,
        matchConfidence: row.match_confidence || null,
      });
      if (markets.length) map.set(eid, markets);
    }
  }
  return map;
}

/**
 * Attach ACTION playerMarkets onto games.
 * Prefers ACTION over any prior Parlay-derived playerMarkets.
 */
export async function attachActionPlayerPropsToGames(games = [], db = null) {
  const list = Array.isArray(games) ? games : [];
  if (!list.length || !db) {
    return {
      games: list,
      attached: 0,
      checked: 0,
      fromSeries: 0,
      fromShadow: 0,
      source: "none",
    };
  }
  const ids = list.map((g) => g?.id || g?.eventId || g?.gameId).filter(Boolean);
  const byId = await loadActionPlayerMarketsByEventIds(db, ids);
  let attached = 0;
  let fromSeries = 0;
  let fromShadow = 0;
  const out = list.map((g) => {
    const eid = String(g?.id || g?.eventId || g?.gameId || "");
    const markets = byId.get(eid);
    if (!markets?.length) {
      return { ...g, playerPropsChecked: true };
    }
    attached += 1;
    if (markets[0]?.source === "action-durable-series") fromSeries += 1;
    else fromShadow += 1;
    return {
      ...g,
      playerMarkets: markets,
      playerPropsChecked: true,
      playerPropsSource: markets[0]?.source || "action",
      actionPlayerProps: {
        provider: "ACTION_APIFY",
        role: "market_intelligence",
        displayOnly: true,
        decisionEligible: false,
        canQualify: false,
        canAuthorizeWager: false,
        count: markets.length,
        source: markets[0]?.source || "action",
      },
    };
  });
  return {
    games: out,
    attached,
    checked: ids.length,
    fromSeries,
    fromShadow,
    source: attached ? "action" : "none",
  };
}
