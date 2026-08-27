/** Ballpark Pal — matchup data only. Never a sportsbook. Never a price. */

import { readCache, writeCache } from "./cache.js";

const BASE = "https://www.ballparkpal.com/api/v1";
const TTL_MS = 15 * 60 * 1000;
const CACHE_VER = "bpp-v3";

/** Pal wraps lists as `{ meta, data: { items } }`. Returning `data` itself dropped every game. */
export function unwrapPalResponse(json) {
  const meta = json?.meta || null;
  if (json == null) return { data: null, meta };
  if (Array.isArray(json)) return { data: json, meta };
  if (Array.isArray(json.data?.items)) return { data: json.data.items, meta };
  if (json.data != null) return { data: json.data, meta };
  if (Array.isArray(json.items)) return { data: json.items, meta };
  return { data: json, meta };
}

function attachMeta(data, meta) {
  if (data && typeof data === "object") data._meta = meta;
  return data;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lastName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts[parts.length - 1] || "";
}

function sameAbv(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase() && Boolean(a);
}

async function bppGet(path, apiKey) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error?.code || text.slice(0, 180);
    throw new Error(`Ballpark Pal ${res.status}: ${msg}`);
  }
  const { data, meta } = unwrapPalResponse(json);
  return attachMeta(data, meta);
}

function indexTeams(teams) {
  const byId = new Map();
  for (const t of teams || []) byId.set(Number(t.teamId ?? t.id), t);
  return byId;
}

function summarizeMatchups(rows) {
  const byPitcher = new Map();
  for (const r of rows || []) {
    const pid = r.pitcherId;
    if (pid == null) continue;
    if (!byPitcher.has(pid)) {
      byPitcher.set(pid, {
        pitcherId: pid,
        pitcherName: r.pitcherName,
        pitcherTeam: r.pitcherTeam,
        n: 0,
        hr: 0,
        k: 0,
        hrVs: 0,
        kVs: 0,
        rcVs: 0,
      });
    }
    const agg = byPitcher.get(pid);
    agg.n += 1;
    agg.hr += num(r.homeRunProbability) || 0;
    agg.k += num(r.strikeoutProbability) || 0;
    agg.hrVs += num(r.homeRunVsTypical) || 0;
    agg.kVs += num(r.strikeoutVsTypical) || 0;
    agg.rcVs += num(r.runsCreatedVsTypical) || 0;
  }
  return [...byPitcher.values()].map((a) => ({
    ...a,
    hr: a.n ? a.hr / a.n : null,
    k: a.n ? a.k / a.n : null,
    hrVs: a.n ? Math.round(a.hrVs / a.n) : null,
    kVs: a.n ? Math.round(a.kVs / a.n) : null,
    rcVs: a.n ? Math.round(a.rcVs / a.n) : null,
  }));
}

function compactPalMarkets(items, homeId, awayId) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const mkt = (row) => String(row?.marketId || row?.market || row?.mkt || "");
  const teamOf = (row) => Number(row?.teamId ?? row?.team_id);
  const sideOf = (row) => String(row?.side || "").toLowerCase();
  const lineOf = (row) => Number(row?.line);
  const pOf = (row) => num(row?.probability ?? row?.p);
  const hasTeam = (row) => {
    const tid = row?.teamId ?? row?.team_id;
    return tid != null && tid !== "" && Number(tid) > 0;
  };
  const mlHome = list.find((r) => mkt(r).includes("mkt_1") && teamOf(r) === Number(homeId) && sideOf(r) === "over" && lineOf(r) === 0.5);
  const mlAway = list.find((r) => mkt(r).includes("mkt_1") && teamOf(r) === Number(awayId) && sideOf(r) === "over" && lineOf(r) === 0.5);
  const totals = {};
  for (const r of list) {
    const market = mkt(r);
    if (hasTeam(r)) continue;
    if (!market.includes("mkt_2") && !/total/i.test(market)) continue;
    const line = lineOf(r);
    if (!Number.isFinite(line)) continue;
    const key = String(line);
    if (!totals[key]) totals[key] = { over: null, under: null };
    if (sideOf(r) === "over") totals[key].over = pOf(r);
    if (sideOf(r) === "under") totals[key].under = pOf(r);
  }
  const runLines = [];
  for (const r of list) {
    if (!hasTeam(r)) continue;
    const line = lineOf(r);
    if (!Number.isFinite(line)) continue;
    if (mkt(r).includes("mkt_1") && line === 0.5) continue;
    runLines.push({
      teamId: teamOf(r),
      line,
      side: sideOf(r),
      p: pOf(r),
      marketId: mkt(r),
    });
  }
  const pHome = pOf(mlHome);
  const pAway = pOf(mlAway);
  if (pHome == null && pAway == null && !Object.keys(totals).length && !runLines.length) return null;
  return { pHome, pAway, totals, runLine: runLines.length ? runLines : null };
}

