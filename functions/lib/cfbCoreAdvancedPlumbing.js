/**
 * Week-aware CORE + advanced team/player plumbing for CFB research features.
 * Fail-closed on undated CORE when a week bound is required.
 * Research-only — never authorizes wagers or promotes champions.
 */
import { normalizeCoreRating, indexCoreByTeam } from "./cfbdCanonical.js";
import { mapSourceTeam } from "./collegeIdentity.js";

export const CFB_CORE_ADVANCED_AUTHORITY = "research_only";
export const CFB_FEATURES_VERSION = "cfb-features-v1";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Approximate FBS week from Chicago calendar when ESPN/opts week unavailable. */
export function estimateCfbWeekFromDate(now = new Date(), seasonYear = null) {
  const d = now instanceof Date ? now : new Date(now);
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const season = seasonYear != null ? Number(seasonYear) : m >= 8 ? y : y - 1;
  // Week 1 window starts ~ late August of the season year.
  const start = Date.UTC(season, 7, 25);
  const cur = Date.UTC(y, m - 1, day);
  const week = Math.floor((cur - start) / (7 * 86400000)) + 1;
  return Math.max(1, Math.min(20, week));
}

/**
 * throughWeek for pregame CORE = latest completed week strictly before target.
 */
export function coreThroughWeekBound(targetWeek) {
  const w = Number(targetWeek);
  if (!Number.isInteger(w) || w < 1) return null;
  return Math.max(0, w - 1);
}

/**
 * Map raw /ratings/core rows into team catalog patches with provenance.
 * When maxWeek is set, undated rows are rejected (temporal fail-closed).
 */
export function coreProvenancePatches(coreRows = [], { maxWeek = null, seasonType = "regular" } = {}) {
  const indexed = indexCoreByTeam(coreRows, { maxWeek, seasonType });
  const patches = {};
  for (const [key, row] of Object.entries(indexed)) {
    patches[key] = {
      core: num(row.rating),
      coreOffense: num(row.offense),
      coreDefense: num(row.defense),
      coreSpecialTeams: num(row.specialTeams),
      coreThroughWeek: num(row.throughWeek),
      coreThroughSeasonType: row.throughSeasonType || null,
      coreWeekBounded: maxWeek != null,
      coreTemporalClass: "B",
      coreSourceEndpoint: "/ratings/core",
    };
  }
  return { bySchoolKey: patches, n: Object.keys(patches).length, maxWeek };
}

function schoolKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Merge CORE provenance onto an indexCfbRatings catalog (by school name key). */
export function enrichCatalogWithCoreProvenance(catalog, coreRows = [], opts = {}) {
  const { bySchoolKey, n, maxWeek } = coreProvenancePatches(coreRows, opts);
  const byCanonicalId = {};
  for (const [id, src] of Object.entries(catalog?.byCanonicalId || {})) {
    // The season-index was built from the latest /ratings/core response and can
    // already contain a future/undated rating. It is NOT a trusted PIT source.
    // Always erase the unbounded values before overlaying eligible CORE rows.
    const clean = { ...src };
    for (const key of [
      "core", "coreOffense", "coreDefense", "coreSpecialTeams",
      "coreThroughWeek", "coreThroughSeasonType", "coreSourceEndpoint",
      "coreTemporalClass", "coreWeekBounded", "coreTemporalNote",
    ]) delete clean[key];
    byCanonicalId[id] = clean;
  }
  const srcCorePresence = new Map(Object.entries(catalog?.byCanonicalId || {})
    .map(([id, row]) => [id, row?.core != null || row?.coreOffense != null || row?.coreDefense != null]));
  let enriched = 0;
  let scrubbed = 0;
  for (const row of Object.values(byCanonicalId)) {
    const hit = bySchoolKey[schoolKey(row.team)];
    if (hit) {
      Object.assign(row, hit);
      enriched += 1;
      continue;
    }
    // No eligible dated, week-bounded record. Never promote current-season
    // CORE into a frozen research vector by retaining untrusted catalog data.
    row.coreWeekBounded = false;
    row.coreTemporalNote = maxWeek != null
      ? "no-eligible-week-bounded-core"
      : "core-cutoff-not-proven";
    if (srcCorePresence.get(row.canonicalId) === true) scrubbed += 1;
  }
  return {
    ...catalog,
    byCanonicalId,
    coreEnriched: enriched,
    coreIndexed: n,
    coreMaxWeek: maxWeek,
    coreScrubbed: scrubbed,
    authority: CFB_CORE_ADVANCED_AUTHORITY,
    canAuthorizeWager: false,
  };
}

