import test from "node:test";
import assert from "node:assert/strict";
import { ODDS_PROVIDER_ORDER } from "../functions/lib/oddsProviderRouter.js";
import {
  acquireSchedulerLease,
  releaseSchedulerLease,
  queryMonthToDateSpendUsd,
  schedulerScopeKey,
  buildLogicalCollectionKey,
} from "../functions/lib/actionApifyDurableState.js";
import {
  observationNaturalKey,
  classifyObservationDelta,
  fingerprintSchema,
  matchEventWithConfidence,
} from "../functions/lib/actionApifyCandidate.js";
import {
  runCandidateCollection,
  resetCandidateRuntimeGuards,
  evaluateSchedulerSafety,
  planCandidateCollection,
} from "../functions/lib/actionApifyCollector.js";
import { computeMatchDenominators } from "../functions/lib/actionApifyObservationStore.js";
import { buildPromotionReadinessScorecard } from "../functions/lib/actionApifyChampionship.js";
import {
  calendarDateChicago,
  defaultFbisSlateDates,
  loadFbisSlateForMatching,
} from "../functions/lib/actionApifyEvidence.js";

function memoryDb() {
  const tables = new Map();
  const keys = new Map();
  const sqlLog = [];
  return {
    tables,
    keys,
    sqlLog,
    async exec(sql, params = []) {
      sqlLog.push(sql);
      if (/INSERT INTO shadow_candidate_scheduler_state/i.test(sql)) {
        tables.set(`sched:${params[1]}`, {
          provider: params[0],
          scope_key: params[1],
          active_run_id: params[2],
          lease_acquired_at: params[3],
          lease_expires_at: params[4],
          consecutive_failures: 0,
          circuit_open_until: null,
          updated_at: params[params.length - 1],
        });
      }
      if (/UPDATE shadow_candidate_scheduler_state/i.test(sql) && /active_run_id = \?/i.test(sql)) {
        const scope = params[params.length - 1] || params[5];
        // acquire conditional update path — mark active
        const existing = tables.get(`sched:${scope}`) || tables.get(`sched:${params[5]}`);
        if (existing) {
          existing.active_run_id = params[0];
          existing.lease_expires_at = params[2];
        }
      }
      return { success: true };
    },
    async queryOne(sql, params = []) {
      if (/shadow_candidate_scheduler_state/i.test(sql)) {
        return tables.get(`sched:${params[1]}`) || null;
      }
      if (/shadow_cost_ledger/i.test(sql) && /SUM/i.test(sql)) {
        return { mtd_usd: Number(tables.get("mtd") || 0), runs: 1, runs_actual: 1 };
      }
      return null;
    },
    async queryAll() {
      return [];
    },
    async getObservationKey(k) {
      return keys.get(k) || null;
    },
    async putObservationKey(row) {
      keys.set(row.natural_key, row);
    },
  };
}

const env = {
  ACTION_APIFY_ENABLED: "true",
  ACTION_APIFY_PLAN: "free",
  APIFY_TOKEN: "test-token-not-secret",
  ACTION_APIFY_MONTHLY_BUDGET_USD: "5",
};

function sampleRow(overrides = {}) {
  return {
    gameId: "a1",
    homeTeam: "Texas",
    awayTeam: "Alabama",
    startTime: "2026-09-12T19:00:00Z",
    league: "ncaaf",
    scrapedAt: "2026-09-12T10:00:00Z",
    consensus: {
      spreadHome: -6.5,
      spreadHomeOdds: -110,
      moneylineHome: -250,
      moneylineAway: 200,
      total: 55.5,
      overOdds: -110,
      underOdds: -110,
    },
    books: [
      {
        book: "DraftKings",
        spreadHome: -6.5,
        spreadHomeOdds: -110,
        moneylineHome: -250,
        moneylineAway: 200,
        total: 55.5,
        overOdds: -110,
        underOdds: -110,
      },
    ],
    publicBetting: { spreadHome: { ticketsPercent: 62, moneyPercent: 48 } },
    lineMovement: {
      openSpreadHome: -7,
      currentSpreadHome: -6.5,
      history: [{ book: "dk", market: "spread", line: -6.5, observedAt: "2026-09-12T09:00:00Z" }],
    },
    ...overrides,
  };
}

