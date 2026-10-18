/**
 * Compare available current-season team intelligence fields vs fields that
 * actually move CFB-FBIS-v2 fitted production scores (M*=A / T*=A).
 *
 * Being collected ≠ being consumed. Fitted champion uses only blended base /
 * base_total from overall PPA (+ prior) and observation count n.
 */

export const CFB_AVAILABLE_CURRENT_SEASON_FIELDS = Object.freeze([
  { key: "ppaOff", unit: "PPA/play", role: "offense" },
  { key: "ppaDef", unit: "PPA/play", role: "defense" },
  { key: "ppaPass", unit: "PPA/play", role: "offense-pass" },
  { key: "ppaRush", unit: "PPA/play", role: "offense-rush" },
  { key: "ppaPassAllowed", unit: "PPA/play", role: "defense-pass" },
  { key: "ppaRushAllowed", unit: "PPA/play", role: "defense-rush" },
  { key: "offensiveSuccessRate", unit: "rate", role: "offense" },
  { key: "defensiveSuccessRate", unit: "rate", role: "defense" },
  { key: "offensiveExplosiveness", unit: "explosiveness", role: "offense" },
  { key: "defensiveExplosiveness", unit: "explosiveness", role: "defense" },
  { key: "offensiveHavoc", unit: "havoc rate", role: "offense-allowed" },
  { key: "defensiveHavoc", unit: "havoc rate", role: "defense" },
  { key: "offensiveLineYards", unit: "yards/carry proxy", role: "offense" },
  { key: "defensiveLineYards", unit: "yards/carry proxy", role: "defense" },
  { key: "offensivePointsPerOpportunity", unit: "points/opportunity", role: "offense" },
  { key: "defensivePointsPerOpportunity", unit: "points/opportunity", role: "defense" },
  { key: "core", unit: "CORE/100 plays", role: "overall" },
  { key: "coreOffense", unit: "CORE/100 plays", role: "offense" },
  { key: "coreDefense", unit: "CORE/100 plays", role: "defense" },
  { key: "coreThroughWeek", unit: "week", role: "provenance" },
  { key: "gamesPlayed", unit: "games", role: "observation-count" },
  { key: "currentPointsForPerGame", unit: "PPG", role: "offense-form" },
  { key: "currentPointsAgainstPerGame", unit: "PPG", role: "defense-form" },
]);

/** Fields that enter fitted M*=A / T*=A production scores. */
export const CFB_CHAMPION_CONSUMED_FIELDS = Object.freeze([
  {
    key: "ppaOff",
    effect: "current offense = 26.5 + ppaOff*40; blended with priorOff via n/(n+6)",
  },
  {
    key: "ppaDef",
    effect: "current defense = 26.5 + ppaDef*40; blended with priorDef via n/(n+6)",
  },
  {
    key: "gamesPlayed",
    effect: "observation count n for prior decay (schedule preferred; coreThroughWeek fallback flagged)",
  },
  {
    key: "coreThroughWeek",
    effect: "fallback n only when gamesPlayed missing and coreWeekBounded; not a CORE rating input to fitted score",
  },
  {
    key: "priorOff",
    effect: "2025 prior-v1 offensive points prior",
  },
  {
    key: "priorDef",
    effect: "2025 prior-v1 defensive points prior",
  },
]);

/** Collected / shown on pages but zero effect on fitted champion scores. */
export const CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION = Object.freeze([
  "ppaPass",
  "ppaRush",
  "ppaPassAllowed",
  "ppaRushAllowed",
  "offensiveSuccessRate",
  "defensiveSuccessRate",
  "offensiveExplosiveness",
  "defensiveExplosiveness",
  "offensiveHavoc",
  "defensiveHavoc",
  "offensiveLineYards",
  "defensiveLineYards",
  "offensivePointsPerOpportunity",
  "defensivePointsPerOpportunity",
  "core",
  "coreOffense",
  "coreDefense",
  "currentPointsForPerGame",
  "currentPointsAgainstPerGame",
  "talent",
  "returningPpa",
  "sp",
  "fpi",
  "srs",
  "elo",
]);

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Audit one team's available snapshot vs champion consumption.
 */
export function auditTeamFeatureUsage(features = {}, { gamesPlayedSource = null } = {}) {
  const available = {};
  for (const f of CFB_AVAILABLE_CURRENT_SEASON_FIELDS) {
    available[f.key] = num(features[f.key] ?? features[f.key.replace(/^offensive/, "offensive")]);
  }
  // Normalize deep-feed aliases
  available.ppaOff = available.ppaOff ?? num(features.offensePpa);
  available.ppaDef = available.ppaDef ?? num(features.defensePpa);
  available.gamesPlayed = available.gamesPlayed ?? num(features.gamesPlayed);

  const consumed = {
    ppaOff: available.ppaOff,
    ppaDef: available.ppaDef,
    gamesPlayed: available.gamesPlayed,
    gamesPlayedSource: gamesPlayedSource || features.gamesPlayedSource || null,
    coreThroughWeekUsedAsN:
      (gamesPlayedSource || features.gamesPlayedSource) === "coreThroughWeekFallback",
  };

  const presentButUnused = CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION.filter(
    (k) => num(features[k] ?? available[k]) != null
  );

  const missingCriticalForChampion = [];
  if (consumed.ppaOff == null) missingCriticalForChampion.push("ppaOff");
  if (consumed.ppaDef == null) missingCriticalForChampion.push("ppaDef");
  if (!(consumed.gamesPlayed > 0)) missingCriticalForChampion.push("gamesPlayed");

  return {
    available,
    championConsumed: consumed,
    presentButUnusedByChampion: presentButUnused,
    missingCriticalForChampion,
    note:
      "Fitted CFB-FBIS-v2 (M*=A/T*=A) scores depend only on blended prior+PPA base power. Advanced rates/CORE ratings are research display unless a verified challenger artifact is promoted.",
  };
}

/**
 * Aggregate coverage: how many teams have page-visible fields vs champion-usable n+PPA.
 */
export function summarizeFeatureCoverage(teamFeatureRows = []) {
  let withPagePpa = 0;
  let withChampionN = 0;
  let withBoth = 0;
  let pageWithoutN = 0;
  let coreThroughWeekFallback = 0;
  for (const row of teamFeatureRows) {
    const audit = auditTeamFeatureUsage(row.features || row, {
      gamesPlayedSource: row.gamesPlayedSource || row.features?.gamesPlayedSource,
    });
    const hasPpa = audit.championConsumed.ppaOff != null || audit.available.ppaOff != null;
    const hasN = audit.championConsumed.gamesPlayed > 0;
    if (hasPpa) withPagePpa += 1;
    if (hasN) withChampionN += 1;
    if (hasPpa && hasN) withBoth += 1;
    if (hasPpa && !hasN) pageWithoutN += 1;
    if (audit.championConsumed.coreThroughWeekUsedAsN) coreThroughWeekFallback += 1;
  }
  return {
    nTeams: teamFeatureRows.length,
    withPagePpa,
    withChampionN,
    withBoth,
    pageWithoutN,
    coreThroughWeekFallback,
    parityGap: pageWithoutN,
  };
}
