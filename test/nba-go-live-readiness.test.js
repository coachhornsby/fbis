import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateNbaProspectiveGate,
  resolveNbaProspectiveGate,
  collectNbaGateEvidence,
  isProspectivePitWagerEvidence,
  NBA_PROSPECTIVE_GATE_DEFAULT_RULES,
} from "../functions/lib/nbaProspectiveGate.js";
import {
  attachNbaAvailabilityContext,
  loadNbaAvailabilityContext,
  injuryAppliesToTipoff,
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
    economicsSource: "nba_wager_decisions.prospective_pit",
    economicsProvenance: { ok: true, pitVerifiedN: 60, reason: null },
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
  assert.ok(frozen.gaps.includes("injury_regression"), "missing subgroup regression is a gap");
  assert.ok(frozen.progress.total >= 18);
});

test("missing subgroup regression fails (never treated as pass)", () => {
  const missing = evaluateNbaProspectiveGate(passingEvidence({
    injuryCatastrophicRegression: null,
    scheduleCatastrophicRegression: null,
  }));
  assert.equal(missing.criteriaPassed, false);
  assert.ok(missing.gaps.includes("injury_regression"));
  assert.ok(missing.gaps.includes("schedule_regression"));
  const injury = missing.criteria.find((c) => c.id === "injury_regression");
  assert.equal(injury.detail, "UNVERIFIED_MISSING_MEASUREMENT");
});

test("research validation economics cannot satisfy gate CLV/ROI criteria", () => {
  const fromResearchOnly = evaluateNbaProspectiveGate(passingEvidence({
    economicsSource: "nba_decision_validation_runs",
    economicsProvenance: { ok: false, pitVerifiedN: 0, reason: "UNVERIFIED_PIT_PROVENANCE" },
  }));
  assert.equal(fromResearchOnly.criteriaPassed, false);
  assert.ok(fromResearchOnly.gaps.includes("econ_pit_provenance"));
  assert.ok(fromResearchOnly.gaps.includes("clv_n"));
  assert.ok(fromResearchOnly.gaps.includes("roi"));
});

test("timestamp-only wager rows without tipoff/cutoff fail PIT provenance", () => {
  assert.equal(
    isProspectivePitWagerEvidence(
      { decision_timestamp: "2026-10-20T18:00:00Z", graded_at: "2026-10-21T04:00:00Z" },
      { tipoff_timestamp: null, feature_cutoff_timestamp: "2026-10-20T12:00:00Z" }
    ).ok,
    false
  );
  assert.equal(
    isProspectivePitWagerEvidence(
      { decision_timestamp: "2026-10-20T23:30:00Z", graded_at: "2026-10-21T04:00:00Z" },
      { tipoff_timestamp: "2026-10-20T23:00:00Z", feature_cutoff_timestamp: "2026-10-20T12:00:00Z" }
    ).reason,
    "decision_after_tipoff"
  );
  assert.equal(
    isProspectivePitWagerEvidence(
      { decision_timestamp: "2026-10-20T18:00:00Z", graded_at: "2026-10-21T04:00:00Z" },
      { tipoff_timestamp: "2026-10-20T23:00:00Z", feature_cutoff_timestamp: "2026-10-20T12:00:00Z" }
    ).ok,
    true
  );
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

test("resolveNbaProspectiveGate requires criteria + D1 cutover; flag alone never authorizes", async () => {
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
          if (text.includes("COUNT(DISTINCT") || text.includes("COUNT(*)")) return { n: 0 };
          return null;
        },
        async all() { return { results: [] }; },
      };
    },
  };
  const armedButNoEvidence = await resolveNbaProspectiveGate(dbArmed);
  assert.equal(armedButNoEvidence.d1CanAuthorize, true);
  assert.equal(armedButNoEvidence.canAuthorize, false, "D1 switch alone must not authorize without criteria");
  assert.equal(armedButNoEvidence.boardPolicy, "RESEARCH_DISPLAY_ONLY_NO_WAGER_AUTHORITY");
});

