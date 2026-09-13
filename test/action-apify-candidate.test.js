import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ODDS_PROVIDER_ORDER } from "../functions/lib/oddsProviderRouter.js";
import { assertActionApifyNotInProductionRouter } from "../functions/lib/actionApifyShadow.js";
import {
  ACTION_APIFY_FREE_MAX_ITEMS,
  ACTION_APIFY_STARTER_SAFETY_CAP,
  COLLECTION_PROFILES,
  TEMPORAL_CLASS,
  parseActionApifyPlan,
  resolveMaxItems,
  readCandidateConfig,
  profileToActorFlags,
  cadenceForPhase,
} from "../functions/lib/actionApifyCandidateConfig.js";
import {
  MATCH_CONFIDENCE,
  canonicalizeBook,
  canonicalizeMarket,
  normalizePrices,
  matchEventWithConfidence,
  observationNaturalKey,
  classifyObservationDelta,
  fingerprintSchema,
  buildCostLedgerEntry,
  aggregateCostWindows,
  classifyTemporal,
  isolateCandidateFailure,
  redactSecrets,
  normalizeCandidateGameRow,
  unmappedBookCoverage,
} from "../functions/lib/actionApifyCandidate.js";
import {
  planCandidateCollection,
  evaluateSchedulerSafety,
  runCandidateCollection,
  resetCandidateRuntimeGuards,
  actionApifyCandidateHealth,
} from "../functions/lib/actionApifyCollector.js";
import {
  runProviderChampionship,
  projectMonthlyStarterSufficiency,
  buildPromotionReadinessScorecard,
  evaluateCandidatePromotionPackage,
  MONTHLY_COST_SCENARIOS,
} from "../functions/lib/actionApifyChampionship.js";
import {
  onRequestGet as collectGet,
  onRequestPost as collectPost,
} from "../functions/api/action-apify-collect.js";

