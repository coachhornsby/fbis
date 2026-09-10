/**
 * FBIS canonical CFB feature dictionary mapped to CFBD endpoints.
 * Availability flags are refined by live cfbd-endpoint-audit results.
 * Market features are evaluation-only and MUST NOT enter independent score generation.
 */

export const FEATURE_CATALOG_VERSION = "cfb-feature-catalog-v2";

/** @typedef {"prior"|"matchup"|"context"|"qb"|"personnel"|"evaluation"|"benchmark"|"exclude"} FeatureUse */
/** @typedef {"A"|"B"|"C"|"D"|"E"} TemporalSafetyClass */

/**
 * Temporal safety:
 * A PRE-KICKOFF SAFE DIRECTLY
 * B SAFE IF WEEK/GAME FILTERED
 * C MUST BE RECONSTRUCTED FROM GAME/PLAY DATA
 * D NOT SAFE FOR HISTORICAL BACKTEST (same-season aggregates without as-of)
 * E EVALUATION-ONLY
 */
/**
 * @type {Array<{
 *  canonical: string,
 *  group: string,
 *  endpoint: string,
 *  rawFields: string[],
 *  unit: string,
 *  orientation: "offense"|"defense"|"team"|"player"|"context"|"market"|"both",
 *  higherIsBetter: boolean|null,
 *  grain: "season"|"game"|"player"|"venue"|"team",
 *  opponentAdjusted: boolean,
 *  availabilityTiming: string,
 *  leakageRisk: "none"|"low"|"medium"|"high",
 *  pregameSafe: boolean|"conditional",
 *  fallback: string|null,
 *  usedInChampion: boolean,
 *  candidateForChallenger: boolean,
 *  use: FeatureUse,
 *  notes?: string
 * }>}
 */
