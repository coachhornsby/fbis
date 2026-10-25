import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyResearchScoreCorrections,
  applyPlattCalibration,
  evaluateMarketPromotionGate,
  isWeakResearchLaneQuarantined,
  featureFamilyAuthorized,
  cappedResiduals,
  loadNflResearchCorrections,
} from "../functions/lib/nflProjectionImprovements.js";
import correctionsJs from "../functions/lib/nflProV12ResearchCorrections.js";
import { projectNflProV1, attachNflProShadow, NFL_PRO_ID } from "../functions/lib/nflProModel.js";
import { replayNflProScore } from "../functions/lib/nflScoreReplayAudit.js";
import { promoteNflResearchToBoard } from "../functions/lib/researchBoardPromote.js";
import {
  NFL_PRODUCTION_CHAMPION,
  NFL_MARKET_PROMOTION_GATE,
  NFL_QB_PERSONNEL_CHALLENGER,
} from "../functions/lib/nflModelGovernance.js";
import {
  buildNflQbPersonnelShadow,
  assertNflQbShadowInvariants,
  NFL_QB_PERSONNEL_GATE,
} from "../functions/lib/nflQbPersonnelShadow.js";
import { NFL_FEATURE_CONTRACT_VERSION } from "../functions/lib/nflPregamePublication.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(root, "../data/models/nfl-pro-v1-2-research-corrections-20261018.json");

function baseFeatures(overrides = {}) {
  return {
    offenseEpa: 0.10,
    defenseEpa: -0.04,
    successRate: 0.45,
    successRateAllowed: 0.40,
    earlyDownEpa: 0.08,
    earlyDownEpaAllowed: -0.02,
    qbEpa: 0.14,
    qbCpoe: 2,
    qbSackRate: 0.06,
    passEpa: 0.12,
    rushEpa: 0.03,
    passEpaAllowed: -0.02,
    rushEpaAllowed: 0.01,
    explosiveRate: 0.12,
    explosiveRateAllowed: 0.10,
    pressureRate: 0.28,
    pressureRateAllowed: 0.22,
    lineYards: 4.5,
    lineYardsAllowed: 4.0,
    specialTeamsEpa: 0.05,
    restDays: 7,
    ...overrides,
  };
}

test("JS research-corrections mirror matches JSON artifact schema and residuals", () => {
  const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(correctionsJs.schema, json.schema);
  assert.equal(correctionsJs.championUnchanged, "NFL-PRO-v1.1");
  assert.equal(correctionsJs.altersChampion, false);
  assert.equal(correctionsJs.canAuthorizeWager, false);
  assert.equal(correctionsJs.scoreResiduals.marginResidual, json.scoreResiduals.marginResidual);
  assert.equal(correctionsJs.scoreResiduals.totalResidual, json.scoreResiduals.totalResidual);
  assert.equal(correctionsJs.platt.intercept, json.platt.intercept);
  assert.equal(correctionsJs.platt.weight, json.platt.weight);
});

test("P0: Platt calibration moves mid-band probabilities with fitted intercept/weight", () => {
  const raw = 0.55;
  const cal = applyPlattCalibration(raw);
  assert.notEqual(cal, raw);
  assert.ok(cal > 0 && cal < 1);
  // Fitted intercept is negative → mid-band homes should be pulled down.
  assert.ok(cal < raw);
});

test("P0/P1: research score corrections apply margin+total residuals without altering champion", () => {
  const base = {
    ok: true,
    modelId: NFL_PRO_ID,
    version: "v1.2",
    home: 24,
    away: 21,
    margin: 3,
    total: 45,
    pHomeWin: 0.58,
    sigmaMargin: 13.8,
    coverage: { share: 0.85 },
  };
  const out = applyResearchScoreCorrections(base);
  assert.equal(out.researchCorrections.applied, true);
  assert.equal(out.researchCorrections.altersChampion, false);
  assert.equal(out.researchCorrections.canAuthorizeWager, false);
  assert.equal(out.researchCorrections.championUnchanged, NFL_PRODUCTION_CHAMPION.modelId);
  // Totals residual ~+3 → total rises; margin residual ~-2.24 → home edge shrinks.
  assert.ok(out.total > base.total);
  assert.ok(out.margin < base.margin);
  assert.ok(Number.isFinite(out.pHomeWinCalibrated));
  assert.ok(Number.isFinite(out.pHomeWinRaw));
});

test("P0: market promotion gate requires beats-close + identical windows + CLV + operator", () => {
  assert.equal(NFL_MARKET_PROMOTION_GATE.automaticPromotion, false);
  assert.equal(NFL_MARKET_PROMOTION_GATE.championFrozen, "NFL-PRO-v1.1");

  const fail = evaluateMarketPromotionGate({
    challenger: { marginMae: 10.5, totalMae: 12, winnerAccuracy: 0.60 },
    market: { marginMae: 9.8, totalMae: 11, winnerAccuracy: 0.62 },
    identicalChronologicalWindows: true,
    operatorApproved: false,
    economicClvAvailable: false,
  });
  assert.equal(fail.beatsClosingOnIdenticalWindows, false);
  assert.equal(fail.researchGatePassed, false);
  assert.equal(fail.automaticPromotion, false);
  assert.equal(fail.canAuthorizeWager, false);

  const beat = evaluateMarketPromotionGate({
    challenger: { marginMae: 9.0, totalMae: 10.0, winnerAccuracy: 0.65 },
    market: { marginMae: 9.8, totalMae: 11.0, winnerAccuracy: 0.62 },
    identicalChronologicalWindows: true,
    operatorApproved: true,
    economicClvAvailable: true,
  });
  assert.equal(beat.beatsClosingOnIdenticalWindows, true);
  assert.equal(beat.researchGatePassed, true);
  assert.equal(beat.automaticPromotion, false);
  assert.equal(beat.productionChampionUnchanged, true);
});