async function loadFixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/action-apify/${name}`, import.meta.url), "utf8"));
}

test("Action candidate stays outside production odds router and wager gates", () => {
  assert.deepEqual([...ODDS_PROVIDER_ORDER], ["parlay", "theodds", "sharpapi", "therundown"]);
  assert.equal(assertActionApifyNotInProductionRouter(ODDS_PROVIDER_ORDER), true);
  assert.throws(
    () => assertActionApifyNotInProductionRouter([...ODDS_PROVIDER_ORDER, "action_apify"]),
    /ACTION_APIFY|action.?apify/i
  );
  const health = actionApifyCandidateHealth({});
  assert.equal(health.inProductionRouter, false);
  assert.equal(health.canQualify, false);
  assert.equal(health.canAuthorizeWager, false);
  assert.equal(health.mode, "shadow");
});

test("plan handling: free clamps <=10, starter allows >10, unknown fails closed", () => {
  assert.equal(resolveMaxItems(100, "free"), ACTION_APIFY_FREE_MAX_ITEMS);
  assert.equal(resolveMaxItems(3, "free"), 3);
  assert.equal(resolveMaxItems(50, "starter"), 50);
  assert.ok(resolveMaxItems(9999, "starter") <= ACTION_APIFY_STARTER_SAFETY_CAP);
  assert.equal(parseActionApifyPlan("starter"), "starter");
  assert.throws(() => parseActionApifyPlan("enterprise"), /UNKNOWN|unknown|fail closed/i);
  const bad = readCandidateConfig({ ACTION_APIFY_ENABLED: "true", ACTION_APIFY_PLAN: "gold", APIFY_TOKEN: "x" });
  assert.equal(bad.enabled, false);
  assert.ok(bad.planError);
  const inferred = readCandidateConfig({ APIFY_TOKEN: "x" });
  assert.equal(inferred.plan, "free");
  assert.equal(inferred.enabled, false);
});

test("profiles map Actor flags without enabling every expensive block", () => {
  const base = profileToActorFlags(COLLECTION_PROFILES.BASE);
  assert.equal(base.includeLineMovement, false);
  assert.equal(base.includePlayerProps, false);
  const move = profileToActorFlags(COLLECTION_PROFILES.MOVEMENT);
  assert.equal(move.includeLineMovement, true);
  const f5 = profileToActorFlags(COLLECTION_PROFILES.MLB_F5, { sport: "mlb" });
  assert.ok(Array.isArray(f5.periods) && f5.periods.length >= 1);
  const props = profileToActorFlags(COLLECTION_PROFILES.PLAYER_PROPS);
  assert.equal(props.includePlayerProps, true);
  const audit = profileToActorFlags(COLLECTION_PROFILES.CAPABILITY_AUDIT);
  assert.equal(audit.includeLineMovement, true);
  assert.equal(audit.includePlayerProps, true);
  assert.equal(audit.includeGameProps, true);
  assert.equal(audit.includeGameDetail, true);
  assert.equal(audit.includeWeather, false);
  assert.equal(audit.includeInjuries, false);
  const cadence = cadenceForPhase("postgame", "mlb");
  assert.equal(cadence.temporalClass, TEMPORAL_CLASS.EVALUATION_CLOSE);
});

test("CAPABILITY_AUDIT plan enables all four enrichments and respects maxItems", () => {
  const env = {
    ACTION_APIFY_ENABLED: "true",
    ACTION_APIFY_PLAN: "free",
    ACTION_APIFY_MAX_ITEMS: "10",
    APIFY_TOKEN: "x",
  };
  const plan = planCandidateCollection(env, {
    sport: "nfl",
    lifecycle: "pregame",
    profile: "CAPABILITY_AUDIT",
    maxItems: 4,
    gameUrls: ["290853", "290851", "290845", "290800"],
  });
  assert.equal(plan.profile, "CAPABILITY_AUDIT");
  assert.equal(plan.input.maxItems, 4);
  assert.equal(plan.input.includeLineMovement, true);
  assert.equal(plan.input.includePlayerProps, true);
  assert.equal(plan.input.includeGameProps, true);
  assert.equal(plan.input.includeGameDetail, true);
  assert.equal(plan.input.includeWeather, false);
  assert.deepEqual(plan.input.gameUrls, ["290853", "290851", "290845", "290800"]);
  assert.equal(plan.input.onlyWithOdds, true);
  // 4 games × $0.030 + $0.054 start + $0.01 scoreboard = $0.184
  assert.ok(plan.estimatedCostUsd > 0.15 && plan.estimatedCostUsd < 0.2);
});

test("capability audit summary covers BASE + enrichments without inventing observedAt", async () => {
  const { buildCapabilityAuditSummary } = await import("../functions/lib/actionApifyChampionship.js");
  const fixture = await loadFixture("scheduled-ncaaf.json");
  const row = normalizeCandidateGameRow({
    ...fixture,
    gameProps: [{ market: "team_total", line: 24.5, overOdds: -110, underOdds: -110 }],
    gameDetail: { rosters: [{ player: "QB One" }], depthCharts: { offense: [] } },
  });
  assert.equal(row.observedAt, null);
  assert.ok(Array.isArray(row.lineMovement?.history) ? row.lineMovement.history.length >= 1 : true);
  const summary = buildCapabilityAuditSummary([row], { sport: "cfb", profile: "CAPABILITY_AUDIT" });
  assert.equal(summary.gamesReturned, 1);
  assert.equal(summary.base.identityCoverage, 1);
  assert.ok(summary.base.consensusMoneylineCoverage >= 0);
  assert.equal(summary.gameDetail.gamesWithDetail, 1);
  assert.ok(summary.gameDetail.detailKeys.includes("rosters"));
  assert.equal(summary.games[0].observedAt, null);
});

test("book/market/price normalization + unmapped books", async () => {
  assert.equal(canonicalizeBook("DraftKings").mapped, true);
  const unk = canonicalizeBook("MysteryBookXYZ");
  assert.equal(unk.mapped, false);
  assert.equal(unk.canonicalBookId, "unmapped");
  assert.equal(canonicalizeMarket("run_line", "firstfiveinnings", "mlb").period, "firstfive");
  const one = normalizePrices({ homeOdds: -110 });
  assert.equal(one.incomplete, true);
  assert.equal(one.noVig.home, null);
  const two = normalizePrices({ homeOdds: -110, awayOdds: -110 });
  assert.equal(two.marketComplete.moneyline, true);
  assert.ok(two.noVig.home != null);
  const row = normalizeCandidateGameRow(await loadFixture("scheduled-ncaaf.json"));
  assert.ok(Number(unmappedBookCoverage([row]).totalBookRows) >= 0);
});

test("temporal: scrape time is not source observation; closing is evaluation-only", async () => {
  const row = normalizeCandidateGameRow(await loadFixture("scheduled-ncaaf.json"), { lifecycle: "pregame" });
  assert.equal(row.temporalClass, TEMPORAL_CLASS.PREGAME_OBSERVATION);
  assert.equal(row.canQualify, false);
  assert.equal(row.canAuthorizeWager, false);
  const t = classifyTemporal({ scrapedAt: "2025-09-11T12:00:00.000Z", sourceObservedAt: null });
  assert.equal(t.temporalClass, TEMPORAL_CLASS.PREGAME_OBSERVATION);
  assert.match(String(t.note || ""), /scrape/i);
  assert.equal(
    classifyTemporal({ isFinal: true, scrapedAt: "2025-09-11T12:00:00.000Z" }).temporalClass,
    TEMPORAL_CLASS.EVALUATION_CLOSE
  );
});

test("event matching: exact/ambiguous/unmatched + postponed skew", async () => {
  const row = normalizeCandidateGameRow(await loadFixture("scheduled-ncaaf.json"));
  const exact = matchEventWithConfidence(row, [
    { id: "1", homeTeam: row.homeTeam, awayTeam: row.awayTeam, startTime: row.startTime, league: row.league },
  ]);
  assert.ok(exact.confidence === MATCH_CONFIDENCE.EXACT || exact.confidence === MATCH_CONFIDENCE.HIGH);
  assert.equal(exact.comparisonEligible, true);

  // Identical slate clones collapse to a canonical id (not AMBIGUOUS).
  const collapsed = matchEventWithConfidence(row, [
    { id: "a", homeTeam: row.homeTeam, awayTeam: row.awayTeam, startTime: row.startTime, league: row.league },
    { id: "b", homeTeam: row.homeTeam, awayTeam: row.awayTeam, startTime: row.startTime, league: row.league },
  ]);
  assert.ok(
    collapsed.confidence === MATCH_CONFIDENCE.EXACT || collapsed.confidence === MATCH_CONFIDENCE.HIGH
  );
  assert.equal(collapsed.comparisonEligible, true);
  assert.equal(collapsed.candidate?.id, "a");

  // True ambiguity: same teams, near but unaligned kickoffs, both canonical numeric ids.
  const amb = matchEventWithConfidence(row, [
    {
      id: "401111111",
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      startTime: row.startTime,
      league: row.league,
    },
    {
      id: "401222222",
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      startTime: new Date(Date.parse(row.startTime) + 20 * 60 * 1000).toISOString(),
      league: row.league,
    },
  ]);
  assert.equal(amb.confidence, MATCH_CONFIDENCE.AMBIGUOUS);
  assert.equal(amb.comparisonEligible, false);

  const none = matchEventWithConfidence(row, [
    { id: "x", homeTeam: "Totally Different", awayTeam: "Also Different", startTime: row.startTime, league: row.league },
  ]);
  assert.equal(none.confidence, MATCH_CONFIDENCE.UNMATCHED);

  const postponed = matchEventWithConfidence(
    { ...row, status: "postponed" },
    [{
      id: "p",
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      startTime: new Date(Date.parse(row.startTime) + 36 * 3600 * 1000).toISOString(),
      league: row.league,
      status: "postponed",
    }]
  );
  assert.ok(
    postponed.confidence === MATCH_CONFIDENCE.AMBIGUOUS ||
      postponed.confidence === MATCH_CONFIDENCE.UNMATCHED ||
      postponed.comparisonEligible === false
  );
});

test("idempotent observation keys distinguish duplicate vs line change", () => {
  const args = {
    actionGameId: "g1",
    market: "spread",
    period: "event",
    book: "draftkings",
    sourceObservedAt: "2025-09-11T12:00:00.000Z",
    payloadHash: "aaa",
  };
  assert.equal(observationNaturalKey(args), observationNaturalKey(args));
  const same = classifyObservationDelta(
    { payload_hash: "aaa", source_observed_at: args.sourceObservedAt, book: "draftkings" },
    { payloadHash: "aaa", sourceObservedAt: args.sourceObservedAt, book: "draftkings" }
  );
  assert.match(String(same.kind), /identical|same|duplicate|repeated/i);
  const changed = classifyObservationDelta(
    { payload_hash: "aaa", source_observed_at: args.sourceObservedAt, book: "draftkings" },
    { payloadHash: "bbb", sourceObservedAt: args.sourceObservedAt, book: "draftkings" }
  );
  assert.match(String(changed.kind), /line_change|change|delta/i);
});

test("cost ledger + monthly $19 sufficiency model is measurable", () => {
  const entry = buildCostLedgerEntry({
    runId: "r1",
    plan: "starter",
    sport: "cfb",
    profile: "BASE",
    input: { leagues: ["ncaaf"], periods: ["event"], maxItems: 20, includeLineMovement: false },
    gamesReturned: 20,
  });
  assert.equal(entry.cost_basis, "ESTIMATED");
  assert.ok(entry.estimated_total_usd > 0);
  const windows = aggregateCostWindows([entry]);
  assert.ok(windows.runs === 1 || windows.costMonthToDate > 0 || windows.costToday > 0);
  const monthly = projectMonthlyStarterSufficiency({});
  const a = monthly.scenarios[MONTHLY_COST_SCENARIOS.A_BASE_ONLY];
  assert.ok(a);
  assert.equal(typeof a.combined.withinStarterCredit, "boolean");
  assert.ok(a.combined.estimatedMonthlyCostUsd > 0);
  assert.equal(a.combined.withinStarterCredit, a.combined.estimatedMonthlyCostUsd <= 19 + 1e-9);
});

test("schema drift + secret redaction + failure isolation", async () => {
  const fixture = await loadFixture("scheduled-ncaaf.json");
  const fp = fingerprintSchema(fixture);
  assert.ok(fp.fingerprint);
  assert.ok(fp.promotionEligible === true || fp.driftLevel === "INFO" || fp.driftLevel === "WARN");
  const bad = fingerprintSchema({ totally: "wrong" });
  assert.ok(bad.driftLevel === "BLOCK" || bad.promotionEligible === false || bad.driftLevel === "WARN");
  const iso = isolateCandidateFailure(new Error("boom"));
  assert.equal(iso.affectsProductionOdds, false);
  assert.equal(iso.canQualify, false);
  const red = redactSecrets("Authorization: Bearer SECRETTOKEN apify_api_SECRETTOKEN", "SECRETTOKEN");
  assert.equal(red.includes("SECRETTOKEN"), false);
});

test("scheduler: free/starter plans, budget guard, idempotent offline collect", async () => {
  resetCandidateRuntimeGuards();
  const freePlan = planCandidateCollection(
    { ACTION_APIFY_ENABLED: "true", ACTION_APIFY_PLAN: "free", ACTION_APIFY_MAX_ITEMS: "50", APIFY_TOKEN: "x" },
    { sport: "cfb", lifecycle: "pregame" }
  );
  assert.ok(freePlan.input.maxItems <= 10);

  const starterEnv = {
    ACTION_APIFY_ENABLED: "true",
    ACTION_APIFY_PLAN: "starter",
    ACTION_APIFY_MAX_ITEMS: "40",
    APIFY_TOKEN: "x",
  };
  const starterPlan = planCandidateCollection(starterEnv, { sport: "nfl", lifecycle: "pregame" });
  assert.equal(starterPlan.input.maxItems, 40);
  assert.equal(evaluateSchedulerSafety(starterPlan).allowed, true);
  const blockedBudget = evaluateSchedulerSafety(starterPlan, { monthToDateCostUsd: 1e9 });
  assert.equal(blockedBudget.allowed, false);
  assert.equal(blockedBudget.budgetBlocked, true);

  const fixture = await loadFixture("scheduled-ncaaf.json");
  const keys = new Map();
  const db = {
    getObservationKey: async (k) => keys.get(k) || null,
    putObservationKey: async (row) => { keys.set(row.natural_key || row.naturalKey, row); },
    exec: async () => ({ ok: true }),
  };
  resetCandidateRuntimeGuards();
  const first = await runCandidateCollection(starterEnv, {
    sport: "cfb",
    lifecycle: "pregame",
    rowsInject: [fixture, fixture],
    fbisEvents: [],
    db,
  });
  assert.equal(first.ok, true);
  assert.equal(first.canQualify, false);
  assert.equal(first.inProductionRouter, false);
  assert.ok((first.duplicatesSkipped ?? 0) >= 1 || (first.observationsWritten ?? 0) >= 1);
});

test("provider championship + promotion scorecard never auto-promotes", async () => {
  const row = normalizeCandidateGameRow(await loadFixture("scheduled-ncaaf.json"));
  const incumbents = {
    parlay: [{
      id: "1",
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      startTime: row.startTime,
      league: row.league,
      books: row.books,
    }],
  };
  const champ = runProviderChampionship({ actionRows: [row], incumbents });
  assert.equal(champ.inProductionRouter, false);
  assert.equal(champ.canQualify, false);
  const card = buildPromotionReadinessScorecard({ sampleRuns: 2, schemaDriftLevel: "INFO" });
  assert.equal(card.status, "INSUFFICIENT_SAMPLE");
  assert.equal(card.hardRules.mutatesOddsProviderOrder, false);
  assert.equal(card.hardRules.canQualify, false);
  const blocked = buildPromotionReadinessScorecard({ sampleRuns: 20, schemaDriftLevel: "BLOCK", successRate7d: 0.5 });
  assert.equal(blocked.hardRules.canAuthorizeWager, false);
  const pkg = evaluateCandidatePromotionPackage({
    actionRows: [row],
    incumbents,
    sampleRuns: 12,
    plan: "starter",
    reliability: { successRate7d: 0.95 },
  });
  assert.ok(pkg.scorecard);
  assert.equal(pkg.scorecard.hardRules.canQualify, false);
});

test("candidate collect API plans without spending and refuses unauthorized", async () => {
  const denied = await collectGet({
    request: new Request("https://example.test/api/action-apify-collect?mode=plan&sport=cfb"),
    env: {},
  });
  assert.equal(denied.status, 401);

  const env = {
    HARVEST_SECRET: "test-secret",
    ACTION_APIFY_ENABLED: "true",
    ACTION_APIFY_PLAN: "free",
    APIFY_TOKEN: "x",
  };
  const ok = await collectGet({
    request: new Request("https://example.test/api/action-apify-collect?mode=plan&sport=cfb", {
      headers: { "x-harvest-secret": "test-secret" },
    }),
    env,
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.inProductionRouter, false);
  assert.equal(body.canQualify, false);
  assert.ok((body.plan?.input?.maxItems ?? 10) <= 10);

  const post = await collectPost({
    request: new Request("https://example.test/api/action-apify-collect", {
      method: "POST",
      headers: { "x-harvest-secret": "test-secret", "content-type": "application/json" },
      body: JSON.stringify({ sport: "cfb", execute: "0" }),
    }),
    env,
  });
  const postBody = await post.json();
  assert.equal(postBody.executed, false);
});

test("migration 0021/0022 + schema.extensions + health expected migration", async () => {
  const m21 = await readFile(new URL("../migrations/0021_action_apify_candidate.sql", import.meta.url), "utf8");
  const m22 = await readFile(new URL("../migrations/0022_action_apify_harden.sql", import.meta.url), "utf8");
  const schema = await readFile(new URL("../schema.extensions.sql", import.meta.url), "utf8");
  const health = await readFile(new URL("../functions/api/health.js", import.meta.url), "utf8");
  assert.match(m21, /0021_action_apify_candidate/);
  assert.match(m22, /0022_action_apify_harden/);
  assert.match(m22, /shadow_candidate_scheduler_state/);
  for (const t of [
    "shadow_collection_runs",
    "shadow_cost_ledger",
    "shadow_provider_reliability",
    "shadow_schema_fingerprints",
    "shadow_promotion_metrics",
    "shadow_dead_letters",
    "shadow_observation_keys",
  ]) {
    assert.match(m21, new RegExp(t));
    assert.match(schema, new RegExp(t));
  }
  assert.match(schema, /shadow_candidate_scheduler_state/);
  assert.match(health, /EXPECTED_MIGRATION\s*=\s*["']0024_action_observation_timeseries["']/);
  assert.match(health, /actionApifyCandidateHealth/);
  assert.match(health, /actionApify:/);
});