function pickSide(list, sp, teamAbv) {
  if (!list.length) return null;
  if (sp?.id != null) {
    const hit = list.find((p) => Number(p.pitcherId) === Number(sp.id));
    if (hit) return hit;
  }
  if (sp?.name) {
    const hit = list.find((p) => lastName(p.pitcherName) === lastName(sp.name));
    if (hit) return hit;
  }
  return list.find((p) => sameAbv(p.pitcherTeam, teamAbv)) || null;
}

function matchupForm(homeMu, awayMu) {
  if (homeMu?.rcVs == null && awayMu?.rcVs == null) return null;
  const net = (homeMu?.rcVs || 0) - (awayMu?.rcVs || 0);
  return 0.5 + Math.max(-0.12, Math.min(0.12, net / 200));
}

function packGame(bppGame, averages, park, matchupRows, teamsById) {
  const homeId = Number(bppGame.teamHomeId);
  const awayId = Number(bppGame.teamAwayId);
  const homeTeam = teamsById.get(homeId);
  const awayTeam = teamsById.get(awayId);
  const teamRows = averages?.teams || [];
  const homeT = teamRows.find((t) => Number(t.teamId) === homeId) || null;
  const awayT = teamRows.find((t) => Number(t.teamId) === awayId) || null;
  const pitchers = (averages?.pitchers || []).filter((p) => p.isStarter);
  const homeSp = pitchers.find((p) => Number(p.teamId) === homeId) || null;
  const awaySp = pitchers.find((p) => Number(p.teamId) === awayId) || null;
  const homeAbv = homeTeam?.abv || homeT?.team || "";
  const awayAbv = awayTeam?.abv || awayT?.team || "";

  const packedSp = (sp) =>
    sp
      ? {
          id: sp.playerId,
          name: sp.playerName,
          last: lastName(sp.playerName),
          innings: num(sp.innings),
          k: num(sp.strikeouts),
        }
      : null;

  const homePacked = packedSp(homeSp);
  const awayPacked = packedSp(awaySp);
  const sides = summarizeMatchups(matchupRows);
  const vsAwaySp = pickSide(sides, awayPacked, awayAbv);
  const vsHomeSp = pickSide(sides, homePacked, homeAbv);
  const form = matchupForm(vsAwaySp, vsHomeSp);

  const homeF5Runs = num(homeT?.runsFirstFive);
  const awayF5Runs = num(awayT?.runsFirstFive);
  const homeRuns = num(homeT?.runs);
  const awayRuns = num(awayT?.runs);
  const markets = averages?.markets || compactPalMarkets(averages?.probabilities, homeId, awayId);
  const asOf = averages?._meta?.asOf || averages?.asOf || null;
  const requestId = averages?._meta?.requestId || averages?.requestId || null;

  return {
    bppId: bppGame.gameId,
    homeId,
    awayId,
    homeAbv,
    awayAbv,
    lineupsOfficial: Boolean(averages?.lineupsOfficial),
    asOf,
    requestId,
    homeRuns,
    awayRuns,
    pHome: markets?.pHome ?? null,
    pAway: markets?.pAway ?? null,
    totals: markets?.totals || null,
    runLine: markets?.runLine || null,
    matchupForm: form,
    f5: {
      homeRuns: homeF5Runs,
      awayRuns: awayF5Runs,
      total: homeF5Runs != null && awayF5Runs != null ? homeF5Runs + awayF5Runs : null,
      homeWin: num(homeT?.winFirstFiveProbability),
      awayWin: num(awayT?.winFirstFiveProbability),
    },
    homeSp: homePacked,
    awaySp: awayPacked,
    park: park
      ? {
          runsPct: num(park.runsPercent),
          hrPct: num(park.homeRunsPercent),
          runsAmt: num(park.runsAmount),
        }
      : null,
    matchup: {
      vsAwaySp: vsAwaySp
        ? { pitcher: vsAwaySp.pitcherName, hrVs: vsAwaySp.hrVs, kVs: vsAwaySp.kVs, rcVs: vsAwaySp.rcVs, n: vsAwaySp.n }
        : null,
      vsHomeSp: vsHomeSp
        ? { pitcher: vsHomeSp.pitcherName, hrVs: vsHomeSp.hrVs, kVs: vsHomeSp.kVs, rcVs: vsHomeSp.rcVs, n: vsHomeSp.n }
        : null,
    },
  };
}

