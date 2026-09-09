/**
 * Direct Kalshi public market data for game winner sentiment.
 * Free, no API key for market reads. Never used as a betting book.
 * https://docs.kalshi.com — production: https://external-api.kalshi.com/trade-api/v2
 */

import { readCache, writeCache } from "./cache.js";
import { namesMatch } from "./match.js";
import { SENTIMENT_BOOK } from "./books.js";

const BASE = "https://external-api.kalshi.com/trade-api/v2";
const TTL_MS = 15 * 60 * 1000;
const EMPTY_TTL_MS = 30 * 60 * 1000;

/** Kalshi series tickers for FBIS board sports. */
export const KALSHI_SERIES = {
  mlb: "KXMLBGAME",
  nfl: "KXNFLGAME",
  nba: "KXNBAGAME",
  cfb: "KXNCAAFGAME",
  // CBB game series not consistently listed under a single ticker yet.
};

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function dollarPrice(market) {
  const last = finite(market?.last_price_dollars ?? market?.last_price);
  const bid = finite(market?.yes_bid_dollars ?? market?.yes_bid);
  const ask = finite(market?.yes_ask_dollars ?? market?.yes_ask);
  if (bid != null && ask != null && ask >= bid) return (bid + ask) / 2;
  if (last != null && last > 0) return last;
  if (bid != null) return bid;
  if (ask != null) return ask;
  return null;
}

function americanFromProb(p) {
  if (p == null || !(p > 0) || !(p < 1)) return null;
  if (p >= 0.5) return Math.round((-100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

function teamLabel(market) {
  return (
    market?.yes_sub_title ||
    market?.no_sub_title ||
    String(market?.title || "")
      .replace(/\s+wins\.?$/i, "")
      .trim()
  );
}

async function fetchOpenMarkets(seriesTicker, caches) {
  const key = `v1:kalshi-direct:${seriesTicker}`;
  const cached = await readCache(key, caches, TTL_MS);
  if (cached) return cached;

  const markets = [];
  let cursor = "";
  for (let page = 0; page < 8; page++) {
    const url = new URL(`${BASE}/markets`);
    url.searchParams.set("series_ticker", seriesTicker);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(String(url), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const empty = { markets: [], empty: true, error: `Kalshi ${res.status}`, asOf: new Date().toISOString() };
      await writeCache(key, empty, caches, EMPTY_TTL_MS);
      return empty;
    }
    const json = await res.json();
    markets.push(...(json.markets || []));
    cursor = json.cursor || "";
    if (!cursor || !(json.markets || []).length) break;
  }

  const packed = {
    markets,
    empty: !markets.length,
    error: null,
    asOf: new Date().toISOString(),
    seriesTicker,
  };
  await writeCache(key, packed, caches, markets.length ? TTL_MS : EMPTY_TTL_MS);
  return packed;
}

function groupByEvent(markets) {
  const map = new Map();
  for (const m of markets || []) {
    const et = m.event_ticker || "";
    if (!et) continue;
    if (!map.has(et)) map.set(et, []);
    map.get(et).push(m);
  }
  return map;
}

function sentimentForGame(game, eventMarkets) {
  const homeName = game.home?.name || game.home?.abbr || "";
  const awayName = game.away?.name || game.away?.abbr || "";
  if (!homeName || !awayName || !eventMarkets?.length) return null;

  let homeM = null;
  let awayM = null;
  for (const m of eventMarkets) {
    const label = teamLabel(m);
    if (!label) continue;
    if (!homeM && namesMatch(label, homeName)) homeM = m;
    if (!awayM && namesMatch(label, awayName)) awayM = m;
  }
  if (!homeM && !awayM) return null;

  const homeP = dollarPrice(homeM);
  const awayP = dollarPrice(awayM);
  if (homeP == null && awayP == null) return null;
  const sum = (homeP || 0) + (awayP || 0);
  const home = sum > 0 ? (homeP || 0) / sum : homeP;
  const away = home != null ? 1 - home : awayP;
  return {
    source: SENTIMENT_BOOK,
    home,
    away,
    priceHome: americanFromProb(homeP),
    priceAway: americanFromProb(awayP),
    yesHome: homeP,
    yesAway: awayP,
    provider: "kalshi-direct",
  };
}

/**
 * Attach Kalshi winner sentiment onto games. Does not overwrite an existing
 * Parlay-sourced sentiment unless replace=true.
 */
export async function attachKalshiSentiment(games = [], sport, caches = null, { replace = false } = {}) {
  const series = KALSHI_SERIES[String(sport || "").toLowerCase()];
  if (!series || !games.length) {
    return { games, meta: { enabled: Boolean(series), series: series || null, matched: 0, skipped: !series } };
  }

  let payload;
  try {
    payload = await fetchOpenMarkets(series, caches);
  } catch (err) {
    return {
      games,
      meta: { enabled: true, series, matched: 0, error: String(err?.message || err) },
    };
  }

  if (payload.empty) {
    return {
      games,
      meta: {
        enabled: true,
        series,
        matched: 0,
        empty: true,
        error: payload.error || null,
        asOf: payload.asOf || null,
      },
    };
  }

  const byEvent = groupByEvent(payload.markets);
  // Also try matching without requiring event grouping first: scan all pairs.
  const eventLists = [...byEvent.values()];
  let matched = 0;
  const next = games.map((g) => {
    if (g.sentiment && !replace) return g;
    let hit = null;
    for (const markets of eventLists) {
      hit = sentimentForGame(g, markets);
      if (hit) break;
    }
    if (!hit) return g;
    matched += 1;
    return {
      ...g,
      sentiment: hit,
      odds: { ...(g.odds || {}), sentiment: hit },
    };
  });

  return {
    games: next,
    meta: {
      enabled: true,
      series,
      matched,
      marketN: payload.markets.length,
      events: byEvent.size,
      asOf: payload.asOf,
      provider: "kalshi-direct",
      free: true,
    },
  };
}
