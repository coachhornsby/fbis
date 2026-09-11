import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ODDS_PROVIDER_ORDER } from "../functions/lib/oddsProviderRouter.js";
import { COLLEGE_MODELS } from "../functions/lib/collegeModels.js";
import {
  ACTION_APIFY_ACTOR_ID,
  ACTION_APIFY_FREE_MAX_ITEMS,
  ACTION_APIFY_PRICING_USD,
  ACTION_APIFY_PROVIDER,
  ACTION_APIFY_RESEARCH_BUDGET_USD,
  ACTION_APIFY_SCHEMA_VERSION,
  ACTION_APIFY_SOURCE_CLASS,
  americanToImpliedProb,
  apifyTokenConfigured,
  assertActionApifyNotInProductionRouter,
  buildActorInput,
  buildResearchFields,
  clampMaxItems,
  compareShadowToProvider,
  createResearchBudget,
  estimateActorCostUsd,
  hashPayload,
  matchShadowEvent,
  noVigTwoWay,
  normalizeActionDataset,
  normalizeActionGameRow,
  normalizeBookKey,
  normalizeResult,
  runActionApifyShadow,
} from "../functions/lib/actionApifyShadow.js";

const FIX = {
  scheduled: "scheduled-ncaaf.json",
  completed: "completed-mlb.json",
  firstFive: "mlb-first-five.json",
};

