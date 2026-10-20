import nflTeams from "../../data/teams/nfl.js";
import nbaTeams from "../../data/teams/nba.js";
import nhlTeams from "../../data/teams/nhl.js";
import { nhlModelTeamCode } from "./nhlTeamCodes.js";

const ROSTER_CACHE = new Map();
const ROSTER_CACHE_MS = 15 * 60 * 1000;
const REGISTRIES = Object.freeze({ nfl: nflTeams, nba: nbaTeams, nhl: nhlTeams });
const ESPN_SPORT = Object.freeze({ nfl: "football", nba: "basketball" });
const normalize = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const safeText = value => String(value ?? "").trim();
const httpsImage = value => {
  const url = typeof value === "string" ? value : value?.href || value?.url || "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /(^|\.)((espncdn|nba|nhle)\.com)$/.test(parsed.hostname) ? parsed.href : null;
  } catch { return null; }
};

export function getProTeamDirectory(sport) {
  const league = safeText(sport).toLowerCase();
  if (!Object.hasOwn(REGISTRIES, league)) return null;
  return REGISTRIES[league].map(team => ({
    id: team.id,
    sport: league,
    abbr: team.abbr,
    name: team.displayName,
    displayName: team.displayName,
    espnId: team.espnId || team.sources?.espn?.id || null,
    logo: team.logo || null,
    color: team.color ? "#" + team.color.replace(/^#/, "") : null,
    altColor: team.altColor ? "#" + team.altColor.replace(/^#/, "") : null,
    division: team.division || null,
    conference: team.conference || null
  }));
}

export function resolveProTeam(sport, teamValue) {
  const list = getProTeamDirectory(sport);
  if (!list) return null;
  const query = normalize(teamValue);
  if (!query) return null;
  const official = sport === "nhl" ? normalize(nhlModelTeamCode(teamValue)) : query;
  const result = list.filter(t => [normalize(t.id), normalize(t.abbr), normalize(t.name), normalize(t.espnId), sport === "nhl" ? normalize(nhlModelTeamCode(t.abbr)) : ""].includes(query) ||
    (sport === "nhl" && normalize(nhlModelTeamCode(t.abbr)) === official));
  return result.length === 1 ? result[0] : null;
}

function parseEspnRoster(payload, sport) {
  const groups = Array.isArray(payload?.athletes) ? payload.athletes : [];
  const raw = groups.flatMap(g => Array.isArray(g?.items) ? g.items : g?.id && (g.displayName || g.fullName) ? [g] : []);
  const out = [], seen = new Set();
  for (const candidate of raw) {
    const p = candidate?.athlete || candidate;
    const id = safeText(p?.id);
    const name = safeText(p?.displayName || p?.fullName || [p?.firstName, p?.lastName].filter(Boolean).join(" "));
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const photo = httpsImage(p.headshot || p.headshot?.href || p.images?.[0]);
    const fallback = "https://a.espncdn.com/i/headshots/" + sport + "/players/full/" + encodeURIComponent(id) + ".png";
    out.push({
      id, sourcePlayerId: id, identitySource: "ESPN", playerKey: "espn:" + sport + ":" + id,
      name, position: safeText(p.position?.abbreviation || p.position?.name || p.position),
      jersey: safeText(p.jersey) || null,
      age: Number.isFinite(Number(p.age)) && p.age != null ? Number(p.age) : null,
      status: safeText(p.status?.name || p.status?.type || p.status) || null,
      headshotUrl: photo || fallback,
      headshotSource: photo ? "ESPN_ROSTER" : "ESPN_ID_CDN_CANDIDATE"
    });
  }
  return out;
}

function nhlName(value) {
  if (typeof value === "string") return safeText(value);
  return safeText(value?.default || value?.en);
}
function parseNhlRoster(payload) {
  const out = [], seen = new Set();
  for (const [group, position] of [["forwards", "F"], ["defensemen", "D"], ["goalies", "G"]]) {
    for (const p of payload?.[group] || []) {
      const id = safeText(p?.id || p?.playerId);
      const name = nhlName(p?.fullName) || [nhlName(p?.firstName), nhlName(p?.lastName)].filter(Boolean).join(" ");
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id, sourcePlayerId: id, identitySource: "NHL_OFFICIAL", playerKey: "nhl:" + id,
        name, position: safeText(p.positionCode || position),
        jersey: safeText(p.sweaterNumber) || null, age: null, status: null,
        headshotUrl: httpsImage(p.headshot),
        headshotSource: "NHL_OFFICIAL_ROSTER"
      });
    }
  }
  return out;
}

export function parseProRoster(sport, data) {
  if (sport === "nhl") return parseNhlRoster(data);
  if (sport === "nfl" || sport === "nba") return parseEspnRoster(data, sport);
  return [];
}

export function matchProRosterPlayer(players, name) {
  const needle = normalize(name);
  if (!needle) return null;
  const matches = (players || []).filter(p => normalize(p.name) === needle);
  return matches.length === 1 ? matches[0] : null;
}

export async function loadProTeamRoster({ sport, team, fetcher = fetch }) {
  const league = safeText(sport).toLowerCase();
  const selected = resolveProTeam(league, team);
  if (!selected) return { ok: false, error: "unknown-team-or-sport", status: 400 };
  const key = league + ":" + selected.abbr;
  const useCache = fetcher === fetch;
  const hit = useCache ? ROSTER_CACHE.get(key) : null;
  if (hit && Date.now() - hit.time < ROSTER_CACHE_MS) return hit.result;
  const sourceUrl = league === "nhl"
    ? "https://api-web.nhle.com/v1/roster/" + encodeURIComponent(nhlModelTeamCode(selected.abbr)) + "/current"
    : "https://site.api.espn.com/apis/site/v2/sports/" + ESPN_SPORT[league] + "/" + league + "/teams/" + encodeURIComponent(selected.espnId) + "/roster";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(sourceUrl, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) return { ok: false, error: "upstream-roster-http-" + response.status, status: 502, team: selected };
    const payload = await response.json();
    const players = parseProRoster(league, payload);
    if (!players.length) return { ok: false, error: "upstream-roster-empty", status: 502, team: selected };
    const result = {
      ok: true, sport: league, team: selected, players,
      source: league === "nhl" ? "NHL_OFFICIAL_CURRENT_ROSTER" : "ESPN_TEAM_ROSTER",
      sourceUrl, fetchedAt: new Date().toISOString(), rosterCount: players.length
    };
    if (useCache) ROSTER_CACHE.set(key, { time: Date.now(), result });
    return result;
  } catch {
    return { ok: false, error: "upstream-roster-unavailable", status: 502, team: selected };
  } finally { clearTimeout(timeout); }
}
