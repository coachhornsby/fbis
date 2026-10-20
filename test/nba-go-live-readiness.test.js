import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateNbaProspectiveGate,
  resolveNbaProspectiveGate,
  NBA_PROSPECTIVE_GATE_DEFAULT_RULES,
} from "../functions/lib/nbaProspectiveGate.js";
import {
  attachNbaAvailabilityContext,
  loadNbaAvailabilityContext,
} from "../functions/lib/nbaAvailabilityContext.js";
import {
  attachNbaPlayerProjectionResearch,
  attachNbaPlayerProjectionBlocked,
  loadNbaPlayerPropContext,
} from "../functions/lib/proPlayerProjectionLayer.js";
import { attachNbaBoardProjection } from "../functions/lib/nbaBoardProjection.js";
import { nbaComponentAudit } from "../functions/lib/nbaResearchArchitecture.js";

function passingEvidence(overrides = {}) {
  return {
    gradedGames: 120,
    marginImprovement: 0.01,
    totalImprovement: 0.005,
    winnerAccuracyDeltaVsV1: 0.0,
    brierDeltaVsV1: 0.001,
    logLossDeltaVsV1: 0.002,
    ece: 0.03,
    clvEvaluatedBets: 60,
    positiveClvRate: 0.55,
    meanProbabilityClv: 0.01,
    settledBets: 60,
    roiPct: 4.2,
    roiUnits: 3.1,
    maxDrawdownUnits: 8,
    injurySubgroupN: 25,
    scheduleStressSubgroupN: 25,
    injuryCatastrophicRegression: 0.01,
    scheduleCatastrophicRegression: 0.01,
    operatorApproved: false,
    ...overrides,
  };
}

test("evaluateNbaProspectiveGate stays frozen until all criteria pass", () => {
  const frozen = evaluateNbaProspectiveGate({ gradedGames: 10 });
  assert.equal(frozen.status, "FROZEN_RESEARCH_GATE");
  assert.equal(frozen.canAuthorize, false);
  assert.equal(frozen.promotionEligible, false);
  assert.ok(frozen.gaps.includes("graded_games"));
  assert.ok(frozen.progress.total >= 18);
});

test("evaluateNbaProspectiveGate becomes PROMOTION_ELIGIBLE then AUTHORIZED with operator", () => {
  const eligible = evaluateNbaProspectiveGate(passingEvidence());
  assert.equal(eligible.criteriaPassed, true);
  assert.equal(eligible.promotionEligible, true);
  assert.equal(eligible.canAuthorize, false);
  assert.equal(eligible.status, "AWAITING_OPERATOR_APPROVAL");

  const authorized = evaluateNbaProspectiveGate(passingEvidence({ operatorApproved: true }));
  assert.equal(authorized.canAuthorize, true);
  assert.equal(authorized.status, "AUTHORIZED");
});

test("resolveNbaProspectiveGate requires D1 can_authorize cutover after criteria", async () => {
  const evidenceReady = passingEvidence({ operatorApproved: false });
  // Simulate DB that returns gate row + empty collectors → inject via evaluate path
  const dbFrozen = {
    prepare(sql) {
      const text = String(sql);
      return {
        bind() { return this; },
        async first() {
          if (text.includes("nba_prospective_gate")) {
            return {
              gate_version: "NBA-PROSPECTIVE-GATE-v1",
              frozen_at: "2026-10-01T00:00:00Z",
              rules_json: JSON.stringify(NBA_PROSPECTIVE_GATE_DEFAULT_RULES),
              auto_promote: 0,
              can_qualify: 0,
              can_authorize: 0,
              status: "FROZEN_RESEARCH_GATE",
            };
          }
          return { n: 0 };
        },
        async all() { return { results: [] }; },
      };
    },
  };
  const frozen = await resolveNbaProspectiveGate(dbFrozen);
  assert.equal(frozen.canAuthorize, false);
  assert.ok(["FROZEN_RESEARCH_GATE", "AWAITING_OPERATOR_APPROVAL"].includes(frozen.status) || frozen.boardPolicy === "RESEARCH_ONLY_UNTIL_GATE_AND_OPERATOR");

  // Force criteria via evaluate unit already covered; cutover path:
  const dbArmed = {
    prepare(sql) {
      const text = String(sql);
      return {
        bind() { return this; },
        async first() {
          if (text.includes("nba_prospective_gate")) {
            return {
              gate_version: "NBA-PROSPECTIVE-GATE-v1",
              frozen_at: "2026-10-01T00:00:00Z",
              rules_json: JSON.stringify(NBA_PROSPECTIVE_GATE_DEFAULT_RULES),
              can_authorize: 1,
              status: "AUTHORIZED",
            };
          }
          // Return counts that still fail criteria → canAuthorize must stay false
          if (text.includes("COUNT(*)")) return { n: 0 };
          return null;
        },
        async all() { return { results: [] }; },
      };
    },
  };
  const armedButNoEvidence = await resolveNbaProspectiveGate(dbArmed);
  assert.equal(armedButNoEvidence.d1CanAuthorize, true);
  assert.equal(armedButNoEvidence.canAuthorize, false, "D1 switch alone must not authorize without criteria");
  void evidenceReady;
});

