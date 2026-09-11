/**
 * Action/Apify provider championship + promotion readiness scorecard.
 *
 * Read-only measurement. Never mutates ODDS_PROVIDER_ORDER.
 * Never grants canQualify / canAuthorizeWager.
 */

import {
  ACTION_APIFY_DEFAULT_MONTHLY_BUDGET_USD,
  PROMOTION_STATES,
} from "./actionApifyCandidateConfig.js";
import {
  MATCH_CONFIDENCE,
  aggregateCostWindows,
  matchEventWithConfidence,
  normalizePrices,
} from "./actionApifyCandidate.js";
import {
  ACTION_APIFY_PRICING_USD,
  ACTION_APIFY_PROVIDER,
  compareShadowToProvider,
  estimateActorCostUsd,
} from "./actionApifyShadow.js";

export const INCUMBENT_PROVIDERS = Object.freeze([
  "parlay",
  "theodds",
  "sharpapi",
  "therundown",
]);

/** Sufficiency scenarios for $19 Starter credit modeling. */
export const MONTHLY_COST_SCENARIOS = Object.freeze({
  A_BASE_ONLY: "A_BASE_ONLY",
  B_BASE_MOVEMENT: "B_BASE_MOVEMENT",
  C_BASE_MLB_F5: "C_BASE_MLB_F5",
  D_BASE_MOVEMENT_MLB_F5: "D_BASE_MOVEMENT_MLB_F5",
  E_TARGETED_PROPS: "E_TARGETED_PROPS",
  F_NORMAL_FBIS_CADENCE: "F_NORMAL_FBIS_CADENCE",
  G_HEAVY_REASONABLE: "G_HEAVY_REASONABLE",
});

/**
 * Compare Action candidate rows to one incumbent provider slate.
 * Only EXACT/HIGH matches participate in agreement metrics.
 */
export function compareCandidateToIncumbent({
  actionRows = [],
  providerEvents = [],
  providerName = "authoritative",
  observationSkewMs = 15 * 60 * 1000,
} = {}) {
  const eligibleAction = [];
  const unmatchedAction = [];
  const ambiguousAction = [];

  for (const row of actionRows) {
    const m = matchEventWithConfidence(row, providerEvents);
    if (m.confidence === MATCH_CONFIDENCE.AMBIGUOUS) {
      ambiguousAction.push({
        actionGameId: row.actionGameId || row.gameId,
        reason: m.reason,
      });
      continue;
    }
    if (!m.comparisonEligible) {
      unmatchedAction.push({
        actionGameId: row.actionGameId || row.gameId,
        reason: m.reason,
        confidence: m.confidence,
      });
      continue;
    }
    eligibleAction.push({ row, match: m });
  }

  // Reuse shadow book/market comparator on eligible pairs only.
  const base = compareShadowToProvider({
    actionRows: eligibleAction.map((x) => x.row),
    providerEvents,
    providerName,
  });

  const freshness = measureFreshness(eligibleAction.map((x) => x.row), observationSkewMs);
  const history = measureHistory(eligibleAction.map((x) => x.row));
  const intelligence = measureIntelligence(eligibleAction.map((x) => x.row));

  const expectedGames = providerEvents.length;
  const returnedGames = actionRows.length;
  const matchRate =
    returnedGames > 0 ? round4(eligibleAction.length / returnedGames) : null;

  return {
    providerName,
    candidateProvider: ACTION_APIFY_PROVIDER,
    coverage: {
      expectedGames,
      returnedGames,
      matchedGames: eligibleAction.length,
      matchRate,
      ambiguousMatches: ambiguousAction.length,
      unmatchedAction: unmatchedAction.length,
      unmatchedProvider: base.unmatchedProvider?.length ?? null,
      marketsPerGame: mean(actionRows.map((r) => countMarkets(r))),
      booksPerGame: mean(actionRows.map((r) => (r.books || []).length)),
      missingMarkets: base.missingOnAction ?? null,
      missingBooks: base.missingOnAction ?? null,
    },
    accuracy: {
      spreadExactMatchPct: base.exactSpreadLineAgreement,
      spreadAbsDiffMean: meanAbsDiff(
        base.marketComparisonsSample?.filter((m) => m.market === "spread") || []
      ),
      totalExactMatchPct: base.exactTotalLineAgreement,
      totalAbsDiffMean: meanAbsDiff(
        base.marketComparisonsSample?.filter((m) => m.market === "total") || []
      ),
      moneylineAbsPriceDiffMean: base.mlPriceAbsDiffMean,
      bestPriceAgreement: null,
    },
    freshness,
    history,
    intelligence,
    note: "Ambiguous matches are excluded from agreement metrics. Disagreement is not auto-error.",
    unmatchedAction,
    ambiguousAction,
    marketComparisonsSample: base.marketComparisonsSample || [],
  };
}