export function indexAdvancedGameRows(rows = []) {
  const byGameId = {};
  for (const row of rows || []) {
    const gameId = row.gameId ?? row.id ?? row.game_id;
    if (gameId == null) continue;
    const school = row.team || row.school;
    if (!school) continue;
    const mapped = mapSourceTeam("cfb", { team: school, school });
    if (!mapped.ok) continue;
    const side = String(row.homeAway || row.home_away || "").toLowerCase();
    const entry = byGameId[String(gameId)] || {
      gameId: String(gameId),
      season: num(row.season ?? row.year),
      week: num(row.week),
      teams: {},
    };
    entry.teams[mapped.canonicalId] = {
      canonicalId: mapped.canonicalId,
      team: school,
      side: side === "home" || side === "away" ? side : null,
      offensiveSuccessRate: num(row.offense?.successRate ?? row.offensiveSuccessRate),
      defensiveSuccessRate: num(row.defense?.successRate ?? row.defensiveSuccessRate),
      offensiveExplosiveness: num(row.offense?.explosiveness),
      defensiveExplosiveness: num(row.defense?.explosiveness),
      offensiveLineYards: num(row.offense?.lineYards),
      defensiveLineYards: num(row.defense?.lineYards),
      offensiveHavoc: num(row.offense?.havoc?.total),
      defensiveHavoc: num(row.defense?.havoc?.total),
      pointsPerOpportunity: num(row.offense?.pointsPerOpportunity),
      pointsPerOpportunityAllowed: num(row.defense?.pointsPerOpportunity),
    };
    byGameId[String(gameId)] = entry;
  }
  return { byGameId, n: Object.keys(byGameId).length };
}

export function indexPpaGameRows(rows = []) {
  const byGameId = {};
  for (const row of rows || []) {
    const gameId = row.gameId ?? row.id ?? row.game_id;
    if (gameId == null) continue;
    const school = row.team || row.school;
    if (!school) continue;
    const mapped = mapSourceTeam("cfb", { team: school, school });
    if (!mapped.ok) continue;
    const entry = byGameId[String(gameId)] || {
      gameId: String(gameId),
      season: num(row.season ?? row.year),
      week: num(row.week),
      teams: {},
    };
    entry.teams[mapped.canonicalId] = {
      canonicalId: mapped.canonicalId,
      team: school,
      offensePpa: num(row.offense?.overall ?? row.offensePpa),
      defensePpa: num(row.defense?.overall ?? row.defensePpa),
      passPpa: num(row.offense?.passing),
      rushPpa: num(row.offense?.rushing),
    };
    byGameId[String(gameId)] = entry;
  }
  return { byGameId, n: Object.keys(byGameId).length };
}

/**
 * Research player-season role index (QB/RB/WR PPA + usage).
 * Not wager authority; used for challenger / player-v1 research only.
 */
export function indexPlayerSeasonRoles({
  qbRows = [],
  rbRows = [],
  wrRows = [],
  usageRows = [],
} = {}) {
  const byPlayer = {};
  const ingest = (rows, position) => {
    for (const row of rows || []) {
      const playerId = row.playerId ?? row.id ?? row.athleteId;
      const name = row.player ?? row.name ?? row.athleteName;
      const team = row.team || row.school;
      if (!name || !team) continue;
      const mapped = mapSourceTeam("cfb", { team, school: team });
      if (!mapped.ok) continue;
      const key = String(playerId || `${mapped.canonicalId}:${name}`).toLowerCase();
      const prev = byPlayer[key] || {
        playerId: playerId != null ? String(playerId) : null,
        playerName: name,
        team: mapped.school || team,
        canonicalTeamId: mapped.canonicalId,
        position,
      };
      byPlayer[key] = {
        ...prev,
        position: position || prev.position,
        seasonPpa: num(row.averagePPA?.all ?? row.ppa ?? row.averagePPA) ?? prev.seasonPpa,
        seasonPpaPass: num(row.averagePPA?.pass) ?? prev.seasonPpaPass,
        seasonPpaRush: num(row.averagePPA?.rush) ?? prev.seasonPpaRush,
        countedPlays: num(row.countedPlays ?? row.plays) ?? prev.countedPlays,
      };
    }
  };
  ingest(qbRows, "QB");
  ingest(rbRows, "RB");
  ingest(wrRows, "WR");
  for (const row of usageRows || []) {
    const playerId = row.playerId ?? row.id;
    const name = row.player ?? row.name;
    const team = row.team || row.school;
    if (!name || !team) continue;
    const mapped = mapSourceTeam("cfb", { team, school: team });
    if (!mapped.ok) continue;
    const key = String(playerId || `${mapped.canonicalId}:${name}`).toLowerCase();
    const prev = byPlayer[key] || {
      playerId: playerId != null ? String(playerId) : null,
      playerName: name,
      team: mapped.school || team,
      canonicalTeamId: mapped.canonicalId,
      position: row.position || null,
    };
    byPlayer[key] = {
      ...prev,
      usageOverall: num(row.usage?.overall ?? row.overall) ?? prev.usageOverall,
      usagePass: num(row.usage?.pass) ?? prev.usagePass,
      usageRush: num(row.usage?.rush) ?? prev.usageRush,
    };
  }
  return {
    byPlayer,
    n: Object.keys(byPlayer).length,
    authority: CFB_CORE_ADVANCED_AUTHORITY,
    canAuthorizeWager: false,
  };
}

export function summarizeCoreRow(row = {}) {
  const norm = normalizeCoreRating(row);
  return {
    team: norm.team,
    throughWeek: norm.throughWeek,
    rating: norm.rating,
    offense: norm.offense,
    defense: norm.defense,
    temporalClass: norm.temporalClass,
  };
}
