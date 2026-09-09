/**
 * The Rundown free-tier soft odds backup.
 *
 * Free plan: BetMGM, DraftKings, FanDuel; pre-match full game only; 5-minute delay.
 * Never treat these as Pinnacle / pin* / CLV. Soft display lines only.
 */

import { namesMatch } from "./match.js";
import { pickExactRunLinePair, pairTotalSides, validAmerican } from "./books.js";

const BASE = "https://therundown.io/api/v2";
const SOFT_BOOKS = {
  19: "draftkings",
  22: "betmgm",
  23: "fanduel",
  30: "novig",
  34: "heritage",
};

export const THERUNDOWN_SPORT = {
  cfb: { sportId: 1 },
  nfl: { sportId: 2 },
  mlb: { sportId: 3 },
  nba: { sportId: 4 },
  cbb: { sportId: 5 },
};

function creditMeta(res) {
  const remaining = res.headers.get("x-datapoints-remaining");
  const limit = res.headers.get("x-datapoints-limit");
  const monthlyRemaining = res.headers.get("x-datapoints-monthly-remaining");
  return {
    remaining: remaining ? Number(remaining) : null,
    limit: limit ? Number(limit) : null,
    monthlyRemaining: monthlyRemaining ? Number(monthlyRemaining) : null,
    asOf: new Date().toISOString(),
  };
}

function isoDate(date) {
  if (!date) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const ts = Date.parse(date);
  return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function teamName(team) {
  if (!team) return null;
  return [team.name, team.mascot].filter(Boolean).join(" ").trim() || team.name || null;
}

function parsePoint(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bookTitle(key) {
  if (key === "fanduel") return "FanDuel";
  if (key === "draftkings") return "DraftKings";
  if (key === "betmgm") return "BetMGM";
  if (key === "novig") return "Novig";
  if (key === "heritage") return "Heritage";
  return key;
}

function pushBookOutcome(bookMap, key, marketKey, outcome) {
  if (!bookMap.has(key)) {
    bookMap.set(key, { key, title: bookTitle(key), markets: new Map() });
  }
  const book = bookMap.get(key);
  if (!book.markets.has(marketKey)) {
    book.markets.set(marketKey, { key: marketKey, outcomes: [] });
  }
  book.markets.get(marketKey).outcomes.push(outcome);
}

function priceEntries(prices = {}, allowKeys) {
  return Object.entries(prices)
    .map(([affiliateId, price]) => [SOFT_BOOKS[Number(affiliateId)] || null, price])
    .filter(([key, price]) => key && allowKeys.has(key) && validAmerican(price?.price));
}

export function theRundownEventsToParlay(events = [], sportId = "mlb") {
  const allowBooks = new Set(["draftkings", "betmgm", "fanduel", "novig", "heritage"]);
  const out = [];
  for (const event of events || []) {
    const teams = event.teams_normalized || event.teams || [];
    const home = teams.find((t) => t.is_home);
    const away = teams.find((t) => t.is_away);
    const homeName = teamName(home);
    const awayName = teamName(away);
    if (!homeName || !awayName) continue;

    const books = new Map();
    for (const market of event.markets || []) {
      const marketId = Number(market.market_id);
      if (![1, 2, 3].includes(marketId)) continue;
      for (const participant of market.participants || []) {
        for (const line of participant.lines || []) {
          for (const [bookKey, price] of priceEntries(line.prices, allowBooks)) {
            if (marketId === 1) {
              const name = namesMatch(participant.name, homeName) ? homeName : namesMatch(participant.name, awayName) ? awayName : null;
              if (!name) continue;
              pushBookOutcome(books, bookKey, "h2h", { name, price: Number(price.price) });
            } else if (marketId === 2) {
              const name = namesMatch(participant.name, homeName) ? homeName : namesMatch(participant.name, awayName) ? awayName : null;
              const point = parsePoint(line.value);
              if (!name || point == null) continue;
              pushBookOutcome(books, bookKey, "spreads", { name, price: Number(price.price), point });
            } else if (marketId === 3) {
              const point = parsePoint(line.value);
              if (point == null) continue;
              const name = /^over$/i.test(String(participant.name || "")) ? "Over" : /^under$/i.test(String(participant.name || "")) ? "Under" : null;
              if (!name) continue;
              pushBookOutcome(books, bookKey, "totals", { name, price: Number(price.price), point });
            }
          }
        }
      }
    }

    const bookmakers = [];
    for (const book of books.values()) {
      const markets = [];
      for (const market of book.markets.values()) {
        let outcomes = market.outcomes;
        if (market.key === "spreads" && sportId === "mlb") {
          const pair = pickExactRunLinePair(
            outcomes.filter((o) => namesMatch(o.name, homeName) && o.point != null),
            outcomes.filter((o) => namesMatch(o.name, awayName) && o.point != null),
            sportId
          );
          if (pair) {
            outcomes = [
              { name: homeName, price: pair.home.price, point: pair.point },
              { name: awayName, price: pair.away.price, point: -pair.point },
            ];
          }
        }
        if (market.key === "totals") {
          const pair = pairTotalSides(
            outcomes.filter((o) => /over/i.test(o.name) && o.point != null),
            outcomes.filter((o) => /under/i.test(o.name) && o.point != null)
          );
          if (pair) {
            outcomes = [
              { name: "Over", price: pair.over.price, point: pair.point },
              { name: "Under", price: pair.under.price, point: pair.point },
            ];
          }
        }
        if (outcomes.length) markets.push({ key: market.key, outcomes });
      }
      if (markets.length) bookmakers.push({ key: book.key, title: book.title, markets });
    }
    if (!bookmakers.length) continue;
    out.push({
      id: String(event.event_id || event.event_uuid),
      home_team: homeName,
      away_team: awayName,
      commence_time: event.event_date || null,
      bookmakers,
      softSource: "therundown",
    });
  }
  return out;
}

export async function fetchTheRundownOdds(sportId, apiKey, date) {
  if (!apiKey) {
    return { events: [], error: "therundown-no-api-key", credits: { remaining: null, limit: null, asOf: null } };
  }
  const cfg = THERUNDOWN_SPORT[sportId];
  if (!cfg) {
    return { events: [], error: `therundown-unsupported-sport:${sportId}`, credits: { remaining: null, limit: null, asOf: null } };
  }
  const url = new URL(`${BASE}/sports/${cfg.sportId}/events/${isoDate(date)}`);
  url.searchParams.set("market_ids", "1,2,3");
  url.searchParams.set("affiliate_ids", "19,22,23,30,34");
  url.searchParams.set("main_line", "true");
  url.searchParams.set("offset", "300");

  const res = await fetch(String(url), {
    headers: { Accept: "application/json", "X-TheRundown-Key": apiKey },
  });
  const credits = creditMeta(res);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    return {
      events: [],
      error: `TheRundown ${res.status}: ${text.slice(0, 180)}`,
      credits,
    };
  }
  const events = theRundownEventsToParlay(json?.events || [], sportId);
  return {
    events,
    error: null,
    credits,
    soft: true,
    free: true,
    books: ["draftkings", "betmgm", "fanduel"],
  };
}
