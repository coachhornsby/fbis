import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCfbTeamResearchPanels,
  buildGameMetricSeries,
  buildPlayerPropResearchCards,
  CFB_TEAM_RESEARCH_AUTHORITY,
} from "../functions/lib/cfbTeamResearchPanels.js";
import { loadFbsTeamDirectory } from "../functions/api/cfb-teams.js";

test("research panels map CORE/PPA/efficiency without granting authority", () => {
  const panels = buildCfbTeamResearchPanels({
    featureState: {
      state: "RESEARCH_SNAPSHOT",
      asOf: "2026-10-14T00:00:00Z",
      featureVersion: "cfb-features-v1",
      features: {
        core: 18.2,
        coreOffense: 12,
        coreDefense: -4.5,
        coreThroughWeek: 6,
        coreWeekBounded: true,
        coreTemporalClass: "B",
        ppaOff: 0.28,
        ppaDef: -0.12,
        ppaPass: 0.22,
        offensiveSuccessRate: 0.49,
        defensiveSuccessRate: 0.34,
        offensiveLineYards: 3.1,
        defensiveHavoc: 0.19,
        sp: 21.4,
        elo: 1780,
      },
      canInfluenceProjection: false,
    },
  });
  assert.equal(panels.authority, CFB_TEAM_RESEARCH_AUTHORITY);
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

test("team detail API includes researchPanels and never grants model authority", async () => {
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
  const db = {
    prepare(sql) {
      return {
        bind() {
          return {
            first: async () => {
              if (sql.includes("cfb_canonical_teams")) return sample;
              if (sql.includes("team_feature_snapshots")) {
                return {
                  as_of: "2026-10-14T00:00:00Z",
                  feature_version: "cfb-features-v1",
                  features_json: JSON.stringify({ core: 15, ppaOff: 0.2, offensiveSuccessRate: 0.45 }),
                  missingness_json: "{}",
                };
              }
              return null;
            },
            all: async () => ({ results: [] }),
          };
        },
        all: async () => ({ results: [] }),
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
  assert.ok(r.body.researchPanels.panels.length >= 1);
});
