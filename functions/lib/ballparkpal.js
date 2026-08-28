/** Ballpark Pal — matchup data only. Never a sportsbook. Never a price. */

import { readCache, writeCache } from "./cache.js";
import { canonAbbr, resolveMlbCanon, sameMlbTeam } from "./mlbCanonical.js";

const BASE = "https://www.ballparkpal.com/api/v1";
const TTL_MS = 4 * 60 * 60 * 1000;
const CACHE_VER = "bpp-v8";
const DH_WINDOW_MS = 6 * 60 * 60 * 1000;
const DH_AMBIGUOUS_MS = 45 * 60 * 1000;
const REQUEST_GAP_MS = 1100;
const MAX_429_RETRIES = 2;
let nextRequestAt = 0;
let fetchQueue = Promise.resolve();
const inFlight = new Map();

function dateInZone(now, tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date(now));
}

export function palDateET(now = new Date()) {
  return dateInZone(now, "America/New_York");
}

export function palQueryDates(slateDate, now = new Date()) {
  const ctToday = dateInZone(now, "America/Chicago");
  const etToday = palDateET(now);
  const dates = [slateDate].filter(Boolean);
  if (slateDate === ctToday && etToday !== ctToday) dates.push(etToday);
  return [...new Set(dates)];
}

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

export function palErrorFromBody(json, httpStatus) {
  if (httpStatus && Number(httpStatus) >= 400) {
    const msg = json?.error?.message || json?.error?.code || json?.error || `HTTP ${httpStatus}`;
    return { code: json?.error?.code || String(httpStatus), message: String(msg), httpStatus: Number(httpStatus) };
  }
  if (json?.error) {
    const msg = json.error.message || json.error.code || json.error;
    return { code: json.error.code || "pal-error", message: String(msg), httpStatus: httpStatus || 200 };
  }
  return null;
}

export class PalHttpError extends Error {
  constructor(httpStatus, message, code) {
    super(message);
    this.name = "PalHttpError";
    this.httpStatus = Number(httpStatus) || null;
    this.code = code || null;
  }
}

/** Actual Pal HTTP status for SYS `last_pal_http_status` — 200 and 401, never a fake 200 on auth failure. */
export function palHttpStatusFromError(err) {
  const n = Number(err?.httpStatus);
  if (Number.isFinite(n) && n > 0) return n;
  const msg = String(err?.message || err || "");
  const tagged = msg.match(/Ballpark Pal (\d{3})/);
  if (tagged) return Number(tagged[1]);
  const bare = msg.match(/\b(401|403|404|429|5\d\d)\b/);
  return bare ? Number(bare[1]) : null;
}

export function palHttpStatusToStore(palMeta) {
  const n = Number(palMeta?.httpStatus);
  if (Number.isFinite(n) && n > 0) return String(Math.trunc(n));
  if (palMeta?.error || palMeta?.reason === "upstream-error") return "";
  if (palMeta?.enabled === false) return "";
  return "200";
}

function attachMeta(data, meta) {
  if (data && typeof data === "object") data._meta = meta;
  return data;
}

function asList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.games)) return raw.games;
  if (Array.isArray(raw?.parkFactors)) return raw.parkFactors;
  if (Array.isArray(raw?.matchups)) return raw.matchups;
  if (Array.isArray(raw?.teams)) return raw.teams;
  return [];
}

/** Fill missing Pal prop names from confirmed starters only. */
export function fillPalPropNamesFromKnownPlayers(game) {
  const known = new Map();
  if (game?.homeSp?.id != null && game.homeSp.name) known.set(Number(game.homeSp.id), game.homeSp.name);
  if (game?.awaySp?.id != null && game.awaySp.name) known.set(Number(game.awaySp.id), game.awaySp.name);
  return {
    ...game,
    props: (game?.props || []).map((prop) => {
      if (prop?.playerName) return prop;
      const name = known.get(Number(prop?.playerId));
      return name ? { ...prop, playerName: name } : prop;
    }),
  };
}

