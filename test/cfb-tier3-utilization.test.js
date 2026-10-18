import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeTier3Entitlements,
  buildRestEntitlementMatrix,
  buildGraphqlEntitlementMatrix,
  assignFeatureLevel,
  FEATURE_LEVEL,
} from "../functions/lib/cfbTier3Entitlements.js";
import {
  buildRollingEfficiency,
  buildGameMatchupFeatures,
  researchModelFeaturePlan,
  graphqlShadowPlan,
  RESEARCH_ONLY,
} from "../functions/lib/cfbAdvancedResearchFeatures.js";
import { buildSourceToModelAudit } from "../functions/lib/cfbSourceToModelAudit.js";

test("Tier 3 entitlement matrix classifies underutilized vs integrated", () => {
  const summary = summarizeTier3Entitlements();
  assert.ok(summary.rest.n >= 14);
  assert.ok(summary.rest.underutilized >= 1);
  assert.equal(summary.graphql.productionQueryDocuments, 0);
  assert.ok(summary.featureLevels.L1 >= 4);
  const rest = buildRestEntitlementMatrix();
  const ppa = rest.find((r) => r.capabilityId === "cfbd-ppa-teams");
  assert.equal(ppa.classification, "integrated");
  const advanced = rest.find((r) => r.capabilityId === "cfbd-stats-season-advanced");
  assert.equal(advanced.classification, "underutilized");
  const gql = buildGraphqlEntitlementMatrix();
  assert.ok(gql.every((r) => r.classification === "needs_verification"));
});

test("feature levels: PPA is L1, CORE is L2, live is L3", () => {
  assert.equal(assignFeatureLevel("ppaOff"), FEATURE_LEVEL.L1_CORE_PRODUCTION);
  assert.equal(assignFeatureLevel("gamesPlayed"), FEATURE_LEVEL.L1_CORE_PRODUCTION);
  assert.equal(assignFeatureLevel("coreOffense"), FEATURE_LEVEL.L2_ADVANCED_RESEARCH);
  assert.equal(assignFeatureLevel("live_scoreboard"), FEATURE_LEVEL.L3_SPECIALIZED_LIVE);
});

test("rolling windows exclude post-kickoff games", () => {
  const rows = [
    { homeTeam: "A", awayTeam: "B", startDate: "2026-10-10T18:00:00Z", offensePpa: 0.1 },
    { homeTeam: "A", awayTeam: "C", startDate: "2026-10-17T18:00:00Z", offensePpa: 0.2 },
    { homeTeam: "A", awayTeam: "D", startDate: "2026-10-24T18:00:00Z", offensePpa: 0.9 },
  ];
  const roll = buildRollingEfficiency({
    gameRows: rows,
    teamKey: "A",
    kickoffTimestamp: "2026-10-20T23:00:00Z",
    metricKeys: ["offensePpa"],
    windows: [2],
  });
  assert.equal(roll.nGamesBeforeKick, 2);
  assert.equal(roll.canAuthorizeWager, false);
  assert.ok(Math.abs(roll.fullSeason.offensePpa - 0.15) < 1e-9);
});

test("matchup vector preserves research-only and CORE unit note", () => {
  const m = buildGameMatchupFeatures({
    home: { passEpa: 0.1, coreOffense: 5, successRate: 0.45 },
    away: { passEpaAllowed: -0.05, coreDefense: 2, successRateAllowed: 0.4 },
    throughWeek: 7,
  });
  assert.equal(m.canInfluenceProduction, false);
  assert.ok(m.homeOffenseVsAwayDefense.passing.mismatch != null);
  assert.match(m.homeOffenseVsAwayDefense.core.units, /100 plays/i);
});

test("research model plan and GraphQL shadow stay non-promoting", () => {
  const plan = researchModelFeaturePlan();
  assert.equal(plan.canAuthorizeWager, false);
  assert.ok(plan.models.A_repaired_champion);
  assert.ok(plan.models.E_combined_research);
  const gql = graphqlShadowPlan();
  assert.equal(gql.status, "scaffolded_not_production");
  assert.equal(RESEARCH_ONLY.canInfluenceProduction, false);
});

test("source-to-model audit answers champion vs excluded advanced fields", () => {
  const audit = buildSourceToModelAudit({
    game: {
      id: "espn-401871092",
      home_name: "Marshall",
      away_name: "South Alabama",
      homeEspnId: "276",
      awayEspnId: "6",
      season: 2026,
    },
    homeFeatures: {
      ppaOff: 0.11,
      ppaDef: 0.31,
      // No explicit gamesPlayed — force coreThroughWeek fallback path
      coreWeekBounded: true,
      coreThroughWeek: 6,
      offensiveSuccessRate: 0.44,
      coreOffense: 1.76,
      priorOff: 28,
      priorDef: 24,
      snapshotAsOf: "2026-10-17T16:32:00Z",
    },
    awayFeatures: {
      ppaOff: 0.23,
      ppaDef: 0.27,
      coreWeekBounded: true,
      coreThroughWeek: 6,
      coreOffense: 7.18,
      priorOff: 27,
      priorDef: 25,
      snapshotAsOf: "2026-10-17T16:32:00Z",
    },
    projection: { ok: true, home: 27.8, away: 25.5, margin: 2.3, modelId: "CFB-FBIS-v2" },
  });
  assert.equal(audit.answers.collected.homePpa, true);
  assert.ok(audit.answers.excluded.some((e) => e.feature === "offensiveSuccessRate" || e.feature === "coreOffense"));
  assert.ok(audit.answers.priorFallbacks.some((p) => p.type === "gamesPlayed"));
  assert.equal(audit.answers.predictedScore.home, 27.8);
  assert.equal(audit.answers.collected.homeGamesPlayed, 6);
});