/**
 * Multi-provider championship aggregate.
 * @param {{ actionRows: object[], incumbents: Record<string, object[]> }} args
 */
export function runProviderChampionship({ actionRows = [], incumbents = {} } = {}) {
  const comparisons = {};
  for (const name of INCUMBENT_PROVIDERS) {
    const events = incumbents[name] || incumbents[name.toLowerCase()] || [];
    comparisons[name] = compareCandidateToIncumbent({
      actionRows,
      providerEvents: events,
      providerName: name,
    });
  }
  return {
    candidateProvider: ACTION_APIFY_PROVIDER,
    mode: "shadow",
    comparedAt: new Date().toISOString(),
    actionGames: actionRows.length,
    comparisons,
    inProductionRouter: false,
    canQualify: false,
    canAuthorizeWager: false,
  };
}

function measureFreshness(rows, skewMs) {
  let withSourceTs = 0;
  let stale = 0;
  let lagSum = 0;
  let lagN = 0;
  let latest = null;
  for (const r of rows) {
    const scraped = r.scrapedAt ? Date.parse(r.scrapedAt) : NaN;
    const observed = r.observedAt ? Date.parse(r.observedAt) : NaN;
    if (Number.isFinite(observed)) {
      withSourceTs += 1;
      if (latest == null || observed > Date.parse(latest)) latest = r.observedAt;
      if (Number.isFinite(scraped)) {
        const lag = Math.max(0, scraped - observed);
        lagSum += lag;
        lagN += 1;
        if (lag > skewMs) stale += 1;
      }
    }
  }
  return {
    rowsWithSourceObservationTime: withSourceTs,
    sourceObservationLagMsMean: lagN ? Math.round(lagSum / lagN) : null,
    staleMarketRate: rows.length ? round4(stale / rows.length) : null,
    latestSourceObservedAt: latest,
    note: "Freshness never inferred from scrape time alone",
  };
}

function measureHistory(rows) {
  let opening = 0;
  let closing = 0;
  let ticks = 0;
  let withTs = 0;
  let completed = 0;
  for (const r of rows) {
    const lm = r.lineMovement;
    if (lm?.openSpreadHome != null || lm?.openTotal != null || lm?.openMoneylineHome != null) opening += 1;
    if (r.result?.closingSpreadHome != null || r.result?.closingTotal != null) closing += 1;
    const hist = Array.isArray(lm?.history) ? lm.history : [];
    ticks += hist.length;
    withTs += hist.filter((h) => h.observedAt).length;
    if (r.result?.isFinal) completed += 1;
  }
  return {
    openingAvailabilityRate: rows.length ? round4(opening / rows.length) : null,
    closingAvailabilityRate: rows.length ? round4(closing / rows.length) : null,
    movementTickCount: ticks,
    movementTimestampCoverageRate: ticks ? round4(withTs / ticks) : null,
    completedGameCoverageRate: rows.length ? round4(completed / rows.length) : null,
  };
}

function measureIntelligence(rows) {
  let withTickets = 0;
  let withMoney = 0;
  let withGap = 0;
  let withSharp = 0;
  let withBetCount = 0;
  let withBest = 0;
  let withMovement = 0;
  let props = 0;
  for (const r of rows) {
    const pb = r.publicBetting;
    if (pb?.spreadHome?.ticketsPercent != null || pb?.moneylineHome?.ticketsPercent != null) withTickets += 1;
    if (pb?.spreadHome?.moneyPercent != null || pb?.moneylineHome?.moneyPercent != null) withMoney += 1;
    if (pb?.spreadHome?.moneyMinusTickets != null || pb?.maxMoneyTicketGap != null) withGap += 1;
    if (pb?.sharpSide) withSharp += 1;
    if (pb?.betCount != null) withBetCount += 1;
    if (r.bestOdds) withBest += 1;
    if (r.lineMovement?.history?.length) withMovement += 1;
    props += Array.isArray(r.playerProps) ? r.playerProps.length : 0;
  }
  const n = rows.length || 1;
  return {
    ticketPctCoverage: round4(withTickets / n),
    moneyPctCoverage: round4(withMoney / n),
    moneyTicketGapCoverage: round4(withGap / n),
    sharpSideCoverage: round4(withSharp / n),
    betCountCoverage: round4(withBetCount / n),
    bestBookCoverage: round4(withBest / n),
    movementDetailCoverage: round4(withMovement / n),
    playerPropsTotal: props,
    playerPropsPerGame: round4(props / n),
  };
}

