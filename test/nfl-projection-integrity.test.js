import test from "node:test";
import assert from "node:assert/strict";
import { promoteNflResearchToBoard } from "../functions/lib/researchBoardPromote.js";
import { NFL_PRO_ID } from "../functions/lib/nflProModel.js";
import {
  NFL_PRODUCTION_CHAMPION,
  NFL_DISPLAYED_RESEARCH,
} from "../functions/lib/nflModelGovernance.js";
import { buildNflFrozenAuditPacket, attachNflFrozenAuditPackets } from "../functions/lib/nflFrozenPublicationAudit.js";
import { replayNflProScore } from "../functions/lib/nflScoreReplayAudit.js";
import { buildNflQbPersonnelShadow } from "../functions/lib/nflQbPersonnelShadow.js";
import { attachNflPersistentProfiles } from "../functions/lib/nflTeamProfiles.js";
import { buildNflWeeklyResearchReport } from "../functions/lib/nflWeeklyResearchReport.js";
import { summarizeHistoricalScoreCases, NFL_HISTORICAL_SCORE_CASES } from "../functions/lib/nflHistoricalScoreCases.js";
import { nflInjuryScoreIntegrity } from "../src/lib/nflInjuryScoreIntegrity.js";

const zeroMatchup = { pass: 0, rush: 0, explosive: 0, pressure: 0, trenches: 0, total: 0 };
function side(power, hfa) {
  return {
    teamPower: power,
    matchup: { ...zeroMatchup },
    qb: { value: 0, inputs: {} },
    tracking: { value: 0, inputs: {} },
    specialTeams: 0,
    context: 0,
    hfa,
  };
}

test("board attribution distinguishes champion from displayed NFL-PRO-v1.2 research", () => {
  const game = {
    sport: "nfl",
    home: { abbr: "JAX" },
    away: { abbr: "HOU" },
    nflProShadow: {
      ok: true,
      modelId: NFL_PRO_ID,
      version: "v1.2",
      home: 25.5,
      away: 23.7,
      margin: 1.8,
      total: 49.2,
    },
  };
  const out = promoteNflResearchToBoard([game]).games[0];
  assert.equal(out.projectionDisplayLabel, NFL_DISPLAYED_RESEARCH.displayLabel);
  assert.equal(out.championModel, NFL_PRODUCTION_CHAMPION.modelId);
  assert.equal(out.displayedResearchModel, NFL_PRO_ID);
  assert.equal(out.displayedResearchVersion, "v1.2");
  assert.equal(out.researchProjection.governance.productionChampion, NFL_PRODUCTION_CHAMPION.modelId);
  assert.equal(out.researchProjection.governance.researchNotChampion, true);
  assert.equal(out.canAuthorizeWager, false);
});

test("frozen audit packet includes contribution ledger and exact reconciliation", () => {
  const shadow = {
    ok: true,
    modelId: NFL_PRO_ID,
    version: "v1.2",
    home: 23.5,
    away: 21.5,
    margin: 2,
    total: 45,
    pHomeWin: 0.55,
    sigmaMargin: 14,
    sigmaTotal: 13,
    coverage: { missing: ["pressure"], share: 0.75 },
    decomposition: {
      baseLeaguePpg: 22.5,
      home: side(1, 0),
      away: side(-1, 0),
    },
  };
  const game = {
    id: "401872996",
    sport: "nfl",
    start: "2026-10-18T13:30Z",
    away: { abbr: "HOU", name: "Houston Texans" },
    home: { abbr: "JAX", name: "Jacksonville Jaguars" },
    nflProShadow: shadow,
    model: { projHome: 23.5, projAway: 21.5 },
    nflFeatures: {
      home: { offenseEpa: 0.1, source: "nflverse-player-v2" },
      away: { offenseEpa: -0.05, source: "nflverse-player-v2" },
    },
    nflPersistentProfile: { configured: true, attachedBeforeScoring: true, home: {}, away: {} },
  };
  const packet = buildNflFrozenAuditPacket(game, { research: { nflVerse: { builtAt: "2026-10-18T04:00:00Z" } } }, { codeSha: "abc123" });
  assert.equal(packet.ok, true);
  assert.equal(packet.replay.reconciled, true);
  assert.equal(packet.productionChampion, NFL_PRODUCTION_CHAMPION.modelId);
  assert.equal(packet.codeSha, "abc123");
  assert.equal(packet.contributions.scoringUsesVerifiedAvailability, false);
  assert.equal(packet.personnelState.attachedBeforeScoring, true);
  assert.equal(packet.contributions.home.qbContribution, 0);
  assert.ok(packet.missingFeatureFlags.includes("pressure"));
});

