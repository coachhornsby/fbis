import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCfbTeamResearchPanels,
  buildGameMetricSeries,
  buildPlayerPropResearchCards,
  CFB_TEAM_RESEARCH_AUTHORITY,
  CFB_RESEARCH_RANK_AUTHORITY,
} from "../functions/lib/cfbTeamResearchPanels.js";
import {
  competitionRanks,
  performancePercentile,
  classifyPerformance,
  rankMetricForTeam,
  CFB_RESEARCH_METRIC_BY_ID,
  researchPeriodForMetric,
} from "../functions/lib/cfbTeamResearchRanking.js";
import { loadFbsTeamDirectory } from "../functions/api/cfb-teams.js";

function makePeers(n, { conference = "SEC", metric = "ppaOff", base = 0.1, step = 0.01 } = {}) {
  const peers = [];
  for (let i = 0; i < n; i++) {
    peers.push({
      teamId: `cfb:espn:${1000 + i}`,
      conference: i < 8 ? conference : (i < 16 ? "Big Ten" : "ACC"),
      flat: { [metric]: base + i * step, core: 5 + i, coreOffense: 3 + i * 0.2, coreDefense: -1 - i * 0.1 },
      asOf: "2026-10-14T00:00:00Z",
    });
  }
  return peers;
}

