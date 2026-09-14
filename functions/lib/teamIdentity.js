/**
 * Canonical FBIS team identity + logo resolution.
 *
 * Presentation layer only — does not alter event IDs, matching, models,
 * grading, or publication. Wraps the existing sport registries in
 * functions/lib/teams.js; does not create a parallel identity system.
 */

import {
  TEAMS_BY_SPORT,
  enrichTeam,
  espnLogoUrl,
  identityForSport,
  listTeams,
  logoForCanonicalId,
  resolveTeam,
  teamDisplayName,
} from "./teams.js";

/** Named logo bounding boxes used by <TeamLogo size="…" />. */
export const LOGO_SIZES = Object.freeze({
  hero: 72,
  card: 48,
  compact: 28,
  micro: 18,
});

export const SUPPORTED_LOGO_SPORTS = Object.freeze(["mlb", "nfl", "nba", "cfb", "cbb"]);

/**
 * Resolve a single logo URL with explicit provenance.
 * Priority:
 *   1. Registry row logo (approved ESPN CDN URL on canonical team)
 *   2. Existing legitimate logo already on the team object
 *   3. Constructed ESPN CDN URL from sport + espnId/abbr
 *   4. Empty → caller renders abbreviation badge
 */
export function resolveTeamLogo(input = {}) {
  const sport = normalizeSport(input.sport || input.league);
  const canonicalTeamId = input.canonicalTeamId || input.canonicalId || null;
  const providerIds = input.providerIds || {};
  const espnId = input.espnId ?? providerIds.espn ?? input.providerTeamId ?? null;
  const abbreviation = cleanAbbr(input.abbreviation || input.abbr);
  const teamName = input.teamName || input.name || input.displayName || input.fullName || null;

  if (canonicalTeamId) {
    const fromId = logoForCanonicalId(canonicalTeamId);
    if (fromId?.logo && isUsableLogoUrl(fromId.logo)) {
      return logoResult({
        url: fromId.logo,
        source: "registry",
        sourceId: canonicalTeamId,
        confidence: "high",
        fallbackUsed: false,
        sport: sport || String(canonicalTeamId).split("-")[0] || null,
        abbr: fromId.abbr || abbreviation || null,
        name: fromId.name || teamName || null,
      });
    }
  }

  if (sport && SUPPORTED_LOGO_SPORTS.includes(sport)) {
    const hit = resolveTeam(sport, {
      canonicalId: canonicalTeamId,
      espnId,
      abbr: abbreviation,
      name: teamName,
      displayName: teamName,
    });
    if (hit?.logo && isUsableLogoUrl(hit.logo)) {
      return logoResult({
        url: hit.logo,
        source: "registry",
        sourceId: hit.id,
        confidence: "high",
        fallbackUsed: false,
        sport,
        abbr: hit.abbr || abbreviation || null,
        name: hit.displayName || teamName || null,
      });
    }
  }

  const existing = String(input.logo || input.logoUrl || input.primaryUrl || "").trim();
  if (existing && isUsableLogoUrl(existing)) {
    return logoResult({
      url: existing,
      source: "provided",
      sourceId: canonicalTeamId || (espnId != null ? String(espnId) : null),
      confidence: canonicalTeamId || espnId ? "medium" : "low",
      fallbackUsed: false,
      sport,
      abbr: abbreviation || null,
      name: teamName || null,
    });
  }

  if (sport && SUPPORTED_LOGO_SPORTS.includes(sport) && (espnId || abbreviation)) {
    const constructed = espnLogoUrl(sport, espnId, abbreviation);
    if (constructed && isUsableLogoUrl(constructed)) {
      return logoResult({
        url: constructed,
        source: "espn-cdn",
        sourceId: espnId != null ? String(espnId) : abbreviation || null,
        confidence: espnId ? "medium" : "low",
        fallbackUsed: true,
        sport,
        abbr: abbreviation || null,
        name: teamName || null,
      });
    }
  }

  return logoResult({
    url: "",
    source: "none",
    sourceId: null,
    confidence: "none",
    fallbackUsed: true,
    sport,
    abbr: abbreviation || null,
    name: teamName || null,
  });
}

/**
 * Build the canonical TeamIdentity presentation object.
 * Nullable fields are expected — never invent logos, colors, or abbrs.
 */