export const CFBD_FEATURE_CATALOG = [
  // BASE POWER
  { canonical: "sp_plus_overall", group: "BASE POWER", endpoint: "/ratings/sp", rawFields: ["rating"], unit: "points vs avg", orientation: "team", higherIsBetter: true, grain: "season", opponentAdjusted: true, availabilityTiming: "season snapshot; not true as-of week unless dated observation stored", leakageRisk: "high", pregameSafe: "conditional", fallback: "prior-season frozen SP+", usedInChampion: true, candidateForChallenger: true, use: "prior", notes: "Use prior-season freeze for early weeks; never end-of-season SP+ for earlier games" },
  { canonical: "sp_plus_offense", group: "BASE POWER", endpoint: "/ratings/sp", rawFields: ["offense.rating"], unit: "expected points", orientation: "offense", higherIsBetter: true, grain: "season", opponentAdjusted: true, availabilityTiming: "season snapshot", leakageRisk: "high", pregameSafe: "conditional", fallback: "prior-season", usedInChampion: true, candidateForChallenger: true, use: "prior" },
  { canonical: "sp_plus_defense", group: "BASE POWER", endpoint: "/ratings/sp", rawFields: ["defense.rating"], unit: "expected points allowed", orientation: "defense", higherIsBetter: false, grain: "season", opponentAdjusted: true, availabilityTiming: "season snapshot", leakageRisk: "high", pregameSafe: "conditional", fallback: "prior-season", usedInChampion: true, candidateForChallenger: true, use: "prior" },
  { canonical: "fpi_overall", group: "BASE POWER", endpoint: "/ratings/fpi", rawFields: ["fpi"], unit: "points vs avg", orientation: "team", higherIsBetter: true, grain: "season", opponentAdjusted: true, availabilityTiming: "season snapshot", leakageRisk: "high", pregameSafe: "conditional", fallback: "prior-season FPI", usedInChampion: true, candidateForChallenger: true, use: "prior" },
  { canonical: "srs_rating", group: "BASE POWER", endpoint: "/ratings/srs", rawFields: ["rating"], unit: "SRS points", orientation: "team", higherIsBetter: true, grain: "season", opponentAdjusted: true, availabilityTiming: "season snapshot", leakageRisk: "high", pregameSafe: "conditional", fallback: "Elo", usedInChampion: true, candidateForChallenger: true, use: "prior" },
  { canonical: "elo_rating", group: "BASE POWER", endpoint: "/ratings/elo", rawFields: ["elo"], unit: "Elo (~1500 center)", orientation: "team", higherIsBetter: true, grain: "season", opponentAdjusted: true, availabilityTiming: "season snapshot; reconstructable historically if dated", leakageRisk: "medium", pregameSafe: "conditional", fallback: "SP+", usedInChampion: true, candidateForChallenger: true, use: "prior" },
  { canonical: "core_overall", group: "BASE POWER", endpoint: "/ratings/core", rawFields: ["overall"], unit: "CORE efficiency", orientation: "team", higherIsBetter: true, grain: "season", opponentAdjusted: true, availabilityTiming: "if entitled; may 404", leakageRisk: "high", pregameSafe: "conditional", fallback: "SP+", usedInChampion: false, candidateForChallenger: true, use: "prior", notes: "Probe entitlement; exclude if unavailable" },

  // OFFENSE / DEFENSE advanced
  { canonical: "ppa_offense_overall", group: "OFFENSE", endpoint: "/ppa/teams", rawFields: ["offense.overall"], unit: "PPA/play", orientation: "offense", higherIsBetter: true, grain: "season", opponentAdjusted: true, availabilityTiming: "in-season cumulative unless week-bounded; prefer rolling from /ppa/games", leakageRisk: "high", pregameSafe: "conditional", fallback: "prior-season PPA", usedInChampion: true, candidateForChallenger: true, use: "matchup" },
  { canonical: "ppa_offense_passing", group: "OFFENSE", endpoint: "/ppa/teams", rawFields: ["offense.passing"], unit: "PPA/play", orientation: "offense", higherIsBetter: true, grain: "season", opponentAdjusted: true, availabilityTiming: "same as season PPA", leakageRisk: "high", pregameSafe: "conditional", fallback: "rolling game PPA", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "ppa_offense_rushing", group: "OFFENSE", endpoint: "/ppa/teams", rawFields: ["offense.rushing"], unit: "PPA/play", orientation: "offense", higherIsBetter: true, grain: "season", opponentAdjusted: true, availabilityTiming: "same as season PPA", leakageRisk: "high", pregameSafe: "conditional", fallback: "rolling game PPA", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "ppa_defense_overall", group: "DEFENSE", endpoint: "/ppa/teams", rawFields: ["defense.overall"], unit: "PPA/play allowed", orientation: "defense", higherIsBetter: false, grain: "season", opponentAdjusted: true, availabilityTiming: "same as season PPA", leakageRisk: "high", pregameSafe: "conditional", fallback: "prior-season", usedInChampion: true, candidateForChallenger: true, use: "matchup" },
  { canonical: "ppa_defense_passing", group: "DEFENSE", endpoint: "/ppa/teams", rawFields: ["defense.passing"], unit: "PPA/play allowed", orientation: "defense", higherIsBetter: false, grain: "season", opponentAdjusted: true, availabilityTiming: "same as season PPA", leakageRisk: "high", pregameSafe: "conditional", fallback: "rolling", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "ppa_defense_rushing", group: "DEFENSE", endpoint: "/ppa/teams", rawFields: ["defense.rushing"], unit: "PPA/play allowed", orientation: "defense", higherIsBetter: false, grain: "season", opponentAdjusted: true, availabilityTiming: "same as season PPA", leakageRisk: "high", pregameSafe: "conditional", fallback: "rolling", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "game_ppa_offense", group: "OFFENSE", endpoint: "/ppa/games", rawFields: ["offense.overall"], unit: "PPA/play", orientation: "offense", higherIsBetter: true, grain: "game", opponentAdjusted: false, availabilityTiming: "postgame; use only games before kickoff", leakageRisk: "none", pregameSafe: true, fallback: null, usedInChampion: false, candidateForChallenger: true, use: "matchup", notes: "Primary temporal reconstruction source" },
  { canonical: "adv_success_offense", group: "OFFENSE", endpoint: "/stats/season/advanced", rawFields: ["offense.successRate"], unit: "rate", orientation: "offense", higherIsBetter: true, grain: "season", opponentAdjusted: false, availabilityTiming: "cumulative season; reconstruct from /stats/game/advanced", leakageRisk: "high", pregameSafe: "conditional", fallback: "game advanced rolling", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "adv_explosiveness_offense", group: "OFFENSE", endpoint: "/stats/season/advanced", rawFields: ["offense.explosiveness"], unit: "index", orientation: "offense", higherIsBetter: true, grain: "season", opponentAdjusted: false, availabilityTiming: "cumulative", leakageRisk: "high", pregameSafe: "conditional", fallback: "game advanced", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "adv_havoc_defense", group: "DEFENSE", endpoint: "/stats/season/advanced", rawFields: ["defense.havoc.total"], unit: "rate", orientation: "defense", higherIsBetter: true, grain: "season", opponentAdjusted: false, availabilityTiming: "cumulative", leakageRisk: "high", pregameSafe: "conditional", fallback: "game advanced", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "adv_line_yards_offense", group: "OFFENSE", endpoint: "/stats/season/advanced", rawFields: ["offense.lineYards"], unit: "yards/carry proxy", orientation: "offense", higherIsBetter: true, grain: "season", opponentAdjusted: false, availabilityTiming: "cumulative", leakageRisk: "high", pregameSafe: "conditional", fallback: "game advanced", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "adv_stuff_rate_defense", group: "DEFENSE", endpoint: "/stats/season/advanced", rawFields: ["defense.stuffRate"], unit: "rate", orientation: "defense", higherIsBetter: true, grain: "season", opponentAdjusted: false, availabilityTiming: "cumulative", leakageRisk: "high", pregameSafe: "conditional", fallback: "game advanced", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "adv_points_per_opportunity", group: "OFFENSE", endpoint: "/stats/season/advanced", rawFields: ["offense.pointsPerOpportunity"], unit: "points", orientation: "offense", higherIsBetter: true, grain: "season", opponentAdjusted: false, availabilityTiming: "cumulative", leakageRisk: "high", pregameSafe: "conditional", fallback: "game advanced", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "adv_standard_downs", group: "OFFENSE", endpoint: "/stats/season/advanced", rawFields: ["offense.standardDowns.successRate", "offense.passingDowns.successRate"], unit: "rate", orientation: "offense", higherIsBetter: true, grain: "season", opponentAdjusted: false, availabilityTiming: "cumulative", leakageRisk: "high", pregameSafe: "conditional", fallback: "game advanced", usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "game_adv_success", group: "OFFENSE", endpoint: "/stats/game/advanced", rawFields: ["offense.successRate", "defense.successRate"], unit: "rate", orientation: "both", higherIsBetter: null, grain: "game", opponentAdjusted: false, availabilityTiming: "postgame only before next kickoff", leakageRisk: "none", pregameSafe: true, fallback: null, usedInChampion: false, candidateForChallenger: true, use: "matchup" },
  { canonical: "pace_plays", group: "OFFENSE", endpoint: "/stats/season/advanced", rawFields: ["offense.plays", "offense.drives"], unit: "plays/drives", orientation: "offense", higherIsBetter: null, grain: "season", opponentAdjusted: false, availabilityTiming: "cumulative", leakageRisk: "medium", pregameSafe: "conditional", fallback: "games season stats", usedInChampion: false, candidateForChallenger: true, use: "matchup" },

  // QB
  { canonical: "qb_ppa_season", group: "QB", endpoint: "/ppa/players/season", rawFields: ["averagePPA.all", "averagePPA.pass"], unit: "PPA", orientation: "player", higherIsBetter: true, grain: "player", opponentAdjusted: true, availabilityTiming: "cumulative; prior season for new starters", leakageRisk: "medium", pregameSafe: "conditional", fallback: "usage + team pass PPA residual", usedInChampion: false, candidateForChallenger: true, use: "qb" },
  { canonical: "qb_usage", group: "QB", endpoint: "/player/usage", rawFields: ["usage.overall", "usage.pass"], unit: "share", orientation: "player", higherIsBetter: null, grain: "player", opponentAdjusted: false, availabilityTiming: "cumulative", leakageRisk: "medium", pregameSafe: "conditional", fallback: "roster starter flag", usedInChampion: false, candidateForChallenger: true, use: "qb" },
  { canonical: "qb_passing_stats", group: "QB", endpoint: "/stats/player/season", rawFields: ["stat"], unit: "mixed", orientation: "player", higherIsBetter: null, grain: "player", opponentAdjusted: false, availabilityTiming: "cumulative", leakageRisk: "medium", pregameSafe: "conditional", fallback: null, usedInChampion: false, candidateForChallenger: true, use: "qb" },

  // PERSONNEL
  { canonical: "returning_production", group: "PERSONNEL", endpoint: "/player/returning", rawFields: ["percentPPA", "usage"], unit: "fraction", orientation: "team", higherIsBetter: true, grain: "season", opponentAdjusted: false, availabilityTiming: "preseason", leakageRisk: "none", pregameSafe: true, fallback: null, usedInChampion: false, candidateForChallenger: true, use: "prior" },
  { canonical: "team_talent", group: "PERSONNEL", endpoint: "/talent", rawFields: ["talent"], unit: "0-1000 composite", orientation: "team", higherIsBetter: true, grain: "season", opponentAdjusted: false, availabilityTiming: "recruiting year", leakageRisk: "low", pregameSafe: true, fallback: "recruiting points", usedInChampion: false, candidateForChallenger: true, use: "prior" },
  { canonical: "recruiting_team", group: "PERSONNEL", endpoint: "/recruiting/teams", rawFields: ["points", "rank"], unit: "points/rank", orientation: "team", higherIsBetter: true, grain: "season", opponentAdjusted: false, availabilityTiming: "class year", leakageRisk: "low", pregameSafe: true, fallback: "talent", usedInChampion: false, candidateForChallenger: true, use: "prior" },
  { canonical: "transfer_portal", group: "PERSONNEL", endpoint: "/player/portal", rawFields: ["direction", "position", "destination"], unit: "identity", orientation: "player", higherIsBetter: null, grain: "player", opponentAdjusted: false, availabilityTiming: "preseason/offseason", leakageRisk: "low", pregameSafe: true, fallback: null, usedInChampion: false, candidateForChallenger: true, use: "prior" },
  { canonical: "roster", group: "PERSONNEL", endpoint: "/roster", rawFields: ["id", "name", "position"], unit: "identity", orientation: "player", higherIsBetter: null, grain: "player", opponentAdjusted: false, availabilityTiming: "season roster", leakageRisk: "low", pregameSafe: true, fallback: null, usedInChampion: false, candidateForChallenger: true, use: "prior" },
  { canonical: "coaching", group: "PERSONNEL", endpoint: "/coaches", rawFields: ["hireDate", "firstName", "lastName"], unit: "identity/tenure", orientation: "team", higherIsBetter: null, grain: "season", opponentAdjusted: false, availabilityTiming: "season", leakageRisk: "low", pregameSafe: true, fallback: null, usedInChampion: false, candidateForChallenger: true, use: "prior" },

  // CONTEXT
  { canonical: "hfa", group: "CONTEXT", endpoint: "internal", rawFields: ["neutralSite"], unit: "points", orientation: "context", higherIsBetter: null, grain: "game", opponentAdjusted: false, availabilityTiming: "schedule known pregame", leakageRisk: "none", pregameSafe: true, fallback: "2.5 production constant", usedInChampion: true, candidateForChallenger: true, use: "context", notes: "Preserve 2.5 until challenger evidence" },
  { canonical: "neutral_site", group: "CONTEXT", endpoint: "/games", rawFields: ["neutral_site", "neutralSite"], unit: "boolean", orientation: "context", higherIsBetter: null, grain: "game", opponentAdjusted: false, availabilityTiming: "schedule", leakageRisk: "none", pregameSafe: true, fallback: null, usedInChampion: true, candidateForChallenger: true, use: "context" },
  { canonical: "weather", group: "CONTEXT", endpoint: "/games/weather", rawFields: ["temperature", "windSpeed", "humidity", "gameIndoors"], unit: "mixed", orientation: "context", higherIsBetter: null, grain: "game", opponentAdjusted: false, availabilityTiming: "pregame forecast (Patreon tier may apply)", leakageRisk: "low", pregameSafe: true, fallback: "omit", usedInChampion: false, candidateForChallenger: true, use: "context" },
  { canonical: "venue_altitude", group: "CONTEXT", endpoint: "/venues", rawFields: ["elevation", "dome", "timezone"], unit: "meters/tz", orientation: "venue", higherIsBetter: null, grain: "venue", opponentAdjusted: false, availabilityTiming: "static", leakageRisk: "none", pregameSafe: true, fallback: null, usedInChampion: false, candidateForChallenger: true, use: "context" },
  { canonical: "rest_days", group: "CONTEXT", endpoint: "/games", rawFields: ["start_date"], unit: "days", orientation: "context", higherIsBetter: null, grain: "game", opponentAdjusted: false, availabilityTiming: "derived from prior schedule", leakageRisk: "none", pregameSafe: true, fallback: null, usedInChampion: false, candidateForChallenger: true, use: "context" },

  // MARKET — evaluation only
  { canonical: "closing_lines", group: "MARKET", endpoint: "/lines", rawFields: ["lines.spread", "lines.overUnder", "lines.provider"], unit: "points", orientation: "market", higherIsBetter: null, grain: "game", opponentAdjusted: false, availabilityTiming: "closing; evaluation/CLV only", leakageRisk: "n/a-eval", pregameSafe: false, fallback: "Pinnacle/DK/FD production books", usedInChampion: false, candidateForChallenger: false, use: "evaluation", notes: "MUST NOT enter independent FBIS score" },
  { canonical: "pregame_wp", group: "MARKET", endpoint: "/metrics/wp/pregame", rawFields: ["homeWinProb"], unit: "probability", orientation: "market", higherIsBetter: null, grain: "game", opponentAdjusted: false, availabilityTiming: "pregame market-ish", leakageRisk: "n/a-eval", pregameSafe: false, fallback: null, usedInChampion: false, candidateForChallenger: false, use: "evaluation", notes: "Treat as market baseline, not independent feature" },
];

