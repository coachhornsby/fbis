import test from "node:test";
import assert from "node:assert/strict";

import { projectMlbDeep, MLB_DEEP_ID, MLB_PITCH_ZONE_K_CALIBRATION } from "../functions/lib/mlbDeepModel.js";
import { projectCfbMatchupV2, CFB_MATCHUP_V2_ID } from "../functions/lib/cfbMatchupV2.js";
import { projectNflProV1, NFL_PRO_ID } from "../functions/lib/nflProModel.js";
import { modelMeta, shadowCannotQualify } from "../functions/lib/collegeModels.js";

test("MLB deep challenger allocates starter and bullpen run prevention without market inputs", () => {
  const p = projectMlbDeep({
    sport: "mlb",
    savant: {
      homeRpg: 4.9, awayRpg: 4.2, homeSpEra: 3.4, awaySpEra: 4.5,
      homeSpKPer9: 9.6, awaySpKPer9: 8.1,
      homeSpInningsPerStart: 5.9, awaySpInningsPerStart: 5.2,
      homeOpponentKRate: 0.238, awayOpponentKRate: 0.214, leagueKRate: 0.225,
    },
    mlbContext: {
      homeBullpenEra: 3.7,
      awayBullpenEra: 4.4,
      homePlatoonWoba: 0.334,
      awayPlatoonWoba: 0.309,
      palParkRunFactor: 1.04,
      palParkHrFactor: 1.08,
      palLineupsOfficial: true,
      homePalRcVsTypical: 25,
      homePalHrVsTypical: 18,
      homePalKVsTypical: -12,
      homePalMatchupN: 9,
      awayPalRcVsTypical: -20,
      awayPalHrVsTypical: -15,
      awayPalKVsTypical: 14,
      awayPalMatchupN: 8,
      homePalStarterExpectedInnings: 5.8,
      awayPalStarterExpectedInnings: 5.1,
      homePalStarterProjectedKs: 6.4,
      awayPalStarterProjectedKs: 4.8,
      weatherRunFactor: 1.02,
      homeDefenseRunsSaved: 10,
      awayDefenseRunsSaved: -8,
    },
  });
  assert.equal(p.ok, true);
  assert.equal(p.modelId, MLB_DEEP_ID);
  assert.equal(p.independent, true);
  assert.equal(p.marketInformed, false);
  assert.equal(p.canQualify, true);
  assert.ok(Number.isFinite(p.home));
  assert.ok(Number.isFinite(p.away));
  assert.ok(p.decomposition.home.bullpenShare > 0);
  assert.equal(p.provenance.ballparkPalRole, "features-plus-external-challenger");
  assert.equal(p.provenance.palFinalProjectionUsed, false);
  assert.equal(p.provenance.palWinProbabilityUsed, false);
  assert.equal(p.provenance.palFeatureInputs.lineupsOfficial, true);
  assert.ok(p.decomposition.home.palMatchupFactor > 1);
  assert.ok(p.decomposition.away.palMatchupFactor < 1);
  assert.ok(p.decomposition.home.palHrFactor > 1);
  assert.ok(p.decomposition.home.palKFactor > 1);
  assert.ok(p.decomposition.away.palHrFactor < 1);
  assert.ok(p.decomposition.away.palKFactor < 1);
  assert.equal(p.provenance.palFeatureInputs.homeStarterExpectedInnings, 5.8);
  assert.equal(p.provenance.palFeatureInputs.awayStarterExpectedInnings, 5.1);
  assert.ok(p.provenance.palUsageAudit.scoreInputs.includes("HR vs typical"));
  assert.ok(p.provenance.palUsageAudit.externalCrossChecksOnly.includes("Pal team run projection"));
  assert.ok(Number.isFinite(p.f5.home));
  assert.ok(Number.isFinite(p.f5.away));
  assert.ok(Number.isFinite(p.f5.total));
  assert.ok(Number.isFinite(p.pitcherKs.home.projection));
  assert.ok(Number.isFinite(p.pitcherKs.away.projection));
  assert.equal(p.pitcherKs.home.independentOfPalFinalProjection, true);
  assert.equal(p.pitcherKs.away.independentOfPalFinalProjection, true);
});



