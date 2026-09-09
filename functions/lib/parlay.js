/**
 * ParlayAPI integration.
 *
 * Pinnacle (eu) = sharp / fair / CLV. Always the market layer.
 * Kalshi (us h2h) = public sentiment only. Never a betting book.
 * Heritage = execution destination. Not in Parlay's book list today —
 *   tickets are still labeled Heritage and priced off the Pinnacle number.
 * F5 book lines are often empty on /odds; Pal is matchup data, not a substitute price.
 */

import { readCache, writeCache } from "./cache.js";
import {
  BASEBALL,
  EXECUTION_BOOK,
  SHARP_BOOK,
  SENTIMENT_BOOK,
  isExecutionBook,
  isF5QuoteBook,
  isPricingBook,
  isSentimentBook,
  isSharpBook,
  pickExactRunLinePair,
  pairTotalSides,
  validAmerican,
} from "./books.js";
import { matchEvent, namesMatch } from "./match.js";
import { enrichGameTeams } from "./teams.js";
import { attachMarketLabels } from "./marketLabels.js";
import { fetchSharpApiOdds } from "./sharpApi.js";
import { fetchTheRundownOdds } from "./theRundown.js";

/** Soft recreational books used only when pin + Heritage are absent. Never pin*. */
const SOFT_QUOTE_KEYS = new Set(["draftkings", "fanduel", "betmgm", "caesars", "bovada", "novig"]);

function isSoftQuoteBook(key) {
  return SOFT_QUOTE_KEYS.has(String(key || "").toLowerCase());
}

export { namesMatch };

export const PARLAY_SPORT = {
  mlb: "baseball_mlb",
  nba: "basketball_nba",
  nfl: "americanfootball_nfl",
  cfb: "americanfootball_ncaaf",
  cbb: "basketball_ncaab",
};

const TTL_MS = 15 * 60 * 1000;
const EMPTY_F5_TTL_MS = 6 * 60 * 60 * 1000;
const STALE_PROPS_TTL_MS = 36 * 60 * 60 * 1000;
const CACHE_VER = "v7";
const MLB_PROP_MARKETS = [
  "player_total_bases", "player_hits", "player_home_runs", "player_rbis", "player_runs",
  "player_strikeouts", "player_pitcher_outs", "player_hits_allowed", "player_earned_runs",
];

function outcomes(bookmakers, marketKey, pred) {
  const rows = [];
  for (const book of bookmakers || []) {
    const key = String(book.key || "").toLowerCase();
    if (pred && !pred(key)) continue;
    const markets = (book.markets || []).filter((x) => x.key === marketKey);
    for (const m of markets) {
      for (const o of m.outcomes || []) {
        if (!validAmerican(o.price)) continue;
        rows.push({
          book: book.title || book.key,
          bookKey: key,
          name: o.name,
          price: Number(o.price),
          point: o.point == null ? null : Number(o.point),
        });
      }
    }
  }
  return rows;
}

