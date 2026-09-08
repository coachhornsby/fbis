import test from "node:test";
import assert from "node:assert/strict";

import { projectMlbDeep, MLB_DEEP_ID } from "../functions/lib/mlbDeepModel.js";
import { projectCfbMatchupV2, CFB_MATCHUP_V2_ID } from "../functions/lib/cfbMatchupV2.js";
import { projectNflProV1, NFL_PRO_ID } from "../functions/lib/nflProModel.js";
import { modelMeta, shadowCannotQualify } from "../functions/lib/collegeModels.js";

test("MLB deep challenger allocates starter and bullpen run prevention without market inputs", () => {
  const p = projectMlbDeep({
    sport: "mlb",
    savant: { homeRpg: 4.9, awayRpg: 4.2, homeSpEra: 3.4, awaySpEra: 4.5 },
    mlbContext: {
      homeBullpenEra: 3.7,
      awayBullpenEra: 4.4,
      homePlatoonWoba: 0.334,
      awayPlatoonWoba: 0.309,
      parkFactor: 1.04,
      weatherRunFactor: 1.02,
      homeDefenseRunsSaved: 10,
      awayDefenseRunsSaved: -8,
    },
  });
  assert.equal(p.ok, true);
  assert.equal(p.modelId, MLB_DEEP_ID);
  assert.equal(p.independent, true);
  assert.equal(p.marketInformed, false);
  assert.equal(p.canQualify, false);
  assert.ok(Number.isFinite(p.home));
  assert.ok(Number.isFinite(p.away));
  assert.ok(p.decomposition.home.bullpenShare > 0);
  assert.equal(p.provenance.ballparkPalRole, "external-cross-check-only");
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
  assert.equal(p.canQualify, false);
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
