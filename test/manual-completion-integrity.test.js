/**
 * FBIS canonical-manual completion integrity suite.
 * Hard rules from the completion mandate — no invented OOS/EV evidence.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MISPRICE_STATE,
  MODEL_MATURITY,
  REASON_CODE,
  PROBABILITY_SOURCE,
  marketImpliedAuthority,
  deriveBoardDecision,
  assertStateTransition,
  probabilityAuthority,
  buildProbabilityProvenance,
  assertPureManifestClean,
  assertActionCannotEnterPure,
  evaluatePromotionReadiness,
  assertArtifactHash,
  hashArtifactContent,
  buildPublicationRecord,
  supersedePublication,
  autoPromoteAllowed,
  getModel,
  listChampions,
  assertChampionFrozen,
  assertPointInTime,
  PLATFORM_RUNTIME_VERSION,
  getSource,
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
import { projectCbbPureChallenger } from "../functions/lib/cbbPureChallenger.js";
import { projectNflPureChallenger } from "../functions/lib/nflPureChallenger.js";
import { nbaMarketImpliedCannotQualify } from "../functions/lib/nbaResearchArchitecture.js";
import { nhlResearchContracts } from "../functions/lib/nhlResearchArchitecture.js";
import {
  mlbChallengerStatusReport,
  mlbContextUncertainty,
  MLB_STARTER_STATE,
} from "../functions/lib/mlbChallengerScaffold.js";
import {
  cfbChampionFreezeGuard,
  buildCfbPriorProvenance,
} from "../functions/lib/cfbChallengerScaffold.js";
import { authorizeHarvest } from "../functions/lib/auth.js";
import { MODEL_VERSION } from "../functions/lib/weights.js";

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

test("ACTION cannot enter PURE features, qualify, or authorize", () => {
  assert.equal(ACTION_FIREWALL.canQualify, false);
  assert.equal(ACTION_FIREWALL.canAuthorizeWager, false);
  assert.equal(actionMayEnterPureGameFeatures(), false);
  assert.equal(actionMayEnterPurePlayerFeatures(), false);
  assert.equal(actionMayDirectlyQualifyWager(), false);
  assert.equal(actionMayAuthorizeWager(), false);
  assert.equal(assertActionCannotEnterPure(["action_observation"], "PURE").ok, false);
  assert.equal(assertActionCannotEnterPure(["public_ticket_pct"], "PLAYER").ok, false);
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

test("market-implied CBB/NBA cannot qualify", () => {
  for (const sport of ["cbb", "nba"]) {
    const gate = qualificationIntegrity(sport, {
      sport,
      projectionKind: "PINNACLE_IMPLIED",
      quality: { flags: ["pinnacle_implied_score"] },
    });
    assert.equal(gate.ok, false);
  }
  assert.equal(marketImpliedAuthority("PINNACLE_IMPLIED").canQualify, false);
  assert.equal(nbaMarketImpliedCannotQualify("PINNACLE_IMPLIED").canQualify, false);
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
});

test("NFL without independent production model is NO_MODEL; qualified=false is not PASS", () => {
  const board = deriveBoardDecision({
    hasPureProjection: false,
    projectionKind: "PINNACLE_IMPLIED",
    qualified: false,
  });
  assert.equal(board.decision, "NO_MODEL");
  assert.notEqual(board.decision, "PASS");
  const nfl = projectNflPureChallenger({});
  assert.equal(nfl.canQualify, false);
});

test("MODEL_DISAGREEMENT and heuristic sigma cannot become CALIBRATED_EDGE / EV", () => {
  const blocked = assertStateTransition(
    MISPRICE_STATE.MODEL_DISAGREEMENT,
    MISPRICE_STATE.CALIBRATED_EDGE,
    {}
  );
  assert.equal(blocked.ok, false);
  const auth = probabilityAuthority(
    buildProbabilityProvenance({ probabilitySource: PROBABILITY_SOURCE.HEURISTIC_SIGMA })
  );
  assert.equal(auth.ok, false);
  assert.equal(auth.canShowExpectedValue, false);
  assert.ok(auth.blockers.length > 0);
});

test("ambiguous identity and stale market fail closed", () => {
  assert.equal(
    deriveBoardDecision({
      blocked: true,
      blockReasonCode: REASON_CODE.AMBIGUOUS_EVENT_IDENTITY,
    }).decision,
    "BLOCKED"
  );
  assert.equal(
    deriveBoardDecision({
      blocked: true,
      blockReasonCode: REASON_CODE.AMBIGUOUS_PLAYER_IDENTITY,
    }).decision,
    "BLOCKED"
  );
  assert.equal(
    deriveBoardDecision({ blocked: true, blockReasonCode: REASON_CODE.STALE_MARKET }).decision,
    "BLOCKED"
  );
});

test("publications are immutable; supersession creates a new record", () => {
  const prior = buildPublicationRecord({
    projectionId: "proj-1",
    modelId: "CFB-FBIS-v2",
    publishedValue: { home: 24 },
    sport: "cfb",
  });
  const { prior: superseded, next } = supersedePublication(prior, {
    publishedValue: { home: 25 },
  });
  assert.equal(prior.publishedValue.home, 24);
  assert.equal(superseded.publicationStatus, "SUPERSEDED");
  assert.equal(next.supersedesPublicationId, prior.publicationId);
  assert.notEqual(next.publicationId, prior.publicationId);
});

test("unauthorized harvest / missing secret fail closed", () => {
  const missing = authorizeHarvest(new Request("https://fbis.example/api/collect"), {});
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "secret-unconfigured");
  const bad = authorizeHarvest(
    new Request("https://fbis.example/api/collect", { headers: { "x-harvest-secret": "nope" } }),
    { HARVEST_SECRET: "abc" }
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "unauthorized");
});

test("PURE manifests reject market fields; PIT rejects future cutoff", () => {
  assert.equal(assertPureManifestClean(["sportsbook_spread", "team_off_epa"], "PURE").ok, false);
  assert.equal(assertPureManifestClean(["team_off_epa"], "PURE").ok, true);
  const bad = assertPointInTime({
    effectiveAt: "2026-09-13T12:00:00Z",
    informationCutoff: "2026-09-13T20:00:00Z",
    eventStart: "2026-09-13T18:00:00Z",
  });
  assert.equal(bad.ok, false);
});

test("artifact hash mismatch and shuffled folds block promotion; never auto-promote", () => {
  const hash = hashArtifactContent("trained-bytes");
  assert.equal(assertArtifactHash("deadbeef", "trained-bytes").ok, false);
  assert.equal(assertArtifactHash(hash, "trained-bytes").ok, true);
  const promo = evaluatePromotionReadiness({
    modelId: "NFL-FBIS-PURE",
    modelVersion: "research-v0",
    foldScheme: "shuffled_kfold",
  });
  assert.equal(autoPromoteAllowed(), false);
  assert.equal(promo.ready, false);
  assert.equal(promo.autoPromote, false);
});

test("market sources cannot enter PURE; NBA/NHL licensed feeds blocked", () => {
  const action = getSource("action_apify");
  assert.equal(action.inPureModel, false);
  assert.equal(action.domain, "market");
  assert.equal(getSource("nba_stats_licensed").commercialStatus, "BLOCKED");
  assert.equal(getSource("nhl_stats_licensed").commercialStatus, "BLOCKED");
  const nhl = nhlResearchContracts();
  assert.match(String(nhl.implementation), /PROVIDER|LICENSE|BLOCK/i);
});

test("runtime version and champion freeze semantics", () => {
  assert.equal(PLATFORM_RUNTIME_VERSION, MODEL_VERSION);
  const prior = buildCfbPriorProvenance({ priorIsLiveInSeason: true });
  assert.equal(prior.label, "LIVE_IN_SEASON_PRIOR");
  const unc = mlbContextUncertainty({ starterState: MLB_STARTER_STATE.UNKNOWN });
  assert.ok(unc.sigma > 3);
  assert.ok(unc.suppressFragile.length > 0);
  const champs = listChampions()
    .map((c) => c.modelId)
    .sort();
  assert.deepEqual(champs, ["CFB-FBIS-v2", "MLB-SAVANT-RPG-SP"].sort());
});

test("migration 0025 + health tip + compliance matrix", async () => {
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
  assert.match(migration, /canonical_publication_ledger/);
  assert.match(migration, /auto_promote_allowed['\"]?,?\s*'false'/i);
  assert.match(health, /0025_manual_completion_contracts/);
  assert.match(schema, /canonical_publication_ledger/);
  assert.match(doc, /IMPLEMENTED/);
  assert.match(doc, /OOS_DATA_PENDING|PROVIDER_OR_LICENSE_BLOCKED|OPERATOR_PROMOTION_REQUIRED/);
  assert.match(doc, /CFB-FBIS-v2/);
  assert.match(doc, /ACTION/);
});
