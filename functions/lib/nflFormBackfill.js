/**
 * NFL team-form backfill from ESPN week scoreboards.
 *
 * Harvest only updates team_form when a game is already in the freeze ledger.
 * NFL freeze was historically skipped (no independent FBIS projection), so form
 * priors never accumulated — a circular dependency. This path writes form from
 * completed ESPN finals without requiring a prior freeze.
 *
 * Cloudflare Workers often get HTTP 403 from site.api.espn.com; prefer the CDN
 * scoreboard (same pattern as CFB) and fall back to site.web.api.
 */

import { applyFinalToForm } from "./store.js";
import { nflSeasonYear } from "./nflModel.js";

const ESPN_NFL_CDN =
  "https://cdn.espn.com/core/nfl/scoreboard";
const ESPN_NFL_WEB_API =
  "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** Regular-season weeks included when formWeeks is omitted. */
export const NFL_FORM_BACKFILL_WEEK_MAX = 18;

const FETCH_HEADERS = {
  Accept: "application/json,text/plain,*/*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Referer: "https://www.espn.com/nfl/scoreboard",
  "Accept-Language": "en-US,en;q=0.9",
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function competitor(comp, side) {
  return (comp?.competitors || []).find((c) => c.homeAway === side) || null;
}

function eventDate(event) {
  const iso = event?.date || event?.competitions?.[0]?.date;
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

/** Normalize site.api / site.web.api / CDN xhr payloads to an events[]. */
export function espnNflEvents(payload = {}) {
  if (Array.isArray(payload.events)) return payload.events;
  const sb = payload.content?.sbData;
  if (Array.isArray(sb?.events)) return sb.events;
  if (Array.isArray(payload.content?.events)) return payload.content.events;
  return [];
}

export function parseEspnNflFinals(payload = {}) {
  const out = [];
  for (const event of espnNflEvents(payload)) {
    const comp = event.competitions?.[0] || {};
    const status = comp.status?.type || {};
    if (!status.completed && status.state !== "post") continue;
    const homeC = competitor(comp, "home");
    const awayC = competitor(comp, "away");
    const homeScore = num(homeC?.score);
    const awayScore = num(awayC?.score);
    if (homeScore == null || awayScore == null) continue;
    const date = eventDate(event);
    out.push({
      gameId: String(event.id || comp.id || ""),
      date,
      season: date ? nflSeasonYear(date) : null,
      home: {
        name: homeC?.team?.displayName || homeC?.team?.name || null,
        abbr: homeC?.team?.abbreviation || null,
        espnId: homeC?.team?.id || homeC?.id || null,
      },
      away: {
        name: awayC?.team?.displayName || awayC?.team?.name || null,
        abbr: awayC?.team?.abbreviation || null,
        espnId: awayC?.team?.id || awayC?.id || null,
      },
      homeScore,
      awayScore,
    });
  }
  return out.filter((g) => g.gameId);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) {
    const err = new Error(`espn-nfl-scoreboard ${res.status} url=${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchEspnWeek(season, week, seasonType = 2) {
  // CDN accepts year= and is reachable from Cloudflare Workers (site.api often 403s).
  const cdnUrl =
    `${ESPN_NFL_CDN}?xhr=1&seasontype=${seasonType}&week=${week}&year=${season}&limit=300`;
  try {
    return await fetchJson(cdnUrl);
  } catch (cdnErr) {
    const webUrl =
      `${ESPN_NFL_WEB_API}?seasontype=${seasonType}&week=${week}&dates=${season}&limit=300`;
    try {
      return await fetchJson(webUrl);
    } catch (webErr) {
      throw new Error(
        `espn-nfl-scoreboard week=${week} season=${season} cdn=${cdnErr?.status || cdnErr?.message}; web=${webErr?.status || webErr?.message}`
      );
    }
  }
}

/**
 * Backfill NFL team_form for regular-season (and optional postseason) weeks.
 * Idempotent via team_form_games uniqueness inside applyFinalToForm.
 */
export async function backfillNflTeamForm(
  env,
  {
    season = nflSeasonYear(),
    weeks = null,
    includePostseason = true,
    fetchWeek = fetchEspnWeek,
    applyFinal = applyFinalToForm,
  } = {}
) {
  const seasonNum = Number(season);
  const regularWeeks = Array.isArray(weeks) && weeks.length
    ? weeks.map(Number)
    : Array.from({ length: NFL_FORM_BACKFILL_WEEK_MAX }, (_, i) => i + 1);
  const postWeeks = includePostseason ? [1, 2, 3, 4, 5] : [];
  const plan = [
    ...regularWeeks.map((week) => ({ seasonType: 2, week })),
    ...postWeeks.map((week) => ({ seasonType: 3, week })),
  ];

  let fetched = 0;
  let finals = 0;
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const { seasonType, week } of plan) {
    let payload;
    try {
      payload = await fetchWeek(seasonNum, week, seasonType);
      fetched += 1;
    } catch (err) {
      failed += 1;
      errors.push(String(err?.message || err));
      continue;
    }
    const games = parseEspnNflFinals(payload);
    finals += games.length;
    for (const g of games) {
      try {
        const res = await applyFinal(env, {
          sport: "nfl",
          season: Number(g.season || seasonNum),
          gameId: g.gameId,
          date: g.date,
          home: g.home,
          away: g.away,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
        });
        if (res?.skipped) skipped += 1;
        else if (res?.ok) applied += 1;
        else {
          failed += 1;
          if (res?.reason) errors.push(`${g.gameId}:${res.reason}`);
        }
      } catch (err) {
        failed += 1;
        errors.push(`${g.gameId}:${String(err?.message || err)}`);
      }
    }
  }

  return {
    // Partial ESPN/week failures are OK when some form rows applied — callers
    // chunk weeks to stay under Pages Function time limits.
    ok: failed === 0 || applied > 0,
    sport: "nfl",
    season: seasonNum,
    weeksFetched: fetched,
    finalsSeen: finals,
    formApplied: applied,
    formSkipped: skipped,
    formFailed: failed,
    errors: errors.slice(0, 20),
    note: "Independent of freeze ledger — seeds NFL-TEAM-FORM-v0 / NFL-FBIS-PURE research-v0-form priors",
  };
}