/** Names for Pal player IDs that Pal omitted. Only unnamed IDs — not a full roster crawl. */
async function fetchMissingMlbPlayerNames(ids) {
  const unique = [...new Set((ids || []).map(Number).filter(Number.isFinite))];
  if (!unique.length) return new Map();
  const chunks = [];
  for (let i = 0; i < unique.length; i += 150) chunks.push(unique.slice(i, i + 150));
  const batches = await Promise.all(
    chunks.map(async (part) => {
      const url = new URL("https://statsapi.mlb.com/api/v1/people");
      url.searchParams.set("personIds", part.join(","));
      url.searchParams.set("fields", "people,id,fullName,primaryPosition,abbreviation");
      try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return [];
        return (await res.json())?.people || [];
      } catch {
        return [];
      }
    })
  );
  return new Map(
    batches.flat().map((p) => [Number(p.id), { playerName: p.fullName || null, position: p.primaryPosition?.abbreviation || null }])
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lastName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts[parts.length - 1] || "";
}

export function sameAbv(a, b) {
  return sameMlbTeam(a, b);
}

export function palInstant(row) {
  if (!row) return null;
  const utc = row.gameTimeUTC || row.start || row.gameTimeIso;
  if (utc) {
    const t = Date.parse(utc);
    if (Number.isFinite(t)) return t;
  }
  const full = row.gameTimeFull;
  if (full && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(full))) {
    const t = Date.parse(`${String(full).replace(" ", "T")}-04:00`);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttledFetch(url, options) {
  const turn = fetchQueue.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await sleep(wait);
    nextRequestAt = Date.now() + REQUEST_GAP_MS;
    return fetch(url, options);
  });
  fetchQueue = turn.then(() => undefined, () => undefined);
  return turn;
}

async function bppGet(path, apiKey) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const requestKey = `${url}:${String(apiKey || "").slice(-8)}`;
  if (inFlight.has(requestKey)) return inFlight.get(requestKey);
  const job = (async () => {
    let res;
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
      res = await throttledFetch(url, {
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
      });
      if (res.status !== 429 || attempt === MAX_429_RETRIES) break;
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1));
    }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const palErr = palErrorFromBody(json, res.status);
  if (palErr) {
    throw new PalHttpError(palErr.httpStatus, `Ballpark Pal ${palErr.httpStatus}: ${palErr.message}`, palErr.code);
  }
  if (!res.ok) {
    throw new PalHttpError(res.status, `Ballpark Pal ${res.status}: ${text.slice(0, 180)}`);
  }
  const { data, meta } = unwrapPalResponse(json);
  return attachMeta(data, { ...(meta || {}), httpStatus: res.status });
  })();
  inFlight.set(requestKey, job);
  try {
    return await job;
  } finally {
    inFlight.delete(requestKey);
  }
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