test("availability attaches before scoring for QB shadow without changing displayed incumbent", () => {
  const games = attachNflPersistentProfiles(
    [{ sport: "nfl", home: { abbr: "BAL" }, away: { abbr: "CLE" }, nflProShadow: { ok: true, home: 24, away: 21, margin: 3, total: 45, pHomeWin: 0.58, sigmaMargin: 13.8 } }],
    {
      teams: { bal: { team_key: "bal" }, cle: { team_key: "cle" } },
      players: {
        bal: [{ position: "QB", health_state: "OUT", role_label: "QB1", last_known_snap_share: 0.99, state_source: "nfl-official", player_name: "Lamar Jackson" }],
        cle: [],
      },
      schedule: {},
    },
    { attachedBeforeScoring: true }
  );
  assert.equal(games[0].nflPersistentProfile.attachedBeforeScoring, true);
  assert.equal(games[0].nflPersistentProfile.consumedByDisplayedScore, false);
  const shadow = buildNflQbPersonnelShadow(games[0]);
  assert.equal(shadow.ok, true);
  assert.equal(shadow.invariants.productionChampionModified, false);
  assert.equal(shadow.invariants.wagerAuthorityModified, false);
  assert.equal(shadow.incumbent.home, 24);
  assert.equal(shadow.incumbent.away, 21);
});

test("injury integrity strip reports pre-score attachment without claiming score consumption", () => {
  const evidence = nflInjuryScoreIntegrity({
    sport: "nfl",
    home: { abbr: "BAL" },
    away: { abbr: "CLE" },
    nflPersistentProfile: {
      configured: true,
      attachedBeforeScoring: true,
      home: {
        players: [{
          position: "QB",
          health_state: "OUT",
          role_label: "QB1",
          depth_rank: 1,
          state_source: "nfl-official",
          player_name: "Lamar Jackson",
          state_source_updated_at: "2026-10-18T05:00:00Z",
        }],
      },
      away: { players: [] },
    },
    nflQbPersonnelShadow: { ok: true, gate: { fired: true, combinedQbBurden: 0.9 }, marginCorrection: -1.2 },
  });
  assert.equal(evidence.critical, true);
  assert.equal(evidence.scoreUsesPersistentInjuries, false);
  assert.equal(evidence.availabilityAttachedBeforeScoring, true);
  assert.equal(evidence.qbPersonnelShadow.gateFired, true);
  assert.equal(evidence.canAuthorizeWager, false);
});

test("historical discrepancy cases remain non-executable and mostly NOT_FULLY_RECONSTRUCTABLE", () => {
  const summary = summarizeHistoricalScoreCases();
  assert.equal(summary.executableBettingOpportunities, false);
  assert.ok((summary.byReconstructability.NOT_FULLY_RECONSTRUCTABLE || 0) >= 4);
  assert.equal(NFL_HISTORICAL_SCORE_CASES.find((c) => c.matchup === "HOU@TEN").topic, "spread-compression");
});