test("research panels map CORE/PPA/efficiency without granting authority", () => {
  const peers = makePeers(25, { metric: "ppaOff" }).map((p, i) => ({
    ...p,
    flat: {
      ...p.flat,
      ppaOff: 0.05 + i * 0.01,
      ppaDef: 0.2 - i * 0.005,
      offensiveSuccessRate: 0.35 + i * 0.005,
      defensiveSuccessRate: 0.45 - i * 0.004,
      offensiveLineYards: 2 + i * 0.05,
      defensiveHavoc: 0.1 + i * 0.004,
      offensiveHavoc: 0.2 - i * 0.003,
      sp: 10 + i,
      elo: 1400 + i * 10,
    },
  }));
  const subject = peers[20];
  subject.flat.coreThroughWeek = 6;
  subject.flat.coreWeekBounded = true;
  subject.flat.coreTemporalClass = "B";
  const panels = buildCfbTeamResearchPanels({
    teamId: subject.teamId,
    conference: subject.conference,
    season: 2026,
    peers,
    featureState: {
      state: "RESEARCH_SNAPSHOT",
      asOf: "2026-10-14T00:00:00Z",
      featureVersion: "cfb-features-v1",
      season: 2026,
      features: subject.flat,
      canInfluenceProjection: false,
    },
  });
  assert.equal(panels.authority, CFB_TEAM_RESEARCH_AUTHORITY);
  assert.equal(panels.rankAuthority, CFB_RESEARCH_RANK_AUTHORITY);
  assert.equal(panels.canAuthorizeWager, false);
  assert.equal(panels.canInfluenceProjection, false);
  assert.equal(panels.state, "RESEARCH_AVAILABLE");
  assert.ok(panels.panels.some((p) => p.id === "core"));
  assert.ok(panels.panels.some((p) => p.id === "ppa"));
  assert.ok(panels.panels.some((p) => p.id === "efficiency"));
  assert.ok(panels.panels.some((p) => p.id === "trenches"));
  assert.ok(panels.panels.some((p) => p.id === "ratings"));
  const core = panels.panels.find((p) => p.id === "core");
  assert.equal(core.throughWeek, 6);
  assert.equal(core.weekBounded, true);
  assert.ok(!core.series.some((s) => s.id === "coreSpecialTeams"), "CORE panel excludes special teams");
  const ppaOff = panels.metrics.find((m) => m.id === "ppaOff");
  assert.ok(ppaOff.national.rank != null);
  assert.match(ppaOff.national.display, /^#\d+ of \d+$/);
  assert.ok(ppaOff.percentile != null);
  assert.ok(["Elite", "Strong", "Above Average", "Below Average", "Poor"].includes(ppaOff.performance));
  assert.equal(ppaOff.preferredDirection, "higher");
});

test("CORE excludes special teams even when coreSpecialTeams is present", () => {
  const peers = makePeers(22).map((p, i) => ({
    ...p,
    flat: { core: 10 + i, coreOffense: 8, coreDefense: -3, coreSpecialTeams: 2 },
  }));
  const subject = peers[10];
  const out = buildCfbTeamResearchPanels({
    teamId: subject.teamId,
    conference: "SEC",
    season: 2026,
    peers,
    featureState: {
      state: "RESEARCH_SNAPSHOT",
      featureVersion: "cfb-features-v1",
      asOf: "2026-10-14T00:00:00Z",
      features: subject.flat,
    },
  });
  const core = out.panels.find((p) => p.id === "core");
  assert.deepEqual(core.series.map((s) => s.id).sort(), ["core", "coreDefense", "coreOffense"]);
});

test("offensive havoc is lower-is-better (havoc allowed); defensive havoc higher-is-better", () => {
  assert.equal(CFB_RESEARCH_METRIC_BY_ID.offensiveHavoc.polarity, "lower_better");
  assert.equal(CFB_RESEARCH_METRIC_BY_ID.defensiveHavoc.polarity, "higher_better");
  assert.match(CFB_RESEARCH_METRIC_BY_ID.offensiveHavoc.label, /allowed/i);

  const peers = [];
  for (let i = 0; i < 25; i++) {
    peers.push({
      teamId: `cfb:espn:${i}`,
      conference: "SEC",
      flat: { offensiveHavoc: 0.05 + i * 0.01, defensiveHavoc: 0.05 + i * 0.01 },
    });
  }
  // Lowest offensive havoc (allowed) should rank #1 nationally.
  const bestAllowed = rankMetricForTeam({
    metricId: "offensiveHavoc",
    teamId: "cfb:espn:0",
    conference: "SEC",
    peerRows: peers.map((p) => ({ teamId: p.teamId, conference: p.conference, value: p.flat.offensiveHavoc })),
  });
  assert.equal(bestAllowed.national.rank, 1);
  assert.equal(bestAllowed.preferredDirection, "lower");

  // Highest defensive havoc created should rank #1.
  const bestCreated = rankMetricForTeam({
    metricId: "defensiveHavoc",
    teamId: "cfb:espn:24",
    conference: "SEC",
    peerRows: peers.map((p) => ({ teamId: p.teamId, conference: p.conference, value: p.flat.defensiveHavoc })),
  });
  assert.equal(bestCreated.national.rank, 1);
  assert.equal(bestCreated.preferredDirection, "higher");
});

test("competition ranks share place on ties and never invent missing samples", () => {
  const { byId, eligibleCount } = competitionRanks([
    { teamId: "a", value: 10 },
    { teamId: "b", value: 10 },
    { teamId: "c", value: 8 },
  ], { polarity: "higher_better" });
  assert.equal(eligibleCount, 3);
  assert.equal(byId.get("a"), 1);
  assert.equal(byId.get("b"), 1);
  assert.equal(byId.get("c"), 3);
  assert.equal(performancePercentile(1, 3), 100);
  assert.equal(classifyPerformance(95), "Elite");
  assert.equal(classifyPerformance(40), "Below Average");
  assert.equal(classifyPerformance(10), "Poor");

  const thin = rankMetricForTeam({
    metricId: "sp",
    teamId: "a",
    conference: "SEC",
    peerRows: [{ teamId: "a", conference: "SEC", value: 20 }],
  });
  assert.equal(thin.national.rank, null);
  assert.equal(thin.national.reason, "insufficient_national_sample");
  assert.equal(thin.percentile, null);
  assert.equal(thin.performance, null);
});

test("defensive success/PPA/explosiveness/line yards are lower-is-better", () => {
  for (const id of [
    "defensiveSuccessRate", "defensiveExplosiveness", "defensivePointsPerOpportunity",
    "ppaDef", "ppaPassAllowed", "ppaRushAllowed", "defensiveLineYards", "coreDefense",
  ]) {
    assert.equal(CFB_RESEARCH_METRIC_BY_ID[id].polarity, "lower_better", id);
  }
});

test("empty snapshots stay fail-closed with no invented series", () => {
  const empty = buildCfbTeamResearchPanels({ featureState: { state: "NOT_POPULATED" } });
  assert.equal(empty.state, "NOT_POPULATED");
  assert.equal(empty.panels.length, 0);
  assert.equal(empty.propResearch.count, 0);
  assert.equal(empty.canAuthorizeWager, false);
});

test("game series requires at least two observed points", () => {
  const series = buildGameMetricSeries({
    games: [
      { gameId: "1", gameAt: "2026-09-01", opponent: "A", stats: { groups: { offense: { successRate: 0.4 } } } },
      { gameId: "2", gameAt: "2026-09-08", opponent: "B", stats: { groups: { offense: { successRate: 0.5 } } } },
    ],
  });
  assert.equal(series.offensiveSuccessRate.length, 2);
  assert.equal(buildGameMetricSeries({ games: [{ gameId: "1", stats: { groups: { offense: { successRate: 0.4 } } } }] }).offensiveSuccessRate, undefined);
});

test("player prop research cards are shadow inputs only", () => {
  const cards = buildPlayerPropResearchCards({
    roster: [
      { playerId: "p1", name: "QB One", position: "QB", jersey: 1 },
      { playerId: "p2", name: "OL One", position: "OL", jersey: 70 },
    ],
    playerStatistics: {
      byPlayer: {
        p1: { state: "SOURCE_OBSERVED", groups: { passing: { passing_yards: 1200, attempts: 180 }, ppa: 0.35 } },
      },
    },
    flatFeatures: { ppaOff: 0.2, returningPpa: 0.7 },
  });
  assert.equal(cards.state, "RESEARCH_INPUTS");
  assert.equal(cards.count, 1);
  assert.equal(cards.cards[0].modelHook, "CFB-PLAYER-v1");
  assert.equal(cards.cards[0].role, "shadow_research_input");
  assert.equal(cards.canAuthorizeWager, false);
  assert.equal(cards.teamContext.ppaOff, 0.2);
});

test("team detail API loads peers for ranks and never grants model authority", async () => {
  const sample = {
    team_id: "cfb:espn:333", school_name: "Alabama", athletic_name: "Crimson Tide",
    abbreviation: "ALA", active: 1, subdivision: "FBS", current_conference: "SEC",
    city: "Tuscaloosa", state: "AL", home_stadium: "Bryant-Denny",
    latitude: 33.2, longitude: -87.5, timezone: "America/Chicago",
    last_observed_at: "2026-10-06T14:30:02Z",
    source_json: JSON.stringify({
      season: 2026, display_name: "Alabama Crimson Tide", mascot: "Crimson Tide",
      color: "9e1b32", alternate_color: "ffffff",
      team_logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/333.png",
      venue_id: 1, venue_name: "Bryant-Denny", venue_city: "Tuscaloosa", venue_state: "AL",
    }),
  };
  const peerRows = [];
  for (let i = 0; i < 25; i++) {
    const id = i === 0 ? "cfb:espn:333" : `cfb:espn:${400 + i}`;
    peerRows.push({
      team_id: id,
      as_of: "2026-10-14T00:00:00Z",
      feature_version: "cfb-features-v1",
      season: 2026,
      features_json: JSON.stringify({
        core: 10 + i, coreOffense: 8, coreDefense: -2 - i * 0.1,
        ppaOff: 0.1 + i * 0.01, offensiveSuccessRate: 0.4 + i * 0.002,
        defensiveSuccessRate: 0.4 - i * 0.002, defensiveHavoc: 0.1 + i * 0.002,
        offensiveHavoc: 0.2 - i * 0.002, sp: 15 + i,
      }),
    });
  }
  const confRows = peerRows.map((r, i) => ({
    team_id: r.team_id,
    current_conference: i < 10 ? "SEC" : "Big Ten",
    active: 1, subdivision: "FBS",
  }));
  const db = {
    prepare(sql) {
      const isAll = () => ({
        all: async () => {
          if (sql.includes("team_feature_snapshots") && sql.includes("LIMIT 500")) {
            return { results: peerRows };
          }
          if (sql.includes("cfb_canonical_teams") && sql.includes("current_conference") && !sql.includes("AND team_id=")) {
            return { results: confRows };
          }
          return { results: [] };
        },
        first: async () => null,
      });
      return {
        bind(...args) {
          return {
            first: async () => {
              if (sql.includes("cfb_canonical_teams") && sql.includes("AND team_id=")) return sample;
              if (sql.includes("team_feature_snapshots") && sql.includes("team_id=?") && sql.includes("LIMIT 1")) {
                return peerRows[0];
              }
              return null;
            },
            all: async () => {
              if (sql.includes("team_feature_snapshots") && sql.includes("LIMIT 500")) {
                assert.equal(args[0], 2026);
                assert.equal(args[1], "cfb-features-v1");
                return { results: peerRows };
              }
              if (sql.includes("current_conference")) return { results: confRows };
              return { results: [] };
            },
          };
        },
        ...isAll(),
      };
    },
  };
  const r = await loadFbsTeamDirectory(db, "cfb:espn:333", {
    season: 2026,
    publicFactsLoader: async () => ({
      schedule: { state: "AVAILABLE", games: [], count: 0 },
      apRanking: { state: "AVAILABLE", rank: null },
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.modelAuthority.canInfluenceProjection, false);
  assert.equal(r.body.researchPanels.canAuthorizeWager, false);
  assert.ok(r.body.researchPanels.summary.peerSnapshots >= 20);
  const core = r.body.researchPanels.metrics.find((m) => m.id === "core");
  assert.ok(core.national.rank != null);
  assert.ok(core.conference.display);
  assert.ok(!r.body.researchPanels.metrics.some((m) => m.id === "coreSpecialTeams"));
  const offHavoc = r.body.researchPanels.metrics.find((m) => m.id === "offensiveHavoc");
  assert.equal(offHavoc.polarity, "lower_better");
});


test("midrank percentiles split ties fairly while keeping competition rank", () => {
  const ranking = competitionRanks([
    { teamId: "a", value: 10 }, { teamId: "b", value: 10 },
    { teamId: "c", value: 8 }, { teamId: "d", value: 4 },
  ]);
  assert.equal(ranking.byId.get("a"), 1);
  assert.equal(ranking.byId.get("b"), 1);
  assert.equal(ranking.byId.get("c"), 3);
  assert.equal(ranking.midrankById.get("a"), 1.5);
  assert.equal(ranking.midrankById.get("b"), 1.5);
  assert.equal(performancePercentile(ranking.midrankById.get("a"), 4), 83.3);
});

test("20-team sample is labeled observed, not a representative national FBS rank", () => {
  const peers = Array.from({ length: 25 }, (_, i) => ({
    teamId: "team:" + i, conference: "SEC", value: i, periodKey: "week:7",
  }));
  const small = rankMetricForTeam({
    metricId: "ppaOff", teamId: "team:24", conference: "SEC",
    peerRows: peers, periodKey: "week:7", periodVerified: true,
    expectedNationalCount: 138, expectedConferenceCount: 16,
  });
  assert.equal(small.national.scope, "observed_fbs");
  assert.equal(small.national.representative, false);
  assert.match(small.national.display, /observed/);
  assert.equal(small.percentileScope, "observed_fbs");
  const full = rankMetricForTeam({
    metricId: "ppaOff", teamId: "team:119", conference: "SEC",
    peerRows: Array.from({ length: 120 }, (_, i) => ({
      teamId: "team:" + i, conference: i < 12 ? "SEC" : "Big Ten",
      value: i, periodKey: "week:7",
    })), periodKey: "week:7", periodVerified: true,
    expectedNationalCount: 138, expectedConferenceCount: 16,
  });
  assert.equal(full.national.representative, true);
  assert.equal(full.national.scope, "national_fbs");
  assert.doesNotMatch(full.national.display, /observed/);
});

test("research ranks never mix verified Week 5 with verified Week 7", () => {
  const peers = Array.from({ length: 25 }, (_, i) => ({
    teamId: "week7-" + i, conference: "SEC", value: i, periodKey: "week:7",
  })).concat(Array.from({ length: 30 }, (_, i) => ({
    teamId: "week5-" + i, conference: "SEC", value: 100 + i, periodKey: "week:5",
  })));
  const r = rankMetricForTeam({
    metricId: "ppaOff", teamId: "week7-24", conference: "SEC",
    peerRows: peers, periodKey: "week:7", periodVerified: true,
    expectedNationalCount: 138, expectedConferenceCount: 16,
  });
  assert.equal(r.national.of, 25);
  assert.equal(r.national.rank, 1);
  assert.equal(r.national.representative, false);
});

test("unverified source cutoffs are observational, not nationally certified", () => {
  const raw = researchPeriodForMetric("core", { coreThroughWeek: 7, coreWeekBounded: true }, "2026-10-16T12:00:00Z");
  assert.equal(raw.verified, true);
  assert.equal(raw.key, "week:7");
  const unknown = researchPeriodForMetric("core", { coreThroughWeek: 7 }, "2026-10-16T12:00:00Z");
  assert.equal(unknown.verified, false);
  assert.equal(unknown.key, "observed:2026-10-16");
  assert.equal(researchPeriodForMetric("ppaOff", {}, null).key, null);
});