export function compactPalMarkets(items, homeId, awayId) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const mkt = (row) => String(row?.marketId || row?.marketKey || row?.market || row?.mkt || "");
  const teamOf = (row) => Number(row?.teamId ?? row?.team_id ?? row?.subject?.id);
  const sideOf = (row) => String(row?.side || "").toLowerCase();
  const lineOf = (row) => Number(row?.line);
  const pOf = (row) => num(row?.probability ?? row?.p);
  const hasTeam = (row) => {
    const tid = row?.teamId ?? row?.team_id ?? (row?.subject?.type === "team" ? row?.subject?.id : null);
    return tid != null && tid !== "" && Number(tid) > 0;
  };
  const isMarket = (row, id) => mkt(row) === id || mkt(row).startsWith(`${id}:`);
  const mlHome = list.find((r) => isMarket(r, "mkt_1") && teamOf(r) === Number(homeId) && sideOf(r) === "over" && lineOf(r) === 0.5);
  const mlAway = list.find((r) => isMarket(r, "mkt_1") && teamOf(r) === Number(awayId) && sideOf(r) === "over" && lineOf(r) === 0.5);
  const totals = {};
  for (const r of list) {
    const market = mkt(r);
    if (hasTeam(r)) continue;
    if (!isMarket(r, "mkt_2")) continue;
    const line = lineOf(r);
    if (!Number.isFinite(line)) continue;
    const key = String(line);
    if (!totals[key]) totals[key] = { over: null, under: null };
    if (sideOf(r) === "over") totals[key].over = pOf(r);
    if (sideOf(r) === "under") totals[key].under = pOf(r);
  }
  const teamTotals = {};
  const propMap = new Map();
  const unknown = [];
  for (const r of list) {
    const market = mkt(r);
    const line = lineOf(r);
    const subject = r?.subject || null;
    if (market === "mkt_5" && hasTeam(r) && Number.isFinite(line)) {
      const key = `${teamOf(r)}:${line}`;
      if (!teamTotals[key]) teamTotals[key] = { teamId: teamOf(r), line, over: null, under: null, average: num(r?.average), marketId: market, displayName: r?.displayName || "Team Total Runs" };
      if (sideOf(r) === "over") teamTotals[key].over = pOf(r);
      if (sideOf(r) === "under") teamTotals[key].under = pOf(r);
      continue;
    }
    if (subject?.type === "player" || r?.playerId != null) {
      const playerId = subject?.id ?? r?.playerId ?? null;
      const key = `${market}:${playerId}:${Number.isFinite(line) ? line : ""}`;
      if (!propMap.has(key)) {
        propMap.set(key, {
          marketId: market || null,
          displayName: r?.displayName || null,
          playerId,
          playerName: subject?.name ?? r?.playerName ?? null,
          subjectType: subject?.type || "player",
          teamId: teamOf(r) || null,
          line: Number.isFinite(line) ? line : null,
          over: null,
          under: null,
          average: num(r?.average),
        });
      }
      const packed = propMap.get(key);
      if (sideOf(r) === "over") packed.over = pOf(r);
      if (sideOf(r) === "under") packed.under = pOf(r);
      continue;
    }
    if (market && market !== "mkt_1" && market !== "mkt_2" && market !== "mkt_5") {
      unknown.push({ marketId: market, displayName: r?.displayName || null, teamId: hasTeam(r) ? teamOf(r) : null, line: Number.isFinite(line) ? line : null, side: sideOf(r) || null });
    }
  }
  const pHome = pOf(mlHome);
  const pAway = pOf(mlAway);
  const props = [...propMap.values()];
  if (pHome == null && pAway == null && !Object.keys(totals).length && !Object.keys(teamTotals).length && !props.length) return null;
  return {
    pHome,
    pAway,
    totals,
    teamTotals: Object.values(teamTotals),
    props,
    unknown,
    // Pal currently exposes no explicitly identified game run-line market.
    // Never infer one from team totals or player props.
    runLine: null,
  };
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
  return list.find((p) => sameMlbTeam({ abbr: p.pitcherTeam }, { abbr: teamAbv })) || null;
}

function matchupForm(homeMu, awayMu) {
  if (homeMu?.rcVs == null && awayMu?.rcVs == null) return null;
  const net = (homeMu?.rcVs || 0) - (awayMu?.rcVs || 0);
  return 0.5 + Math.max(-0.12, Math.min(0.12, net / 200));
}

