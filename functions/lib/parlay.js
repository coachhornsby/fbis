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
  pickRunLineRow,
  runLine,
  validAmerican,
} from "./books.js";

export const PARLAY_SPORT = {
  mlb: "baseball_mlb",
  nba: "basketball_nba",
  nfl: "americanfootball_nfl",
  cfb: "americanfootball_ncaaf",
  cbb: "basketball_ncaab",
};

const TTL_MS = 15 * 60 * 1000;
const EMPTY_F5_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_VER = "v4";

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\b(st)\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}

export function namesMatch(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const la = na.split(" ").pop();
  const lb = nb.split(" ").pop();
  return la === lb && la.length > 3;
}

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

  const pinHome = sideMl(pinH2h, home);
  const pinAway = sideMl(pinH2h, away);
  const herHome = sideMl(heritageH2h, home);
  const herAway = sideMl(heritageH2h, away);

  const pinSpread = pickRunLineRow(
    pinSpreads.filter((r) => namesMatch(r.name, home) && r.point != null),
    sportId
  );
  const herSpread = pickRunLineRow(
    heritageSpreads.filter((r) => namesMatch(r.name, home) && r.point != null),
    sportId
  );
  const pinOver = pinTotals.find((r) => /over/i.test(r.name) && r.point != null);
  const pinUnder = pinTotals.find((r) => /under/i.test(r.name) && r.point != null);
  const herOver = heritageTotals.find((r) => /over/i.test(r.name) && r.point != null);
  const pinAwaySpread = pickRunLineRow(
    pinSpreads.filter((r) => namesMatch(r.name, away) && r.point != null),
    sportId
  );

  const spread = pinSpread ? runLine(sportId, pinSpread.point) : herSpread ? runLine(sportId, herSpread.point) : null;
  const total = pinOver?.point ?? herOver?.point ?? null;
  const nick = String(home).split(" ").pop();
  const hasPin = Boolean(pinHome || pinSpread || pinOver);

  return {
    homeMl: herHome?.price ?? pinHome?.price ?? null,
    awayMl: herAway?.price ?? pinAway?.price ?? null,
    fairHomeMl: pinHome?.price ?? null,
    fairAwayMl: pinAway?.price ?? null,
    pinHomeMl: pinHome?.price ?? null,
    pinAwayMl: pinAway?.price ?? null,
    pinSpreadHomePrice: pinSpread?.price ?? null,
    pinSpreadAwayPrice: pinAwaySpread?.price ?? null,
    pinOverPrice: pinOver?.price ?? null,
    pinUnderPrice: pinUnder?.price ?? null,
    spread,
    spreadPrice: herSpread?.price ?? pinSpread?.price ?? null,
    total,
    totalPrice: herOver?.price ?? pinOver?.price ?? null,
    details: spread != null
      ? `${nick} ${spread > 0 ? "+" : ""}${spread}`
      : pinHome
        ? `${SHARP_BOOK} ML`
        : "",
    book: EXECUTION_BOOK,
    sharp: hasPin ? SHARP_BOOK : "",
    heritageListed: Boolean(herHome || herSpread || herOver),
    pinPresent: hasPin,
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
  const homeSpread = pickRunLineRow(
    useSpreads.filter((r) => namesMatch(r.name, home) && r.point != null),
    sportId,
    { f5: true }
  );
  const over = useTotals.find((r) => /over/i.test(r.name) && r.point != null);
  if (!homeMl && !homeSpread && !over) return null;
  return {
    homeMl: homeMl?.price ?? null,
    awayMl: awayMl?.price ?? null,
    spread: homeSpread ? runLine(sportId, homeSpread.point, { f5: true }) : null,
    total: over?.point ?? null,
    book: homeMl?.book || homeSpread?.book || over?.book || SHARP_BOOK,
    sharp: pinH2h.length || pinSpreads.length || pinTotals.length ? SHARP_BOOK : "",
  };
}

export function summarizeParlayEvent(event, sportId) {
  const books = event.bookmakers || [];
  const home = event.home_team;
  const away = event.away_team;
  const fg = packFg(books, sportId, home, away);
  const f5 = packF5(books, sportId, home, away);
  const kalshiH2h = outcomes(books, "h2h", (k) => k === "kalshi");
  return {
    parlayId: event.id,
    homeTeam: home,
    awayTeam: away,
    commence: event.commence_time,
    ...fg,
    f5,
    sentiment: sentimentFromKalshi(kalshiH2h, home, away),
    books: books.filter((b) => isPricingBook(b.key)).length,
  };
}

export function matchParlay(game, events) {
  return (
    (events || []).find(
      (e) => namesMatch(e.homeTeam, game.home.name) && namesMatch(e.awayTeam, game.away.name)
    ) ||
    (events || []).find(
      (e) => namesMatch(e.homeTeam, game.home.name) || namesMatch(e.awayTeam, game.away.name)
    )
  );
}