test("router still excludes Action; wager gates remain closed", () => {
  assert.deepEqual([...ODDS_PROVIDER_ORDER], ["parlay", "theodds", "sharpapi", "therundown"]);
  assert.equal(ODDS_PROVIDER_ORDER.includes("action_apify"), false);
  assert.equal(ODDS_PROVIDER_ORDER.includes("ACTION_APIFY"), false);
});

test("durable lease: first wins, overlap blocked, expired recoverable", async () => {
  const db = memoryDb();
  const scopeKey = schedulerScopeKey("cfb", "BASE", "pregame");
  const a = await acquireSchedulerLease(db, { scopeKey, runId: "run-a", ttlMs: 60_000 });
  assert.equal(a.ok, true);
  const b = await acquireSchedulerLease(db, { scopeKey, runId: "run-b", ttlMs: 60_000 });
  assert.equal(b.ok, false);
  assert.equal(b.code, "OVERLAP");
  await releaseSchedulerLease(db, { scopeKey, runId: "run-a", success: true });
  db.tables.set(`sched:${scopeKey}`, {
    provider: "ACTION_APIFY",
    scope_key: scopeKey,
    active_run_id: "run-old",
    lease_expires_at: new Date(Date.now() - 1000).toISOString(),
    consecutive_failures: 0,
  });
  const c = await acquireSchedulerLease(db, { scopeKey, runId: "run-c", ttlMs: 60_000 });
  assert.equal(c.ok, true);
});