export async function fetchBallparkPal(date, apiKey, cfCache) {
  if (!apiKey) {
    return { games: [], meta: { enabled: false } };
  }
  const cacheKey = `${CACHE_VER}:${date}`;
  const cached = await readCache(cacheKey, cfCache, TTL_MS);
  if (cached) return { ...cached, meta: { ...cached.meta, cached: true } };

  try {
    const [gamesRaw, parkRaw, matchRaw, teamsRaw] = await Promise.all([
      bppGet(`/games?date=${date}`, apiKey),
      bppGet(`/parkfactors?date=${date}`, apiKey).catch(() => []),
      bppGet(`/matchups?date=${date}&starters=true&parkAdjusted=true`, apiKey).catch(() => []),
      bppGet("/teams", apiKey).catch(() => []),
    ]);
    const games = Array.isArray(gamesRaw) ? gamesRaw : gamesRaw?.games || gamesRaw?.items || [];
    const parks = Array.isArray(parkRaw) ? parkRaw : parkRaw?.parkFactors || [];
    const matchups = Array.isArray(matchRaw) ? matchRaw : matchRaw?.matchups || [];
    const teams = Array.isArray(teamsRaw) ? teamsRaw : teamsRaw?.teams || [];
    const slateAsOf = gamesRaw?._meta?.asOf || null;
    const teamsById = indexTeams(teams);
    const parkByGame = new Map(parks.map((p) => [Number(p.gameId), p]));
    const muByGame = new Map();
    for (const row of matchups) {
      const id = Number(row.gameId);
      if (!muByGame.has(id)) muByGame.set(id, []);
      muByGame.get(id).push(row);
    }

    const packed = [];
    const errors = [];
    const chunk = 5;
    for (let i = 0; i < games.length; i += chunk) {
      const slice = games.slice(i, i + chunk);
      const avgs = await Promise.all(
        slice.map((g) =>
          Promise.all([
            bppGet(`/projections/averages?gameId=${g.gameId}`, apiKey)
              .then((data) => ({ ok: true, data }))
              .catch((err) => ({ ok: false, error: String(err.message || err) })),
            bppGet(`/projections/probabilities?gameId=${g.gameId}`, apiKey)
              .then((data) => data)
              .catch(() => null),
          ]).then(([avg, probs]) => ({ avg, probs }))
        )
      );
      slice.forEach((g, idx) => {
        const { avg, probs } = avgs[idx];
        const data = avg.ok ? avg.data || {} : {};
        if (!avg.ok) errors.push(avg.error);
        packed.push(
          packGame(
            g,
            {
              teams: data.teams || [],
              pitchers: data.pitchers || [],
              lineupsOfficial: data.lineupsOfficial,
              asOf: data._meta?.asOf || data.asOf,
              requestId: data._meta?.requestId || data.requestId,
              _meta: data._meta,
              probabilities: Array.isArray(probs) ? probs : probs?.items || [],
            },
            parkByGame.get(Number(g.gameId)),
            muByGame.get(Number(g.gameId)) || [],
            teamsById
          )
        );
      });
    }

    const payload = {
      games: packed,
      meta: {
        enabled: true,
        cached: false,
        games: packed.length,
        matchups: matchups.length,
        asOf: slateAsOf,
        requestId: gamesRaw?._meta?.requestId || null,
        errors: errors.slice(0, 3),
      },
    };
    await writeCache(cacheKey, payload, cfCache, TTL_MS);
    return payload;
  } catch (err) {
    return {
      games: [],
      meta: { enabled: true, error: String(err.message || err), cached: false },
    };
  }
}

export function matchBpp(game, bppGames) {
  const hid = Number(game.home?.mlbId);
  const aid = Number(game.away?.mlbId);
  if (hid && aid) {
    const hit = (bppGames || []).find((b) => b.homeId === hid && b.awayId === aid);
    if (hit) return hit;
  }
  const hn = String(game.home?.abbr || "").toLowerCase();
  const an = String(game.away?.abbr || "").toLowerCase();
  return (bppGames || []).find(
    (b) =>
      String(b.homeAbv || "").toLowerCase() === hn &&
      String(b.awayAbv || "").toLowerCase() === an
  );
}

export function mergeBallparkPal(games, bpp) {
  const list = bpp?.games || [];
  return games.map((g) => {
    const hit = matchBpp(g, list);
    if (!hit) return g;
    const homeSp = g.homeSp?.name ? g.homeSp : hit.homeSp;
    const awaySp = g.awaySp?.name ? g.awaySp : hit.awaySp;
    return {
      ...g,
      bpp: hit,
      homeSp,
      awaySp,
      park: hit.park,
    };
  });
}