export function catalogByCanonical() {
  return Object.fromEntries(CFBD_FEATURE_CATALOG.map((f) => [f.canonical, f]));
}

export function featuresForUse(use) {
  return CFBD_FEATURE_CATALOG.filter((f) => f.use === use);
}

export function independentModelFeatures() {
  return CFBD_FEATURE_CATALOG.filter((f) => f.candidateForChallenger && f.use !== "evaluation");
}

export function leakageExcludedFromTemporal() {
  return CFBD_FEATURE_CATALOG.filter((f) => f.leakageRisk === "high" && f.pregameSafe !== true);
}

/**
 * Merge live audit classifications into a feature availability table.
 */
export function featureAvailabilityTable(auditByEndpoint = {}) {
  return CFBD_FEATURE_CATALOG.map((f) => {
    const audit = auditByEndpoint[f.endpoint] || null;
    const available2026 =
      f.endpoint === "internal"
        ? true
        : audit
          ? ["AVAILABLE", "AVAILABLE-BUT-EMPTY"].includes(audit.classification)
          : null;
    const historical =
      f.endpoint === "internal"
        ? true
        : audit
          ? audit.classification === "AVAILABLE" || audit.classification === "AVAILABLE-BUT-EMPTY"
          : null;
    const pregame =
      f.pregameSafe === true ? "✅" : f.pregameSafe === "conditional" ? "⚠️" : f.use === "evaluation" ? "❌ model" : "❌";
    let temporalSafety = "D";
    if (f.use === "evaluation") temporalSafety = "E";
    else if (f.pregameSafe === true && f.leakageRisk === "none") temporalSafety = "A";
    else if (f.grain === "game" || f.endpoint === "/ppa/games" || f.endpoint === "/stats/game/advanced") temporalSafety = "B";
    else if (
      ["/ppa/teams", "/stats/season/advanced", "/stats/season"].includes(f.endpoint) ||
      (f.grain === "season" && f.leakageRisk === "high" && f.use === "matchup")
    ) {
      temporalSafety = "C";
    } else if (f.grain === "season" && (f.use === "prior" || f.use === "benchmark")) {
      temporalSafety = "D";
    } else if (f.pregameSafe === true) temporalSafety = "A";
    return {
      feature: f.canonical,
      group: f.group,
      endpoint: f.endpoint,
      available2026: available2026 == null ? "unprobed" : available2026 ? "✅" : "❌",
      historical: historical == null ? "unprobed" : historical ? "✅" : "❌",
      pregameSafe: pregame,
      temporalSafety,
      use: f.use,
      leakageRisk: f.leakageRisk,
      classification: audit?.classification || (f.endpoint === "internal" ? "INTERNAL" : "UNPROBED"),
      sampleFieldNames: audit?.sampleFieldNames || f.rawFields,
      usedInChampion: f.usedInChampion,
      candidateForChallenger: f.candidateForChallenger,
    };
  });
}

export function markdownFeatureTable(rows) {
  const header =
    "| Feature | Endpoint | 2026? | Historical? | Pregame-safe? | Temporal | Use |\n|---|---|---|---|---|---|---|";
  const body = rows
    .map(
      (r) =>
        `| ${r.feature} | ${r.endpoint} | ${r.available2026} | ${r.historical} | ${r.pregameSafe} | ${r.temporalSafety || "?"} | ${r.use} |`
    )
    .join("\n");
  return `${header}\n${body}`;
}