function packGame(bppGame, averages, park, matchupRows, teamsById) {
  const homeId = Number(bppGame.teamHomeId ?? bppGame.homeId);
  const awayId = Number(bppGame.teamAwayId ?? bppGame.awayId);
  const homeTeam = teamsById.get(homeId);
  const awayTeam = teamsById.get(awayId);
  const teamRows = averages?.teams || [];
  const homeT = teamRows.find((t) => Number(t.teamId) === homeId) || null;
  const awayT = teamRows.find((t) => Number(t.teamId) === awayId) || null;
  const pitchers = (averages?.pitchers || []).filter((p) => p.isStarter);
  const homeSp = pitchers.find((p) => Number(p.teamId) === homeId) || null;
  const awaySp = pitchers.find((p) => Number(p.teamId) === awayId) || null;
  const homeAbv =
    canonAbbr(homeTeam?.abv || park?.teamHome || homeT?.team) ||
    resolveMlbCanon({ mlbId: homeId, abbr: homeTeam?.abv, name: homeTeam?.nickname }) ||
    "";
  const awayAbv =
    canonAbbr(awayTeam?.abv || park?.teamAway || awayT?.team) ||
    resolveMlbCanon({ mlbId: awayId, abbr: awayTeam?.abv, name: awayTeam?.nickname }) ||
    "";

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
  const asOf = averages?._meta?.asOf || averages?.asOf || bppGame.asOf || null;
  const requestId = averages?._meta?.requestId || averages?.requestId || bppGame.requestId || null;
  const startMs = palInstant(bppGame);
  const start = startMs != null ? new Date(startMs).toISOString() : bppGame.gameTimeUTC || null;

  return {
    bppId: bppGame.gameId,
    gamePk: bppGame.gameId,
    homeId,
    awayId,
    homeAbv,
    awayAbv,
    homeCanon: resolveMlbCanon({ mlbId: homeId, abbr: homeAbv, name: homeTeam?.nickname || homeTeam?.city }),
    awayCanon: resolveMlbCanon({ mlbId: awayId, abbr: awayAbv, name: awayTeam?.nickname || awayTeam?.city }),
    start,
    gameDate: bppGame.gameDate || null,
    lineupsOfficial: Boolean(averages?.lineupsOfficial ?? bppGame.lineupsOfficial),
    asOf,
    requestId,
    homeRuns,
    awayRuns,
    pHome: markets?.pHome ?? null,
    pAway: markets?.pAway ?? null,
    totals: markets?.totals || null,
    runLine: markets?.runLine || null,
    teamTotals: markets?.teamTotals || [],
    props: markets?.props || [],
    unknownMarkets: markets?.unknown || [],
    matchupForm: form,
    usable: Boolean(homeAbv && awayAbv),
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

function emptyPalMeta(extra = {}) {
  return {
    enabled: true,
    cached: false,
    recordsReturned: 0,
    usable: 0,
    games: 0,
    matchups: 0,
    asOf: null,
    requestId: null,
    httpStatus: extra.httpStatus != null ? extra.httpStatus : null,
    stage: extra.stage || null,
    reason: extra.reason || null,
    error: extra.error || null,
    dates: extra.dates || [],
    ...extra,
  };
}

async function fetchPalDate(date, apiKey) {
  const [gamesRaw, parkRaw, matchRaw, teamsRaw] = await Promise.all([
    bppGet(`/games?date=${date}`, apiKey),
    bppGet(`/parkfactors?date=${date}`, apiKey).catch(() => []),
    bppGet(`/matchups?date=${date}&starters=true&parkAdjusted=true`, apiKey).catch(() => []),
    bppGet("/teams", apiKey).catch(() => []),
  ]);
  return { gamesRaw, parkRaw, matchRaw, teamsRaw };
}

export async function fetchBallparkPal(date, apiKey, cfCache, opts = {}) {
  if (!apiKey) {
    return { games: [], meta: emptyPalMeta({ enabled: false, reason: "no-api-key", stage: "credential" }) };
  }
  const dates = palQueryDates(date);
  const cacheKey = `${CACHE_VER}:${dates.join(",")}`;
  const cached = await readCache(cacheKey, cfCache, TTL_MS);
  if (cached) return { ...cached, meta: { ...cached.meta, cached: true, cacheAgeMs: Date.now() - (cached.meta?.cachedAtMs || Date.now()) } };
  if (opts.cacheOnly) {
    return {
      games: [],
      meta: emptyPalMeta({
        enabled: true,
        cached: false,
        skipped: true,
        reason: "cache-only",
        stage: "request",
        dates,
      }),
    };
  }

  try {
    const batches = [];
    const errors = [];
    let httpStatus = null;
    for (const day of dates) {
      try {
        const batch = await fetchPalDate(day, apiKey);
        batches.push(batch);
        httpStatus = httpStatus || batch.gamesRaw?._meta?.httpStatus || 200;
      } catch (err) {
        httpStatus = httpStatus || palHttpStatusFromError(err);
        errors.push(`${day}: ${err.message || err}`);
      }
    }
    if (!batches.length) {
      return {
        games: [],
        meta: emptyPalMeta({
          enabled: true,
          error: errors[0] || "Pal request failed",
          reason: "upstream-error",
          stage: "http",
          dates,
          errors: errors.slice(0, 3),
          httpStatus,
        }),
      };
    }

    const gamesById = new Map();
    const parks = [];
    const matchups = [];
    let teams = [];
    let slateAsOf = null;
    let slateRequestId = null;
    for (const batch of batches) {
      const games = asList(batch.gamesRaw);
      slateAsOf = slateAsOf || batch.gamesRaw?._meta?.asOf || null;
      slateRequestId = slateRequestId || batch.gamesRaw?._meta?.requestId || null;
      for (const g of games) {
        if (g?.gameId == null) continue;
        gamesById.set(Number(g.gameId), g);
      }
      parks.push(...asList(batch.parkRaw));
      matchups.push(...asList(batch.matchRaw));
      const t = asList(batch.teamsRaw);
      if (t.length) teams = t;
    }

    const gameList = [...gamesById.values()];
    const teamsById = indexTeams(teams);
    const parkByGame = new Map(parks.map((p) => [Number(p.gameId), p]));
    const muByGame = new Map();
    for (const row of matchups) {
      const id = Number(row.gameId);
      if (!muByGame.has(id)) muByGame.set(id, []);
      muByGame.get(id).push(row);
    }

    const packed = [];
    const avgErrors = [];
    const chunk = 5;
    for (let i = 0; i < gameList.length; i += chunk) {
      const slice = gameList.slice(i, i + chunk);
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
        if (!avg.ok) avgErrors.push(avg.error);
        const packedGame = packGame(
            { ...g, asOf: slateAsOf, requestId: slateRequestId },
            {
              teams: asList(data.teams) || data.teams || [],
              pitchers: asList(data.pitchers) || data.pitchers || [],
              lineupsOfficial: data.lineupsOfficial ?? data._meta?.lineupsOfficial,
              asOf: data._meta?.asOf || data.asOf || slateAsOf,
              requestId: data._meta?.requestId || data.requestId || slateRequestId,
              _meta: data._meta,
              probabilities: asList(probs),
            },
            parkByGame.get(Number(g.gameId)),
            muByGame.get(Number(g.gameId)) || [],
            teamsById
          );
        packed.push(packedGame);
      });
    }

    for (let i = 0; i < packed.length; i += 1) packed[i] = fillPalPropNamesFromKnownPlayers(packed[i]);
    const missingIds = packed.flatMap((g) => (g.props || []).filter((p) => !p.playerName && p.playerId != null).map((p) => p.playerId));
    if (missingIds.length) {
      const playersById = await fetchMissingMlbPlayerNames(missingIds);
      for (let i = 0; i < packed.length; i += 1) {
        packed[i] = {
          ...packed[i],
          props: (packed[i].props || []).map((prop) => {
            if (prop.playerName) return prop;
            const player = playersById.get(Number(prop.playerId));
            return player?.playerName ? { ...prop, playerName: player.playerName, position: player.position || null } : prop;
          }),
        };
      }
    }
    const usable = packed.filter((g) => g.homeCanon && g.awayCanon);
    const payload = {
      games: packed,
      meta: {
        enabled: true,
        cached: false,
        cachedAtMs: Date.now(),
        stage: "records",
        recordsReturned: packed.length,
        usable: usable.length,
        games: packed.length,
        matchups: matchups.length,
        asOf: slateAsOf,
        requestId: slateRequestId,
        dates,
        httpStatus: httpStatus || 200,
        reason: packed.length ? null : "no-records-returned",
        errors: [...errors, ...avgErrors].filter(Boolean).slice(0, 3),
      },
    };
    await writeCache(cacheKey, payload, cfCache, TTL_MS);
    return payload;
  } catch (err) {
    return {
      games: [],
      meta: emptyPalMeta({
        enabled: true,
        error: String(err.message || err),
        reason: "upstream-error",
        stage: "http",
        dates,
        httpStatus: palHttpStatusFromError(err),
      }),
    };
  }
}

