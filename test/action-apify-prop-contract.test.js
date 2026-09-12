/**
 * Stable player-prop contract + football market aliases.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeFootballPropMarket,
  classifyPlayerPropsReadiness,
  isFbisFootballModelMarket,
  toStablePlayerPropContract,
  FBIS_FOOTBALL_PROP_MARKETS,
} from "../functions/lib/actionApifyPropContract.js";
import { normalizePlayerProps } from "../functions/lib/actionApifyShadow.js";
import {
  CADENCE_EXPERIMENT_PROFILES,
  projectMonthlyStarterSufficiency,
  resolveCadenceExperimentProfile,
} from "../functions/lib/actionApifyChampionship.js";

test("football prop market aliases map to FBIS model markets", () => {
  assert.equal(canonicalizeFootballPropMarket("Passing Yards"), "passing_yards");
  assert.equal(canonicalizeFootballPropMarket("player_pass_yds"), "passing_yards");
  assert.equal(canonicalizeFootballPropMarket("rush_attempts"), "rushing_attempts");
  assert.equal(canonicalizeFootballPropMarket("Receptions"), "receptions");
  assert.equal(canonicalizeFootballPropMarket("receiving yards"), "receiving_yards");
  assert.equal(canonicalizeFootballPropMarket("first_touchdown_scorer"), null);
  for (const m of FBIS_FOOTBALL_PROP_MARKETS) {
    assert.equal(isFbisFootballModelMarket(m), true);
  }
});

test("stable prop contract never invents ids/prices/images and stays non-decision-eligible", () => {
  const contract = toStablePlayerPropContract(
    {
      playerName: "Josh Allen",
      market: "passing_yards",
      line: 267.5,
      overOdds: -110,
      underOdds: -110,
      book: "draftkings",
    },
    { providerGameId: "290853", gameIdentityConfidence: "EXACT" }
  );
  assert.equal(contract.providerPlayerId, null);
  assert.equal(contract.fbisPlayerId, null);
  assert.equal(contract.imageUrl, null);
  assert.equal(contract.imageSource, null);
  assert.equal(contract.marketCanonical, "passing_yards");
  assert.equal(contract.decisionEligible, false);
  assert.ok(contract.reasonCodes.includes("SHADOW_ONLY"));
  assert.ok(contract.reasonCodes.includes("PROVIDER_PLAYER_ID_ABSENT"));
  assert.equal(contract.marketComplete, true);
});

test("normalizePlayerProps attaches marketCanonical + nullable imageUrl", () => {
  const rows = normalizePlayerProps([
    {
      player: { id: 9, name: "Bijan Robinson", teamAbbr: "ATL", position: "RB" },
      type: "rushing_yards",
      line: 78.5,
      books: [{ book: "FanDuel", overOdds: -105, underOdds: -115 }],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].marketCanonical, "rushing_yards");
  assert.equal(rows[0].imageUrl, null);
  assert.equal(rows[0].overOdds, -105);
  assert.equal(rows[0].book, "fanduel");
});

test("options[] Actor shape flattens into priced sides without invention", () => {
  const rows = normalizePlayerProps([
    {
      playerName: "CeeDee Lamb",
      market: "receptions",
      line: 6.5,
      book: "DraftKings",
      options: [
        { side: "Over", price: -120 },
        { side: "Under", price: -110 },
      ],
    },
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.marketCanonical === "receptions"));
  assert.ok(rows.some((r) => r.overOdds === -120 || r.price === -120));
  assert.ok(rows.some((r) => r.underOdds === -110 || r.price === -110));
});

test("player-prop readiness classifier stays fail-closed without coverage", () => {
  const blocked = classifyPlayerPropsReadiness({});
  assert.equal(blocked.status, "BLOCKED");
  const research = classifyPlayerPropsReadiness({
    modelMarketNormalizationRate: 0.6,
    gameIdentityUsableRate: 0.95,
    playerIdentityUsableRate: 0.5,
    lineCoverage: 0.7,
    priceCoverage: 0.6,
    bookCoverage: 0.6,
    sideCoverage: 0.4,
    bothSidesCoverage: 0.6,
    rawPropRows: 100,
    normalizedPropRows: 80,
  });
  assert.equal(research.status, "RESEARCH_READY");
});

test("Starter monthly model distinguishes subscription, prepaid usage, and excess", () => {
  const model = projectMonthlyStarterSufficiency({});
  assert.equal(model.subscriptionCostUsd, 19);
  assert.equal(model.prepaidPlatformUsageUsd, 19);
  const first = Object.values(model.scenarios)[0];
  assert.equal(first.combined.subscriptionCostUsd, 19);
  assert.equal(first.combined.prepaidPlatformUsageUsd, 19);
  assert.ok("estimatedGrossPlatformUsageUsd" in first.combined);
  assert.ok("estimatedExcessPlatformUsageUsd" in first.combined);
  assert.ok("estimatedInvoicePreTaxUsd" in first.combined);
});

test("cadence experiment profiles A/B/C are defined and resolvable", () => {
  assert.ok(CADENCE_EXPERIMENT_PROFILES.A_LEAN);
  assert.ok(CADENCE_EXPERIMENT_PROFILES.B_DECISION_INTEL);
  assert.ok(CADENCE_EXPERIMENT_PROFILES.C_MOVEMENT_HEAVY);
  const b = resolveCadenceExperimentProfile("B_DECISION_INTEL");
  assert.equal(b.windows.PREGAME.includeMovement, true);
  assert.equal(b.windows.OPENING.includeMovement, false);
  const a = resolveCadenceExperimentProfile("A_LEAN");
  assert.equal(a.windows.PREGAME.includeMovement, false);
});
