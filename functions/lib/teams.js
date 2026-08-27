/**
 * Canonical team registry. Verified abbreviations and ESPN IDs only.
 * Source mappings (ESPN / Parlay / Heritage / Kalshi / Pal / Savant) live on
 * each row under `sources` — never invent initials or last-word labels.
 */

import nfl from "../../data/teams/nfl.js";
import mlb from "../../data/teams/mlb.js";
import nba from "../../data/teams/nba.js";
import cfb from "../../data/teams/cfb.js";
import cbb from "../../data/teams/cbb.js";
import { abbrMatch, namesMatch, normName } from "./match.js";

export const TEAMS_BY_SPORT = { nfl, mlb, nba, cfb, cbb };

const INDEX = new Map();

function schoolIdentity(row) {
  const display = String(row.displayName || "");
  const nick = String(row.nickname || "");
  if (nick && display.toLowerCase().endsWith(nick.toLowerCase())) {
    const school = display.slice(0, display.length - nick.length).trim();
    if (school) return school;
  }
  return row.school || display;
}

function indexSport(sport, rows) {
  const byId = new Map();
  const byEspn = new Map();
  const byAbbr = new Map();
  const byName = new Map();
  for (const raw of rows || []) {
    const row = { ...raw, school: schoolIdentity(raw) };
    byId.set(row.id, row);
    if (row.espnId) byEspn.set(String(row.espnId), row);
    if (row.abbr) {
      const list = byAbbr.get(row.abbr) || [];
      list.push(row);
      byAbbr.set(row.abbr, list);
      const espnAbbr = row.sources?.espn?.abbr;
      if (espnAbbr && espnAbbr !== row.abbr) {
        const extra = byAbbr.get(espnAbbr) || [];
        extra.push(row);
        byAbbr.set(espnAbbr, extra);
      }
    }
    const names = [
      row.displayName,
      row.school,
      row.nickname,
      row.sources?.espn?.name,
      ...(row.sources?.parlay?.names || []),
      ...(row.sources?.heritage?.names || []),
      ...(row.sources?.kalshi?.names || []),
    ];
    for (const name of names) {
      const key = normName(name);
      if (!key) continue;
      const list = byName.get(key) || [];
      if (!list.includes(row)) list.push(row);
      byName.set(key, list);
    }
  }
  INDEX.set(sport, { byId, byEspn, byAbbr, byName, rows });
}

for (const [sport, rows] of Object.entries(TEAMS_BY_SPORT)) indexSport(sport, rows);

export function espnLogoUrl(sport, espnId, abbr) {
  const id = espnId != null ? String(espnId) : "";
  const a = String(abbr || "").toLowerCase();
  if (sport === "cfb" || sport === "cbb") {
    return id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png` : "";
  }
  if (sport === "nfl" && a) return `https://a.espncdn.com/i/teamlogos/nfl/500/${a}.png`;
  if (sport === "nba" && a) return `https://a.espncdn.com/i/teamlogos/nba/500/${a}.png`;
  if (sport === "mlb" && a) return `https://a.espncdn.com/i/teamlogos/mlb/500/${a}.png`;
  return "";
}

export function listTeams(sport) {
  return TEAMS_BY_SPORT[sport] || [];
}

function uniqueHit(list) {
  if (!list?.length) return null;
  const ids = new Set(list.map((r) => r.id));
  if (ids.size !== 1) return null;
  return list[0];
}

/**
 * Resolve a team query to exactly one canonical row. Fail closed.
 * Never match on mascot / State / Tech / Forest last-word alone.
 */
export function resolveTeam(sport, query = {}) {
  const idx = INDEX.get(sport);
  if (!idx) return null;
  if (query.canonicalId && idx.byId.has(query.canonicalId)) return idx.byId.get(query.canonicalId);
  if (query.espnId && idx.byEspn.has(String(query.espnId))) return idx.byEspn.get(String(query.espnId));
  const abbr = String(query.abbr || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (abbr && abbr !== "—" && abbr.length >= 2) {
    const byAb = uniqueHit(idx.byAbbr.get(abbr));
    if (byAb) return byAb;
  }
  const candidates = [];
  for (const name of [query.name, query.displayName, query.school, query.fullName]) {
    const key = normName(name);
    if (!key) continue;
    const exact = uniqueHit(idx.byName.get(key));
    if (exact) return exact;
    for (const row of idx.rows || []) {
      if (namesMatch(name, row.displayName) || namesMatch(name, row.school)) candidates.push(row);
    }
  }
  return uniqueHit(candidates);
}

export function enrichTeam(sport, raw = {}) {
  const hit = resolveTeam(sport, raw);
  if (!hit) {
    const abbr = String(raw.abbr || "").toUpperCase();
    const invented = !abbr || abbr === "—" || looksInventedAbbr(raw.name, abbr);
    return {
      ...raw,
      canonicalId: null,
      matchStatus: "unresolved",
      school: raw.school || raw.name || null,
      fullName: raw.name || raw.displayName || null,
      abbr: invented ? "—" : abbr,
      logo: raw.logo || espnLogoUrl(sport, raw.espnId, abbr),
      espnId: raw.espnId || null,
    };
  }
  const espnAbbr = hit.sources?.espn?.abbr || hit.abbr;
  return {
    ...raw,
    canonicalId: hit.id,
    matchStatus: "resolved",
    name: sport === "cfb" || sport === "cbb" ? hit.school : hit.displayName,
    school: hit.school,
    nickname: hit.nickname,
    fullName: hit.displayName,
    abbr: hit.abbr,
    logo: hit.logo || raw.logo || espnLogoUrl(sport, hit.espnId, espnAbbr),
    espnId: hit.espnId || raw.espnId || null,
    color: hit.color || raw.color || null,
    altColor: hit.altColor || raw.altColor || null,
    conference: hit.conference || raw.conference || null,
    classification: hit.classification || raw.classification || null,
    sources: hit.sources,
  };
}

function looksInventedAbbr(name, abbr) {
  const parts = String(name || "").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  const initials = parts.map((p) => p[0]).join("").slice(0, 3).toUpperCase();
  return abbr === initials;
}

export function enrichGameTeams(sport, game) {
  if (!game) return game;
  const home = enrichTeam(sport, game.home || {});
  const away = enrichTeam(sport, game.away || {});
  return { ...game, sport, home, away };
}

export function logoForCanonicalId(canonicalId) {
  if (!canonicalId) return null;
  const sport = String(canonicalId).split("-")[0];
  const idx = INDEX.get(sport);
  const row = idx?.byId.get(canonicalId);
  if (!row) return null;
  return { canonicalId, logo: row.logo, abbr: row.abbr, name: row.displayName, school: row.school };
}

export function verifiedNflAbbr(name) {
  return resolveTeam("nfl", { name })?.abbr || null;
}

export function verifiedCfbSchool(name) {
  return resolveTeam("cfb", { name })?.school || null;
}

export function identityFromName(name) {
  if (!name) return { name: null, abbr: "—", logo: "", canonicalId: null, sport: null };
  for (const sport of ["mlb", "nfl", "nba", "cfb", "cbb"]) {
    const hit = resolveTeam(sport, { name });
    if (hit) {
      return {
        name: sport === "cfb" || sport === "cbb" ? hit.school : hit.displayName,
        fullName: hit.displayName,
        school: hit.school,
        abbr: hit.abbr,
        logo: hit.logo,
        canonicalId: hit.id,
        sport,
      };
    }
  }
  return { name, abbr: "—", logo: "", canonicalId: null, sport: null };
}