test("collectNbaGateEvidence counts distinct graded games and does not fill economics from validation runs", async () => {
  const db = {
    prepare(sql) {
      const text = String(sql);
      return {
        bind() { return this; },
        async first() {
          if (text.includes("COUNT(DISTINCT game_id)") && text.includes("nba_prospective_game_shadow") && text.includes("graded_at")) {
            return { n: 1 };
          }
          if (text.includes("nba_decision_validation_runs")) {
            return {
              bet_n: 999,
              units: 50,
              roi_pct: 12,
              max_drawdown_units: 2,
              positive_clv_rate: 0.9,
              graded_n: 999,
              status: "SIMULATED",
              created_at: "2026-10-01T00:00:00Z",
            };
          }
          if (text.includes("pit_ok") || text.includes("missing_projection")) {
            return {
              pit_ok: 0,
              missing_projection: 5,
              missing_tipoff_or_cutoff: 0,
              decision_after_tipoff: 0,
              cutoff_after_decision: 0,
              graded_with_decision_ts: 5,
            };
          }
          if (text.includes("nba_wager_decisions")) return { n: 0 };
          if (text.includes("nba_prospective_gate")) return null;
          return { n: 0 };
        },
        async all() { return { results: [] }; },
      };
    },
  };
  const evidence = await collectNbaGateEvidence(db);
  assert.equal(evidence.gradedGames, 1);
  assert.equal(evidence.economicsSource, null);
  assert.equal(evidence.economicsProvenance.ok, false);
  assert.equal(evidence.economicsProvenance.rejectedMissingProjection, 5);
  assert.equal(evidence.settledBets, 0);
  assert.ok(evidence.researchContext?.betN === 999 || evidence.researchContext?.kind);
  assert.equal(evidence.injuryCatastrophicRegression, null, "must not zero-fill unmeasured regression");
});

test("collectNbaGateEvidence only counts PIT-verified wager rows for economics", async () => {
  const db = {
    prepare(sql) {
      const text = String(sql);
      return {
        bind() { return this; },
        async first() {
          if (text.includes("pit_ok") || text.includes("missing_projection")) {
            return {
              pit_ok: 2,
              missing_projection: 3,
              missing_tipoff_or_cutoff: 1,
              decision_after_tipoff: 1,
              cutoff_after_decision: 0,
              graded_with_decision_ts: 7,
            };
          }
          if (text.includes("clv_probability") && text.includes("nba_game_projections")) {
            return { n: 2, pos_rate: 0.6, mean_clv: 0.02 };
          }
          if (text.includes("profit_units") && text.includes("nba_game_projections") && text.includes("COUNT(*)")) {
            return { n: 2, units: 1.5, roi: 0.05 };
          }
          if (text.includes("COUNT(DISTINCT")) return { n: 0 };
          if (text.includes("nba_prospective_gate")) return null;
          return { n: 0 };
        },
        async all() { return { results: [] }; },
      };
    },
  };
  const evidence = await collectNbaGateEvidence(db);
  assert.equal(evidence.economicsProvenance.ok, true);
  assert.equal(evidence.economicsProvenance.pitVerifiedN, 2);
  assert.equal(evidence.economicsSource, "nba_wager_decisions.prospective_pit");
  assert.equal(evidence.clvEvaluatedBets, 2);
  assert.equal(evidence.settledBets, 2);
});

test("injuryAppliesToTipoff rejects post-tip and stale observations", () => {
  const tip = Date.parse("2026-10-21T00:00:00Z");
  assert.equal(
    injuryAppliesToTipoff({ observed_at: "2026-10-20T20:00:00Z", report_date: "2026-10-20" }, tip),
    true
  );
  assert.equal(
    injuryAppliesToTipoff({ observed_at: "2026-10-21T01:00:00Z", report_date: "2026-10-21" }, tip),
    false
  );
  assert.equal(
    injuryAppliesToTipoff({ observed_at: "2026-10-10T12:00:00Z", report_date: "2026-10-10" }, tip),
    false
  );
});