function impliedFromAmerican(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

function sentimentFromKalshi(h2h, home, away) {
  const homeRow = h2h.find((r) => namesMatch(r.name, home));
  const awayRow = h2h.find((r) => namesMatch(r.name, away));
  const homeP = impliedFromAmerican(homeRow?.price);
  const awayP = impliedFromAmerican(awayRow?.price);
  if (homeP == null && awayP == null) return null;
  const s = (homeP || 0) + (awayP || 0);
  const homeImp = s > 0 ? (homeP || 0) / s : homeP;
  return {
    source: SENTIMENT_BOOK,
    home: homeImp,
    away: homeImp != null ? 1 - homeImp : awayP,
    priceHome: homeRow?.price ?? null,
    priceAway: awayRow?.price ?? null,
  };
}

function sideMl(rows, team) {
  return rows.find((r) => namesMatch(r.name, team)) || null;
}

function packFg(books, sportId, home, away) {
  const pinH2h = outcomes(books, "h2h", isSharpBook);
  const pinSpreads = outcomes(books, "spreads", isSharpBook);
  const pinTotals = outcomes(books, "totals", isSharpBook);
  const heritageH2h = outcomes(books, "h2h", isExecutionBook);
  const heritageSpreads = outcomes(books, "spreads", isExecutionBook);
  const heritageTotals = outcomes(books, "totals", isExecutionBook);
  const softH2h = outcomes(books, "h2h", isSoftQuoteBook);
  const softSpreads = outcomes(books, "spreads", isSoftQuoteBook);
  const softTotals = outcomes(books, "totals", isSoftQuoteBook);

  const pinHome = sideMl(pinH2h, home);
  const pinAway = sideMl(pinH2h, away);
  const herHome = sideMl(heritageH2h, home);
  const herAway = sideMl(heritageH2h, away);
  const softHome = sideMl(softH2h, home);
  const softAway = sideMl(softH2h, away);

  const pinSpreadPair = pickExactRunLinePair(
    pinSpreads.filter((r) => namesMatch(r.name, home) && r.point != null),
    pinSpreads.filter((r) => namesMatch(r.name, away) && r.point != null),
    sportId
  );
  const herSpreadPair = pickExactRunLinePair(
    heritageSpreads.filter((r) => namesMatch(r.name, home) && r.point != null),
    heritageSpreads.filter((r) => namesMatch(r.name, away) && r.point != null),
    sportId
  );
  const softSpreadPair = pickExactRunLinePair(
    softSpreads.filter((r) => namesMatch(r.name, home) && r.point != null),
    softSpreads.filter((r) => namesMatch(r.name, away) && r.point != null),
    sportId
  );
  const pinTotalPair = pairTotalSides(
    pinTotals.filter((r) => /over/i.test(r.name) && r.point != null),
    pinTotals.filter((r) => /under/i.test(r.name) && r.point != null)
  );
  const herTotalPair = pairTotalSides(
    heritageTotals.filter((r) => /over/i.test(r.name) && r.point != null),
    heritageTotals.filter((r) => /under/i.test(r.name) && r.point != null)
  );
  const softTotalPair = pairTotalSides(
    softTotals.filter((r) => /over/i.test(r.name) && r.point != null),
    softTotals.filter((r) => /under/i.test(r.name) && r.point != null)
  );

  const spreadPair = pinSpreadPair || herSpreadPair || softSpreadPair;
  const totalPair = pinTotalPair || herTotalPair || softTotalPair;
  const spread = spreadPair?.point ?? null;
  const total = totalPair?.point ?? null;
  const hasPin = Boolean(pinHome && pinAway) || Boolean(pinSpreadPair) || Boolean(pinTotalPair);
  const hasSoft =
    !hasPin &&
    ((softHome && softAway) || Boolean(softSpreadPair) || Boolean(softTotalPair));

  return {
    homeMl: herHome?.price ?? pinHome?.price ?? softHome?.price ?? null,
    awayMl: herAway?.price ?? pinAway?.price ?? softAway?.price ?? null,
    fairHomeMl: pinHome && pinAway ? pinHome.price : null,
    fairAwayMl: pinHome && pinAway ? pinAway.price : null,
    pinHomeMl: pinHome && pinAway ? pinHome.price : null,
    pinAwayMl: pinHome && pinAway ? pinAway.price : null,
    pinSpreadHomePrice: pinSpreadPair?.home.price ?? null,
    pinSpreadAwayPrice: pinSpreadPair?.away.price ?? null,
    pinSpread: pinSpreadPair?.point ?? null,
    pinTotal: pinTotalPair?.point ?? null,
    pinOverPrice: pinTotalPair?.over.price ?? null,
    pinUnderPrice: pinTotalPair?.under.price ?? null,
    heritageHomeMl: herHome?.price ?? null,
    heritageAwayMl: herAway?.price ?? null,
    heritageSpreadHomePrice: herSpreadPair?.home.price ?? null,
    heritageSpreadAwayPrice: herSpreadPair?.away.price ?? null,
    heritageOverPrice: herTotalPair?.over.price ?? null,
    heritageUnderPrice: herTotalPair?.under.price ?? null,
    spread,
    spreadPrice: (pinSpreadPair || herSpreadPair || softSpreadPair)?.home.price ?? null,
    total,
    totalPrice: (pinTotalPair || herTotalPair || softTotalPair)?.over.price ?? null,
    details: "",
    book: EXECUTION_BOOK,
    sharp: hasPin ? SHARP_BOOK : "",
    heritageListed: Boolean(herHome || herAway || herSpreadPair || herTotalPair),
    pinPresent: hasPin,
    softPresent: hasSoft,
  };
}

function packF5(books, sportId, home, away) {
  const quote = (key) => isF5QuoteBook(key) && !isSentimentBook(key);
  const h2h = outcomes(books, "h2h_1st_5_innings", quote);
  const spreads = outcomes(books, "spreads_1st_5_innings", quote);
  const totals = outcomes(books, "totals_1st_5_innings", quote);
  const pinH2h = h2h.filter((r) => isSharpBook(r.bookKey));
  const useH2h = pinH2h.length ? pinH2h : h2h;
  const pinSpreads = spreads.filter((r) => isSharpBook(r.bookKey));
  const useSpreads = pinSpreads.length ? pinSpreads : spreads;
  const pinTotals = totals.filter((r) => isSharpBook(r.bookKey));
  const useTotals = pinTotals.length ? pinTotals : totals;

  const homeMl = sideMl(useH2h, home);
  const awayMl = sideMl(useH2h, away);
  const spreadPair = pickExactRunLinePair(
    useSpreads.filter((r) => namesMatch(r.name, home) && r.point != null),
    useSpreads.filter((r) => namesMatch(r.name, away) && r.point != null),
    sportId,
    { f5: true }
  );
  const totalPair = pairTotalSides(
    useTotals.filter((r) => /over/i.test(r.name) && r.point != null),
    useTotals.filter((r) => /under/i.test(r.name) && r.point != null)
  );
  if (!homeMl && !awayMl && !spreadPair && !totalPair) return null;
  return {
    homeMl: homeMl && awayMl ? homeMl.price : null,
    awayMl: homeMl && awayMl ? awayMl.price : null,
    spread: spreadPair?.point ?? null,
    spreadHomePrice: spreadPair?.home.price ?? null,
    spreadAwayPrice: spreadPair?.away.price ?? null,
    total: totalPair?.point ?? null,
    overPrice: totalPair?.over.price ?? null,
    underPrice: totalPair?.under.price ?? null,
    book: homeMl?.book || spreadPair?.home.book || totalPair?.over.book || SHARP_BOOK,
    sharp: pinH2h.length || pinSpreads.length || pinTotals.length ? SHARP_BOOK : "",
  };
}

export function summarizeParlayEvent(event, sportId) {
  const books = event.bookmakers || [];
  const home = event.home_team;
  const away = event.away_team;
  const fg = packFg(books, sportId, home, away);
  const f5 = event.periodF5 || packF5(books, sportId, home, away);
  const kalshiH2h = outcomes(books, "h2h", (k) => k === "kalshi");
  const softSource =
    fg.pinPresent || fg.heritageListed
      ? null
      : event.softSource || (fg.softPresent ? "sharpapi" : null);
  return {
    parlayId: event.id,
    homeTeam: home,
    awayTeam: away,
    commence: event.commence_time,
    ...fg,
    softSource,
    f5,
    sentiment: sentimentFromKalshi(kalshiH2h, home, away),
    playerProps: event.playerProps || [],
    books: books.filter((b) => isPricingBook(b.key)).length,
  };
}

export function matchParlay(game, events) {
  return matchEvent(game, events);
}

function applyOdds(game, p) {
  if (!p) return game;
  const softEspn =
    !p.pinPresent &&
    !p.softSource &&
    (game.odds?.homeMl != null || game.odds?.awayMl != null) &&
    !game.odds?.pinPresent;
  const odds = {
    ...game.odds,
    spread: p.spread ?? game.odds?.spread ?? null,
    total: p.total ?? game.odds?.total ?? null,
    homeMl: p.homeMl ?? game.odds?.homeMl ?? null,
    awayMl: p.awayMl ?? game.odds?.awayMl ?? null,
    details: p.details || game.odds?.details || "",
    book: EXECUTION_BOOK,
    sharp: p.sharp || (p.pinPresent ? SHARP_BOOK : game.odds?.sharp || ""),
    homeMlBook: EXECUTION_BOOK,
    awayMlBook: EXECUTION_BOOK,
    books: p.books,
    sentiment: p.sentiment || game.odds?.sentiment || null,
    softSource: p.pinPresent
      ? null
      : p.softSource || (softEspn ? "espn" : game.odds?.softSource || null),
    f5: p.f5 || game.odds?.f5 || null,
    playerProps: p.playerProps || game.odds?.playerProps || [],
    heritageListed: p.heritageListed,
    pinPresent: p.pinPresent,
    pinHomeMl: p.pinHomeMl ?? p.fairHomeMl ?? game.odds?.pinHomeMl ?? null,
    pinAwayMl: p.pinAwayMl ?? p.fairAwayMl ?? game.odds?.pinAwayMl ?? null,
    pinSpreadHomePrice: p.pinSpreadHomePrice ?? null,
    pinSpreadAwayPrice: p.pinSpreadAwayPrice ?? null,
    pinSpread: p.pinSpread ?? null,
    pinTotal: p.pinTotal ?? null,
    pinOverPrice: p.pinOverPrice ?? null,
    pinUnderPrice: p.pinUnderPrice ?? null,
    heritageHomeMl: p.heritageHomeMl ?? null,
    heritageAwayMl: p.heritageAwayMl ?? null,
    heritageSpreadHomePrice: p.heritageSpreadHomePrice ?? null,
    heritageSpreadAwayPrice: p.heritageSpreadAwayPrice ?? null,
    heritageOverPrice: p.heritageOverPrice ?? null,
    heritageUnderPrice: p.heritageUnderPrice ?? null,
    spreadPrice: p.spreadPrice ?? null,
    totalPrice: p.totalPrice ?? null,
  };
  let projHome = game.projHomeScore;
  let projAway = game.projAwayScore;
  let marketProjHome = game.marketProjHome;
  let marketProjAway = game.marketProjAway;
  if (odds.total != null && odds.spread != null) {
    marketProjHome = odds.total / 2 - odds.spread / 2;
    marketProjAway = odds.total / 2 + odds.spread / 2;
  }
  if (!BASEBALL.has(game.sport) && game.sport !== "nfl" && game.sport !== "cfb" && odds.total != null && odds.spread != null && game.bpp == null && !game.savant) {
    projHome = marketProjHome;
    projAway = marketProjAway;
  }
  return {
    ...game,
    odds,
    projHomeScore: projHome,
    projAwayScore: projAway,
    marketProjHome,
    marketProjAway,
    parlayHomeName: p.homeTeam,
    parlayAwayName: p.awayTeam,
    parlayId: p.parlayId,
    fairHomeMl: p.fairHomeMl,
    fairAwayMl: p.fairAwayMl,
    sentiment: p.sentiment || game.sentiment || null,
  };
}

export function mergeParlay(games, parlayEvents, sport) {
  const leftover = [...(parlayEvents || [])];
  const merged = games.map((g) => {
    const hit = matchParlay(g, leftover);
    if (!hit) return g;
    const i = leftover.indexOf(hit);
    if (i >= 0) leftover.splice(i, 1);
    return applyOdds(g, hit);
  });

  for (const p of leftover) {
    const stub = {
      id: p.parlayId,
      sport,
      start: p.commence,
      status: { state: "pre", detail: "Scheduled", completed: false, live: false },
      home: { name: p.homeTeam, abbr: "—", logo: "", score: null, rank: null, record: "", mlbId: null },
      away: { name: p.awayTeam, abbr: "—", logo: "", score: null, rank: null, record: "", mlbId: null },
      odds: {
        spread: p.spread,
        total: p.total,
        homeMl: p.homeMl,
        awayMl: p.awayMl,
        details: p.details,
        book: EXECUTION_BOOK,
        sharp: p.sharp || SHARP_BOOK,
        homeMlBook: EXECUTION_BOOK,
        awayMlBook: EXECUTION_BOOK,
        books: p.books,
        sentiment: p.sentiment || null,
        f5: p.f5 || null,
        playerProps: p.playerProps || [],
        pinPresent: p.pinPresent,
        heritageListed: p.heritageListed,
    pinHomeMl: p.pinHomeMl ?? p.fairHomeMl ?? null,
    pinAwayMl: p.pinAwayMl ?? p.fairAwayMl ?? null,
    pinSpreadHomePrice: p.pinSpreadHomePrice ?? null,
    pinSpreadAwayPrice: p.pinSpreadAwayPrice ?? null,
    pinSpread: p.pinSpread ?? null,
    pinTotal: p.pinTotal ?? null,
    pinOverPrice: p.pinOverPrice ?? null,
    pinUnderPrice: p.pinUnderPrice ?? null,
        heritageHomeMl: p.heritageHomeMl ?? null,
        heritageAwayMl: p.heritageAwayMl ?? null,
        heritageSpreadHomePrice: p.heritageSpreadHomePrice ?? null,
        heritageSpreadAwayPrice: p.heritageSpreadAwayPrice ?? null,
        heritageOverPrice: p.heritageOverPrice ?? null,
        heritageUnderPrice: p.heritageUnderPrice ?? null,
        spreadPrice: p.spreadPrice ?? null,
        totalPrice: p.totalPrice ?? null,
      },
      espnHomeWinPct: null,
      projHomeScore: null,
      projAwayScore: null,
      marketProjHome: p.total != null && p.spread != null ? p.total / 2 - p.spread / 2 : null,
      marketProjAway: p.total != null && p.spread != null ? p.total / 2 + p.spread / 2 : null,
      projectionKind: sport === "nfl" ? "PINNACLE_IMPLIED" : sport === "cfb" ? "UNAVAILABLE" : "PINNACLE_IMPLIED",
      venue: "",
      broadcast: "",
      notes: [],
      parlayId: p.parlayId,
      parlayHomeName: p.homeTeam,
      parlayAwayName: p.awayTeam,
      fairHomeMl: p.fairHomeMl,
      fairAwayMl: p.fairAwayMl,
      sentiment: p.sentiment || null,
    };
    merged.push(attachMarketLabels(enrichGameTeams(sport, stub)));
  }
  return merged;
}

function parseEvents(raw) {
  const list = Array.isArray(raw) ? raw : raw?.data || raw?.odds || [];
  return Array.isArray(list) ? list : [];
}

function creditMeta(res) {
  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  return {
    remaining: remaining ? Number(remaining) : null,
    used: used ? Number(used) : null,
    asOf: res.headers.get("x-data-as-of") || null,
  };
}

async function parlayFetch(url, apiKey) {
  return fetch(url, {
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
    },
  });
}