test("MLB pitcher K uses validated pitch-zone calibration when detailed matchup exists", () => {
  const p = projectMlbDeep({
    sport: "mlb",
    home: { abbr: "HOU" },
    away: { abbr: "SEA" },
    homeSp: { id: 1, name: "Home Starter" },
    awaySp: { id: 2, name: "Away Starter" },
    savant: {
      homeRpg: 4.6, awayRpg: 4.4,
      homeSpEra: 3.5, awaySpEra: 4.1,
      homeSpKPer9: 9.0, awaySpKPer9: 8.0,
      homeSpInningsPerStart: 6.0, awaySpInningsPerStart: 5.5,
      homeSpBattersFacedPerInning: 4.2, awaySpBattersFacedPerInning: 4.3,
      homeOpponentKRate: 0.23, awayOpponentKRate: 0.22, leagueKRate: 0.225,
    },
    mlbContext: { homeBullpenEra: 4.0, awayBullpenEra: 4.2 },
    mlbPitchMatchup: {
      awayOffense: { lineupKRate: 0.25, coverage: 0.8, whiffPerSwing: 0.27, contactPerSwing: 0.73, dynamicDifficulty: 0.2 },
      homeOffense: { lineupKRate: 0.22, coverage: 0.8, whiffPerSwing: 0.24, contactPerSwing: 0.76, dynamicDifficulty: 0.1 },
    },
  });
  const home = p.pitcherKs.home;
  assert.equal(home.calibrationState, "HISTORICALLY_VALIDATED_2026_HOLDOUT");
  assert.equal(home.source, "STATCAST_PITCH_SHAPE_X_HITTER_ZONE_X_WORKLOAD_CALIBRATED_V1");
  assert.equal(home.calibration.pitchZoneWeight, MLB_PITCH_ZONE_K_CALIBRATION.pitchZoneWeight);
  assert.ok(Number.isFinite(home.rawPitchZoneProjection));
  assert.ok(Number.isFinite(home.baselineProjection));
  const expected = Math.max(
    1,
    Math.min(
      12.5,
      home.baselineProjection * MLB_PITCH_ZONE_K_CALIBRATION.baselineWeight +
      home.rawPitchZoneProjection * MLB_PITCH_ZONE_K_CALIBRATION.pitchZoneWeight +
      MLB_PITCH_ZONE_K_CALIBRATION.offset
    )
  );
  assert.ok(Math.abs(home.projection - Math.round(expected * 10) / 10) < 1e-9);
});

test("MLB deep challenger uses Pal starter innings as a fallback but not Pal final game predictions", () => {
  const base = {
    sport: "mlb",
    savant: { homeRpg: 4.8, awayRpg: 4.4, homeSpEra: 3.2, awaySpEra: 4.6 },
    mlbContext: {
      homeBullpenEra: 3.9,
      awayBullpenEra: 4.3,
      palParkRunFactor: 1.02,
      palParkHrFactor: 1.09,
      homePalRcVsTypical: 10,
      homePalHrVsTypical: 12,
      homePalKVsTypical: -5,
      homePalMatchupN: 8,
      awayPalRcVsTypical: -8,
      awayPalHrVsTypical: -10,
      awayPalKVsTypical: 7,
      awayPalMatchupN: 8,
      homePalStarterExpectedInnings: 6.2,
      awayPalStarterExpectedInnings: 4.7,
      palProjectedHomeRuns: 9.9,
      palProjectedAwayRuns: 1.1,
      palHomeWinProbability: 0.95,
      palF5Total: 8.5,
    },
  };
  const a = projectMlbDeep(base);
  const b = projectMlbDeep({
    ...base,
    mlbContext: {
      ...base.mlbContext,
      palProjectedHomeRuns: 1.2,
      palProjectedAwayRuns: 8.8,
      palHomeWinProbability: 0.05,
      palF5Total: 2.5,
    },
  });
  assert.equal(a.ok, true);
  assert.equal(a.home, b.home);
  assert.equal(a.away, b.away);
  assert.equal(a.provenance.palFinalProjectionUsed, false);
  assert.equal(a.provenance.palWinProbabilityUsed, false);
  assert.equal(a.decomposition.away.starterShare, 6.2 / 9);
  assert.equal(a.decomposition.home.starterShare, 4.7 / 9);
});

test("MLB deep challenger fails closed when team offense or starters are unresolved", () => {
  const p = projectMlbDeep({ savant: { homeRpg: 4.8, awayRpg: null, homeSpEra: 3.5, awaySpEra: 4.0 } });
  assert.equal(p.ok, false);
  assert.equal(p.canQualify, false);
});