test("P0: trenches and special teams stay null without authorized source", () => {
  const p = projectNflProV1({
    sport: "nfl",
    nflFeatures: {
      home: baseFeatures(),
      away: baseFeatures({ offenseEpa: -0.02, defenseEpa: 0.05, qbEpa: 0.02 }),
    },
  });
  assert.equal(p.ok, true);
  assert.equal(p.decomposition.home.matchup.trenches, null);
  assert.equal(p.decomposition.home.specialTeams, null);
  assert.equal(featureFamilyAuthorized(baseFeatures(), "trenches"), false);

  const authorized = projectNflProV1({
    sport: "nfl",
    nflFeatures: {
      home: baseFeatures({ trenchesAuthorized: true, specialTeamsAuthorized: true }),
      away: baseFeatures({
        offenseEpa: -0.02,
        defenseEpa: 0.05,
        qbEpa: 0.02,
        trenchesAuthorized: true,
        specialTeamsAuthorized: true,
      }),
    },
  });
  assert.notEqual(authorized.decomposition.home.matchup.trenches, null);
  assert.notEqual(authorized.decomposition.home.specialTeams, null);
});

test("attachNflProShadow applies research corrections and keeps wager authority closed", () => {
  const { games, meta } = attachNflProShadow([
    {
      sport: "nfl",
      nflFeatures: {
        home: baseFeatures(),
        away: baseFeatures({ offenseEpa: -0.02, defenseEpa: 0.06, qbEpa: 0.01 }),
      },
    },
  ]);
  const shadow = games[0].nflProShadow;
  assert.equal(shadow.ok, true);
  assert.equal(shadow.researchCorrections.applied, true);
  assert.equal(shadow.canAuthorizeWager, false);
  assert.equal(meta.productionChampionUnchanged, true);
  assert.ok(meta.researchCorrectionsApplied >= 1);

  const replay = replayNflProScore(shadow);
  assert.equal(replay.ok, true);
  assert.equal(replay.reconciled, true);
  assert.equal(replay.researchCorrectionsApplied, true);
});

test("P1: QB overlay stays SHADOW until 160/50 gates; invariants hardened", () => {
  assert.equal(NFL_QB_PERSONNEL_GATE.minTotalGradedGames, 160);
  assert.equal(NFL_QB_PERSONNEL_GATE.minGateFiredGames, 50);
  assert.equal(NFL_QB_PERSONNEL_CHALLENGER.lifecycle, "SHADOW");
  assert.equal(NFL_QB_PERSONNEL_GATE.prospectiveValidationPassed, false);

  const shadow = buildNflQbPersonnelShadow({
    sport: "nfl",
    nflProShadow: {
      ok: true,
      modelId: NFL_PRO_ID,
      version: "v1.2",
      home: 24,
      away: 21,
      margin: 3,
      total: 45,
      pHomeWin: 0.59,
      sigmaMargin: 13.8,
    },
    nflPersistentProfile: {
      home: {
        players: [
          {
            player_key: "qb1",
            position: "QB",
            health_state: "OUT",
            last_known_snap_share: 0.95,
          },
        ],
      },
      away: { players: [] },
    },
  });
  assert.equal(shadow.lifecycle, "SHADOW");
  assert.equal(shadow.canQualify, false);
  assert.equal(shadow.canAuthorizeWager, false);
  assert.equal(shadow.invariants.productionChampionModified, false);
  assert.equal(shadow.invariantCheck.ok, true);
  const check = assertNflQbShadowInvariants(shadow);
  assert.equal(check.ok, true);
});

test("P2: weak form research lanes are quarantined on board fallback", () => {
  assert.equal(isWeakResearchLaneQuarantined("research-v0.1-form-calibrated"), true);
  const out = promoteNflResearchToBoard([
    {
      sport: "nfl",
      nflProShadow: { ok: false, reason: "core-epa-or-qb-features-missing" },
      nflShadow: { ok: true, home: 24.5, away: 21.5, version: "v0.1-margin-calibrated" },
    },
  ]);
  assert.equal(out.games[0].researchQuarantined, true);
  assert.equal(out.games[0].promotionEvidenceEligible, false);
  assert.match(out.games[0].projectionDisplayLabel, /QUARANTINED/);
  assert.ok(out.meta.weakResearchQuarantine.includes("research-v0.1-form-calibrated"));
});

test("P2: feature contract version bumped for PIT correction hash", () => {
  assert.equal(NFL_FEATURE_CONTRACT_VERSION, "nfl-features-v5");
  const residuals = cappedResiduals(loadNflResearchCorrections());
  assert.ok(Math.abs(residuals.marginResidual) <= 3.5);
  assert.ok(Math.abs(residuals.totalResidual) <= 4.0);
});