async function fetchJson(sportKey, params, apiKey) {
  const url = new URL(`https://parlay-api.com/v1/sports/${sportKey}/odds`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("include", "slim");
  const res = await parlayFetch(url, apiKey);
  const credits = creditMeta(res);
  if (!res.ok) {
    const text = await res.text();
    return { events: [], error: `Parlay ${res.status}: ${text.slice(0, 180)}`, credits };
  }
  const raw = await res.json();
  return { events: parseEvents(raw), credits };
}

function isParlayCreditError(err = "") {
  const s = String(err || "").toUpperCase();
  return s.includes("OUT_OF_USAGE_CREDITS") || s.includes("CREDIT_LIMIT_REACHED") || s.includes("MONTHLY CREDIT LIMIT");
}

async function fetchTheOddsJson(sportKey, params, apiKey) {
  if (!apiKey) return { events: [], error: "theodds-no-api-key", credits: { remaining: null, used: null, asOf: null } };
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("oddsFormat", "american");
  const res = await fetch(String(url), { headers: { Accept: "application/json" } });
  const credits = creditMeta(res);
  if (!res.ok) {
    const text = await res.text();
    return { events: [], error: `TheOdds ${res.status}: ${text.slice(0, 180)}`, credits };
  }
  const raw = await res.json();
  return { events: parseEvents(raw), credits };
}

async function fetchPropsJson(sportKey, params, apiKey) {
  const url = new URL(`https://parlay-api.com/v1/sports/${sportKey}/props`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await parlayFetch(url, apiKey);
  const credits = creditMeta(res);
  if (!res.ok) return { rows: [], error: `Parlay ${res.status}: ${(await res.text()).slice(0, 180)}`, credits };
  const raw = await res.json();
  const rows = Array.isArray(raw) ? raw : raw?.results || raw?.data?.items || raw?.data || raw?.props || [];
  return { rows: Array.isArray(rows) ? rows : [], credits };
}

function propTimestamp(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 1e12) return new Date(n).toISOString();
  if (Number.isFinite(n) && n > 1e9) return new Date(n * 1000).toISOString();
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

export function attachFlatProps(events, rows) {
  return (events || []).map((event) => ({
    ...event,
    playerProps: (rows || []).filter((r) => {
      const eventId = r.event_id || r.eventId || r.canonical_event_id;
      if (eventId != null && String(eventId) === String(event.id)) return true;
      const home = r.home_team || r.homeTeam;
      const away = r.away_team || r.awayTeam;
      return home && away && namesMatch(home, event.home_team) && namesMatch(away, event.away_team);
    }).map((r) => ({
      eventId: r.event_id || r.eventId || r.canonical_event_id, playerName: r.player_name || r.playerName || r.player,
      marketKey: r.market_key || r.marketKey || r.market, marketLabel: r.market_label || r.marketLabel || r.market,
      line: r.line == null ? null : Number(r.line), overPrice: r.over_price == null ? null : Number(r.over_price),
      underPrice: r.under_price == null ? null : Number(r.under_price), bookmaker: r.source_title || r.bookmaker_title || r.bookmaker || r.source,
      bookmakerKey: r.source || r.bookmaker_key || r.bookmakerKey || r.bookmaker, snapshotAt: propTimestamp(r.snapshot_time || r.snapshotAt || r.last_update),
    })),
  }));
}

async function fetchPeriodMarkets(sportKey, period, apiKey) {
  const url = new URL(`https://parlay-api.com/v1/sports/${sportKey}/live/period_markets`);
  url.searchParams.set("period", period);
  const res = await parlayFetch(url, apiKey);
  const credits = creditMeta(res);
  if (!res.ok) return { rows: [], error: `Parlay ${res.status}: ${(await res.text()).slice(0, 180)}`, credits };
  const raw = await res.json();
  const rows = Array.isArray(raw) ? raw : raw?.results || raw?.data?.items || raw?.data || [];
  return { rows: Array.isArray(rows) ? rows : [], credits };
}

function periodSource(row) {
  return String(row.source || row.bookmaker_key || row.bookmaker || "").toLowerCase();
}

function periodPrice(row) {
  const value = Number(row.price);
  return validAmerican(value) ? value : null;
}

function periodLine(row) {
  const value = Number(row.line ?? row.point);
  return Number.isFinite(value) ? value : null;
}

function sourceRank(source) {
  const order = ["pinnacle", "fanduel", "draftkings", "betmgm", "caesars", "bovada"];
  const i = order.indexOf(source);
  return i < 0 ? order.length : i;
}

function packPeriodRows(rows) {
  const byGame = new Map();
  for (const row of rows || []) {
    const home = row.home_team || row.homeTeam;
    const away = row.away_team || row.awayTeam;
    if (!home || !away || String(row.period_key || row.period || "").toUpperCase() !== "F5") continue;
    const key = `${String(away).toLowerCase()}|${String(home).toLowerCase()}`;
    if (!byGame.has(key)) byGame.set(key, { home, away, rows: [] });
    byGame.get(key).rows.push(row);
  }
  const packed = [];
  for (const game of byGame.values()) {
    const sources = [...new Set(game.rows.map(periodSource).filter(Boolean))].sort((a, b) => sourceRank(a) - sourceRank(b));
    let f5 = null;
    for (const source of sources) {
      const sourceRows = game.rows.filter((r) => periodSource(r) === source && periodPrice(r) != null);
      const market = (name) => sourceRows.filter((r) => String(r.market || r.market_key || "").toLowerCase() === name);
      const h2h = market("h2h");
      const homeMl = h2h.find((r) => String(r.side || "").toLowerCase() === "home");
      const awayMl = h2h.find((r) => String(r.side || "").toLowerCase() === "away");
      const spreads = market("spread");
      const homeSpreads = spreads.filter((r) => String(r.side || "").toLowerCase() === "home" && periodLine(r) != null);
      let spreadPair = null;
      for (const homeRow of homeSpreads) {
        const awayRow = spreads.find((r) => String(r.side || "").toLowerCase() === "away" && periodLine(r) === -periodLine(homeRow));
        if (awayRow) { spreadPair = { home: homeRow, away: awayRow }; break; }
      }
      const totals = market("total");
      let totalPair = null;
      for (const over of totals.filter((r) => String(r.side || "").toLowerCase() === "over" && periodLine(r) != null)) {
        const under = totals.find((r) => String(r.side || "").toLowerCase() === "under" && periodLine(r) === periodLine(over));
        if (under) { totalPair = { over, under }; break; }
      }
      if (homeMl && awayMl || spreadPair || totalPair) {
        f5 = {
          homeMl: homeMl && awayMl ? periodPrice(homeMl) : null,
          awayMl: homeMl && awayMl ? periodPrice(awayMl) : null,
          spread: spreadPair ? periodLine(spreadPair.home) : null,
          spreadHomePrice: spreadPair ? periodPrice(spreadPair.home) : null,
          spreadAwayPrice: spreadPair ? periodPrice(spreadPair.away) : null,
          total: totalPair ? periodLine(totalPair.over) : null,
          overPrice: totalPair ? periodPrice(totalPair.over) : null,
          underPrice: totalPair ? periodPrice(totalPair.under) : null,
          book: source,
          sharp: isSharpBook(source) ? SHARP_BOOK : "",
        };
        break;
      }
    }
    if (f5) packed.push({ homeTeam: game.home, awayTeam: game.away, f5 });
  }
  return packed;
}

export function attachPeriodF5(events, rows) {
  const packed = packPeriodRows(rows);
  return (events || []).map((event) => {
    const hit = packed.find((p) => namesMatch(p.homeTeam, event.home_team) && namesMatch(p.awayTeam, event.away_team));
    return hit ? { ...event, periodF5: hit.f5 } : event;
  });
}

function mergeByTeams(primary, extra) {
  const out = primary.map((ev) => ({ ...ev, bookmakers: [...(ev.bookmakers || [])] }));
  for (const add of extra) {
    const hit = out.find(
      (ev) => namesMatch(ev.home_team, add.home_team) && namesMatch(ev.away_team, add.away_team)
    );
    if (hit) {
      hit.bookmakers = [...(hit.bookmakers || []), ...(add.bookmakers || [])];
    } else {
      out.push(add);
    }
  }
  return out;
}

function propsRowsToStubEvents(rows = []) {
  const grouped = new Map();
  for (const row of rows || []) {
    const home = row.home_team || row.homeTeam;
    const away = row.away_team || row.awayTeam;
    if (!home || !away) continue;
    const eventId = row.event_id || row.eventId || row.canonical_event_id || `${away} @ ${home}`;
    const commence = row.commence_time || row.commenceTime || row.start_time || row.startTime || null;
    const key = `${String(home).toLowerCase()}::${String(away).toLowerCase()}`;
    if (!grouped.has(key)) {
      grouped.set(key, { id: eventId, home_team: home, away_team: away, commence_time: commence, bookmakers: [], playerProps: [] });
    }
  }
  return Array.from(grouped.values());
}

export async function fetchParlayOdds(sportId, apiKey, cfCache, opts = {}) {
  const sportKey = PARLAY_SPORT[sportId];
  if (!sportKey || (!apiKey && !opts.backupApiKey && !opts.sharpApiKey && !opts.theRundownApiKey)) {
    return { events: [], meta: { enabled: false, remaining: null, cached: false } };
  }
  const baseball = BASEBALL.has(sportId);
  const cacheKey = `${CACHE_VER}:odds${baseball ? "-props-v3" : ""}:${sportKey}`;
  const cached = await readCache(cacheKey, cfCache, TTL_MS);
  if (cached) {
    const cachedMeta = { ...(cached.meta || {}), cached: true };
    const cachedErr = String(cachedMeta.parlayError || cachedMeta.error || "");
    if (isParlayCreditError(cachedErr) && !String(cachedMeta.source || "").includes("credit-exhausted")) {
      cachedMeta.source = opts.backupApiKey ? "parlay-credit-exhausted-backup-failed" : "parlay-credit-exhausted";
    }
    return { ...cached, meta: cachedMeta };
  }
  if (opts.cacheOnly) {
    // Cache miss on TODAY sport=all: prefer sharp backup, then soft free books.
    if (opts.backupApiKey) {
      const backup = await fetchTheOddsJson(
        sportKey,
        {
          regions: "eu",
          markets: "h2h,spreads,totals",
          bookmakers: "pinnacle",
        },
        opts.backupApiKey
      );
      if (backup.events?.length) {
        const events = backup.events.map((ev) => summarizeParlayEvent(ev, sportId)).filter(Boolean);
        const payload = {
          events,
          meta: {
            enabled: true,
            remaining: backup.credits.remaining,
            used: backup.credits.used,
            cached: false,
            skipped: false,
            source: "theodds-free-cacheonly",
            free: true,
            sharp: SHARP_BOOK,
            execution: EXECUTION_BOOK,
            sentiment: SENTIMENT_BOOK,
            sentimentGames: 0,
            propFeedStatus: baseball ? "skipped" : "not-applicable",
            propFeedError: null,
            propRows: 0,
          },
        };
        await writeCache(cacheKey, payload, cfCache, TTL_MS);
        return payload;
      }
    }
    if (opts.sharpApiKey) {
      const sharp = await fetchSharpApiOdds(sportId, opts.sharpApiKey);
      if (sharp.events?.length) {
        const events = sharp.events.map((ev) => summarizeParlayEvent(ev, sportId)).filter(Boolean);
        const payload = {
          events,
          meta: {
            enabled: true,
            remaining: sharp.credits.remaining,
            used: null,
            cached: false,
            skipped: false,
            source: "sharpapi-free-cacheonly",
            free: true,
            softBooks: sharp.books,
            sharp: SHARP_BOOK,
            execution: EXECUTION_BOOK,
            sentiment: SENTIMENT_BOOK,
            sentimentGames: 0,
            propFeedStatus: baseball ? "skipped" : "not-applicable",
            propFeedError: null,
            propRows: 0,
          },
        };
        await writeCache(cacheKey, payload, cfCache, TTL_MS);
        return payload;
      }
    }
    if (opts.theRundownApiKey) {
      const rundown = await fetchTheRundownOdds(sportId, opts.theRundownApiKey, opts.date);
      if (rundown.events?.length) {
        const events = rundown.events.map((ev) => summarizeParlayEvent(ev, sportId)).filter(Boolean);
        const payload = {
          events,
          meta: {
            enabled: true,
            remaining: rundown.credits.remaining,
            used: null,
            cached: false,
            skipped: false,
            source: "therundown-free-cacheonly",
            free: true,
            softBooks: rundown.books,
            sharp: SHARP_BOOK,
            execution: EXECUTION_BOOK,
            sentiment: SENTIMENT_BOOK,
            sentimentGames: 0,
            propFeedStatus: baseball ? "skipped" : "not-applicable",
            propFeedError: null,
            propRows: 0,
          },
        };
        await writeCache(cacheKey, payload, cfCache, TTL_MS);
        return payload;
      }
    }
    return {
      events: [],
      meta: {
        enabled: true,
        remaining: null,
        cached: false,
        skipped: true,
        source: opts.backupApiKey || opts.sharpApiKey || opts.theRundownApiKey ? "free-backups-empty" : null,
        propFeedStatus: baseball ? "skipped" : "not-applicable",
        propFeedError: null,
        propRows: 0,
      },
    };
  }

  let pin = await fetchJson(
    sportKey,
    {
      regions: "eu",
      markets: "h2h,spreads,totals",
      bookmakers: "pinnacle",
    },
    apiKey
  );
  let source = "parlay";
  let parlayError = pin.error || null;
  let backupError = null;
  if (pin.error && !pin.events.length && isParlayCreditError(pin.error) && opts.backupApiKey) {
    const backup = await fetchTheOddsJson(
      sportKey,
      {
        regions: "eu",
        markets: "h2h,spreads,totals",
        bookmakers: "pinnacle",
      },
      opts.backupApiKey
    );
    if (!backup.error && backup.events?.length) {
      pin = { ...pin, events: backup.events, credits: backup.credits };
      source = "theodds-backup";
    } else if (backup.error) {
      backupError = backup.error;
    }
  }
  if (pin.error && !pin.events.length && isParlayCreditError(pin.error) && source !== "theodds-backup") {
    source = opts.backupApiKey ? "parlay-credit-exhausted-backup-failed" : "parlay-credit-exhausted";
  }
  if (pin.error && !pin.events.length && !baseball) {
    let soft = null;
    if (opts.sharpApiKey) soft = await fetchSharpApiOdds(sportId, opts.sharpApiKey);
    if ((!soft || !soft.events?.length) && opts.theRundownApiKey) {
      soft = await fetchTheRundownOdds(sportId, opts.theRundownApiKey, opts.date);
    }
    if (soft?.events?.length) {
      pin = { ...pin, events: soft.events };
      source = soft.soft && soft.books?.includes("betmgm") ? "therundown-soft-backup" : "sharpapi-soft-backup";
    } else {
      return {
        events: [],
        meta: {
          enabled: true,
          error: pin.error,
          remaining: pin.credits.remaining,
          used: pin.credits.used,
          cached: false,
          sportKey,
          sharp: SHARP_BOOK,
          execution: EXECUTION_BOOK,
          source,
        },
      };
    }
  }

  let combined = pin.events;
  let remaining = pin.credits.remaining;
  let used = pin.credits.used;
  let f5Games = 0;
  let propRows = 0;
  let propFeedStatus = "not-applicable";
  let propFeedError = null;
  let sentimentGames = 0;

  const parlayCreditLimited = isParlayCreditError(parlayError);
  const kalshiKey = `${CACHE_VER}:kalshi:${sportKey}`;
  let kalshiPayload = await readCache(kalshiKey, cfCache, EMPTY_F5_TTL_MS);
  if (!kalshiPayload && apiKey && !parlayCreditLimited) {
    const kalshi = await fetchJson(
      sportKey,
      { regions: "us", markets: "h2h", bookmakers: "kalshi" },
      apiKey
    );
    remaining = kalshi.credits.remaining ?? remaining;
    used = kalshi.credits.used ?? used;
    kalshiPayload = { events: kalshi.error ? [] : kalshi.events, empty: !kalshi.events?.length };
    await writeCache(kalshiKey, kalshiPayload, cfCache, kalshiPayload.empty ? EMPTY_F5_TTL_MS : TTL_MS);
  }
  kalshiPayload = kalshiPayload || { events: [], empty: true };
  if (kalshiPayload.events?.length) {
    combined = mergeByTeams(combined, kalshiPayload.events);
    sentimentGames = kalshiPayload.events.length;
  }

  if (baseball) {
    const f5Key = `${CACHE_VER}:f5:${sportKey}`;
    let f5Payload = await readCache(f5Key, cfCache, EMPTY_F5_TTL_MS);
    if (!f5Payload && apiKey && !parlayCreditLimited) {
      const fetched = await fetchPeriodMarkets(sportKey, "F5", apiKey);
      remaining = fetched.credits.remaining ?? remaining;
      used = fetched.credits.used ?? used;
      f5Payload = { rows: fetched.error ? [] : fetched.rows, empty: !fetched.rows?.length, error: fetched.error || null };
      await writeCache(f5Key, f5Payload, cfCache, f5Payload.empty ? EMPTY_F5_TTL_MS : TTL_MS);
    }
    f5Payload = f5Payload || { rows: [], empty: true, error: parlayCreditLimited ? parlayError : null };
    combined = attachPeriodF5(combined, f5Payload.rows || []);
    f5Games = combined.filter((event) => event.periodF5).length;
    const propsKey = `${CACHE_VER}:props-v3:${sportKey}`;
    const stalePropsKey = `${CACHE_VER}:props-v3-stale:${sportKey}`;
    let propsPayload = await readCache(propsKey, cfCache, EMPTY_F5_TTL_MS);
    if (!propsPayload && apiKey && !parlayCreditLimited) {
      const fetched = await fetchPropsJson(sportKey, {
        markets: MLB_PROP_MARKETS.join(","), maxAgeSec: "3600", limit: "10000",
      }, apiKey);
      remaining = fetched.credits.remaining ?? remaining;
      used = fetched.credits.used ?? used;
      propsPayload = { rows: fetched.error ? [] : fetched.rows, empty: !fetched.rows?.length, error: fetched.error || null };
      await writeCache(propsKey, propsPayload, cfCache, propsPayload.empty ? EMPTY_F5_TTL_MS : TTL_MS);
    }
    propsPayload = propsPayload || { rows: [], empty: true, error: parlayCreditLimited ? parlayError : null };
    if (propsPayload.rows?.length) {
      await writeCache(stalePropsKey, { rows: propsPayload.rows }, cfCache, STALE_PROPS_TTL_MS);
    } else if (propsPayload.error) {
      const stale = await readCache(stalePropsKey, cfCache, STALE_PROPS_TTL_MS);
      if (stale?.rows?.length) {
        propsPayload = {
          rows: stale.rows,
          empty: false,
          error: propsPayload.error,
          stale: true,
        };
      }
    }
    if (!combined.length && propsPayload.rows?.length) {
      combined = propsRowsToStubEvents(propsPayload.rows);
    }
    combined = attachFlatProps(combined, propsPayload.rows || []);
    propRows = propsPayload.rows?.length || 0;
    propFeedStatus = propRows ? (propsPayload.stale ? "stale" : "available") : propsPayload?.error ? "error" : "empty";
    propFeedError = propsPayload?.error || null;
  }

  const softNeeds = combined.some((ev) => {
    const packed = summarizeParlayEvent(ev, sportId);
    return !packed.pinPresent && !packed.heritageListed;
  });
  if (softNeeds) {
    let soft = null;
    if (opts.sharpApiKey) soft = await fetchSharpApiOdds(sportId, opts.sharpApiKey);
    if ((!soft || !soft.events?.length) && opts.theRundownApiKey) {
      soft = await fetchTheRundownOdds(sportId, opts.theRundownApiKey, opts.date);
    }
    if (soft?.events?.length) {
      combined = mergeByTeams(combined, soft.events);
      if (source === "parlay") {
        source = soft.books?.includes("betmgm") ? "parlay-plus-therundown-soft" : "parlay-plus-sharpapi-soft";
      }
    }
  }

  const events = combined.map((ev) => summarizeParlayEvent(ev, sportId));
  const payload = {
    events,
    meta: {
      enabled: true,
      remaining,
      used,
      cached: false,
      source,
      parlayError,
      backupError,
      sportKey,
      games: events.length,
      pinGames: pin.events.length,
      sentimentGames,
      f5Games,
      propRows,
      propFeedStatus,
      propFeedError,
      asOf: pin.credits.asOf,
      sharp: SHARP_BOOK,
      execution: EXECUTION_BOOK,
      sentiment: SENTIMENT_BOOK,
      heritageInFeed: events.some((e) => e.heritageListed),
    },
  };
  await writeCache(cacheKey, payload, cfCache, TTL_MS);
  return payload;
}