test("CFB matchup v2 decomposes pass rush explosives havoc trenches and QB without changing champion identity", () => {
  const p = projectCfbMatchupV2({
    sport: "cfb",
    projectionKind: "FBIS",
    projHomeScore: 31,
    projAwayScore: 24,
    cfbDeepInput: {
      home: {
        passEpa: 0.28, passEpaAllowed: 0.03, rushEpa: 0.12, rushEpaAllowed: 0.02,
        successRate: 0.49, successRateAllowed: 0.40, explosiveRate: 0.16, explosiveRateAllowed: 0.10,
        havocRate: 0.14, havocAllowed: 0.11, lineYards: 3.4, lineYardsAllowed: 2.7,
        pressureRate: 0.30, pressureAllowed: 0.19, pointsPerOpportunity: 4.6, pointsPerOpportunityAllowed: 3.3,
        qbComposite: 0.55, paceNorm: 0.2,
      },
      away: {
        passEpa: 0.08, passEpaAllowed: 0.15, rushEpa: 0.06, rushEpaAllowed: 0.09,
        successRate: 0.42, successRateAllowed: 0.46, explosiveRate: 0.11, explosiveRateAllowed: 0.15,
        havocRate: 0.20, havocAllowed: 0.17, lineYards: 2.8, lineYardsAllowed: 3.2,
        pressureRate: 0.22, pressureAllowed: 0.28, pointsPerOpportunity: 3.5, pointsPerOpportunityAllowed: 4.2,
        qbComposite: 0.1, paceNorm: -0.1,
      },
    },
  });
  assert.equal(p.ok, true);
  assert.equal(p.modelId, CFB_MATCHUP_V2_ID);
  assert.equal(p.canQualify, false);
  assert.equal(p.provenance.championOverwritten, false);
  assert.equal(p.decomposition.base.home, 31);
  assert.ok(p.coverage.share > 0.8);
});

test("CFB matchup v2 marks unresolved FCS equivalency provisional", () => {
  const p = projectCfbMatchupV2({
    projectionKind: "FBIS",
    projHomeScore: 35,
    projAwayScore: 14,
    cfbDeepInput: {
      home: { qbComposite: 0.4 },
      away: { classification: "FCS", qbComposite: 0.1 },
    },
  });
  assert.equal(p.ok, true);
  assert.equal(p.provisional, true);
  assert.equal(p.decomposition.away.fcs.reason, "fcs-equivalent-rating-missing");
});

test("NFL pro v1 requires independent EPA and QB evidence and keeps QB separate", () => {
  const p = projectNflProV1({
    sport: "nfl",
    nflFeatures: {
      home: {
        offenseEpa: 0.14, defenseEpa: -0.05, successRate: 0.46, successRateAllowed: 0.39,
        earlyDownEpa: 0.12, earlyDownEpaAllowed: -0.02, qbEpa: 0.18, qbCpoe: 3.2,
        qbPressureEpa: 0.03, qbSackRate: 0.055, passEpa: 0.19, rushEpa: 0.05,
        passEpaAllowed: -0.03, rushEpaAllowed: -0.01, explosiveRate: 0.15, explosiveRateAllowed: 0.10,
        pressureRate: 0.31, pressureRateAllowed: 0.20, lineYards: 4.7, lineYardsAllowed: 4.0,
        specialTeamsEpa: 0.08, restDays: 8,
      },
      away: {
        offenseEpa: -0.02, defenseEpa: 0.08, successRate: 0.39, successRateAllowed: 0.46,
        earlyDownEpa: -0.03, earlyDownEpaAllowed: 0.09, qbEpa: 0.02, qbCpoe: -1.0,
        qbPressureEpa: -0.08, qbSackRate: 0.09, passEpa: 0.00, rushEpa: -0.03,
        passEpaAllowed: 0.12, rushEpaAllowed: 0.07, explosiveRate: 0.09, explosiveRateAllowed: 0.16,
        pressureRate: 0.19, pressureRateAllowed: 0.29, lineYards: 3.8, lineYardsAllowed: 4.8,
        specialTeamsEpa: -0.03, restDays: 6, travelMiles: 1600, timeZonesCrossed: 2,
      },
    },
  });
  assert.equal(p.ok, true);
  assert.equal(p.modelId, NFL_PRO_ID);
  assert.equal(p.marketInformed, false);
  assert.equal(p.canQualify, true);
  assert.equal(p.provenance.qbSeparatedFromTeamBaseline, true);
  assert.ok(Number.isFinite(p.home));
  assert.ok(Number.isFinite(p.away));
  assert.ok(p.coverage.share > 0.7);
});

test("NFL pro v1 fails closed without core EPA/QB evidence", () => {
  const p = projectNflProV1({ nflFeatures: { home: {}, away: {} } });
  assert.equal(p.ok, false);
  assert.equal(p.reason, "core-epa-or-qb-features-missing");
});

test("deep challengers are registered as shadows and cannot qualify", () => {
  for (const id of [MLB_DEEP_ID, CFB_MATCHUP_V2_ID, NFL_PRO_ID]) {
    assert.ok(modelMeta(id));
    assert.equal(modelMeta(id).canQualify, false);
    assert.equal(shadowCannotQualify(id), true);
  }
});
