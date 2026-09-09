/**
 * SharpAPI free-tier soft odds backup.
 *
 * Free plan: DraftKings + FanDuel only, ~60s delay, 12 req/min.
 * Never treat these as Pinnacle / pin* / CLV. Soft display lines only.
 *
 * Docs: https://docs.sharpapi.io — auth via X-API-Key (sk_live_…).
 */

import { namesMatch } from "./match.js";
import { pickExactRunLinePair, pairTotalSides, validAmerican } from "./books.js";

const BASE = "https://api.sharpapi.io/api/v1";
const SOFT_BOOKS = ["draftkings", "fanduel"];

/** FBIS sport → SharpAPI league + market keys for FG lines. */
export const SHARPAPI_SPORT = {
  mlb: { league: "mlb", markets: ["moneyline", "run_line", "total_runs"] },
  nba: { league: "nba", markets: ["moneyline", "point_spread", "total_points"] },
  nfl: { league: "nfl", markets: ["moneyline", "point_spread", "total_points"] },
  cfb: { league: "ncaaf", markets: ["moneyline", "point_spread", "total_points"] },
  cbb: { league: "ncaab", markets: ["moneyline", "point_spread", "total_points"] },
};

function rateMeta(res) {
  return {
    remaining: res.headers.get("X-Ratelimit-Remaining"),
    limit: res.headers.get("X-Ratelimit-Limit"),
    tier: res.headers.get("X-Tier"),
    asOf: new Date().toISOString(),
  };
}

async function fetchOddsPage(apiKey, params) {
  const url = new URL(`${BASE}/odds`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(String(url), {
    headers: { Accept: "application/json", "X-Api-Key": apiKey },
  });
  const credits = rateMeta(res);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err =
      json?.error?.message ||
      json?.error?.code ||
      `SharpAPI ${res.status}: ${text.slice(0, 160)}`;
    return { rows: [], error: String(err), credits, status: res.status };
  }
  const rows = Array.isArray(json?.data) ? json.data : [];
  return { rows, error: null, credits, status: res.status, meta: json?.meta || null };
}

function preferMain(rows = []) {
  const main = rows.filter((r) => r?.is_main_line === true);
  return main.length ? main : rows;
}

function bookKey(row) {
  return String(row?.sportsbook || "").toLowerCase();
}

/**
 * Pack SharpAPI flat rows into The-Odds-API-shaped events so summarizeParlayEvent
 * can attach DK/FD soft lines without marking pinPresent.
 */
