/**
 * NHL data-source policy.
 *
 * Live production projections use official NHL APIs directly. SportsDataverse /
 * fastRhockey is the historical/archive layer and an independent freshness/audit
 * source. Large release assets are intentionally not fetched in request-time
 * Cloudflare functions.
 */

export const NHL_DATA_SOURCE_POLICY = Object.freeze({
  livePrimary: Object.freeze({
    id: "NHL_OFFICIAL_API",
    role: "LIVE_PRIMARY",
    baseUrls: Object.freeze([
      "https://api-web.nhle.com/v1",
      "https://api.nhle.com/stats/rest/en",
    ]),
    pointInTimeSafe: true,
    requestTimeAllowed: true,
  }),
  historicalArchive: Object.freeze({
    id: "SPORTSDATAVERSE_FASTRHOCKEY",
    role: "HISTORICAL_ARCHIVE",
    repository: "sportsdataverse/sportsdataverse-data",
    producer: "sportsdataverse/fastRhockey-nhl-data",
    requestTimeAllowed: false,
    releaseTags: Object.freeze([
      "nhl_pbp_full",
      "nhl_pbp_lite",
      "nhl_team_boxscores",
      "nhl_player_boxscores",
      "nhl_rosters",
      "nhl_schedules",
      "nhl_goalie_boxscores",
      "nhl_scratches",
      "nhl_shifts",
    ]),
  }),
});

export function nhlSeasonIsActive(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return false;
  const month = d.getUTCMonth() + 1;
  return month >= 10 || month <= 6;
}

export function classifyNhlArchiveFreshness(updatedAt, targetDate = new Date(), {
  activeMaxAgeDays = 3,
  offseasonMaxAgeDays = 90,
} = {}) {
  const updated = new Date(updatedAt);
  const target = targetDate instanceof Date ? targetDate : new Date(targetDate);
  if (!Number.isFinite(updated.getTime()) || !Number.isFinite(target.getTime())) {
    return { status: "UNKNOWN", ageDays: null, maxAgeDays: null, stale: true };
  }
  const ageDays = Math.max(0, (target.getTime() - updated.getTime()) / 86400000);
  const maxAgeDays = nhlSeasonIsActive(target) ? activeMaxAgeDays : offseasonMaxAgeDays;
  return {
    status: ageDays <= maxAgeDays ? "FRESH" : "STALE",
    ageDays: Math.round(ageDays * 10) / 10,
    maxAgeDays,
    stale: ageDays > maxAgeDays,
  };
}

export function buildNhlSourceLineage({
  asOf = new Date().toISOString(),
  artifactGeneratedAt = null,
  sportsDataverseUpdatedAt = null,
} = {}) {
  const archiveFreshness = sportsDataverseUpdatedAt
    ? classifyNhlArchiveFreshness(sportsDataverseUpdatedAt, asOf)
    : { status: "NOT_CHECKED", ageDays: null, maxAgeDays: null, stale: null };

  return {
    asOf,
    livePrimary: {
      ...NHL_DATA_SOURCE_POLICY.livePrimary,
      status: "ACTIVE",
    },
    historicalArchive: {
      id: NHL_DATA_SOURCE_POLICY.historicalArchive.id,
      role: NHL_DATA_SOURCE_POLICY.historicalArchive.role,
      repository: NHL_DATA_SOURCE_POLICY.historicalArchive.repository,
      producer: NHL_DATA_SOURCE_POLICY.historicalArchive.producer,
      releaseTags: [...NHL_DATA_SOURCE_POLICY.historicalArchive.releaseTags],
      updatedAt: sportsDataverseUpdatedAt,
      freshness: archiveFreshness,
      status: sportsDataverseUpdatedAt
        ? (archiveFreshness.stale ? "DEGRADED_STALE" : "ACTIVE")
        : "AUDIT_REQUIRED",
    },
    fittedArtifact: {
      generatedAt: artifactGeneratedAt,
      source: "NHL_OFFICIAL_PBP_HISTORICAL_FIT",
    },
    marketInputsUsedForProjection: false,
  };
}