export function buildTeamIdentity(input = {}) {
  const sport = normalizeSport(input.sport || input.league);
  const query = {
    canonicalId: input.canonicalTeamId || input.canonicalId || null,
    espnId: input.espnId ?? input.providerIds?.espn ?? null,
    abbr: input.abbreviation || input.abbr,
    name: input.teamName || input.name || input.displayName || input.fullName,
    displayName: input.displayName || input.fullName || input.name,
    logo: input.logo || input.logoUrl,
    school: input.school,
  };

  const enriched =
    sport && SUPPORTED_LOGO_SPORTS.includes(sport)
      ? enrichTeam(sport, { ...input, ...query })
      : {
          ...input,
          canonicalId: query.canonicalId,
          abbr: cleanAbbr(query.abbr) || "—",
          logo: "",
          fullName: query.displayName || query.name || null,
          name: query.name || query.displayName || null,
          school: input.school || null,
          color: input.color || null,
          altColor: input.altColor || null,
          espnId: query.espnId || null,
          matchStatus: "unresolved",
        };

  // Never promote unresolved/malformed enrich logos (e.g. "—.png").
  const enrichLogo = isUsableLogoUrl(enriched.logo) ? enriched.logo : "";
  const logo = resolveTeamLogo({
    sport,
    canonicalTeamId: enriched.canonicalId,
    espnId: enriched.espnId,
    abbreviation: enriched.abbr !== "—" ? enriched.abbr : cleanAbbr(input.abbr),
    teamName: enriched.fullName || enriched.name,
    logo: enrichLogo || (isUsableLogoUrl(input.logo) ? input.logo : ""),
    providerIds: input.providerIds,
  });

  // If identity is unresolved and logo only came from a guessed CDN abbr, drop it.
  const resolved = Boolean(enriched.canonicalId) || enriched.matchStatus === "resolved";
  const logoUrl =
    logo.url && (resolved || logo.source === "provided" || logo.source === "registry")
      ? logo.url
      : resolved
        ? logo.url
        : "";

  const abbr = enriched.abbr && enriched.abbr !== "—" ? enriched.abbr : cleanAbbr(input.abbr) || null;
  const fullName =
    enriched.fullName ||
    enriched.name ||
    (sport === "cfb" || sport === "cbb" ? enriched.school : null) ||
    input.fullName ||
    input.name ||
    null;
  const shortName =
    sport === "cfb" || sport === "cbb"
      ? enriched.school || fullName
      : enriched.nickname || enriched.school || abbr || fullName;

  return {
    sport: sport || null,
    league: input.league || enriched.league || sportLeague(sport) || null,
    canonicalTeamId: enriched.canonicalId || null,
    abbreviation: abbr,
    shortName: shortName || null,
    fullName: fullName || null,
    record: input.record || null,
    logo: {
      primaryUrl: logoUrl || "",
      smallUrl: logoUrl || "",
      source: logoUrl ? logo.source : "none",
      sourceTeamId: logoUrl ? logo.sourceId : null,
      transparentPreferred: true,
      available: Boolean(logoUrl),
      confidence: logoUrl ? logo.confidence : "none",
      fallbackUsed: logoUrl ? logo.fallbackUsed : true,
    },
    colors: {
      primary: normalizeHex(enriched.color || input.color),
      secondary: normalizeHex(enriched.altColor || input.altColor),
    },
    providerIds: {
      espn: enriched.espnId != null ? String(enriched.espnId) : input.providerIds?.espn || null,
      mlb: input.providerIds?.mlb || null,
      nfl: input.providerIds?.nfl || null,
      nba: input.providerIds?.nba || null,
      nhl: input.providerIds?.nhl || null,
      ncaa: sport === "cfb" || sport === "cbb" ? (enriched.espnId != null ? String(enriched.espnId) : null) : null,
      other: input.providerIds?.other || null,
    },
    matchStatus: enriched.matchStatus || null,
    identityBlock: enriched.identityBlock || null,
  };
}

/** Normalize a loose team object (board/game/bet row) into TeamIdentity. */
export function teamIdentityFromTeam(team, sportHint = null) {
  if (!team) return buildTeamIdentity({ sport: sportHint });
  if (team.logo?.primaryUrl != null && team.canonicalTeamId != null) return team;
  return buildTeamIdentity({
    sport: sportHint || team.sport || team.league,
    league: team.league,
    canonicalTeamId: team.canonicalId || team.canonicalTeamId || null,
    espnId: team.espnId,
    abbreviation: team.abbr || team.abbreviation,
    name: team.name,
    displayName: team.fullName || team.displayName || team.name,
    school: team.school,
    logo: typeof team.logo === "string" ? team.logo : team.logoUrl,
    color: team.color,
    altColor: team.altColor,
    record: team.record,
    providerIds: team.providerIds,
  });
}