export function sharpRowsToEvents(rows = [], sportId = "mlb") {
  const byEvent = new Map();
  for (const row of rows || []) {
    if (!row || row.is_live) continue;
    if (!SOFT_BOOKS.includes(bookKey(row))) continue;
    const eid = row.event_id || row.event_uuid || row.id;
    if (!eid) continue;
    const home = row.home_team || row.home?.name;
    const away = row.away_team || row.away?.name;
    if (!home || !away) continue;
    if (!byEvent.has(eid)) {
      byEvent.set(eid, {
        id: String(eid),
        home_team: home,
        away_team: away,
        commence_time: row.event_start_time || null,
        bookmakers: new Map(),
        softSource: "sharpapi",
      });
    }
    const ev = byEvent.get(eid);
    const bk = bookKey(row);
    if (!ev.bookmakers.has(bk)) {
      ev.bookmakers.set(bk, {
        key: bk,
        title: bk === "fanduel" ? "FanDuel" : "DraftKings",
        markets: new Map(),
      });
    }
    const book = ev.bookmakers.get(bk);
    const mt = String(row.market_type || "").toLowerCase();
    let marketKey = null;
    if (mt === "moneyline") marketKey = "h2h";
    else if (mt === "run_line" || mt === "point_spread" || mt === "spread") marketKey = "spreads";
    else if (mt === "total_runs" || mt === "total_points" || mt === "total") marketKey = "totals";
    if (!marketKey) continue;
    if (!validAmerican(row.odds_american)) continue;

    if (!book.markets.has(marketKey)) {
      book.markets.set(marketKey, { key: marketKey, outcomes: [] });
    }
    const market = book.markets.get(marketKey);
    const side = String(row.selection_type || row.team_side || "").toLowerCase();
    let name = null;
    let point = row.line == null ? null : Number(row.line);
    if (marketKey === "h2h") {
      if (side === "home" || namesMatch(row.selection, home)) name = home;
      else if (side === "away" || namesMatch(row.selection, away)) name = away;
    } else if (marketKey === "spreads") {
      if (side === "home" || namesMatch(row.selection, home)) name = home;
      else if (side === "away" || namesMatch(row.selection, away)) name = away;
    } else if (marketKey === "totals") {
      if (side === "over" || /^over\b/i.test(String(row.selection || ""))) name = "Over";
      else if (side === "under" || /^under\b/i.test(String(row.selection || ""))) name = "Under";
    }
    if (!name) continue;
    market.outcomes.push({
      name,
      price: Number(row.odds_american),
      point: Number.isFinite(point) ? point : null,
      _main: row.is_main_line === true,
    });
  }

  const events = [];
  for (const ev of byEvent.values()) {
    const bookmakers = [];
    for (const book of ev.bookmakers.values()) {
      const markets = [];
      for (const market of book.markets.values()) {
        let outcomes = market.outcomes;
        if (market.key === "spreads" || market.key === "totals") {
          const mainOut = outcomes.filter((o) => o._main);
          outcomes = mainOut.length ? mainOut : outcomes;
          if (market.key === "spreads" && sportId === "mlb") {
            const homeRows = outcomes.filter((o) => namesMatch(o.name, ev.home_team) && o.point != null);
            const awayRows = outcomes.filter((o) => namesMatch(o.name, ev.away_team) && o.point != null);
            const pair = pickExactRunLinePair(homeRows, awayRows, sportId);
            if (pair) {
              outcomes = [
                { name: ev.home_team, price: pair.home.price, point: pair.point },
                { name: ev.away_team, price: pair.away.price, point: -pair.point },
              ];
            }
          }
          if (market.key === "totals") {
            const overs = outcomes.filter((o) => /over/i.test(o.name) && o.point != null);
            const unders = outcomes.filter((o) => /under/i.test(o.name) && o.point != null);
            const pair = pairTotalSides(overs, unders);
            if (pair) {
              outcomes = [
                { name: "Over", price: pair.over.price, point: pair.point },
                { name: "Under", price: pair.under.price, point: pair.point },
              ];
            }
          }
        }
        markets.push({
          key: market.key,
          outcomes: outcomes.map(({ name, price, point }) => ({
            name,
            price,
            ...(point == null ? {} : { point }),
          })),
        });
      }
      if (markets.length) bookmakers.push({ key: book.key, title: book.title, markets });
    }
    if (!bookmakers.length) continue;
    events.push({
      id: ev.id,
      home_team: ev.home_team,
      away_team: ev.away_team,
      commence_time: ev.commence_time,
      bookmakers,
      softSource: "sharpapi",
    });
  }
  return events;
}

/**
 * Fetch soft FG odds for one sport. One request per market key (≤3) to avoid
 * alternate-line flood eating the free-tier page size.
 */
export async function fetchSharpApiOdds(sportId, apiKey) {
  if (!apiKey) {
    return { events: [], error: "sharpapi-no-api-key", credits: { remaining: null, used: null, asOf: null } };
  }
  const cfg = SHARPAPI_SPORT[sportId];
  if (!cfg) {
    return { events: [], error: `sharpapi-unsupported-sport:${sportId}`, credits: { remaining: null, used: null, asOf: null } };
  }

  const allRows = [];
  let credits = { remaining: null, limit: null, tier: null, asOf: null };
  let lastError = null;

  for (const market of cfg.markets) {
    const page = await fetchOddsPage(apiKey, {
      league: cfg.league,
      market,
      sportsbook: SOFT_BOOKS.join(","),
      limit: 200,
    });
    credits = page.credits || credits;
    if (page.error) {
      lastError = page.error;
      if (page.status === 401 || page.status === 403 || page.status === 429) break;
      continue;
    }
    const rows = preferMain(page.rows);
    allRows.push(...rows);
  }

  const events = sharpRowsToEvents(allRows, sportId);
  if (!events.length) {
    return {
      events: [],
      error: lastError || "sharpapi-empty",
      credits,
      soft: true,
      free: true,
      books: SOFT_BOOKS,
    };
  }
  return {
    events,
    error: null,
    credits,
    soft: true,
    free: true,
    books: SOFT_BOOKS,
  };
}
