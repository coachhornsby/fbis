import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  gradeResearchScoreProjection,
  summarizeExactVersionCohort,
} from "../functions/lib/nflResearchGrade.js";
import { isMalformedAbbr, resolveTeam, enrichTeam } from "../functions/lib/teams.js";
import {
  publicationEligibilityForGame,
  buildXGameCopy,
  PUBLICATION_STATES,
} from "../functions/lib/xPublication.js";
import {
  deriveLiveOperational,
  LIVE_OPERATIONAL,
} from "../functions/lib/canonical/liveOperational.js";

describe("NFL research grade formulas", () => {
  it("computes score/margin/total errors and market paired deltas", () => {
    const g = gradeResearchScoreProjection({
      projectedAway: 20,
      projectedHome: 27,
      actualAway: 17,
      actualHome: 24,
      marketHomeSpread: -6.5,
      marketTotal: 45.5,
    });
    assert.equal(g.ok, true);
    assert.equal(g.awayAbsError, 3);
    assert.equal(g.homeAbsError, 3);
    assert.equal(g.actualHomeMargin, 7);
    assert.equal(g.projectedHomeMargin, 7);
    assert.equal(g.marginError, 0);
    assert.equal(g.marginAbsError, 0);
    assert.equal(g.actualTotal, 41);
    assert.equal(g.projectedTotal, 47);
    assert.equal(g.totalError, 6);
    assert.equal(g.totalAbsError, 6);
    assert.equal(g.winnerCorrect, true);
    assert.equal(g.marketHomeMargin, 6.5);
    assert.equal(g.marketMarginAbsError, 0.5);
    assert.equal(g.pairedMarginDelta, -0.5);
    assert.equal(g.marketTotalAbsError, 4.5);
    assert.equal(g.pairedTotalDelta, 1.5);
    assert.equal(g.isEv, false);
    assert.equal(g.isClv, false);
  });

  it("separates prospective vs replay in exact-version cohorts and flags EARLY SAMPLE", () => {
    const row = {
      ok: true,
      modelId: "NFL-FBIS-PURE",
      modelVersion: "research-v0-form",
      marginAbsError: 2,
      totalAbsError: 4,
      marginError: 1,
      totalError: -2,
      winnerCorrect: true,
      marketMarginAbsError: 3,
      marketTotalAbsError: 5,
      pairedMarginDelta: -1,
      pairedTotalDelta: -1,
    };
    const summary = summarizeExactVersionCohort([
      { ...row, classification: "PROSPECTIVE" },
      { ...row, classification: "REPLAY_VERIFIED", marginAbsError: 9 },
    ]);
    assert.equal(summary.prospective.nGraded, 1);
    assert.equal(summary.prospective.earlySample, true);
    assert.equal(summary.label, "EARLY SAMPLE");
    assert.equal(summary.historicalReplay.nGraded, 1);
    assert.equal(summary.prospective.marginMae, 2);
    assert.equal(summary.historicalReplay.marginMae, 9);
  });
});

describe("provider identity repair", () => {
  it("treats em dash / malformed abbr as malformed", () => {
    assert.equal(isMalformedAbbr("—"), true);
    assert.equal(isMalformedAbbr("-"), true);
    assert.equal(isMalformedAbbr(""), true);
    assert.equal(isMalformedAbbr("ARI"), false);
  });

  it("resolves ARI@LAC-shaped payload via ESPN team id when abbr is em dash", () => {
    const ari = enrichTeam("nfl", {
      abbr: "—",
      espnId: "22",
      name: "Arizona Cardinals",
      displayName: "Arizona Cardinals",
    });
    const lac = enrichTeam("nfl", {
      abbr: "—",
      espnId: "24",
      name: "Los Angeles Chargers",
      shortDisplayName: "Chargers",
    });
    assert.equal(ari.matchStatus, "resolved");
    assert.equal(ari.abbr, "ARI");
    assert.equal(ari.canonicalId, resolveTeam("nfl", { espnId: "22" }).id);
    assert.equal(lac.matchStatus, "resolved");
    assert.equal(lac.abbr, "LAC");
    assert.equal(ari.identityBlock, null);
  });

  it("fails closed with PROVIDER_IDENTITY_BLOCK when provider id is unknown", () => {
    const miss = enrichTeam("nfl", { abbr: "—", espnId: "999999", name: "Mystery Club" });
    assert.equal(miss.matchStatus, "unresolved");
    assert.equal(miss.identityBlock, "PROVIDER_IDENTITY_BLOCK");
    assert.equal(miss.abbr, "—");
    assert.equal(miss.canonicalId, null);
  });

  it("fails closed on genuinely ambiguous names without inventing abbr", () => {
    const miss = enrichTeam("nfl", { name: "Los Angeles" });
    assert.equal(miss.matchStatus, "unresolved");
    assert.equal(miss.identityBlock, "AMBIGUOUS_TEAM_IDENTITY");
    assert.equal(miss.abbr, "—");
  });
});

describe("publication + operational gates", () => {
  it("research publication does not unlock wager authority", () => {
    const game = {
      projectionKind: "FBIS",
      projectionMaturity: "RESEARCH",
      canQualify: false,
      qualificationBlocked: true,
      projHome: 30.7,
      projAway: 30.3,
      model: { projHome: 30.7, projAway: 30.3, maturity: "RESEARCH", projectionKind: "FBIS" },
      researchProjection: { modelId: "NFL-FBIS-PURE", modelVersion: "research-v0-form" },
      away: { abbr: "DAL", name: "Dallas Cowboys" },
      home: { abbr: "NYG", name: "New York Giants" },
      odds: { pinSpread: -3.5, pinTotal: 47.5 },
    };
    const el = publicationEligibilityForGame(game);
    assert.equal(el.eligible, true);
    assert.equal(el.status, PUBLICATION_STATES.RESEARCH_PUBLISHABLE);
    assert.equal(el.canQualify, false);
    assert.equal(el.canAuthorizeWager, false);
    const x = buildXGameCopy(game, "nfl");
    assert.equal(x.ok, true);
    assert.match(x.text, /Status: Research/);
    assert.doesNotMatch(x.text, /\bEV\b|best bet|lock|guaranteed|sharp play|qualified/i);
  });

  it("LIVE_OPERATIONAL advances only with evidence gates", () => {
    assert.equal(
      deriveLiveOperational({
        liveEventDetected: true,
        modelExecuted: true,
        boardDisplayed: true,
        frozenCount: 30,
      }).status,
      LIVE_OPERATIONAL.BOARD_LIVE
    );
    assert.equal(
      deriveLiveOperational({
        boardDisplayed: true,
        frozenCount: 30,
        publishedCount: 1,
      }).status,
      LIVE_OPERATIONAL.PUBLICATION_LIVE
    );
    assert.equal(
      deriveLiveOperational({
        liveEventDetected: true,
        modelExecuted: true,
        boardDisplayed: true,
        frozenCount: 30,
        publishedCount: 1,
        gradedCount: 1,
      }).status,
      LIVE_OPERATIONAL.FULL_LOOP_LIVE
    );
  });
});
