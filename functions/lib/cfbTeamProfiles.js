/** Read-only FBS profile presentation from existing canonical D1 identity state.
 * SDV's ESPN-derived source_json is a provider observation, NOT school-official verification.
 * This module never changes model inputs, team state, provider quota or wager authority.
 */
import { isCurrentFbsTeam } from "./cfbTeamDirectory.js";

const safeText = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
const finite = (v, lo = -Infinity, hi = Infinity) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
export function safeBrandHex(v) {
  const raw = String(v || "").trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(raw) ? "#" + raw.toUpperCase() : null;
}
export function safeEspnLogo(v) {
  if (typeof v !== "string") return null;
  try {
    const url = new URL(v);
    if (url.protocol !== "https:" || url.hostname !== "a.espncdn.com"
      || !/^\/i\/teamlogos\/[a-z0-9/_-]+\.png$/i.test(url.pathname)) return null;
    return url.toString();
  } catch { return null; }
}
export function sourcePayload(row) {
  if (!row?.source_json) return {};
  try {
    const parsed = JSON.parse(row.source_json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function toFbsTeamProfile(row = {}) {
  if (!isCurrentFbsTeam(row)) return null;
  const source = sourcePayload(row);
  const lat = finite(row.latitude ?? source.latitude, -90, 90);
  const lon = finite(row.longitude ?? source.longitude, -180, 180);
  // Coordinates are supplied by the canonical source. Don't assert survey-grade precision.
  const coordinatesAvailable = lat !== null && lon !== null;
  const primary = safeBrandHex(source.color);
  const secondary = safeBrandHex(source.alternate_color);
  const stadium = safeText(row.home_stadium) || safeText(source.venue_name);
  const espnId = /^cfb:espn:\d+$/.test(String(row.team_id || ""))
    ? String(row.team_id).split(":").at(-1) : null;
  const observed = safeText(row.last_observed_at) || safeText(row.updated_at);
  return {
    teamId: row.team_id,
    espnId,
    school: row.school_name,
    athleticName: safeText(row.athletic_name),
    displayName: safeText(source.display_name) || [row.school_name, row.athletic_name].filter(Boolean).join(" "),
    abbreviation: safeText(row.abbreviation),
    conference: safeText(row.current_conference),
    subdivision: "FBS",
    season: finite(source.season, 1900, 2200),
    colors: {
      primary, secondary, source: "SPORTSDATAVERSE_ESPN",
      officialVerified: false,
    },
    logo: {
      url: safeEspnLogo(source.team_logo),
      darkUrl: safeEspnLogo(source.team_logo_dark),
      source: "ESPN_CDN", officialVerified: false,
    },
    mascot: {
      teamNickname: safeText(source.mascot) || safeText(row.athletic_name),
      costumedCharacter: null,
      characterVerification: "NOT_SOURCED",
    },
    stadium: {
      name: stadium,
      venueId: finite(source.venue_id, 1),
      city: safeText(source.venue_city) || safeText(row.city),
      state: safeText(source.venue_state) || safeText(row.state),
      latitude: lat,
      longitude: lon,
      coordinatesAvailable,
      coordinateSource: coordinatesAvailable ? "SPORTSDATAVERSE_ESPN_CFBD" : null,
      coordinateVerified: false,
      mapUrl: coordinatesAvailable
        ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(lat + "," + lon)
        : null,
      timezone: safeText(row.timezone) || safeText(source.timezone),
      capacity: finite(source.capacity, 1, 300000),
      elevationMeters: finite(source.elevation, -1000, 9000),
      indoor: typeof source.dome === "boolean" ? source.dome : null,
      grass: typeof source.grass === "boolean" ? source.grass : null,
    },
    provenance: {
      identitySource: "SPORTSDATAVERSE_ESPN",
      observedAt: observed,
      sourceSeason: finite(source.season, 1900, 2200),
      brandingVerification: "PROVIDER_SOURCED_NOT_SCHOOL_VERIFIED",
      venueVerification: "PROVIDER_COORDINATES_NOT_SURVEY_VERIFIED",
    },
    modelAuthority: {
      researchOnly: true,
      canInfluenceProjection: false,
      canQualify: false,
      canAuthorizeWager: false,
    },
  };
}
export function toFbsTeamList(rows = []) {
  return rows.map(toFbsTeamProfile).filter(Boolean)
    .sort((a,b) => a.school.localeCompare(b.school));
}

export function toTeamFeatureSummary(row = null) {
  if (!row) return { state: "NOT_POPULATED", asOf: null, featureVersion: null, features: null, missingness: null, season: null };
  const parse = (raw) => {
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  return {
    state: "RESEARCH_SNAPSHOT",
    asOf: row.as_of || null, featureVersion: row.feature_version || null,
    season: row.season != null && Number.isFinite(Number(row.season)) ? Number(row.season) : null,
    features: parse(row.features_json), missingness: parse(row.missingness_json),
    canInfluenceProjection: false,
  };
}

export function toLegacyFormSummary(row = null) {
  if (!row) return null;
  return {
    games: finite(row.games, 0), pointsFor: finite(row.points_for, 0),
    pointsAgainst: finite(row.points_against, 0), updatedAt: row.updated_at || null,
    source: "LEGACY_TEAM_FORM", currentModelSource: false,
  };
}