test("attachNbaAvailabilityContext requires tipoff match and confirmed starters both sides", async () => {
  const games = [{
    id: "401809123",
    start: "2026-10-21T00:00:00Z",
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
              results: [
                {
                  player_id: "p1",
                  player_name: "Star Guard",
                  team_key: "okc",
                  team_name: "Thunder",
                  status: "OUT",
                  source: "NBA_OFFICIAL_INJURY_REPORT",
                  observed_at: "2026-10-20T12:00:00Z",
                  report_date: "2026-10-20",
                  notes: null,
                  game_id: null,
                },
                {
                  // Post-tip — must not attach
                  player_id: "p-late",
                  player_name: "Late Report",
                  team_key: "okc",
                  status: "OUT",
                  source: "NBA_OFFICIAL_INJURY_REPORT",
                  observed_at: "2026-10-21T02:00:00Z",
                  report_date: "2026-10-21",
                  game_id: null,
                },
              ],
            };
          }
          if (text.includes("nba_lineup_observations")) {
            return {
              results: [
                {
                  game_id: "401809123",
                  team_key: "hou",
                  player_id: "p2",
                  player_name: "Starter One",
                  lineup_status: "STARTER",
                  observed_at: "2026-10-20T16:00:00Z",
                  source: "ESPN_CONFIRMED_STARTER",
                },
                {
                  // Non-starter observation — must not mark confirmed alone
                  game_id: "401809123",
                  team_key: "okc",
                  player_id: "p3",
                  player_name: "Bench",
                  lineup_status: "BENCH",
                  observed_at: "2026-10-20T16:00:00Z",
                  source: "ESPN_ROSTER",
                },
              ],
            };
          }
          return { results: [] };
        },
      };
    },
  };
  const ctx = await loadNbaAvailabilityContext(db, games);
  assert.equal(ctx.meta.matchedInjuryRows, 1);
  const [g] = attachNbaAvailabilityContext(games, ctx);
  assert.equal(g.nbaAvailability.outCount, 1);
  assert.equal(g.nbaAvailability.home[0].playerName, "Star Guard");
  assert.equal(g.nbaAvailability.home.some((p) => p.playerName === "Late Report"), false);
  assert.equal(g.nbaLineups.confirmed, false, "one-side starter is not confirmation");
  assert.equal(g.nbaAvailability.canAuthorize, false);

  // Bare STARTER without confirmedStarter must not satisfy game-level confirmed
  const bareStarters = attachNbaAvailabilityContext(games, {
    ...ctx,
    lineupsByGame: {
      "401809123": {
        home: [{ playerName: "H1", starter: true, confirmedStarter: false }],
        away: [{ playerName: "A1", starter: true, confirmedStarter: false }],
        source: "ESPN_ROSTER",
      },
    },
  });
  assert.equal(bareStarters[0].nbaLineups.confirmed, false, "STARTER alone is not confirmed");

  // Independently verified confirmed starters both sides → confirmed
  const withBoth = attachNbaAvailabilityContext(games, {
    ...ctx,
    lineupsByGame: {
      "401809123": {
        home: [{ playerName: "H1", starter: true, confirmedStarter: true }],
        away: [{ playerName: "A1", starter: true, confirmedStarter: true }],
        source: "ESPN_CONFIRMED_STARTER",
      },
    },
  });
  assert.equal(withBoth[0].nbaLineups.confirmed, true);
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

test("board may display projections without wager authority; gate wire stays fail-closed", async () => {
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
  assert.equal(frozen.games[0].projHomeScore, 115.8, "research display allowed");
  assert.equal(frozen.games[0].canAuthorizeWager, false);
  assert.equal(frozen.games[0].publicationStatus, "RESEARCH_PUBLISHABLE");
  assert.equal(frozen.meta.gateAllows, false);

  // Mechanical cutover path exists, but production must not use it without prospective criteria.
  const open = await attachNbaBoardProjection([{ id: "g1" }], db, { gate: { canAuthorize: true } });
  assert.equal(open.games[0].canAuthorizeWager, true);
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
