/**
 * Searchable SDV (SportsDataverse) Source Registry for CFB.
 * Built from code-verified integrations only — not inferred licenses.
 * Research/display vs production consumption is explicit per dataset.
 */

export const SDV_REGISTRY_VERSION = "cfb-sdv-source-registry-v1";
export const SDV_RELEASE_BASE =
  "https://github.com/sportsdataverse/sportsdataverse-data/releases/download";

/** Collection / consumption status vocabulary shared with CFBD registry. */
export const DATASET_STATUS = Object.freeze({
  NOT_YET_DUE: "not_yet_due",
  WAITING_PUBLICATION: "waiting_for_source_publication",
  COLLECTING: "collecting",
  COMPLETE_VERIFIED: "complete_and_verified",
  PARTIAL: "partial_coverage",
  FAILED: "failed",
  STALE: "stale",
  BLOCKED_ALLOWANCE: "blocked_by_provider_allowance",
  RESEARCH_ONLY: "research_offline",
  AUDIT_ONLY: "audit_catalog_only",
});

/**
 * @typedef {object} SdvDataset
 * @property {string} id
 * @property {string} name
 * @property {string} family
 * @property {string} endpointOrFeed
 * @property {string[]} fields
 * @property {string} units
 * @property {string} identityFields
 * @property {string} seasonWeekScope
 * @property {string} publicationCadence
 * @property {string} ingestionMechanism
 * @property {string} storage
 * @property {string} historicalAvailability
 * @property {boolean} collectedCurrently
 * @property {"none"|"display"|"pit_fallback_audit"|"research"} projectionConsumption
 * @property {boolean} championConsumes
 * @property {string[]} gaps
 */

