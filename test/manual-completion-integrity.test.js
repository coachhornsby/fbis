/**
 * Manual-completion integrity suite — exact live APIs.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MISPRICE_STATE,
  MODEL_MATURITY,
  PROBABILITY_SOURCE,
  marketImpliedAuthority,
  deriveBoardDecision,
  assertStateTransition,
  probabilityAuthority,
  buildProbabilityProvenance,
  assertActionCannotEnterPure,
  evaluatePromotionReadiness,
  assertArtifactHash,
  hashArtifactContent,
  autoPromoteAllowed,
  getModel,
  listChampions,
  assertChampionFrozen,
  assertPointInTime,
  PLATFORM_RUNTIME_VERSION,
  listSources,
} from "../functions/lib/canonical/index.js";

import { qualificationIntegrity } from "../functions/lib/slateEngine.js";
import {
  ACTION_FIREWALL,
  actionMayEnterPureGameFeatures,
  actionMayEnterPurePlayerFeatures,
  actionMayDirectlyQualifyWager,
  actionMayAuthorizeWager,
} from "../functions/lib/actionObservationSeries.js";
import { buildActionMarketResearchPacket } from "../functions/lib/actionMarketDerivatives.js";
import { projectCbbPureChallenger, CBB_PURE_STATUS } from "../functions/lib/cbbPureChallenger.js";
import { projectNflPureChallenger, nflFeatureAudit, NFL_PURE_STATUS } from "../functions/lib/nflPureChallenger.js";
import { nbaMarketImpliedCannotQualify, nbaComponentAudit } from "../functions/lib/nbaResearchArchitecture.js";
import { nhlResearchContracts } from "../functions/lib/nhlResearchArchitecture.js";
import {
  mlbChallengerStatusReport,
  mlbContextUncertainty,
  MLB_STARTER_STATE,
} from "../functions/lib/mlbChallengerScaffold.js";
import {
  cfbChampionFreezeGuard,
  buildCfbPriorProvenance,
  cfbChallengerSlots,
} from "../functions/lib/cfbChallengerScaffold.js";
import { authorizeHarvest } from "../functions/lib/auth.js";
import { MODEL_VERSION } from "../functions/lib/weights.js";
import { cbbProgramAudit } from "../functions/lib/cbbProgramAudit.js";

test("locked CFB and MLB champions remain frozen", () => {
  for (const id of ["CFB-FBIS-v2", "MLB-SAVANT-RPG-SP"]) {
    const m = getModel(id);
    assert.equal(m.maturity, MODEL_MATURITY.PRODUCTION_CHAMPION);
    assert.equal(m.coefficientsLocked, true);
    assert.equal(assertChampionFrozen(id).frozen, true);
  }
  assert.equal(cfbChampionFreezeGuard().canMutateInPlace, false);
  assert.equal(mlbChallengerStatusReport().championPreserved, true);
});

test("CFB/MLB challenger slots are scaffolds, not pipelines", () => {
  for (const slot of cfbChallengerSlots()) {
    assert.equal(slot.declaredFeatureSlot, true);
    assert.equal(slot.actualFeaturePipeline, false);
    assert.equal(slot.status, "IMPLEMENTED_SCAFFOLD");
    assert.equal(slot.pipelineStatus, "IMPLEMENTATION_PENDING");
  }
  for (const c of mlbChallengerStatusReport().challengers) {
    assert.equal(c.pathComplete, false);
    assert.match(c.status, /IMPLEMENTED_SCAFFOLD|IMPLEMENTATION_PENDING/);
  }
});

test("ACTION cannot enter PURE, qualify, or authorize", () => {
  assert.equal(ACTION_FIREWALL.canQualify, false);
  assert.equal(ACTION_FIREWALL.canAuthorizeWager, false);
  assert.equal(actionMayEnterPureGameFeatures(), false);
  assert.equal(actionMayEnterPurePlayerFeatures(), false);
  assert.equal(actionMayDirectlyQualifyWager(), false);
  assert.equal(actionMayAuthorizeWager(), false);
  assert.equal(assertActionCannotEnterPure(["action_observation"], "PURE").ok, false);
  const packet = buildActionMarketResearchPacket({
    open: { line: -3 },
    current: { line: -4 },
    bookRows: [{ sportsbook: "a", line: -3.5, americanPrice: -110 }],
    ticketPct: 62,
    moneyPct: 41,
  });
  assert.equal(packet.canQualify, false);
  assert.equal(packet.canAuthorizeWager, false);
  assert.equal(packet.canEnterPureGameFeatures, false);
  assert.equal(packet.publicSplit.sharpLabel, null);
});

test("market-implied cannot qualify; CBB baseline research-only; program incomplete", () => {
  assert.equal(marketImpliedAuthority("PINNACLE_IMPLIED").canQualify, false);
  assert.equal(nbaMarketImpliedCannotQualify("PINNACLE_IMPLIED").canQualify, false);
  assert.equal(
    qualificationIntegrity("cbb", { sport: "cbb", projectionKind: "PINNACLE_IMPLIED" }).ok,
    false
  );
  const cbb = projectCbbPureChallenger({
    eventId: "x",
    homeAdjOe: 112,
    homeAdjDe: 98,
    homeTempo: 68,
    awayAdjOe: 108,
    awayAdjDe: 102,
    awayTempo: 67,
  });
  assert.equal(cbb.ok, true);
  assert.equal(cbb.canQualify, false);
  assert.equal(CBB_PURE_STATUS.implementation, "IMPLEMENTED_RESEARCH_ONLY");
  assert.equal(CBB_PURE_STATUS.oosStatus, null);
  assert.equal(CBB_PURE_STATUS.programComplete, false);
  const audit = cbbProgramAudit();
  assert.equal(audit.oosDataPendingEligible, false);
  assert.ok((audit.counts.IMPLEMENTATION_PENDING || 0) > 0);
});

test("NFL pure does not claim OOS_DATA_PENDING while implementation remains", () => {
  const nfl = projectNflPureChallenger({});
  assert.equal(nfl.canQualify, false);
  assert.equal(NFL_PURE_STATUS.oosStatus, null);
  assert.ok(NFL_PURE_STATUS.remainingImplementation.length > 0);
  const audit = nflFeatureAudit();
  const pending = Object.values(audit).filter((r) => r.status === "IMPLEMENTATION_PENDING");
  const computed = Object.values(audit).filter((r) => r.status === "IMPLEMENTED_RESEARCH_ONLY");
  assert.ok(pending.length >= 10);
  assert.ok(computed.length >= 8);
});

test("NBA/NHL split provider block from buildable engineering", () => {
  const nba = nbaComponentAudit();
  assert.ok(nba.providerOrLicenseBlocked.length >= 1);
  assert.ok(nba.buildable.some((b) => b.status === "IMPLEMENTATION_PENDING"));
  assert.ok(nba.buildable.some((b) => b.status === "IMPLEMENTED" || b.status === "IMPLEMENTED_SCAFFOLD"));
  const nhl = nhlResearchContracts();
  assert.equal(nhl.implementation, "PROVIDER_OR_LICENSE_BLOCKED");
  assert.ok(nhl.buildableComponents.some((b) => b.status === "IMPLEMENTATION_PENDING"));
});

test("misprice / probability / promotion governance", () => {
  assert.equal(
    assertStateTransition(MISPRICE_STATE.MODEL_DISAGREEMENT, MISPRICE_STATE.CALIBRATED_EDGE, {}).ok,
    false
  );
  const auth = probabilityAuthority(
    buildProbabilityProvenance({ probabilitySource: PROBABILITY_SOURCE.HEURISTIC_SIGMA })
  );
  assert.equal(auth.canShowExpectedValue, false);
  assert.equal(autoPromoteAllowed(), false);
  const promo = evaluatePromotionReadiness({
    modelId: "NFL-FBIS-PURE",
    foldScheme: "shuffled_kfold",
  });
  assert.equal(promo.ready, false);
  assert.equal(promo.autoPromote, false);
});

test("PIT fail-closed + harvest fail-closed + board NO_MODEL", () => {
  assert.equal(
    assertPointInTime({
      effectiveAt: "2026-09-13T20:00:00Z",
      informationCutoff: "2026-09-13T12:00:00Z",
      eventStart: "2026-09-13T18:00:00Z",
    }).ok,
    false
  );
  assert.equal(authorizeHarvest(new Request("https://example/api/collect"), {}).ok, false);
  assert.equal(
    deriveBoardDecision({
      hasPureProjection: false,
      projectionKind: "PINNACLE_IMPLIED",
      qualified: false,
    }).decision,
    "NO_MODEL"
  );
});

test("artifact hash + runtime + prior + MLB uncertainty", () => {
  const hash = hashArtifactContent("trained-bytes");
  assert.equal(assertArtifactHash("deadbeef", "trained-bytes").ok, false);
  assert.equal(assertArtifactHash(hash, "trained-bytes").ok, true);
  assert.equal(PLATFORM_RUNTIME_VERSION, MODEL_VERSION);
  assert.equal(buildCfbPriorProvenance({ priorIsLiveInSeason: true }).label, "LIVE_IN_SEASON_PRIOR");
  const unc = mlbContextUncertainty({ starterState: MLB_STARTER_STATE.UNKNOWN });
  assert.ok(unc.sigma > 3);
  assert.deepEqual(
    listChampions()
      .map((c) => c.modelId)
      .sort(),
    ["CFB-FBIS-v2", "MLB-SAVANT-RPG-SP"].sort()
  );
  const action = listSources().find((s) => s.providerId === "action_apify");
  assert.equal(action.inPureModel, false);
  assert.equal(action.domain, "market");
});

test("migration tip + compliance matrix vocabulary", async () => {
  const migration = await readFile(
    new URL("../migrations/0025_manual_completion_contracts.sql", import.meta.url),
    "utf8"
  );
  const health = await readFile(new URL("../functions/api/health.js", import.meta.url), "utf8");
  const schema = await readFile(new URL("../schema.extensions.sql", import.meta.url), "utf8");
  const doc = await readFile(
    new URL("../docs/canonical/manual-completion-matrix.md", import.meta.url),
    "utf8"
  );
  assert.match(migration, /canonical_publication/);
  assert.match(health, /0028_executed_bet_tracker_metadata/);
  assert.match(schema, /canonical_publication/);
  assert.match(doc, /IMPLEMENTED/);
  assert.match(doc, /IMPLEMENTED_SCAFFOLD/);
  assert.match(doc, /IMPLEMENTATION_PENDING/);
  assert.match(doc, /PROVIDER_OR_LICENSE_BLOCKED/);
  assert.match(doc, /OOS_DATA_PENDING/);
});