test("attachNbaAvailabilityContext hydrates injury + lineup from observations", async () => {
  const games = [{
    id: "401809123",
    home: { abbr: "OKC", name: "Thunder" },
    away: { abbr: "HOU", name: "Rockets" },
  }];
  const db = {
    prepare(sql) {
      const text = String(sql);
      return {
        bind() { return this; },
        async all() {
          if (text.includes("player_availability_observations")) {
            return {
              results: [{
                player_id: "p1",
                player_name: "Star Guard",
                team_key: "okc",
                team_name: "Thunder",
                status: "OUT",
                source: "NBA_OFFICIAL_INJURY_REPORT",
                observed_at: "2026-10-20T12:00:00Z",
                report_date: "2026-10-20",
                notes: null,
              }],
            };
          }
          if (text.includes("nba_lineup_observations")) {
            return {
              results: [{
                game_id: "401809123",
                team_key: "hou",
                player_id: "p2",
                player_name: "Starter One",
                lineup_status: "STARTER",
                observed_at: "2026-10-20T16:00:00Z",
                source: "ESPN_CONFIRMED_STARTER",
              }],
            };
          }
          return { results: [] };
        },
      };
    },
  };
  const ctx = await loadNbaAvailabilityContext(db, games);
  assert.equal(ctx.meta.configured, true);
  assert.ok(ctx.meta.officialInjuryRows >= 1);
  const [g] = attachNbaAvailabilityContext(games, ctx);
  assert.equal(g.nbaAvailability.outCount, 1);
  assert.equal(g.nbaAvailability.home[0].playerName, "Star Guard");
  assert.equal(g.nbaLineups.away[0].starter, true);
  assert.equal(g.nbaAvailability.canAuthorize, false);
});

test("NBA props research path attaches D1 shadow rows and keeps wager auth false", async () => {
  const games = [{ id: "g1", home: { abbr: "BOS" }, away: { abbr: "NYK" } }];
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async all() {
          return {
            results: [{
              game_id: "g1",
              player_id: "42",
              player_name: "Jayson Tatum",
              team: "BOS",
              market_type: "points",
              projection: 27.4,
              sigma: 6.1,
              projected_minutes: 36,
              availability_status: "ACTIVE",
              availability_verified: 1,
              model_id: "NBA-PLAYER-PROP-v1",
              model_version: "shadow-1",
              feature_cutoff_timestamp: "2026-10-20T12:00:00Z",
              can_qualify: 1,
            }],
          };
        },
      };
    },
  };
  const ctx = await loadNbaPlayerPropContext(db, games);
  assert.equal(ctx.meta.state, "ACTIVE_RESEARCH");
  const { games: next, meta } = attachNbaPlayerProjectionResearch(games, ctx);
  assert.equal(next[0].playerProjectionStatus.state, "ACTIVE_RESEARCH");
  assert.equal(next[0].playerProjectionRows[0].fbisProjection, 27.4);
  assert.equal(next[0].playerProjectionRows[0].canAuthorizeWager, false);
  assert.equal(meta.canAuthorize, false);

  const blocked = attachNbaPlayerProjectionBlocked([{ id: "empty" }]);
  assert.equal(blocked[0].playerProjectionStatus.state, "BLOCKED_RIGHTS_CLEARED_PLAYER_FEED");
});

test("attachNbaBoardProjection only authorizes when gate.canAuthorize and row allows", async () => {
  const row = {
    game_id: "g1",
    model_id: "NBA-FBIS-v1",
    model_version: "research-v1.1-calibrated",
    feature_cutoff_timestamp: "2026-10-18T12:00:00Z",
    projected_home: 115.8,
    projected_away: 119.1,
    projected_margin: -3.3,
    projected_total: 234.9,
    expected_possessions: 102.2,
    p_home_win: 0.41,
    sigma_margin: 14.5,
    sigma_total: 18.5,
    maturity: "VALIDATION",
    can_qualify: 1,
    can_authorize: 1,
    provenance_json: JSON.stringify({ marketUsed: false }),
    created_at: "2026-10-18T12:00:00Z",
  };
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: [row] }; },
      };
    },
  };
  const frozen = await attachNbaBoardProjection([{ id: "g1" }], db, { gate: { canAuthorize: false } });
  assert.equal(frozen.games[0].canAuthorizeWager, false);
  assert.equal(frozen.meta.gateAllows, false);

  const open = await attachNbaBoardProjection([{ id: "g1" }], db, { gate: { canAuthorize: true } });
  assert.equal(open.games[0].canAuthorizeWager, true);
  assert.equal(open.games[0].bettingAuthority, "ELIGIBLE");
});

test("nbaComponentAudit lists gate, injury/lineup, and props path as implemented", () => {
  const audit = nbaComponentAudit();
  const reqs = audit.buildable.map((x) => x.requirement);
  assert.ok(reqs.includes("prospective_gate_unfreeze_criteria"));
  assert.ok(reqs.includes("official_injury_lineup_board_hydration"));
  assert.ok(reqs.includes("player_prop_research_shadow_path"));
  for (const id of ["prospective_gate_unfreeze_criteria", "official_injury_lineup_board_hydration", "player_prop_research_shadow_path"]) {
    const row = audit.buildable.find((x) => x.requirement === id);
    assert.equal(row.status, "IMPLEMENTED");
  }
});