function teamPairKey(homeCanon, awayCanon) {
  return `${awayCanon}@${homeCanon}`;
}

function fbisCanon(game) {
  return {
    home: resolveMlbCanon(game.home || {}),
    away: resolveMlbCanon(game.away || {}),
  };
}

function nearestCandidate(game, bppGames) {
  const start = Date.parse(game.start || "");
  let best = null;
  let bestDt = Infinity;
  for (const b of bppGames || []) {
    const t = palInstant(b);
    const dt = Number.isFinite(start) && t != null ? Math.abs(t - start) : Infinity;
    if (dt < bestDt) {
      bestDt = dt;
      best = b;
    }
  }
  return { pal: best, dtMs: Number.isFinite(bestDt) ? bestDt : null };
}

/**
 * Both teams required. GamePk is preferred. Pitchers optional.
 * Doubleheaders use start instants — never an unrestricted window.
 */
export function matchPalSlate(games, bppGames) {
  const pal = bppGames || [];
  const used = new Set();
  const matched = [];
  const unmatched = [];
  const ambiguous = [];

  for (const g of games || []) {
    const { home, away } = fbisCanon(g);
    const pk = Number(g.id);
    const start = Date.parse(g.start || "");
    const byPk = Number.isFinite(pk)
      ? pal.filter((b) => Number(b.bppId ?? b.gamePk ?? b.gameId) === pk)
      : [];
    let chosen = null;
    let reason = null;

    if (byPk.length === 1) {
      chosen = byPk[0];
    } else if (byPk.length > 1) {
      reason = "ambiguous";
      ambiguous.push({ gameId: g.id, reason, palIds: byPk.map((b) => b.bppId) });
    } else if (!home || !away) {
      reason = "team-mismatch";
    } else {
      const both = pal.filter((b) => b.homeCanon === home && b.awayCanon === away && !used.has(b.bppId));
      if (!both.length) {
        const flipped = pal.filter((b) => b.homeCanon === away && b.awayCanon === home && !used.has(b.bppId));
        if (flipped.length) reason = "home-away-orientation";
        else reason = "team-mismatch";
      } else if (both.length === 1 && !Number.isFinite(start)) {
        chosen = both[0];
      } else {
        const timed = both
          .map((b) => ({ b, t: palInstant(b) }))
          .filter((x) => x.t != null && Number.isFinite(start))
          .map((x) => ({ ...x, dt: Math.abs(x.t - start) }))
          .filter((x) => x.dt <= DH_WINDOW_MS)
          .sort((a, b) => a.dt - b.dt);
        if (!timed.length && both.length === 1) {
          chosen = both[0];
        } else if (!timed.length) {
          reason = both.length > 1 ? "ambiguous" : "date-mismatch";
          if (both.length > 1) ambiguous.push({ gameId: g.id, reason: "doubleheader-no-time", palIds: both.map((b) => b.bppId) });
        } else if (timed.length > 1 && Math.abs(timed[0].dt - timed[1].dt) < DH_AMBIGUOUS_MS && timed[0].dt > 20 * 60 * 1000) {
          reason = "ambiguous";
          ambiguous.push({ gameId: g.id, reason: "doubleheader", palIds: timed.map((x) => x.b.bppId) });
        } else {
          chosen = timed[0].b;
        }
      }
    }

    if (chosen && used.has(chosen.bppId) && Number(chosen.bppId) !== pk) {
      reason = "ambiguous";
      chosen = null;
      ambiguous.push({ gameId: g.id, reason: "pal-row-already-used", palIds: [chosen?.bppId] });
    }

    if (chosen) {
      used.add(chosen.bppId);
      matched.push({ game: g, pal: chosen });
    } else {
      const near = nearestCandidate(g, pal);
      unmatched.push({
        gameId: g.id,
        palAway: near.pal?.awayAbv || null,
        palHome: near.pal?.homeAbv || null,
        fbisAway: g.away?.abbr || null,
        fbisHome: g.home?.abbr || null,
        palAwayCanon: near.pal?.awayCanon || null,
        palHomeCanon: near.pal?.homeCanon || null,
        fbisAwayCanon: away,
        fbisHomeCanon: home,
        teamMatch: home && away && near.pal ? near.pal.homeCanon === home && near.pal.awayCanon === away : false,
        dateDiff: near.pal?.gameDate && g.start ? `${near.pal.gameDate} vs ${String(g.start).slice(0, 10)}` : null,
        timeDiffMs: near.dtMs,
        reason: reason || "team-mismatch",
      });
    }
  }

  return {
    matched,
    unmatched,
    ambiguous,
    summary: {
      mlbGames: (games || []).length,
      palRecords: pal.length,
      palUsable: pal.filter((b) => b.homeCanon && b.awayCanon).length,
      matched: matched.length,
      unmatched: unmatched.length,
      ambiguous: ambiguous.length,
    },
  };
}

