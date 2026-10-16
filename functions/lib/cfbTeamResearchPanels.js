/**
 * Research-only CFB team page panels derived from persisted snapshots.
 * Never grants projection or wager authority. Zero network acquisition.
 */

import {
  CFB_RESEARCH_METRICS,
  CFB_RESEARCH_METRIC_BY_ID,
  CFB_RESEARCH_RANK_AUTHORITY,
  buildPeerMetricIndex,
  enrichMetricsWithRanks,
  flattenFeatures,
  num,
} from "./cfbTeamResearchRanking.js";

export const CFB_TEAM_RESEARCH_AUTHORITY = "research_only";
export {
  CFB_RESEARCH_METRICS,
  CFB_RESEARCH_METRIC_BY_ID,
  CFB_RESEARCH_RANK_AUTHORITY,
  flattenFeatures,
} from "./cfbTeamResearchRanking.js";

function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    const v = num(obj?.[key]);
    if (v != null) out[key] = v;
  }
  return out;
}

const PANEL_META = {
  core: {
    id: "core",
    title: "Week-bounded CORE rating",
    note: "CORE overall/offense/defense only — special teams excluded from CORE display. Ranks are FBIS-computed from persisted FBS snapshots.",
  },
  efficiency: {
    id: "efficiency",
    title: "Advanced efficiency",
    note: "Season advanced rates from persisted research snapshots. Percentile bars are national FBS performance (100 = best).",
  },
  ppa: {
    id: "ppa",
    title: "Team PPA splits",
    note: "PPA is not interchangeable with EPA; values keep CFBD units. Ranks are FBIS-computed.",
  },
  trenches: {
    id: "trenches",
    title: "Trenches & havoc",
    note: "Offensive havoc is havoc allowed (lower better). Defensive havoc is havoc created (higher better).",
  },
  ratings: {
    id: "ratings",
    title: "Composite ratings",
    note: "Source-published rating values; national/conference ranks and percentiles are FBIS-computed — not a blended champion model.",
  },
};

function groupMetricsIntoPanels(metrics, flat) {
  const byPanel = {};
  for (const metric of metrics) {
    const meta = CFB_RESEARCH_METRIC_BY_ID[metric.id];
    if (!meta) continue;
    (byPanel[meta.panel] ||= []).push(metric);
  }
  return Object.entries(PANEL_META)
    .map(([panelId, info]) => {
      const series = byPanel[panelId] || [];
      if (!series.length) return null;
      return {
        ...info,
        kind: "percentile_bar",
        series,
        throughWeek: panelId === "core" ? num(flat.coreThroughWeek) : null,
        seasonType: panelId === "core" ? (flat.coreThroughSeasonType || null) : null,
        temporalClass: panelId === "core" ? (flat.coreTemporalClass || null) : null,
        weekBounded: panelId === "core" ? flat.coreWeekBounded === true : null,
      };
    })
    .filter(Boolean);
}

/**
 * Build game-level sparkline points from persisted team-game evidence groups.
 */
export function buildGameMetricSeries(teamGameStatistics = null) {
  const games = teamGameStatistics?.games || [];
  const keys = [
    { id: "offensiveSuccessRate", paths: [["offense", "successRate"], ["offensiveSuccessRate"], ["success_rate"]], polarity: "higher_better" },
    { id: "defensiveSuccessRate", paths: [["defense", "successRate"], ["defensiveSuccessRate"]], polarity: "lower_better" },
    { id: "offensePpa", paths: [["offense", "ppa"], ["ppaOff"], ["offensePpa"]], polarity: "higher_better" },
    { id: "defensePpa", paths: [["defense", "ppa"], ["ppaDef"], ["defensePpa"]], polarity: "lower_better" },
  ];
  const series = {};
  for (const key of keys) series[key.id] = [];

  for (const game of games) {
    const groups = game?.stats?.groups || game?.groups || {};
    const flat = flattenFeatures(groups);
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
          polarity: key.polarity,
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
 * @param {object} opts
 * @param {object|null} opts.featureState
 * @param {object|null} opts.evidence
 * @param {string|null} opts.teamId
 * @param {string|null} opts.conference
 * @param {number|null} opts.season
 * @param {Array<{teamId:string,conference?:string,features?:object,flat?:object,asOf?:string}>} opts.peers
 *   Other FBS teams' latest persisted snapshots (same season/version). Used for ranks.
 */
export function buildCfbTeamResearchPanels({
  featureState = null,
  evidence = null,
  teamId = null,
  conference = null,
  season = null,
  peers = null,
} = {}) {
  const features = featureState?.features || null;
  const flat = flattenFeatures(features || {});
  const resolvedTeamId = teamId || evidence?.teamId || null;
  const resolvedConference = conference || evidence?.conference || null;
  const resolvedSeason = season ?? evidence?.season ?? null;

  const peerList = Array.isArray(peers) && peers.length
    ? peers
    : (resolvedTeamId
      ? [{ teamId: resolvedTeamId, conference: resolvedConference, flat, asOf: featureState?.asOf || null }]
      : []);
  const peerIndex = buildPeerMetricIndex(peerList);
  const coverage = {
    peerSnapshots: peerList.length,
    nationalSampleRule: "≥20 observed FBS teams with the metric",
    conferenceSampleRule: "≥4 observed conference peers with the metric",
  };

  const metrics = resolvedTeamId
    ? enrichMetricsWithRanks({
      teamId: resolvedTeamId,
      conference: resolvedConference,
      flatFeatures: flat,
      peerIndex,
      season: resolvedSeason,
      asOf: featureState?.asOf || null,
      featureVersion: featureState?.featureVersion || null,
      coverage,
    })
    : [];

  const panels = groupMetricsIntoPanels(metrics, flat);
  const gameSeries = buildGameMetricSeries(evidence?.teamGameStatistics);
  const propResearch = buildPlayerPropResearchCards({
    roster: evidence?.roster?.players || [],
    playerStatistics: evidence?.playerStatistics || null,
    flatFeatures: flat,
  });

  const populated = panels.length > 0 || Object.keys(gameSeries).length > 0 || propResearch.count > 0;

  return {
    state: populated
      ? "RESEARCH_AVAILABLE"
      : (featureState?.state === "RESEARCH_SNAPSHOT" ? "SNAPSHOT_WITHOUT_GRAPH_FIELDS" : "NOT_POPULATED"),
    authority: CFB_TEAM_RESEARCH_AUTHORITY,
    rankAuthority: CFB_RESEARCH_RANK_AUTHORITY,
    canInfluenceProjection: false,
    canQualify: false,
    canAuthorizeWager: false,
    featureVersion: featureState?.featureVersion || null,
    asOf: featureState?.asOf || null,
    season: resolvedSeason,
    conference: resolvedConference,
    coverage,
    panels,
    metrics,
    gameSeries,
    propResearch,
    summary: {
      panelCount: panels.length,
      metricCount: metrics.length,
      rankedMetricCount: metrics.filter((m) => m.national?.rank != null).length,
      gameSeriesCount: Object.keys(gameSeries).length,
      propCardCount: propResearch.count,
      peerSnapshots: peerList.length,
    },
  };
}
