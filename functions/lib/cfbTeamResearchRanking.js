/**
 * FBIS-computed national/conference ranks and performance percentiles
 * for CFB team research panels. Research-only; never triggers CFBD.
 */

export const CFB_RESEARCH_RANK_AUTHORITY = "fbis_computed_research";
export const MIN_NATIONAL_SAMPLE = 20;
export const MIN_CONFERENCE_SAMPLE = 4;

/** @typedef {"higher_better"|"lower_better"} Polarity */

/**
 * Metric catalog for research panels.
 * polarity: preferred direction for *performance* (elite).
 * format: display formatting hint.
 * ratingKind: source_published | derived_stat
 */
export const CFB_RESEARCH_METRICS = Object.freeze([
  {
    id: "core", label: "CORE", units: "rating", format: "rating",
    polarity: "higher_better", panel: "core",
    description: "Week-bounded CFBD CORE overall rating. Higher is better.",
    ratingKind: "source_published", source: "CFBD /ratings/core (persisted)",
  },
  {
    id: "coreOffense", label: "CORE offense", units: "rating", format: "rating",
    polarity: "higher_better", panel: "core",
    description: "CORE offensive component. Higher is better.",
    ratingKind: "source_published", source: "CFBD /ratings/core (persisted)",
  },
  {
    id: "coreDefense", label: "CORE defense", units: "rating", format: "rating",
    polarity: "lower_better", panel: "core",
    description: "CORE defensive component (points-style). Lower is better.",
    ratingKind: "source_published", source: "CFBD /ratings/core (persisted)",
  },
  // Special teams intentionally omitted from CORE panel — CORE excludes ST in FBIS display.

  {
    id: "offensiveSuccessRate", label: "Off success rate", units: "rate", format: "rate",
    polarity: "higher_better", panel: "efficiency",
    description: "Offensive success rate. Higher is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },
  {
    id: "defensiveSuccessRate", label: "Def success allowed", units: "rate", format: "rate",
    polarity: "lower_better", panel: "efficiency",
    description: "Opponent success rate allowed. Lower is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },
  {
    id: "offensiveExplosiveness", label: "Off explosiveness", units: "index", format: "rate",
    polarity: "higher_better", panel: "efficiency",
    description: "Offensive explosiveness index. Higher is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },
  {
    id: "defensiveExplosiveness", label: "Def explosiveness allowed", units: "index", format: "rate",
    polarity: "lower_better", panel: "efficiency",
    description: "Explosive production allowed. Lower is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },
  {
    id: "offensivePointsPerOpportunity", label: "Off PPO", units: "points", format: "rate",
    polarity: "higher_better", panel: "efficiency",
    description: "Points per scoring opportunity. Higher is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },
  {
    id: "defensivePointsPerOpportunity", label: "Def PPO allowed", units: "points", format: "rate",
    polarity: "lower_better", panel: "efficiency",
    description: "Points per opportunity allowed. Lower is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },

  {
    id: "ppaOff", label: "Off PPA", units: "ppa", format: "ppa",
    polarity: "higher_better", panel: "ppa",
    description: "Predicted points added on offense. Higher is better. Not EPA.",
    ratingKind: "derived_stat", source: "CFBD /ppa/teams (persisted)",
  },
  {
    id: "ppaDef", label: "Def PPA", units: "ppa", format: "ppa",
    polarity: "lower_better", panel: "ppa",
    description: "PPA allowed on defense. Lower is better.",
    ratingKind: "derived_stat", source: "CFBD /ppa/teams (persisted)",
  },
  {
    id: "ppaPass", label: "Pass PPA", units: "ppa", format: "ppa",
    polarity: "higher_better", panel: "ppa",
    description: "Passing PPA. Higher is better.",
    ratingKind: "derived_stat", source: "CFBD /ppa/teams (persisted)",
  },
  {
    id: "ppaRush", label: "Rush PPA", units: "ppa", format: "ppa",
    polarity: "higher_better", panel: "ppa",
    description: "Rushing PPA. Higher is better.",
    ratingKind: "derived_stat", source: "CFBD /ppa/teams (persisted)",
  },
  {
    id: "ppaPassAllowed", label: "Pass PPA allowed", units: "ppa", format: "ppa",
    polarity: "lower_better", panel: "ppa",
    description: "Passing PPA allowed. Lower is better.",
    ratingKind: "derived_stat", source: "CFBD /ppa/teams (persisted)",
  },
  {
    id: "ppaRushAllowed", label: "Rush PPA allowed", units: "ppa", format: "ppa",
    polarity: "lower_better", panel: "ppa",
    description: "Rushing PPA allowed. Lower is better.",
    ratingKind: "derived_stat", source: "CFBD /ppa/teams (persisted)",
  },

  {
    id: "offensiveLineYards", label: "Off line yards", units: "yards", format: "yards",
    polarity: "higher_better", panel: "trenches",
    description: "Offensive line yards per carry. Higher is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },
  {
    id: "defensiveLineYards", label: "Def line yards allowed", units: "yards", format: "yards",
    polarity: "lower_better", panel: "trenches",
    description: "Line yards allowed. Lower is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },
  {
    id: "offensiveHavoc", label: "Off havoc allowed", units: "rate", format: "rate",
    polarity: "lower_better", panel: "trenches",
    description: "Havoc rate suffered by the offense (TFLs/INTs/PDs/forced fumbles against). Lower is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },
  {
    id: "defensiveHavoc", label: "Def havoc created", units: "rate", format: "rate",
    polarity: "higher_better", panel: "trenches",
    description: "Havoc rate created by the defense. Higher is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },
  {
    id: "offensiveStuffRate", label: "Off stuff rate", units: "rate", format: "rate",
    polarity: "lower_better", panel: "trenches",
    description: "Stuff rate against the offense. Lower is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },
  {
    id: "defensiveStuffRate", label: "Def stuff rate", units: "rate", format: "rate",
    polarity: "higher_better", panel: "trenches",
    description: "Defensive stuff rate created. Higher is better.",
    ratingKind: "derived_stat", source: "CFBD /stats/season/advanced (persisted)",
  },

  {
    id: "sp", label: "SP+", units: "rating", format: "rating",
    polarity: "higher_better", panel: "ratings",
    description: "Source-published SP+ rating. Higher is better. Rank is FBIS-computed.",
    ratingKind: "source_published", source: "CFBD /ratings/sp (persisted)",
  },
  {
    id: "fpi", label: "FPI", units: "rating", format: "rating",
    polarity: "higher_better", panel: "ratings",
    description: "Source-published FPI. Higher is better. Rank is FBIS-computed.",
    ratingKind: "source_published", source: "CFBD /ratings/fpi (persisted)",
  },
  {
    id: "elo", label: "Elo", units: "rating", format: "elo",
    polarity: "higher_better", panel: "ratings",
    description: "Source-published Elo. Higher is better. Rank is FBIS-computed.",
    ratingKind: "source_published", source: "CFBD /ratings/elo (persisted)",
  },
  {
    id: "srs", label: "SRS", units: "rating", format: "rating",
    polarity: "higher_better", panel: "ratings",
    description: "Source-published SRS. Higher is better. Rank is FBIS-computed.",
    ratingKind: "source_published", source: "CFBD /ratings/srs (persisted)",
  },
  {
    id: "talent", label: "Talent", units: "index", format: "rating",
    polarity: "higher_better", panel: "ratings",
    description: "Recruiting talent composite. Higher is better. Rank is FBIS-computed.",
    ratingKind: "source_published", source: "CFBD /talent (persisted)",
  },
]);

export const CFB_RESEARCH_METRIC_BY_ID = Object.freeze(
  Object.fromEntries(CFB_RESEARCH_METRICS.map((m) => [m.id, m]))
);

export function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function flattenFeatures(features = {}) {
  if (!features || typeof features !== "object") return {};
  const flat = { ...features };
  for (const group of ["offense", "defense", "passing", "rushing", "pace", "situational", "ratings", "roster"]) {
    const nested = features[group];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      for (const [k, v] of Object.entries(nested)) {
        if (flat[k] == null && typeof v !== "object") flat[k] = v;
        const prefixed = `${group}_${k}`;
        if (flat[prefixed] == null && typeof v !== "object") flat[prefixed] = v;
      }
    }
  }
  return flat;
}

/** Competition rank: ties share place; next place skips. */
export function competitionRanks(rows, { valueKey = "value", polarity = "higher_better", idKey = "teamId" } = {}) {
  const eligible = rows
    .filter((r) => num(r[valueKey]) != null)
    .slice()
    .sort((a, b) => {
      const av = num(a[valueKey]);
      const bv = num(b[valueKey]);
      const primary = polarity === "lower_better" ? av - bv : bv - av;
      if (primary !== 0) return primary;
      return String(a[idKey]).localeCompare(String(b[idKey]));
    });
  const byId = new Map();
  let previous = null;
  let place = null;
  eligible.forEach((row, i) => {
    const v = num(row[valueKey]);
    if (v !== previous) {
      place = i + 1;
      previous = v;
    }
    byId.set(String(row[idKey]), place);
  });
  return { byId, eligibleCount: eligible.length, ordered: eligible };
}

/**
 * Performance percentile in [0, 100]: 100 = best by polarity.
 * Uses midrank average for ties.
 */
export function performancePercentile(rank, eligibleCount) {
  if (rank == null || !eligibleCount || eligibleCount < 1) return null;
  if (eligibleCount === 1) return 100;
  return Math.round(((eligibleCount - rank) / (eligibleCount - 1)) * 1000) / 10;
}

export function classifyPerformance(percentile) {
  if (percentile == null) return null;
  if (percentile >= 90) return "Elite";
  if (percentile >= 75) return "Strong";
  if (percentile >= 55) return "Above Average";
  if (percentile >= 30) return "Below Average";
  return "Poor";
}

export function formatMetricValue(value, format) {
  const v = num(value);
  if (v == null) return null;
  if (format === "elo") return Math.round(v);
  if (format === "ppa") return Math.round(v * 1000) / 1000;
  if (format === "rate") return Math.round(v * 1000) / 1000;
  if (format === "yards") return Math.round(v * 100) / 100;
  if (format === "rating") return Math.round(v * 100) / 100;
  return v;
}

/**
 * Rank one metric across national FBS peers and conference peers.
 */
export function rankMetricForTeam({
  metricId,
  teamId,
  conference,
  peerRows = [],
  minNational = MIN_NATIONAL_SAMPLE,
  minConference = MIN_CONFERENCE_SAMPLE,
} = {}) {
  const meta = CFB_RESEARCH_METRIC_BY_ID[metricId];
  if (!meta) return null;
  const national = competitionRanks(peerRows, { polarity: meta.polarity });
  const confRows = peerRows.filter((r) => r.conference && conference && r.conference === conference);
  const conferenceRank = competitionRanks(confRows, { polarity: meta.polarity });

  const value = num(peerRows.find((r) => r.teamId === teamId)?.value);
  const natRank = national.byId.get(String(teamId)) ?? null;
  const confPlace = conferenceRank.byId.get(String(teamId)) ?? null;

  const nationalOk = national.eligibleCount >= minNational && natRank != null;
  const conferenceOk = conferenceRank.eligibleCount >= minConference && confPlace != null;
  const percentile = nationalOk ? performancePercentile(natRank, national.eligibleCount) : null;

  return {
    id: metricId,
    label: meta.label,
    units: meta.units,
    format: meta.format,
    description: meta.description,
    polarity: meta.polarity,
    preferredDirection: meta.polarity === "higher_better" ? "higher" : "lower",
    ratingKind: meta.ratingKind,
    source: meta.source,
    rankAuthority: CFB_RESEARCH_RANK_AUTHORITY,
    value: formatMetricValue(value, meta.format),
    rawValue: value,
    national: nationalOk
      ? { rank: natRank, of: national.eligibleCount, display: `#${natRank} of ${national.eligibleCount}` }
      : { rank: null, of: national.eligibleCount, display: null, reason: national.eligibleCount < minNational ? "insufficient_national_sample" : "unobserved" },
    conference: conferenceOk
      ? { rank: confPlace, of: conferenceRank.eligibleCount, name: conference || null, display: `#${confPlace} of ${conferenceRank.eligibleCount}` }
      : { rank: null, of: conferenceRank.eligibleCount, name: conference || null, display: null, reason: conferenceRank.eligibleCount < minConference ? "insufficient_conference_sample" : "unobserved" },
    percentile,
    performance: classifyPerformance(percentile),
  };
}

/**
 * Build peer value rows for every catalog metric from flattened feature maps.
 */
export function buildPeerMetricIndex(peers = []) {
  const byMetric = {};
  for (const metric of CFB_RESEARCH_METRICS) {
    byMetric[metric.id] = [];
  }
  for (const peer of peers) {
    const flat = peer.flat || flattenFeatures(peer.features || {});
    for (const metric of CFB_RESEARCH_METRICS) {
      const value = num(flat[metric.id]);
      if (value == null) continue;
      byMetric[metric.id].push({
        teamId: peer.teamId,
        conference: peer.conference || null,
        value,
        asOf: peer.asOf || null,
      });
    }
  }
  return byMetric;
}

/**
 * Enrich a team's metric list with national/conference interpretation.
 */
export function enrichMetricsWithRanks({
  teamId,
  conference,
  flatFeatures,
  peerIndex,
  season,
  asOf,
  featureVersion,
  coverage = null,
} = {}) {
  const flat = flatFeatures || {};
  const metrics = [];
  for (const meta of CFB_RESEARCH_METRICS) {
    const value = num(flat[meta.id]);
    if (value == null) continue;
    const peers = peerIndex?.[meta.id] || [{ teamId, conference, value }];
    const ranked = rankMetricForTeam({
      metricId: meta.id,
      teamId,
      conference,
      peerRows: peers.some((p) => p.teamId === teamId)
        ? peers
        : [...peers, { teamId, conference, value }],
    });
    if (!ranked) continue;
    metrics.push({
      ...ranked,
      season: season ?? null,
      asOf: asOf ?? null,
      featureVersion: featureVersion ?? null,
      sampleCoverage: coverage,
    });
  }
  return metrics;
}

/**
 * Deduplicate snapshot rows to latest as_of per team.
 */
export function latestSnapshotPerTeam(rows = []) {
  const best = new Map();
  for (const row of rows) {
    const id = String(row.team_id || row.teamId || "");
    if (!id) continue;
    const prev = best.get(id);
    if (!prev || String(row.as_of || "") > String(prev.as_of || "")) best.set(id, row);
  }
  return [...best.values()];
}