test("MTD budget from ledger blocks candidate without production odds impact", async () => {
  resetCandidateRuntimeGuards();
  const plan = planCandidateCollection(env, { sport: "cfb", lifecycle: "pregame", profile: "BASE" });
  const mtd = await queryMonthToDateSpendUsd({
    queryOne: async () => ({ mtd_usd: 4.5, runs: 1, runs_actual: 1 }),
  });
  assert.equal(mtd.mtdUsd, 4.5);
  const blocked = evaluateSchedulerSafety(plan, { monthToDateCostUsd: 100 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.budgetBlocked, true);
  assert.equal(blocked.blocks.some((b) => b.code === "MONTHLY_BUDGET"), true);
});

test("matching: exact / canonical-duplicate-collapse / true-ambiguous / unmatched", () => {
  const fbis = [
    {
      id: "e1",
      homeTeam: "Texas",
      awayTeam: "Alabama",
      homeAbbr: "TEX",
      awayAbbr: "ALA",
      startTime: "2026-09-12T19:00:00Z",
    },
    {
      id: "e2",
      homeTeam: "Texas",
      awayTeam: "Alabama",
      homeAbbr: "TEX",
      awayAbbr: "ALA",
      startTime: "2026-09-12T19:00:00Z",
    },
  ];
  const exact = matchEventWithConfidence(
    {
      homeTeam: "Texas",
      awayTeam: "Alabama",
      homeAbbr: "TEX",
      awayAbbr: "ALA",
      startTime: "2026-09-12T19:00:00Z",
    },
    [fbis[0]]
  );
  assert.equal(exact.confidence, "EXACT");
  assert.equal(exact.comparisonEligible, true);

  // Identical slate clones (same teams + same kickoff) collapse to a canonical id —
  // not AMBIGUOUS. Prefer stable id order among equal-rank non-synthetic rows.
  const collapsed = matchEventWithConfidence(
    {
      homeTeam: "Texas",
      awayTeam: "Alabama",
      homeAbbr: "TEX",
      awayAbbr: "ALA",
      startTime: "2026-09-12T19:00:00Z",
    },
    fbis
  );
  assert.equal(collapsed.confidence, "EXACT");
  assert.equal(collapsed.comparisonEligible, true);
  assert.equal(collapsed.candidate?.id, "e1");

  // True ambiguity: same teams, kickoffs near but not aligned, both canonical numeric ids.
  const trueAmbiguous = matchEventWithConfidence(
    {
      homeTeam: "Texas",
      awayTeam: "Alabama",
      homeAbbr: "TEX",
      awayAbbr: "ALA",
      startTime: "2026-09-12T19:00:00Z",
    },
    [
      {
        id: "401111111",
        homeTeam: "Texas",
        awayTeam: "Alabama",
        homeAbbr: "TEX",
        awayAbbr: "ALA",
        startTime: "2026-09-12T19:00:00Z",
      },
      {
        id: "401222222",
        homeTeam: "Texas",
        awayTeam: "Alabama",
        homeAbbr: "TEX",
        awayAbbr: "ALA",
        startTime: "2026-09-12T19:20:00Z",
      },
    ]
  );
  assert.equal(trueAmbiguous.confidence, "AMBIGUOUS");
  assert.equal(trueAmbiguous.comparisonEligible, false);

  // ESPN + synthetic board clone of the same kickoff → prefer ESPN numeric id.
  const espnOverBoard = matchEventWithConfidence(
    {
      homeTeam: "Michigan Wolverines",
      awayTeam: "Oklahoma Sooners",
      homeAbbr: "MICH",
      awayAbbr: "OU",
      league: "ncaaf",
      startTime: "2026-09-12T16:00:00.000Z",
    },
    [
      {
        id: "ncaaf_michiganwolverines_oklahomasooners_2026-09-12_b2",
        sport: "cfb",
        homeTeam: "Michigan",
        awayTeam: "Oklahoma",
        homeAbbr: "MICH",
        awayAbbr: "OU",
        startTime: "2026-09-12T16:00Z",
      },
      {
        id: "401856679",
        sport: "cfb",
        homeTeam: "Michigan",
        awayTeam: "Oklahoma",
        homeAbbr: "MICH",
        awayAbbr: "OU",
        startTime: "2026-09-12T16:00:00.000Z",
      },
    ]
  );
  assert.ok(["EXACT", "HIGH"].includes(espnOverBoard.confidence));
  assert.equal(espnOverBoard.candidate?.id, "401856679");
  assert.equal(espnOverBoard.comparisonEligible, true);

  const unmatched = matchEventWithConfidence(
    { homeTeam: "Ohio State", awayTeam: "Michigan", startTime: "2026-09-12T19:00:00Z" },
    [fbis[0]]
  );
  assert.equal(unmatched.confidence, "UNMATCHED");

  const den = computeMatchDenominators({
    fbisEvents: [fbis[0]],
    actionRows: [{}, {}],
    matchDetails: [
      { confidence: "EXACT", comparisonEligible: true, fbisEventId: "e1" },
      { confidence: "UNMATCHED", comparisonEligible: false },
    ],
  });
  assert.equal(den.actionToFbisMatchRate, 0.5);
  assert.equal(den.fbisCoverageRate, 1);
});

test("idempotency: same-run retry collapses; later scrape of same price resamples", () => {
  const k1 = observationNaturalKey({
    actionGameId: "a1",
    market: "consensus",
    period: "event",
    book: "consensus",
    payloadHash: "hash1",
    runId: "run1",
  });
  const k1b = observationNaturalKey({
    actionGameId: "a1",
    market: "consensus",
    period: "event",
    book: "consensus",
    payloadHash: "hash1",
    runId: "run1",
  });
  assert.equal(k1, k1b);
  const k2 = observationNaturalKey({
    actionGameId: "a1",
    market: "consensus",
    period: "event",
    book: "consensus",
    payloadHash: "hash1",
    runId: "run2",
  });
  assert.notEqual(k1, k2);

  const kSrc = observationNaturalKey({
    actionGameId: "a1",
    market: "consensus",
    period: "event",
    book: "consensus",
    sourceObservedAt: "2026-09-12T09:00:00Z",
    line: -6.5,
    price: -110,
    payloadHash: "hash1",
    runId: "run1",
  });
  const kSrcSame = observationNaturalKey({
    actionGameId: "a1",
    market: "consensus",
    period: "event",
    book: "consensus",
    sourceObservedAt: "2026-09-12T09:00:00Z",
    line: -6.5,
    price: -110,
    payloadHash: "hash1",
    runId: "run9",
  });
  assert.equal(kSrc, kSrcSame);

  const delta = classifyObservationDelta(
    { payload_hash: "hash1", source_observed_at: "2026-09-12T09:00:00Z", book: "consensus" },
    { payloadHash: "hash2", sourceObservedAt: "2026-09-12T09:00:00Z", book: "consensus" }
  );
  assert.equal(delta.kind, "line_change");
});

test("gamesExpected uses FBIS slate size, not maxItems", async () => {
  resetCandidateRuntimeGuards();
  const rows = Array.from({ length: 16 }, (_, i) =>
    sampleRow({
      gameId: `g${i}`,
      homeTeam: `Home${i}`,
      awayTeam: `Away${i}`,
      startTime: `2026-09-14T${String(17 + (i % 5)).padStart(2, "0")}:00:00Z`,
    })
  );
  const fbis = rows.map((r, i) => ({
    id: `fbis${i}`,
    homeTeam: r.homeTeam,
    awayTeam: r.awayTeam,
    startTime: r.startTime,
  }));
  const starterEnv = {
    ...env,
    ACTION_APIFY_PLAN: "starter",
    ACTION_APIFY_MAX_ITEMS: "200",
  };
  const res = await runCandidateCollection(starterEnv, {
    sport: "nfl",
    lifecycle: "pregame",
    profile: "BASE",
    rowsInject: rows,
    fbisEvents: fbis,
    monthToDateCostUsd: 0,
  });
  assert.equal(res.ok, true);
  assert.equal(res.gamesExpected, 16);
  assert.equal(res.requestedMaxItems ?? res.requestedMaxItems, 200);
  assert.notEqual(res.gamesExpected, 200);
});

test("full observation persistence writes books/movement and matched FBIS id", async () => {
  resetCandidateRuntimeGuards();
  const db = memoryDb();
  const res = await runCandidateCollection(env, {
    sport: "cfb",
    lifecycle: "pregame",
    profile: "MOVEMENT",
    rowsInject: [sampleRow()],
    fbisEvents: [
      {
        id: "fbis1",
        homeTeam: "Texas",
        awayTeam: "Alabama",
        homeAbbr: "TEX",
        awayAbbr: "ALA",
        startTime: "2026-09-12T19:00:00Z",
      },
    ],
    db,
    monthToDateCostUsd: 0,
  });
  assert.equal(res.ok, true);
  assert.equal(res.gamesMatched, 1);
  assert.equal(res.observationsWritten, 1);
  assert.ok((res.booksWritten ?? 0) >= 1);
  assert.ok((res.movementWritten ?? 0) >= 1);
  const sql = db.sqlLog.join("\n");
  assert.match(sql, /shadow_market_observations/);
  assert.match(sql, /shadow_market_books/);
  assert.match(sql, /shadow_line_movement/);
});

test("schema prior compare additive INFO / core missing BLOCK; scorecard never auto-promotes", () => {
  const baseline = fingerprintSchema({
    gameId: "1",
    homeTeam: "A",
    awayTeam: "B",
    startTime: "2026-09-12T19:00:00Z",
    league: "ncaaf",
  });
  const additive = fingerprintSchema(
    {
      gameId: "1",
      homeTeam: "A",
      awayTeam: "B",
      startTime: "2026-09-12T19:00:00Z",
      league: "ncaaf",
      weather: { wind: 5 },
    },
    { previousFingerprint: { fingerprint: baseline.fingerprint, topLevelKeys: baseline.topLevelKeys } }
  );
  assert.ok(["INFO", "WARN"].includes(additive.driftLevel));

  const blocked = fingerprintSchema(
    { homeTeam: "A", awayTeam: "B" },
    { previousFingerprint: { fingerprint: baseline.fingerprint, topLevelKeys: baseline.topLevelKeys } }
  );
  assert.equal(blocked.driftLevel, "BLOCK");
  assert.equal(blocked.promotionEligible, false);

  const score = buildPromotionReadinessScorecard({
    sampleRuns: 12,
    schemaDriftLevel: null,
    unmatchedEventRate: 0.01,
    ambiguousMatchRate: 0.01,
    reliability: { successRate7d: 0.95 },
    costWindows: { projected30DaySpend: 10 },
    plan: "starter",
  });
  assert.ok(["READY_FOR_REVIEW", "SHADOW_ONLY", "COLLECTING", "INSUFFICIENT_SAMPLE"].includes(score.status));
  assert.notEqual(score.status, "PRIMARY_CANDIDATE");
  assert.equal(score.hardRules.canQualify, false);
  assert.equal(score.hardRules.canAuthorizeWager, false);
});

test("logical collection key is deterministic for run idempotency", () => {
  const a = buildLogicalCollectionKey({
    sport: "cfb",
    lifecycle: "pregame",
    profile: "BASE",
    date: "2026-09-12",
    scheduledBucket: "2026-09-12T15:00:00.000Z",
  });
  const b = buildLogicalCollectionKey({
    sport: "cfb",
    lifecycle: "pregame",
    profile: "BASE",
    date: "2026-09-12",
    scheduledBucket: "2026-09-12T15:00:00.000Z",
  });
  assert.equal(a, b);
});

test("default FBIS slate dates: MLB today+tomorrow; football extends through +3 Chicago days", async () => {
  // Friday evening Chicago (Sat early UTC): +36h wrongly skipped Saturday.
  const friEve = new Date("2026-09-12T03:01:00.000Z");
  assert.equal(calendarDateChicago(friEve), "2026-09-11");
  assert.deepEqual(defaultFbisSlateDates(friEve), ["2026-09-11", "2026-09-12"]);
  // Football Fri-night collections must reach Sunday NFL kickoffs.
  assert.deepEqual(defaultFbisSlateDates(friEve, { sport: "nfl" }), [
    "2026-09-11",
    "2026-09-12",
    "2026-09-13",
    "2026-09-14",
  ]);
  assert.deepEqual(defaultFbisSlateDates(friEve, { sport: "cfb" }), [
    "2026-09-11",
    "2026-09-12",
    "2026-09-13",
    "2026-09-14",
  ]);

  const now = new Date("2026-09-12T18:00:00.000Z");
  const mlbDates = defaultFbisSlateDates(now, { sport: "mlb" });
  assert.ok(mlbDates.includes(calendarDateChicago(now)));
  assert.deepEqual(mlbDates, ["2026-09-12", "2026-09-13"]);
  assert.equal(mlbDates.length, 2);

  const footballDates = defaultFbisSlateDates(now, { sport: "cfb" });
  assert.deepEqual(footballDates, ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15"]);

  const seen = [];
  const queryGames = async (_env, opts) => {
    seen.push(opts.date);
    assert.ok(opts.date, "must pass date — undated query returns season slate");
    return {
      ok: true,
      rows: [
        { id: `g-${opts.date}`, homeName: "A", awayName: "B", homeAbbr: "A", awayAbbr: "B", start: `${opts.date}T19:00:00Z`, sport: "cfb" },
      ],
    };
  };
  const slate = await loadFbisSlateForMatching(queryGames, {}, { sport: "cfb", now });
  assert.equal(slate.slateError, null);
  assert.equal(slate.gamesExpected, footballDates.length);
  assert.deepEqual(seen.sort(), footballDates);
  assert.deepEqual(slate.slateDates, footballDates);
});

test("explicit date keeps single-day FBIS slate", async () => {
  const queryGames = async (_env, opts) => ({
    ok: true,
    rows: [{ id: "only", homeName: "X", awayName: "Y", start: `${opts.date}T18:00:00Z`, sport: "nfl" }],
  });
  const slate = await loadFbisSlateForMatching(queryGames, {}, { sport: "nfl", date: "2026-09-14" });
  assert.deepEqual(slate.slateDates, ["2026-09-14"]);
  assert.equal(slate.gamesExpected, 1);
});

test("championship denominators keep match rate separate from dated-slate coverage", () => {
  const fbisEvents = Array.from({ length: 83 }, (_, i) => ({ id: `f${i}` }));
  const actionRows = Array.from({ length: 10 }, (_, i) => ({ actionGameId: `a${i}` }));
  const matchDetails = [
    ...Array.from({ length: 7 }, (_, i) => ({
      comparisonEligible: true,
      confidence: i < 5 ? "EXACT" : "HIGH",
      fbisEventId: `f${i}`,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      comparisonEligible: false,
      confidence: "UNMATCHED",
      fbisEventId: null,
    })),
  ];
  const den = computeMatchDenominators({
    fbisEvents,
    actionRows,
    matchDetails,
    requestedMaxItems: 10,
  });
  assert.equal(den.actionEventsReturned, 10);
  assert.equal(den.fbisDatedSlateCount, 83);
  assert.equal(den.actionRequestMaxItems, 10);
  assert.equal(den.matchedEvents, 7);
  assert.equal(den.exactEvents, 5);
  assert.equal(den.highEvents, 2);
  assert.equal(den.unmatchedEvents, 3);
  assert.equal(den.actionToFbisMatchRate, 0.7);
  assert.equal(den.ambiguousRate, 0);
  assert.equal(den.unmatchedRate, 0.3);
  // Full-slate coverage is secondary — must NOT be confused with Action→FBIS match rate.
  assert.ok(den.fbisCoverageOfDatedSlate < 0.2);
  assert.notEqual(den.actionToFbisMatchRate, den.fbisCoverageOfDatedSlate);
});