function applyOdds(game, p) {
  if (!p) return game;
  const odds = {
    ...game.odds,
    spread: p.spread,
    total: p.total,
    homeMl: p.homeMl,
    awayMl: p.awayMl,
    details: p.details || game.odds?.details || "",
    book: EXECUTION_BOOK,
    sharp: p.sharp || SHARP_BOOK,
    homeMlBook: EXECUTION_BOOK,
    awayMlBook: EXECUTION_BOOK,
    books: p.books,
    sentiment: p.sentiment || null,
    f5: p.f5 || game.odds?.f5 || null,
    heritageListed: p.heritageListed,
    pinPresent: p.pinPresent,
    pinHomeMl: p.pinHomeMl ?? p.fairHomeMl ?? null,
    pinAwayMl: p.pinAwayMl ?? p.fairAwayMl ?? null,
    pinSpreadHomePrice: p.pinSpreadHomePrice ?? null,
    pinSpreadAwayPrice: p.pinSpreadAwayPrice ?? null,
    pinOverPrice: p.pinOverPrice ?? null,
    pinUnderPrice: p.pinUnderPrice ?? null,
    spreadPrice: p.spreadPrice ?? null,
    totalPrice: p.totalPrice ?? null,
  };
  let projHome = game.projHomeScore;
  let projAway = game.projAwayScore;
  if (!BASEBALL.has(game.sport) && odds.total != null && odds.spread != null && game.bpp == null && !game.savant) {
    projHome = odds.total / 2 - odds.spread / 2;
    projAway = odds.total / 2 + odds.spread / 2;
  }
  return {
    ...game,
    odds,
    projHomeScore: projHome,
    projAwayScore: projAway,
    parlayId: p.parlayId,
    fairHomeMl: p.fairHomeMl,
    fairAwayMl: p.fairAwayMl,
    sentiment: p.sentiment || null,
  };
}

function initials(name) {
  const parts = String(name || "").split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.map((p) => p[0]).join("").slice(0, 3).toUpperCase();
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
    merged.push({
      id: p.parlayId,
      sport,
      start: p.commence,
      status: { state: "pre", detail: "Scheduled", completed: false, live: false },
      home: { name: p.homeTeam, abbr: initials(p.homeTeam), logo: "", score: null, rank: null, record: "", mlbId: null },
      away: { name: p.awayTeam, abbr: initials(p.awayTeam), logo: "", score: null, rank: null, record: "", mlbId: null },
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
        pinPresent: p.pinPresent,
        pinHomeMl: p.pinHomeMl ?? p.fairHomeMl ?? null,
        pinAwayMl: p.pinAwayMl ?? p.fairAwayMl ?? null,
        pinSpreadHomePrice: p.pinSpreadHomePrice ?? null,
        pinSpreadAwayPrice: p.pinSpreadAwayPrice ?? null,
        pinOverPrice: p.pinOverPrice ?? null,
        pinUnderPrice: p.pinUnderPrice ?? null,
        spreadPrice: p.spreadPrice ?? null,
        totalPrice: p.totalPrice ?? null,
      },
      espnHomeWinPct: null,
      projHomeScore: null,
      projAwayScore: null,
      venue: "",
      broadcast: "",
      notes: [],
      parlayId: p.parlayId,
      fairHomeMl: p.fairHomeMl,
      fairAwayMl: p.fairAwayMl,
      sentiment: p.sentiment || null,
    });
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

export async function fetchParlayOdds(sportId, apiKey, cfCache) {
  const sportKey = PARLAY_SPORT[sportId];
  if (!sportKey || !apiKey) {
    return { events: [], meta: { enabled: false, remaining: null, cached: false } };
  }
  const cacheKey = `${CACHE_VER}:odds:${sportKey}`;
  const cached = await readCache(cacheKey, cfCache, TTL_MS);
  if (cached) return { ...cached, meta: { ...cached.meta, cached: true } };

  const baseball = BASEBALL.has(sportId);
  const pin = await fetchJson(
    sportKey,
    {
      regions: "eu",
      markets: "h2h,spreads,totals",
      bookmakers: "pinnacle",
    },
    apiKey
  );
  if (pin.error && !pin.events.length) {
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
      },
    };
  }

  let combined = pin.events;
  let remaining = pin.credits.remaining;
  let used = pin.credits.used;
  let f5Games = 0;
  let sentimentGames = 0;

  const kalshiKey = `${CACHE_VER}:kalshi:${sportKey}`;
  let kalshiPayload = await readCache(kalshiKey, cfCache, EMPTY_F5_TTL_MS);
  if (!kalshiPayload) {
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
  if (kalshiPayload.events?.length) {
    combined = mergeByTeams(combined, kalshiPayload.events);
    sentimentGames = kalshiPayload.events.length;
  }

  if (baseball) {
    const f5Key = `${CACHE_VER}:f5:${sportKey}`;
    const f5Payload = await readCache(f5Key, cfCache, EMPTY_F5_TTL_MS);
    if (f5Payload?.events?.length) {
      combined = mergeByTeams(combined, f5Payload.events);
      f5Games = f5Payload.events.length;
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
      sportKey,
      games: events.length,
      pinGames: pin.events.length,
      sentimentGames,
      f5Games,
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