export function logoSizePx(size = "compact") {
  if (typeof size === "number" && Number.isFinite(size) && size > 0) return Math.round(size);
  const key = String(size || "compact").toLowerCase();
  return LOGO_SIZES[key] || LOGO_SIZES.compact;
}

/** Representative teams for the /dev/team-identities gallery. */
export function galleryTeamSamples() {
  const picks = {
    mlb: ["CHW", "CLE", "NYY", "BOS", "LAD", "SD", "HOU", "TEX"],
    nfl: ["DAL", "NYG", "KC", "PHI"],
    nba: ["LAL", "BOS", "GS", "NY"],
    nhl: [],
    cfb: ["Ohio State", "Michigan", "Alabama", "Georgia"],
    cbb: ["Duke", "North Carolina", "Kansas", "Kentucky"],
  };
  const out = {};
  for (const [sport, keys] of Object.entries(picks)) {
    out[sport] = keys
      .map((key) => {
        if (sport === "cfb" || sport === "cbb") return buildTeamIdentity({ sport, name: key });
        return buildTeamIdentity({ sport, abbr: key });
      })
      .filter((t) => t.canonicalTeamId || t.logo.available);
  }
  return out;
}

export function listRegistryCoverage() {
  const coverage = {};
  for (const sport of SUPPORTED_LOGO_SPORTS) {
    const rows = listTeams(sport);
    coverage[sport] = {
      teams: rows.length,
      withLogo: rows.filter((r) => r.logo).length,
      withColor: rows.filter((r) => r.color).length,
      logoHost: "a.espncdn.com",
    };
  }
  coverage.nhl = {
    teams: 0,
    withLogo: 0,
    withColor: 0,
    logoHost: null,
    note: "No NHL registry — logos unavailable until a canonical NHL team pack exists.",
  };
  return coverage;
}

export function identityInSport(sport, nameOrAbbr) {
  return identityForSport(sport, nameOrAbbr);
}

export { TEAMS_BY_SPORT, teamDisplayName };

function logoResult( partial ) {
  return {
    url: partial.url || "",
    source: partial.source || "none",
    sourceId: partial.sourceId ?? null,
    confidence: partial.confidence || "none",
    fallbackUsed: Boolean(partial.fallbackUsed),
    sport: partial.sport || null,
    abbr: partial.abbr || null,
    name: partial.name || null,
  };
}

function normalizeSport(value) {
  const s = String(value || "").toLowerCase().trim();
  if (!s) return null;
  if (s === "football" || s === "ncaaf") return "cfb";
  if (s === "ncaab" || s === "college-basketball") return "cbb";
  if (s === "baseball") return "mlb";
  return s;
}

function cleanAbbr(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw || /^[—–−\-?]+$/.test(raw)) return null;
  const cleaned = raw.replace(/[^A-Z0-9]/g, "");
  return cleaned.length >= 2 ? cleaned : null;
}

function normalizeHex(value) {
  if (value == null || value === "") return null;
  const raw = String(value).replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw)) return null;
  return `#${raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw}`.toLowerCase();
}

function sportLeague(sport) {
  return { mlb: "MLB", nfl: "NFL", nba: "NBA", nhl: "NHL", cfb: "NCAAF", cbb: "NCAAB" }[sport] || null;
}

/** Known-good hosts already used by FBIS registries + reject malformed paths. */
function isUsableLogoUrl(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/[—–−]/.test(trimmed)) return false;
  if (/\/(?:—|–|−|-|\?|null|undefined)\.png$/i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    const okHost =
      host === "a.espncdn.com" ||
      host === "espncdn.com" ||
      host.endsWith(".espncdn.com") ||
      host === "www.mlbstatic.com" ||
      host === "mlbstatic.com";
    if (!okHost) return false;
    const leaf = u.pathname.split("/").pop() || "";
    if (!leaf || leaf.length < 5) return false;
    return true;
  } catch {
    return false;
  }
}