export function matchBpp(game, bppGames) {
  const report = matchPalSlate([game], bppGames);
  if (report.ambiguous.length) return null;
  return report.matched[0]?.pal || null;
}

/** Slate/TODAY/SYS view. Pal `meta.unmatched` is a count; sample arrays live on unmatchedSample. */
export function palSlateView(pal) {
  const meta = pal?.meta && typeof pal.meta === "object" ? pal.meta : pal || { enabled: false };
  const unmatchedSample = Array.isArray(pal?.unmatched)
    ? pal.unmatched.slice(0, 8)
    : Array.isArray(pal?.unmatchedSample)
      ? pal.unmatchedSample.slice(0, 8)
      : [];
  const ambiguousSample = Array.isArray(pal?.ambiguous)
    ? pal.ambiguous.slice(0, 8)
    : Array.isArray(pal?.ambiguousSample)
      ? pal.ambiguousSample.slice(0, 8)
      : [];
  return {
    ...meta,
    meta,
    match: pal?.match || null,
    unmatchedSample,
    ambiguousSample,
  };
}

export function mergeBallparkPal(games, bpp) {
  const list = bpp?.games || [];
  const report = matchPalSlate(games, list);
  const byGame = new Map(report.matched.map((m) => [String(m.game.id), m.pal]));
  if (bpp && typeof bpp === "object") {
    bpp.match = report.summary;
    bpp.unmatched = report.unmatched.slice(0, 24);
    bpp.ambiguous = report.ambiguous.slice(0, 12);
    if (bpp.meta) {
      bpp.meta.matched = report.summary.matched;
      bpp.meta.unmatched = report.summary.unmatched;
      bpp.meta.ambiguous = report.summary.ambiguous;
      bpp.meta.mlbGames = report.summary.mlbGames;
      bpp.meta.recordsReturned = report.summary.palRecords;
      bpp.meta.usable = report.summary.palUsable;
      if (!report.summary.matched && bpp.meta.reason == null) {
        if (bpp.meta.skipped) bpp.meta.reason = "cache-only";
        else if (bpp.meta.error) bpp.meta.reason = "upstream-error";
        else if (!report.summary.palRecords) bpp.meta.reason = bpp.meta.reason || "no-records-returned";
        else bpp.meta.reason = "team-mismatch";
      }
    }
  }
  return games.map((g) => {
    const hit = byGame.get(String(g.id));
    if (!hit) return g;
    const homeSp = g.homeSp?.name ? g.homeSp : hit.homeSp;
    const awaySp = g.awaySp?.name ? g.awaySp : hit.awaySp;
    return {
      ...g,
      bpp: hit,
      homeSp,
      awaySp,
      palUnavailableReason: null,
    };
  });
}

export function palUnavailableReason(meta = {}, game = null) {
  if (game?.bpp?.homeRuns != null && game?.bpp?.awayRuns != null) return null;
  if (game?.bpp && (game.bpp.homeRuns == null || game.bpp.awayRuns == null)) return "projection-fields-missing";
  if (meta.enabled === false || meta.reason === "no-api-key") return "credential-missing";
  if (meta.error || meta.reason === "upstream-error") return "upstream-error";
  if (meta.reason === "cache-only" || meta.skipped) return "cache-only";
  if (meta.reason === "no-records-returned" || (meta.recordsReturned === 0 && !meta.skipped)) return "no-records-returned";
  if (meta.reason === "date-mismatch") return "date-mismatch";
  if (meta.reason === "ambiguous" || (meta.ambiguous || 0) > 0 && !(meta.matched || 0)) return "ambiguous-match";
  if (meta.reason === "team-mismatch" || (meta.unmatched || 0) > 0) return "team-mismatch";
  return meta.reason || "unavailable";
}
