/**
 * Research-only CFB team page panels derived from persisted snapshots.
 * Never grants projection or wager authority. Zero network acquisition.
 */

export const CFB_TEAM_RESEARCH_AUTHORITY = "research_only";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    const v = num(obj?.[key]);
    if (v != null) out[key] = v;
  }
  return out;
}

function barSeries(entries) {
  return entries
    .filter((e) => e.value != null)
    .map((e) => ({
      id: e.id,
      label: e.label,
      value: e.value,
      polarity: e.polarity || "higher_better",
    }));
}

/** Flatten nested offense/defense feature groups when present. */
function flattenFeatures(features = {}) {
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

function corePanel(flat) {
  const series = barSeries([
    { id: "core", label: "CORE", value: num(flat.core), polarity: "higher_better" },
    { id: "coreOffense", label: "Offense", value: num(flat.coreOffense), polarity: "higher_better" },
    { id: "coreDefense", label: "Defense", value: num(flat.coreDefense), polarity: "lower_better" },
    { id: "coreSpecialTeams", label: "Special teams", value: num(flat.coreSpecialTeams), polarity: "higher_better" },
  ]);
  if (!series.length) return null;
  return {
    id: "core",
    title: "Week-bounded CORE rating",
    kind: "bar",
    series,
    throughWeek: num(flat.coreThroughWeek),
    seasonType: flat.coreThroughSeasonType || null,
    temporalClass: flat.coreTemporalClass || null,
    weekBounded: flat.coreWeekBounded === true,
    note: "Research display from persisted CORE fields. Not a wager signal.",
  };
}

function efficiencyPanel(flat) {
  const series = barSeries([
    { id: "offensiveSuccessRate", label: "Off success", value: num(flat.offensiveSuccessRate), polarity: "higher_better" },
    { id: "defensiveSuccessRate", label: "Def success allowed", value: num(flat.defensiveSuccessRate), polarity: "lower_better" },
    { id: "offensiveExplosiveness", label: "Off explosiveness", value: num(flat.offensiveExplosiveness), polarity: "higher_better" },
    { id: "defensiveExplosiveness", label: "Def explosiveness allowed", value: num(flat.defensiveExplosiveness), polarity: "lower_better" },
    { id: "offensivePointsPerOpportunity", label: "Off PPO", value: num(flat.offensivePointsPerOpportunity), polarity: "higher_better" },
    { id: "defensivePointsPerOpportunity", label: "Def PPO allowed", value: num(flat.defensivePointsPerOpportunity), polarity: "lower_better" },
  ]);
  if (!series.length) return null;
  return {
    id: "efficiency",
    title: "Advanced efficiency",
    kind: "bar",
    series,
    note: "Season advanced rates from persisted research snapshots.",
  };
}

function ppaPanel(flat) {
  const series = barSeries([
    { id: "ppaOff", label: "Off PPA", value: num(flat.ppaOff), polarity: "higher_better" },
    { id: "ppaDef", label: "Def PPA", value: num(flat.ppaDef), polarity: "lower_better" },
    { id: "ppaPass", label: "Pass PPA", value: num(flat.ppaPass), polarity: "higher_better" },
    { id: "ppaRush", label: "Rush PPA", value: num(flat.ppaRush), polarity: "higher_better" },
    { id: "ppaPassAllowed", label: "Pass PPA allowed", value: num(flat.ppaPassAllowed), polarity: "lower_better" },
    { id: "ppaRushAllowed", label: "Rush PPA allowed", value: num(flat.ppaRushAllowed), polarity: "lower_better" },
  ]);
  if (!series.length) return null;
  return {
    id: "ppa",
    title: "Team PPA splits",
    kind: "bar",
    series,
    note: "PPA is not interchangeable with EPA; values keep CFBD units.",
  };
}

function trenchesPanel(flat) {
  const series = barSeries([
    { id: "offensiveLineYards", label: "Off line yards", value: num(flat.offensiveLineYards), polarity: "higher_better" },
    { id: "defensiveLineYards", label: "Def line yards", value: num(flat.defensiveLineYards), polarity: "lower_better" },
    { id: "offensiveHavoc", label: "Off havoc", value: num(flat.offensiveHavoc), polarity: "higher_better" },
    { id: "defensiveHavoc", label: "Def havoc", value: num(flat.defensiveHavoc), polarity: "higher_better" },
    { id: "offensiveStuffRate", label: "Off stuff rate", value: num(flat.offensiveStuffRate), polarity: "lower_better" },
    { id: "defensiveStuffRate", label: "Def stuff rate", value: num(flat.defensiveStuffRate), polarity: "higher_better" },
  ]);
  if (!series.length) return null;
  return {
    id: "trenches",
    title: "Trenches & havoc",
    kind: "bar",
    series,
    note: "Line and havoc research metrics for matchup context.",
  };
}

function ratingsPanel(flat) {
  const series = barSeries([
    { id: "sp", label: "SP+", value: num(flat.sp), polarity: "higher_better" },
    { id: "fpi", label: "FPI", value: num(flat.fpi), polarity: "higher_better" },
    { id: "elo", label: "Elo", value: num(flat.elo), polarity: "higher_better" },
    { id: "srs", label: "SRS", value: num(flat.srs), polarity: "higher_better" },
    { id: "talent", label: "Talent", value: num(flat.talent), polarity: "higher_better" },
  ]);
  if (!series.length) return null;
  return {
    id: "ratings",
    title: "Composite ratings",
    kind: "bar",
    series,
    note: "Cross-rating research view; not a blended champion model.",
  };
}

/**
 * Build game-level sparkline points from persisted team-game evidence groups.
 */
export function buildGameMetricSeries(teamGameStatistics = null) {
  const games = teamGameStatistics?.games || [];
  const keys = [
    { id: "offensiveSuccessRate", paths: [["offense", "successRate"], ["offensiveSuccessRate"], ["success_rate"]] },
    { id: "defensiveSuccessRate", paths: [["defense", "successRate"], ["defensiveSuccessRate"]] },
    { id: "offensePpa", paths: [["offense", "ppa"], ["ppaOff"], ["offensePpa"]] },
    { id: "defensePpa", paths: [["defense", "ppa"], ["ppaDef"], ["defensePpa"]] },
  ];
  const series = {};
  for (const key of keys) series[key.id] = [];

  for (const game of games) {
    const groups = game?.stats?.groups || game?.groups || {};
    const flat = flattenFeatures(groups);
    // Also flatten top-level numeric stats if present.
    const merged = { ...flat, ...(typeof game?.stats === "object" ? flattenFeatures(game.stats) : {}) };
    const label = game.gameAt || game.opponent || game.gameId || "game";
    for (const key of keys) {
      let value = null;
      for (const path of key.paths) {
        if (path.length === 1) value = num(merged[path[0]]);
        else {
          let cur = groups;
          for (const p of path) cur = cur?.[p];
          value = num(cur);
        }
        if (value != null) break;
      }
      if (value != null) {
        series[key.id].push({
          gameId: game.gameId || null,
          label: String(label),
          opponent: game.opponent || null,
          value,
        });
      }
    }
  }

  return Object.fromEntries(
    Object.entries(series).filter(([, pts]) => pts.length >= 2)
  );
}

/**
 * Research prop input cards from roster + player season statistics.
 * Does not run CFB-PLAYER-v1 (that needs a matchup environment).
 */
export function buildPlayerPropResearchCards({ roster = [], playerStatistics = null, flatFeatures = {} } = {}) {
  const byPlayer = playerStatistics?.byPlayer || {};
  const skill = new Set(["QB", "RB", "WR", "TE"]);
  const cards = [];

  for (const player of roster) {
    const pos = String(player.position || "").toUpperCase();
    if (!skill.has(pos)) continue;
    const stats = byPlayer[player.playerId];
    if (!stats || stats.state !== "SOURCE_OBSERVED") continue;
    const groups = flattenFeatures(stats.groups || {});
    const metrics = pick(groups, [
      "passing_yards", "passingYards", "pass_yards",
      "rushing_yards", "rushingYards", "rush_yards",
      "receiving_yards", "receivingYards", "receptions",
      "passing_touchdowns", "rushing_touchdowns", "receiving_touchdowns",
      "attempts", "carries", "targets", "ppa", "averagePPA", "usage",
    ]);
    // Prefer friendly aliases when present.
    const projectionInputs = {
      position: pos,
      seasonPpa: num(groups.ppa ?? groups.averagePPA ?? groups.seasonPpa),
      usage: num(groups.usage ?? groups.usageOverall),
      passYards: num(groups.passing_yards ?? groups.passingYards ?? groups.pass_yards),
      rushYards: num(groups.rushing_yards ?? groups.rushingYards ?? groups.rush_yards),
      recYards: num(groups.receiving_yards ?? groups.receivingYards),
      receptions: num(groups.receptions),
      attempts: num(groups.attempts ?? groups.pass_attempts),
      carries: num(groups.carries ?? groups.rush_attempts),
      targets: num(groups.targets),
    };
    const hasSignal = Object.values(projectionInputs).some((v, i) => i > 0 && v != null);
    if (!hasSignal && !Object.keys(metrics).length) continue;
    cards.push({
      playerId: player.playerId,
      name: player.name,
      position: pos,
      jersey: player.jersey ?? null,
      projectionInputs,
      metrics,
      marketsHint:
        pos === "QB" ? ["pass_yards", "pass_tds", "rush_yards"]
          : pos === "RB" ? ["rush_yards", "receptions", "rec_yards"]
            : ["rec_yards", "receptions", "anytime_td"],
      modelHook: "CFB-PLAYER-v1",
      role: "shadow_research_input",
    });
  }

  cards.sort((a, b) => {
    const rank = { QB: 0, RB: 1, WR: 2, TE: 3 };
    const d = (rank[a.position] ?? 9) - (rank[b.position] ?? 9);
    if (d !== 0) return d;
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    state: cards.length ? "RESEARCH_INPUTS" : "NOT_POPULATED",
    count: cards.length,
    cards: cards.slice(0, 24),
    teamContext: pick(flatFeatures, [
      "ppaOff", "ppaPass", "ppaRush", "offensiveSuccessRate",
      "returningPpa", "returningUsage", "returningYards",
    ]),
    note: "Season observed inputs for shadow CFB-PLAYER-v1. Matchup projections require a board game environment and remain unauthorized for wagers.",
    canInfluenceProjection: false,
    canAuthorizeWager: false,
  };
}

/**
 * Assemble research panels for a team profile response.
 */
export function buildCfbTeamResearchPanels({ featureState = null, evidence = null } = {}) {
  const features = featureState?.features || null;
  const flat = flattenFeatures(features || {});
  const panels = [
    corePanel(flat),
    efficiencyPanel(flat),
    ppaPanel(flat),
    trenchesPanel(flat),
    ratingsPanel(flat),
  ].filter(Boolean);

  const gameSeries = buildGameMetricSeries(evidence?.teamGameStatistics);
  const propResearch = buildPlayerPropResearchCards({
    roster: evidence?.roster?.players || [],
    playerStatistics: evidence?.playerStatistics || null,
    flatFeatures: flat,
  });

  const populated = panels.length > 0 || Object.keys(gameSeries).length > 0 || propResearch.count > 0;

  return {
    state: populated ? "RESEARCH_AVAILABLE" : (featureState?.state === "RESEARCH_SNAPSHOT" ? "SNAPSHOT_WITHOUT_GRAPH_FIELDS" : "NOT_POPULATED"),
    authority: CFB_TEAM_RESEARCH_AUTHORITY,
    canInfluenceProjection: false,
    canQualify: false,
    canAuthorizeWager: false,
    featureVersion: featureState?.featureVersion || null,
    asOf: featureState?.asOf || null,
    panels,
    gameSeries,
    propResearch,
    summary: {
      panelCount: panels.length,
      gameSeriesCount: Object.keys(gameSeries).length,
      propCardCount: propResearch.count,
    },
  };
}