/** @type {SdvDataset[]} */
export const SDV_SOURCE_REGISTRY = Object.freeze([
  {
    id: "sdv-team-summaries-2026",
    name: "ESPN CFB team summaries (2026)",
    family: "team_summaries",
    endpointOrFeed: `${SDV_RELEASE_BASE}/espn_cfb_team_summaries/cfb_team_summaries_2026.csv`,
    fields: [
      "team_id", "pos_team", "net_adj_epa", "adj_off_epa", "adj_def_epa",
      "EPAplay_off_pass", "EPAplay_def_pass", "EPAplay_off_rush", "EPAplay_def_rush",
      "success_off", "success_def", "explosive_off", "explosive_def",
      "havoc_def", "havoc_off", "line_yards_off_rush", "line_yards_def_rush",
      "third_down_success_*", "red_zone_success_*", "pts_per_drive_*", "pts_per_opp_*",
      "valid_games", "conference", "division",
    ],
    units: "Opponent-adjusted EPA ranks; rates; points/drive; ESPN-derived",
    identityFields: "team_id → cfb:espn:{id}; FBS-vs-FBS universe",
    seasonWeekScope: "Hard-coded season 2026; cumulative summary (not weekly PIT)",
    publicationCadence: "Public release CSV; observed lag vs finals (summaryGameGap)",
    ingestionMechanism: "GET /api/cfb-intelligence → loadSdvIntelligence; forward-evidence cron",
    storage: "Workers cache cfb-sdv-intelligence-2026-v3 (30m); no D1 write from loader",
    historicalAvailability: "Current-season release only for live path; historical via offline corpus",
    collectedCurrently: true,
    projectionConsumption: "display",
    championConsumes: false,
    gaps: [
      "allStatsConsumed:false on intelligence payload",
      "Not historical PIT — acquisition clock ≠ publication clock",
      "~93 teams with summaryGameGap vs schedule finals",
    ],
  },
  {
    id: "sdv-schedules-2026",
    name: "ESPN CFB schedules (2026)",
    family: "schedules",
    endpointOrFeed: `${SDV_RELEASE_BASE}/espn_cfb_schedules/cfb_schedule_2026.csv`,
    fields: ["game_id", "season", "status", "home_id", "away_id", "home_team", "away_team", "home_score", "away_score", "game_date"],
    units: "Schedule + final scores when completed",
    identityFields: "ESPN game_id + home_id/away_id",
    seasonWeekScope: "Season 2026",
    publicationCadence: "Release CSV; updated by provider after games",
    ingestionMechanism: "Bundled with cfb-sdv-intelligence; forward capture",
    storage: "Intelligence cache object",
    historicalAvailability: "Per-season release files; bulk history workflows",
    collectedCurrently: true,
    projectionConsumption: "display",
    championConsumes: false,
    gaps: ["Schedule attach may be UNAVAILABLE on some intelligence builds"],
  },
  {
    id: "sdv-pit-fallback",
    name: "SDV PIT research fallback (from team summaries)",
    family: "pit_fallback",
    endpointOrFeed: "Derived from sdv-team-summaries via cfbSdvPitFallback",
    fields: [
      "passEpa", "rushEpa", "passEpaAllowed", "rushEpaAllowed",
      "offensePpa", "defensePpa", "successRate", "successRateAllowed",
      "explosiveRate", "havocRate", "pointsPerOpportunity", "gamesPlayed",
    ],
    units: "Mapped to deep-feed aliases; research attribution SportsDataverse CC BY 4.0",
    identityFields: "Exact ESPN ID join only (byEspnId)",
    seasonWeekScope: "2026 pregame freeze; 8-day CT window; FBS vs FBS",
    publicationCadence: "On CFBD deep-feed integrity failure during cfb-pregame-freeze",
    ingestionMechanism: "Job cfb-pregame-freeze; scheduled collectBoards when sport=cfb",
    storage: "D1 cfb_pregame_feature_vectors (source_version=cfb-sdv-source-observed-research-v1)",
    historicalAvailability: "Prospective freeze only; historicalPitVerified=false",
    collectedCurrently: true,
    projectionConsumption: "pit_fallback_audit",
    championConsumes: false,
    gaps: [
      "Never mutates CFB-FBIS-v2 fitted inputs",
      "Requires 4-direction EPA fields; receipt window ≤60 min",
    ],
  },
  {
    id: "sdv-team-directory",
    name: "cfbfastR team directory parquet",
    family: "identity",
    endpointOrFeed: "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb/cfb_teams/parquet/cfb_teams_{year}.parquet",
    fields: ["team_id", "school", "conference", "venue_*", "color", "logos", "aliases"],
    units: "Identity / branding (provider-sourced, not school-verified)",
    identityFields: "cfb:espn:{team_id}",
    seasonWeekScope: "2001–2026 per-season parquet",
    publicationCadence: "Workflow cfb-team-directory-phase-a (manual)",
    ingestionMechanism: "scripts/cfb-team-directory-build.py → wrangler D1",
    storage: "D1 cfb_canonical_teams, aliases, conference_membership",
    historicalAvailability: "Multi-season parquet",
    collectedCurrently: false,
    projectionConsumption: "none",
    championConsumes: false,
    gaps: ["research_only; can_influence_projection=0"],
  },
  {
    id: "sdv-rosters",
    name: "cfbfastR rosters + game_rosters",
    family: "rosters",
    endpointOrFeed: "cfbfastR-cfb-data .../cfb_rosters|game_rosters parquet",
    fields: ["athlete_id", "jersey", "position", "experience", "first/last game/week"],
    units: "Roster membership ≠ confirmed playing time",
    identityFields: "cfb:espn athlete + team ids",
    seasonWeekScope: "Configurable seasons through 2026",
    publicationCadence: "Workflow cfb-player-directory-phase-b",
    ingestionMechanism: "scripts/cfb-player-directory-build.py",
    storage: "D1 cfb_canonical_players, cfb_roster_*; cold archive for observations",
    historicalAvailability: "Multi-season",
    collectedCurrently: false,
    projectionConsumption: "none",
    championConsumes: false,
    gaps: ["PIT resolvability requires distinct first-game times"],
  },
  {
    id: "sdv-player-box",
    name: "espn_cfb_player_box",
    family: "player_box",
    endpointOrFeed: `${SDV_RELEASE_BASE}/espn_cfb_player_box/player_box_{season}.csv`,
    fields: ["passing_*", "rushing_*", "receiving_*", "defensive_*", "kicking_*"],
    units: "Counting stats; offline normalize",
    identityFields: "ESPN game_id + team_id + athlete_id",
    seasonWeekScope: "Arg-driven season; completed finals only",
    publicationCadence: "Forward evidence / postgame contract workflows",
    ingestionMechanism: "scripts/cfb-sdv-player-box-normalize.py (offline)",
    storage: "Staging JSONL/CSV; intended D1 cfb_player_game_stat_observations",
    historicalAvailability: "Release CSVs by season",
    collectedCurrently: true,
    projectionConsumption: "research",
    championConsumes: false,
    gaps: ["Not Worker download; incomplete category coverage"],
  },
  {
    id: "sdv-team-box",
    name: "espn_cfb_team_box",
    family: "team_box",
    endpointOrFeed: `${SDV_RELEASE_BASE}/espn_cfb_team_box/team_box_{season}.csv`,
    fields: ["firstDowns", "totalYards", "pass/rush yards", "turnovers", "3rd/4th down", "possessionTime"],
    units: "Team box counting / rates",
    identityFields: "ESPN game_id + team_id",
    seasonWeekScope: "Season release; FBS whitelist",
    publicationCadence: "Forward / postgame contract",
    ingestionMechanism: "scripts/cfb-sdv-team-box-normalize.py",
    storage: "Staging → cfb_team_game_stat_observations when imported",
    historicalAvailability: "Release CSVs",
    collectedCurrently: true,
    projectionConsumption: "research",
    championConsumes: false,
    gaps: ["Eight recent finals missing boxes reported in shadow rollout docs"],
  },
  {
    id: "sdv-coverage-catalog-39",
    name: "SDV coverage audit (39 CSV families)",
    family: "audit_catalog",
    endpointOrFeed: `${SDV_RELEASE_BASE}/{tag}/{prefix}_{season}.csv`,
    fields: ["All DictReader columns per family — see coverage-manifest"],
    units: "Varies by family",
    identityFields: "Family-specific; typically ESPN ids",
    seasonWeekScope: "Audit season (default 2026)",
    publicationCadence: "scripts/cfb-sdv-coverage-audit.py (on-demand)",
    ingestionMechanism: "Bounded CSV capture; production_consumed=false",
    storage: "research/cfb/sdv-*/coverage-manifest.json",
    historicalAvailability: "39/39 AVAILABLE in frozen 2026 receipt",
    collectedCurrently: false,
    projectionConsumption: "research",
    championConsumes: false,
    gaps: [
      "Whole-season tables forbidden in prior-week backtests",
      "model_pbp 2026 audited UNAVAILABLE (404)",
      "ncaa_pbp_box catalogued ADD but no CFB NCAA loader",
    ],
  },
  {
    id: "sdv-adv-team-gamelog-historical",
    name: "Advanced team gamelog historical (2021–2025)",
    family: "adv_team_gamelog",
    endpointOrFeed: `${SDV_RELEASE_BASE}/espn_cfb_adv_team_gamelog/adv_team_gamelog_{year}.csv`,
    fields: ["~76 numeric postgame columns; schedule join keys"],
    units: "Advanced efficiency — POSTGAME_HISTORICAL_RELEASE_ONLY",
    identityFields: "ESPN game/team + final score agreement",
    seasonWeekScope: "Default 2021–2025; vetted 2004–2026",
    publicationCadence: "workflow_dispatch cfb-sdv-historical-research",
    ingestionMechanism: "scripts/cfb-sdv-historical-collect.py",
    storage: "Immutable run dir → GH artifact (not D1)",
    historicalAvailability: "Yes; pit_certified=false",
    collectedCurrently: false,
    projectionConsumption: "research",
    championConsumes: false,
    gaps: ["No incremental SVD advantage vs ridge in holdout research"],
  },
  {
    id: "sdv-line-odds-archive",
    name: "cfbfastR historical line odds",
    family: "market_eval",
    endpointOrFeed: "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/betting/parquet/cfb_line_odds.parquet",
    fields: ["sdv_archive_home_spread", "sdv_archive_total", "sdv_archive_*_ml", "books"],
    units: "Multi-book median consensus — evaluation only",
    identityFields: "Normalized game_id",
    seasonWeekScope: "Labeled ~2006–2025",
    publicationCadence: "History finalize workflows",
    ingestionMechanism: "scripts/cfb-sdv-line-archive.py",
    storage: "artifacts/cfb-line-archive/",
    historicalAvailability: "Yes",
    collectedCurrently: false,
    projectionConsumption: "none",
    championConsumes: false,
    gaps: ["Must not enter independent FBIS score"],
  },
]);

export function searchSdvRegistry(query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [...SDV_SOURCE_REGISTRY];
  return SDV_SOURCE_REGISTRY.filter((d) => {
    const hay = [
      d.id, d.name, d.family, d.endpointOrFeed, d.units,
      d.ingestionMechanism, d.storage, ...(d.fields || []), ...(d.gaps || []),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function summarizeSdvRegistry() {
  const rows = SDV_SOURCE_REGISTRY;
  return {
    version: SDV_REGISTRY_VERSION,
    nDatasets: rows.length,
    collectedCurrently: rows.filter((d) => d.collectedCurrently).length,
    championConsumes: rows.filter((d) => d.championConsumes).length,
    displayOnly: rows.filter((d) => d.projectionConsumption === "display").length,
    research: rows.filter((d) => d.projectionConsumption === "research" || d.projectionConsumption === "pit_fallback_audit").length,
    note: "SDV never authorizes wagers. Fitted CFB-FBIS-v2 does not consume SDV fields.",
  };
}