async function loadFixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/action-apify/${name}`, import.meta.url), "utf8"));
}

test("Action Apify stays out of the production odds router", () => {
  assert.deepEqual([...ODDS_PROVIDER_ORDER], ["parlay","theodds","sharpapi","therundown"]);
  assert.equal(assertActionApifyNotInProductionRouter(ODDS_PROVIDER_ORDER), true);
  assert.throws(
    () => assertActionApifyNotInProductionRouter([...ODDS_PROVIDER_ORDER, "action_apify"]),
    /ACTION_APIFY must not appear in ODDS_PROVIDER_ORDER/
  );
  assert.equal(ACTION_APIFY_SOURCE_CLASS, "SHADOW_MARKET_INTELLIGENCE");
  assert.equal(ACTION_APIFY_PROVIDER, "ACTION_APIFY");
  assert.match(ACTION_APIFY_ACTOR_ID, /action-network-scraper/);
});

test("free-plan maxItems hard-clamps to 10", () => {
  assert.equal(clampMaxItems(100), ACTION_APIFY_FREE_MAX_ITEMS);
  assert.equal(clampMaxItems(3), 3);
  const input = buildActorInput({ leagues: ["ncaaf"], maxItems: 50, includeLineMovement: true });
  assert.equal(input.maxItems, 10);
  assert.deepEqual(input.leagues, ["ncaaf"]);
  assert.equal(input.includeLineMovement, true);
  assert.equal(input.includeFutures, false);
});

test("cost accounting estimates Actor PPE pricing and enforces $1 research budget", () => {
  const input = buildActorInput({ leagues: ["ncaaf"], periods: ["event"], maxItems: 10, includeLineMovement: false });
  const est = estimateActorCostUsd(input, { gamesReturned: 10 });
  assert.ok(est > 0.13 && est < 0.14);
  const withMove = estimateActorCostUsd({ ...input, includeLineMovement: true }, { gamesReturned: 5 });
  assert.ok(withMove > 0.12 && withMove < 0.14);
  const budget = createResearchBudget({ limitUsd: ACTION_APIFY_RESEARCH_BUDGET_USD });
  assert.equal(budget.canAfford(0.9), true);
  assert.equal(budget.record({ estimatedCostUsd: 0.9, testId: "A" }).ok, true);
  assert.equal(budget.canAfford(0.2), false);
  const blocked = budget.record({ estimatedCostUsd: 0.2, testId: "B" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked, true);
  assert.ok(budget.spentUsd <= 1.0 + 1e-9);
});

test("scheduled games keep null results (never invent 0-0)", async () => {
  const fixture = await loadFixture(FIX.scheduled);
  const row = normalizeActionGameRow(fixture, { runId: "run-sched", receivedAt: "2025-09-11T16:00:01.000Z" });
  assert.ok(row);
  assert.equal(row.result, null);
  assert.equal(normalizeResult(fixture), null);
  assert.equal(normalizeResult({ status: "scheduled", homeScore: 0, awayScore: 0 }), null);
  assert.equal(row.observedAt, null);
  assert.equal(row.scrapedAt, "2025-09-11T16:00:00.000Z");
  assert.equal(row.canQualify, false);
  assert.equal(row.canAuthorizeWager, false);
  assert.equal(row.decisionEligible, false);
  assert.equal(row.provider, ACTION_APIFY_PROVIDER);
  assert.equal(row.sourceClass, ACTION_APIFY_SOURCE_CLASS);
  assert.equal(row.consensus.spreadHome, -3.5);
  assert.equal(row.publicBetting.spreadHome.moneyMinusTickets, 19);
  assert.equal(row.books.length, 2);
  assert.equal(row.lineMovement.history.length, 2);
  assert.equal(row.lineMovement.history[0].observedAt, "2025-09-12T18:00:00.000Z");
  assert.equal(row.playerProps.length, 1);
  assert.ok(row.rawPayloadHash);
  assert.equal(row.rawPayloadHash, hashPayload(fixture));
});

test("completed games parse final scores, closing lines, and ATS/OU", async () => {
  const fixture = await loadFixture(FIX.completed);
  const row = normalizeActionGameRow(fixture, { runId: "run-final" });
  assert.ok(row);
  assert.equal(row.result.isFinal, true);
  assert.equal(row.result.homeScore, 5);
  assert.equal(row.result.awayScore, 3);
  assert.equal(row.result.closingSpreadHome, -1.5);
  assert.equal(row.result.closingTotal, 8.5);
  assert.equal(row.result.atsResult, "home");
  assert.equal(row.result.ouResult, "under");
  assert.equal(row.canQualify, false);
});

test("MLB first-five period parsing + multi-book coverage", async () => {
  const fixture = await loadFixture(FIX.firstFive);
  const row = normalizeActionGameRow(fixture, { runId: "run-f5" });
  assert.ok(row);
  assert.equal(row.period, "firstfive");
  assert.match(String(row.periodLabel || ""), /first five/i);
  assert.equal(row.consensus.total, 4.5);
  assert.equal(row.books.length, 2);
  assert.equal(normalizeBookKey("DraftKings"), "draftkings");
  assert.equal(row.books[0].book, "draftkings");
});

test("no-vig probabilities and public betting splits", async () => {
  const fixture = await loadFixture(FIX.scheduled);
  const row = normalizeActionGameRow(fixture, {});
  assert.ok(row.marketQuality.noVig.moneylineHome);
  assert.ok(row.marketQuality.noVig.moneylineAway);
  const nv = noVigTwoWay(-110, -110);
  assert.equal(nv.home, 0.5);
  assert.equal(nv.away, 0.5);
  assert.ok(nv.hold > 0);
  assert.ok(americanToImpliedProb(-110) > 0.52);
  assert.equal(row.publicBetting.maxMoneyTicketGap, 19);
  assert.equal(row.publicBetting.sharpSide, "spreadHome");
});

test("malformed rows fail soft; dataset reports malformed count", () => {
  assert.equal(normalizeActionGameRow(null), null);
  assert.equal(normalizeActionGameRow({ foo: 1 }), null);
  assert.equal(normalizeActionGameRow({ gameId: 1, homeTeam: "A" }), null);
  const ds = normalizeActionDataset([
    { gameId: 9, league: "ncaaf", homeTeam: "A", awayTeam: "B", startTime: "2025-09-01T00:00:00Z", scrapedAt: "2025-09-01T00:00:00Z" },
    null,
    { gameId: 10 },
  ]);
  assert.equal(ds.rows.length, 1);
  assert.equal(ds.malformed, 2);
});

test("event matching requires league + both teams + kickoff tolerance; never force", async () => {
  const fixture = await loadFixture(FIX.scheduled);
  const row = normalizeActionGameRow(fixture, {});
  const hit = matchShadowEvent(row, [{ id: "g1", league: "ncaaf", homeTeam: "Georgia Bulldogs", awayTeam: "Alabama Crimson Tide", startTime: row.startTime }]);
  assert.equal(hit.matched, true);
  const missTeam = matchShadowEvent(row, [{ id: "g2", league: "ncaaf", homeTeam: "Georgia", awayTeam: "Auburn", startTime: row.startTime }]);
  assert.equal(missTeam.matched, false);
  const missKickoff = matchShadowEvent(row, [{ id: "g3", league: "ncaaf", homeTeam: "Georgia", awayTeam: "Alabama", startTime: "2025-09-20T23:30:00.000Z" }]);
  assert.equal(missKickoff.matched, false);
});

test("shadow vs provider comparison is book/market aware and not auto-error", async () => {
  const fixture = await loadFixture(FIX.scheduled);
  const row = normalizeActionGameRow(fixture, {});
  const cmp = compareShadowToProvider({
    actionRows: [row],
    providerEvents: [{
      id: "g1", league: "ncaaf", homeTeam: "Georgia", awayTeam: "Alabama", startTime: row.startTime,
      books: [
        { book: "draftkings", spreadHome: row.consensus.spreadHome, total: row.consensus.total, moneylineHome: row.consensus.moneylineHome },
        { book: "fanduel", spreadHome: -3.0, total: row.consensus.total, moneylineHome: -160 },
      ],
    }],
    providerName: "sharpapi",
  });
  assert.equal(cmp.matchedGames, 1);
  assert.equal(cmp.gameMatchRate, 1);
  assert.ok(cmp.exactSpreadLineAgreement != null);
  assert.match(String(cmp.note || ""), /not automatically an error/i);
});

test("research fields stay non-authoritative", async () => {
  const fixture = await loadFixture(FIX.scheduled);
  const row = normalizeActionGameRow(fixture, {});
  const fields = buildResearchFields({
    publicBetting: row.publicBetting,
    lineMovement: row.lineMovement,
    consensusSpreadHome: row.consensus.spreadHome,
    consensusTotal: row.consensus.total,
    fbisSpreadProjection: -4.5,
    fbisTotalProjection: 49,
  });
  assert.equal(fields.moneyMinusTickets, 19);
  assert.equal(fields.fbisSpreadEdge, -1);
  assert.equal(fields.unitsResult, null);
});

test("live runner refuses missing token and never logs secrets", async () => {
  assert.equal(apifyTokenConfigured({}), false);
  const missing = await runActionApifyShadow({}, { leagues: ["ncaaf"], maxItems: 3, testId: "dry" });
  assert.equal(missing.ok, false);
  assert.equal(missing.configured, false);
  assert.equal(missing.provider, ACTION_APIFY_PROVIDER);
  assert.equal(String(JSON.stringify(missing)).includes("apify_api_"), false);

  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization || "" });
    return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "Unauthorized" } }), json: async () => ({}) };
  };
  const denied = await runActionApifyShadow(
    { APIFY_TOKEN: "apify_api_TEST_TOKEN_NOT_REAL" },
    { leagues: ["ncaaf"], maxItems: 2, fetchImpl: fakeFetch, testId: "auth-fail" }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.configured, true);
  assert.ok(!String(denied.detail || "").includes("TEST_TOKEN"));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.apify\.com/);
});

test("CFB-FBIS-v2 qualification and wager auth remain disabled", () => {
  const model = COLLEGE_MODELS["CFB-FBIS-v2"];
  assert.ok(model);
  assert.equal(model.canQualify, false);
  assert.equal(model.canAuthorizeWager, false);
});