test("weekly research report never claims promotion authority", () => {
  const report = buildNflWeeklyResearchReport({
    slate: {
      date: "2026-10-18",
      games: [
        {
          id: "1",
          away: { abbr: "HOU" },
          home: { abbr: "JAX" },
          scoreReconciled: true,
          nflFrozenAudit: { ok: true },
          nflQbPersonnelShadow: {
            ok: true,
            gate: {
              fired: false,
              historicalValidationPassed: true,
              prospectiveValidationPassed: false,
              operatorApprovedForProduction: false,
            },
          },
          nflProShadow: {
            ok: true,
            coverage: {
              share: 0.5833,
              available: ["teamEpa", "quarterback", "passMatchup", "rushMatchup", "pressure", "nextGenTracking", "context"],
              missing: ["success", "earlyDown", "explosives", "trenches", "specialTeams"],
            },
            margin: 1.8,
            total: 49.2,
          },
          modelDisagreement: { side: -0.7, total: 7.7 },
          projMargin: 1.8,
          projTotal: 49.2,
        },
      ],
      research: { nflVerse: { teams: 32 } },
    },
    publishedRows: [{ game_id: "1" }],
    publicationCoverage: {
      currentEligible: 12,
      currentFrozen: 12,
      currentCoverageShare: 1,
      missingCheckpointCount: 32,
      blockedCount: 0,
    },
  });
  assert.equal(report.schema, "nfl-weekly-research-report-v2");
  assert.equal(report.governance.automaticPromotion, false);
  assert.equal(report.governance.wagerAuthorityChanged, false);
  assert.equal(report.invariants.researchMayNotChangeChampion, true);
  assert.ok(Array.isArray(report.hypotheses));
  assert.equal(report.systemHealth.publishedCurrentCheckpoint, 12);
  assert.equal(report.systemHealth.publicationCoverageShare, 1);
  assert.equal(report.qbShadow.lifecycle, "SHADOW");
  assert.equal(report.qbShadow.promotionEligible, false);
  assert.equal(report.qbShadow.prospectiveValidationPassed, false);
  assert.equal(report.predictivePerformance.marginMae, null);
  assert.ok(report.featureCoverage.stillMissing.includes("specialTeams"));
  assert.ok(report.hypotheses.some((h) => h.id === "H-QB-AVAILABILITY-SHADOW" && h.status === "SHADOW_ATTACHED"));
  assert.ok(!report.hypotheses.some((h) => h.id === "H-PUBLICATION-COVERAGE"));
});

test("live-style decomposition still reconciles through replay helper", () => {
  // Mirrors production HOU@JAX arithmetic contract without claiming PIT provenance.
  const home = {
    teamPower: 1.335694126323671,
    matchup: { pass: 1.6839539583479142, rush: 0.3266744122420539, explosive: null, pressure: null, trenches: null, total: 2.010628370589968 },
    qb: { value: 0.6163430653306503 },
    tracking: { value: 0.107 },
    specialTeams: null,
    context: 0,
    hfa: 0,
  };
  const away = {
    teamPower: 0.5,
    matchup: { pass: 0.8, rush: 0.1, explosive: null, pressure: null, trenches: null, total: 0.9 },
    qb: { value: 0.4 },
    tracking: { value: 0.05 },
    specialTeams: null,
    context: 0,
    hfa: 0,
  };
  const rawHome = 22.5 + home.teamPower + home.matchup.total + home.qb.value * 0.55 + home.tracking.value + 0 + home.context + home.hfa;
  const rawAway = 22.5 + away.teamPower + away.matchup.total + away.qb.value * 0.55 + away.tracking.value + 0 + away.context + away.hfa;
  const round1 = (v) => Math.round((v + Number.EPSILON) * 10) / 10;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const projection = {
    ok: true,
    modelId: NFL_PRO_ID,
    version: "v1.2",
    home: round1(clamp(rawHome, 8, 42)),
    away: round1(clamp(rawAway, 8, 42)),
    decomposition: { baseLeaguePpg: 22.5, home, away },
  };
  projection.margin = round1(projection.home - projection.away);
  projection.total = round1(projection.home + projection.away);
  const replay = replayNflProScore(projection);
  assert.equal(replay.reconciled, true);
  const audited = attachNflFrozenAuditPackets([{
    sport: "nfl",
    nflProShadow: projection,
    model: { projHome: projection.home, projAway: projection.away },
    nflFeatures: { home: { offenseEpa: 0.1 }, away: { offenseEpa: 0.0 } },
  }]);
  assert.equal(audited[0].scoreReconciled, true);
});
