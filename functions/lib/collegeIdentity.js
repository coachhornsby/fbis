/**
 * College identity extensions on the existing canonical registry.
 * Never match on State / Tech / Miami / mascot / initials alone.
 * Conference membership is season-aware.
 */

import { resolveTeam, resolveTeamExact, listTeams } from "./teams.js";

export const AMBIGUOUS_ALONE = /^(state|tech|miami|usc|forest)$/i;

export const IDENTITY_EXCEPTIONS = [
  {
    id: "miami-fl-vs-oh",
    sport: "cfb",
    rule: "Miami without a qualifier is unresolved. Miami (FL) vs Miami (OH) require school or ESPN id.",
    fl: "cfb-2390",
    oh: "cfb-193",
  },
  {
    id: "usc-vs-south-carolina",
    sport: "cfb",
    rule: "USC is Southern California; South Carolina is not USC.",
    usc: "cfb-30",
    southCarolina: "cfb-2579",
  },
];

export function conferenceForSeason(team, season, seasonRows = []) {
  const hit = (seasonRows || []).find(
    (r) => r.canonicalId === team?.canonicalId && Number(r.season) === Number(season)
  );
  if (hit?.conference) return hit.conference;
  return team?.conference || null;
}

export function identityFailClosed(sport, query = {}) {
  const name = String(query.name || query.school || query.displayName || "").trim();
  if (AMBIGUOUS_ALONE.test(name)) {
    return { ok: false, reason: "ambiguous-token", canonicalId: null };
  }
  const hit = resolveTeamExact(sport, query) || resolveTeam(sport, query);
  if (!hit) return { ok: false, reason: "unresolved", canonicalId: null };
  return { ok: true, reason: null, canonicalId: hit.id, team: hit };
}

export function miamiDisambiguation(query = {}) {
  const raw = String(query.name || query.school || query.displayName || "").toLowerCase();
  if (!raw.includes("miami")) return null;
  if (/\boh\b|\bohio\b|\bredhawks?\b/.test(raw)) return resolveTeamExact("cfb", { espnId: "193" });
  if (/\bfl\b|\bflorida\b|\bhurricanes?\b/.test(raw)) return resolveTeamExact("cfb", { espnId: "2390" });
  if (query.espnId) return resolveTeamExact("cfb", { espnId: query.espnId });
  return null;
}

export function mapSourceTeam(sport, row, season) {
  const name = row?.school || row?.team || row?.name;
  const espnId = row?.id ?? row?.espnId;
  const hit =
    (espnId != null ? resolveTeamExact(sport, { espnId: String(espnId) }) : null) ||
    miamiDisambiguation({ name }) ||
    resolveTeamExact(sport, { name, school: name });
  if (!hit) return { ok: false, reason: "unresolved", source: row };
  return {
    ok: true,
    canonicalId: hit.id,
    espnId: hit.espnId,
    school: hit.school,
    displayName: hit.displayName,
    abbr: hit.abbr,
    conference: row?.conference || hit.conference || null,
    classification: row?.classification || hit.classification || null,
    season: season ?? null,
    sourceTeamId: row?.id != null ? String(row.id) : null,
  };
}

export function collegeTeamCoverage(sport) {
  const rows = listTeams(sport) || [];
  return {
    sport,
    n: rows.length,
    withEspn: rows.filter((r) => r.espnId).length,
    withAbbr: rows.filter((r) => r.abbr && r.abbr !== "—").length,
    miamiFl: rows.some((r) => r.id === "cfb-2390" || r.espnId === "2390"),
    miamiOh: rows.some((r) => r.id === "cfb-193" || r.espnId === "193"),
  };
}

export function featureCutoffIso(scheduledStart, { minutesBefore = 1 } = {}) {
  if (!scheduledStart) return null;
  const t = Date.parse(scheduledStart);
  if (!Number.isFinite(t)) return null;
  return new Date(t - minutesBefore * 60000).toISOString();
}

export function cutoffViolated(cutoffIso, kickoffIso) {
  if (!cutoffIso || !kickoffIso) return true;
  return Date.parse(cutoffIso) > Date.parse(kickoffIso);
}

export async function hashPayload(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const bytes = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