function countMarkets(row) {
  let n = 0;
  const c = row.consensus || {};
  if (c.moneylineHome != null || c.moneylineAway != null) n += 1;
  if (c.spreadHome != null) n += 1;
  if (c.total != null) n += 1;
  return n;
}

function mean(vals) {
  const xs = vals.filter((v) => Number.isFinite(v));
  if (!xs.length) return null;
  return round4(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function meanAbsDiff(comps) {
  const xs = comps
    .map((c) => (c.lineDiff != null ? Math.abs(Number(c.lineDiff)) : null))
    .filter((v) => v != null && Number.isFinite(v));
  if (!xs.length) return null;
  return round4(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/**
 * Monthly $19 sufficiency model from observed/assumed run economics.
 * Does not force projections under $19.
 */
export function projectMonthlyStarterSufficiency({
  observedCostPerRunByProfile = {},
  observedGamesPerRunBySport = {},
  starterCreditUsd = ACTION_APIFY_DEFAULT_MONTHLY_BUDGET_USD,
} = {}) {
  const sports = ["mlb", "nfl", "cfb"];
  const defaultCost = {
    BASE: estimateActorCostUsd(
      { leagues: ["ncaaf"], periods: ["event"], maxItems: 50, includeLineMovement: false },
      { gamesReturned: 50 }
    ),
    MOVEMENT: estimateActorCostUsd(
      { leagues: ["ncaaf"], periods: ["event"], maxItems: 50, includeLineMovement: true },
      { gamesReturned: 50 }
    ),
    MLB_F5: estimateActorCostUsd(
      { leagues: ["mlb"], periods: ["event", "firstfiveinnings"], maxItems: 30, includeLineMovement: false },
      { gamesReturned: 30 }
    ),
    PLAYER_PROPS: estimateActorCostUsd(
      { leagues: ["mlb"], periods: ["event"], maxItems: 20, includePlayerProps: true },
      { gamesReturned: 20 }
    ),
  };

  const scenarios = {
    [MONTHLY_COST_SCENARIOS.A_BASE_ONLY]: { profile: "BASE", runsPerSport: { mlb: 30, nfl: 20, cfb: 25 } },
    [MONTHLY_COST_SCENARIOS.B_BASE_MOVEMENT]: {
      profile: "MOVEMENT",
      runsPerSport: { mlb: 30, nfl: 20, cfb: 25 },
    },
    [MONTHLY_COST_SCENARIOS.C_BASE_MLB_F5]: {
      profile: "MLB_F5",
      runsPerSport: { mlb: 45, nfl: 0, cfb: 0 },
      alsoBase: { mlb: 30, nfl: 20, cfb: 25 },
    },
    [MONTHLY_COST_SCENARIOS.D_BASE_MOVEMENT_MLB_F5]: {
      profile: "MOVEMENT",
      runsPerSport: { mlb: 30, nfl: 20, cfb: 25 },
      alsoF5: { mlb: 45 },
    },
    [MONTHLY_COST_SCENARIOS.E_TARGETED_PROPS]: {
      profile: "PLAYER_PROPS",
      runsPerSport: { mlb: 20, nfl: 10, cfb: 5 },
    },
    [MONTHLY_COST_SCENARIOS.F_NORMAL_FBIS_CADENCE]: {
      profile: "BASE",
      runsPerSport: { mlb: 60, nfl: 40, cfb: 50 },
      movementShare: 0.25,
    },
    [MONTHLY_COST_SCENARIOS.G_HEAVY_REASONABLE]: {
      profile: "MOVEMENT",
      runsPerSport: { mlb: 90, nfl: 60, cfb: 70 },
      alsoF5: { mlb: 60 },
      alsoProps: { mlb: 20, nfl: 10 },
    },
  };

  /** @type {Record<string, object>} */
  const out = {};
  for (const [name, spec] of Object.entries(scenarios)) {
    const bySport = {};
    let totalCost = 0;
    let totalRuns = 0;
    let totalGames = 0;
    for (const sport of sports) {
      const runs = Number(spec.runsPerSport?.[sport] || 0);
      const costPerRun =
        Number(observedCostPerRunByProfile[spec.profile]) ||
        defaultCost[spec.profile] ||
        defaultCost.BASE;
      const gamesPerRun = Number(observedGamesPerRunBySport[sport]) || (sport === "mlb" ? 15 : 12);
      let sportCost = runs * costPerRun;
      let sportRuns = runs;
      let sportGames = runs * gamesPerRun;

      if (spec.movementShare && spec.profile === "BASE") {
        const moveRuns = Math.round(runs * spec.movementShare);
        const baseRuns = runs - moveRuns;
        sportCost =
          baseRuns * (Number(observedCostPerRunByProfile.BASE) || defaultCost.BASE) +
          moveRuns * (Number(observedCostPerRunByProfile.MOVEMENT) || defaultCost.MOVEMENT);
        sportRuns = runs;
      }
      if (spec.alsoBase?.[sport]) {
        const r = spec.alsoBase[sport];
        sportCost += r * (Number(observedCostPerRunByProfile.BASE) || defaultCost.BASE);
        sportRuns += r;
        sportGames += r * gamesPerRun;
      }
      if (spec.alsoF5?.[sport]) {
        const r = spec.alsoF5[sport];
        sportCost += r * (Number(observedCostPerRunByProfile.MLB_F5) || defaultCost.MLB_F5);
        sportRuns += r;
        sportGames += r * gamesPerRun;
      }
      if (spec.alsoProps?.[sport]) {
        const r = spec.alsoProps[sport];
        sportCost += r * (Number(observedCostPerRunByProfile.PLAYER_PROPS) || defaultCost.PLAYER_PROPS);
        sportRuns += r;
        sportGames += r * gamesPerRun;
      }

      bySport[sport] = {
        runs: sportRuns,
        games: sportGames,
        estimatedCostUsd: roundUsd(sportCost),
      };
      totalCost += sportCost;
      totalRuns += sportRuns;
      totalGames += sportGames;
    }

    const pctOfCredit = starterCreditUsd > 0 ? round4(totalCost / starterCreditUsd) : null;
    const overage = Math.max(0, totalCost - starterCreditUsd);
    out[name] = {
      scenario: name,
      bySport,
      combined: {
        runs: totalRuns,
        games: totalGames,
        estimatedMonthlyCostUsd: roundUsd(totalCost),
        percentOfStarterCredit: pctOfCredit,
        expectedOverageUsd: roundUsd(overage),
        withinStarterCredit: totalCost <= starterCreditUsd + 1e-9,
      },
      starterCreditUsd,
      costBasis: "ESTIMATED",
      pricingReference: ACTION_APIFY_PRICING_USD,
    };
  }

  return {
    starterCreditUsd,
    scenarios: out,
    note: "Projections are ESTIMATED from Actor PPE pricing / observed run economics. Not labeled as actual.",
  };
}

/**
 * Read-only promotion readiness scorecard. Never promotes Action into the router.
 * @param {{
 *   championship?: object,
 *   reliability?: object,
 *   costWindows?: object,
 *   schemaDriftLevel?: string|null,
 *   sampleRuns?: number,
 *   unmatchedEventRate?: number|null,
 *   ambiguousMatchRate?: number|null,
 *   plan?: string,
 * }} evidence
 */
export function buildPromotionReadinessScorecard(evidence = {}) {
  const blockers = [];
  const sampleRuns = Number(evidence.sampleRuns || 0);
  const drift = evidence.schemaDriftLevel || null;
  const unmatched = evidence.unmatchedEventRate;
  const ambiguous = evidence.ambiguousMatchRate;
  const successRate7d = evidence.reliability?.successRate7d;
  const projected30 = evidence.costWindows?.projected30DaySpend;
  const plan = evidence.plan || "free";

  if (drift === "BLOCK") blockers.push({ code: "BLOCKED_SCHEMA_DRIFT", detail: "Core schema drift BLOCK" });
  if (unmatched != null && unmatched > 0.25) {
    blockers.push({ code: "BLOCKED_TEMPORAL_INTEGRITY", detail: `unmatchedEventRate=${unmatched}` });
  }
  if (ambiguous != null && ambiguous > 0.05) {
    blockers.push({ code: "BLOCKED_TEMPORAL_INTEGRITY", detail: `ambiguousMatchRate=${ambiguous}` });
  }
  if (successRate7d != null && successRate7d < 0.9) {
    blockers.push({ code: "BLOCKED_RELIABILITY", detail: `successRate7d=${successRate7d}` });
  }
  if (plan === "starter" && projected30 != null && projected30 > ACTION_APIFY_DEFAULT_MONTHLY_BUDGET_USD * 1.5) {
    blockers.push({
      code: "BLOCKED_COST",
      detail: `projected30DaySpend=${projected30} vs starter credit`,
    });
  }

  let status = "SHADOW_ONLY";
  if (sampleRuns <= 0) status = "NOT_READY";
  else if (sampleRuns < 10) status = "INSUFFICIENT_SAMPLE";
  else if (blockers.length) status = blockers[0].code;
  else if (sampleRuns >= 10) status = "READY_FOR_REVIEW";
  else status = "COLLECTING";

  // Never auto-elevate to PRIMARY/CO_PRIMARY — owner decision only.
  if (status === "PRIMARY_CANDIDATE" || status === "CO_PRIMARY_CANDIDATE") {
    status = "READY_FOR_REVIEW";
  }

  return {
    status,
    allowedStates: PROMOTION_STATES,
    blockers,
    metrics: {
      sampleRuns,
      schemaDriftLevel: drift,
      unmatchedEventRate: unmatched ?? null,
      ambiguousMatchRate: ambiguous ?? null,
      successRate7d: successRate7d ?? null,
      projected30DaySpend: projected30 ?? null,
      championshipCoverage: evidence.championship?.comparisons
        ? Object.fromEntries(
            Object.entries(evidence.championship.comparisons).map(([k, v]) => [k, v.coverage])
          )
        : null,
      economics: evidence.costWindows || null,
    },
    hardRules: {
      mutatesOddsProviderOrder: false,
      canQualify: false,
      canAuthorizeWager: false,
      feedsCfbFbisV2: false,
    },
    note: "Scorecard is advisory only. Promotion remains an explicit owner/config decision.",
  };
}

/**
 * Convenience: scorecard + championship + monthly model from a candidate run result.
 */
export function evaluateCandidatePromotionPackage({
  actionRows = [],
  incumbents = {},
  reliability = {},
  costLedgerRows = [],
  schemaDriftLevel = null,
  sampleRuns = 0,
  plan = "free",
} = {}) {
  const championship = runProviderChampionship({ actionRows, incumbents });
  const costWindows = aggregateCostWindows(costLedgerRows);
  const monthly = projectMonthlyStarterSufficiency({
    observedCostPerRunByProfile: deriveObservedCostPerProfile(costLedgerRows),
  });

  let unmatched = 0;
  let ambiguous = 0;
  let compared = 0;
  for (const row of actionRows) {
    for (const events of Object.values(incumbents)) {
      const m = matchEventWithConfidence(row, events || []);
      compared += 1;
      if (m.confidence === MATCH_CONFIDENCE.AMBIGUOUS) ambiguous += 1;
      if (m.confidence === MATCH_CONFIDENCE.UNMATCHED) unmatched += 1;
      break;
    }
  }

  const scorecard = buildPromotionReadinessScorecard({
    championship,
    reliability,
    costWindows,
    schemaDriftLevel,
    sampleRuns,
    unmatchedEventRate: compared ? unmatched / compared : null,
    ambiguousMatchRate: compared ? ambiguous / compared : null,
    plan,
  });

  return {
    championship,
    monthlyStarterModel: monthly,
    scorecard,
    costWindows,
    priceSanitySample: (actionRows[0]
      ? normalizePrices({
          homeOdds: actionRows[0].consensus?.moneylineHome,
          awayOdds: actionRows[0].consensus?.moneylineAway,
          overOdds: actionRows[0].consensus?.overOdds,
          underOdds: actionRows[0].consensus?.underOdds,
        })
      : null),
  };
}

function deriveObservedCostPerProfile(rows = []) {
  /** @type {Record<string, { sum: number, n: number }>} */
  const acc = {};
  for (const r of rows) {
    const p = String(r.profile || "BASE");
    if (!acc[p]) acc[p] = { sum: 0, n: 0 };
    acc[p].sum += Number(r.estimated_total_usd || 0);
    acc[p].n += 1;
  }
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(acc)) out[k] = v.n ? roundUsd(v.sum / v.n) : 0;
  return out;
}

function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function roundUsd(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}
