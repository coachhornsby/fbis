/**
 * Persist full Action/Apify candidate market observations into 0020 shadow tables.
 * Shadow/candidate only — decision_eligible / can_qualify / can_authorize_wager always 0.
 * Props only when profile enables them. Never fabricates observed_at.
 */

import {
  ACTION_APIFY_PROVIDER,
  ACTION_APIFY_SOURCE_CLASS,
  ACTION_APIFY_SCHEMA_VERSION,
} from "./actionApifyShadow.js";
import { MATCH_CONFIDENCE } from "./actionApifyCandidateConfig.js";

const ELIGIBLE = new Set([MATCH_CONFIDENCE.EXACT, MATCH_CONFIDENCE.HIGH]);

export async function ensureShadowProviderRun(db, { runId, plan, startedAt, finishedAt, status = "SUCCEEDED" }) {
  if (!db?.exec) return;
  await db.exec(
    `INSERT OR IGNORE INTO shadow_provider_runs (
      id, provider, source_class, actor_id, test_id, apify_run_id, dataset_id, status,
      leagues_json, periods_json, max_items, optional_blocks_json, games_returned, malformed_rows,
      estimated_cost_usd, actual_cost_usd, budget_limit_usd, budget_spent_usd,
      input_json, usage_json, error, started_at, finished_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      ACTION_APIFY_PROVIDER,
      ACTION_APIFY_SOURCE_CLASS,
      "parseforge/action-network-scraper",
      runId,
      plan?.apifyRunId || null,
      plan?.datasetId || null,
      status,
      JSON.stringify(plan?.input?.leagues || []),
      JSON.stringify(plan?.input?.periods || ["event"]),
      plan?.input?.maxItems ?? null,
      JSON.stringify({ profile: plan?.profile || null, includeLineMovement: Boolean(plan?.input?.includeLineMovement), includePlayerProps: Boolean(plan?.input?.includePlayerProps) }),
      plan?.gamesReturned ?? null,
      plan?.malformedRows ?? 0,
      plan?.estimatedCostUsd ?? null,
      plan?.actualCostUsd ?? null,
      null,
      null,
      JSON.stringify(plan?.input || {}),
      null,
      null,
      startedAt,
      finishedAt,
      startedAt,
    ]
  );
}

export async function persistFullMarketObservation(db, row, ctx = {}) {
  if (!db?.exec) return { observationId: null, books: 0, splits: 0, movement: 0, props: 0, skipped: true };

  const observationId = ctx.observationId || `smo_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const runId = ctx.runId;
  const now = ctx.collectedAt || new Date().toISOString();
  const actionGameId = String(row.actionGameId || row.gameId || "");
  const match = ctx.match || {};
  const confidence = match.confidence || MATCH_CONFIDENCE.UNMATCHED;
  const fbisEventId =
    match.comparisonEligible && match.candidate?.id && ELIGIBLE.has(confidence)
      ? String(match.candidate.id)
      : null;
  const sourceObservedAt = row.observedAt || row.sourceObservedAt || null;
  const scrapedAt = row.scrapedAt || null;
  const profile = String(ctx.profile || "BASE").toUpperCase();
  const persistMovement = profile === "MOVEMENT" || profile === "FINAL" || Boolean(ctx.persistMovement);
  const persistProps = profile === "PLAYER_PROPS" || Boolean(ctx.persistProps);

  await db.exec(
    `INSERT INTO shadow_market_observations (
      id, run_id, provider, source_class, action_game_id, league, season, season_type, week,
      home_team, away_team, home_abbr, away_abbr, start_time, status, is_live, period, period_label,
      scraped_at, received_at, observed_at, source_url, raw_payload_hash, schema_version,
      consensus_json, public_betting_json, market_quality_json, best_odds_json, line_movement_json,
      result_json, research_fields_json, decision_eligible, can_qualify, can_authorize_wager, created_at,
      fbis_event_id, sport, temporal_class, match_confidence, collected_at, source_observed_at, evaluation_close
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      observationId, runId, ACTION_APIFY_PROVIDER, ACTION_APIFY_SOURCE_CLASS, actionGameId,
      row.league || null, row.season ?? null, row.seasonType || null, row.week ?? null,
      row.homeTeam || row.home || "", row.awayTeam || row.away || "",
      row.homeAbbr || null, row.awayAbbr || null, row.startTime || null, row.status || null,
      row.isLive ? 1 : 0, row.period || "event", row.periodLabel || null,
      scrapedAt, now, sourceObservedAt, row.sourceUrl || null,
      row.rawPayloadHash || "", row.schemaVersion || ACTION_APIFY_SCHEMA_VERSION,
      JSON.stringify(row.consensus || null),
      JSON.stringify(row.publicBetting || null),
      JSON.stringify(row.marketQuality || null),
      JSON.stringify(row.bestOdds || null),
      persistMovement ? JSON.stringify(row.lineMovement || null) : null,
      JSON.stringify(row.result || null),
      JSON.stringify({
        matchConfidence: confidence,
        matchReason: match.reason || null,
        temporalClass: row.temporalClass || ctx.temporalClass || null,
        profile,
        propsPersisted: persistProps,
        research: row.researchFields || null,
        playerProps: persistProps ? row.playerProps || null : undefined,
      }),
      now, fbisEventId, ctx.sport || row.sport || null,
      row.temporalClass || ctx.temporalClass || null, confidence, now, sourceObservedAt,
      row.temporalClass === "evaluation_close" || ctx.lifecycle === "postgame" ? 1 : 0,
    ]
  );

  let books = 0;
  for (const b of row.books || []) {
    if (!b?.book) continue;
    await db.exec(
      `INSERT INTO shadow_market_books (
        id, observation_id, run_id, action_game_id, book, book_id, period, market_id, is_live,
        spread_home, spread_home_odds, spread_away, spread_away_odds,
        moneyline_home, moneyline_away, total, over_odds, under_odds,
        moneyline_hold_percent, spread_hold_percent, total_hold_percent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `smb_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        observationId, runId, actionGameId, b.book,
        b.bookId != null ? String(b.bookId) : null,
        b.period || row.period || "event", b.marketId || null, b.isLive ? 1 : 0,
        b.spreadHome ?? null, b.spreadHomeOdds ?? null, b.spreadAway ?? null, b.spreadAwayOdds ?? null,
        b.moneylineHome ?? null, b.moneylineAway ?? null, b.total ?? null, b.overOdds ?? null, b.underOdds ?? null,
        b.moneylineHoldPercent ?? null, b.spreadHoldPercent ?? null, b.totalHoldPercent ?? null, now,
      ]
    );
    books += 1;
  }

  let splits = 0;
  const pb = row.publicBetting || {};
  for (const [market, side, node] of [
    ["spread", "home", pb.spreadHome], ["spread", "away", pb.spreadAway],
    ["moneyline", "home", pb.moneylineHome], ["moneyline", "away", pb.moneylineAway],
    ["total", "over", pb.over], ["total", "under", pb.under],
  ]) {
    if (!node || (node.ticketsPercent == null && node.moneyPercent == null)) continue;
    await db.exec(
      `INSERT INTO shadow_market_splits (
        id, observation_id, run_id, action_game_id, market, side,
        tickets_percent, money_percent, money_minus_tickets, max_money_ticket_gap,
        sharp_side, bet_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `sms_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        observationId, runId, actionGameId, market, side,
        node.ticketsPercent ?? null, node.moneyPercent ?? null, node.moneyMinusTickets ?? null,
        pb.maxMoneyTicketGap ?? null, pb.sharpSide || null, pb.betCount ?? null, now,
      ]
    );
    splits += 1;
  }

  let movement = 0;
  if (persistMovement) {
    const lm = row.lineMovement || {};
    const history = Array.isArray(lm.history) ? lm.history.slice(0, 40) : [];
    const ticks = history.length
      ? history
      : lm.openSpreadHome != null || lm.currentSpreadHome != null
        ? [{ book: "consensus", market: "summary", side: null, line: lm.currentSpreadHome ?? lm.currentTotal ?? null, odds: null, observedAt: lm.observedAt || null }]
        : [];
    for (const tick of ticks) {
      await db.exec(
        `INSERT INTO shadow_line_movement (
          id, observation_id, run_id, action_game_id, book, market, side, line, odds, observed_at,
          open_spread_home, open_total, open_moneyline_home,
          current_spread_home, current_total, current_moneyline_home,
          spread_move, total_move, spread_direction, total_direction, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `slm_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
          observationId, runId, actionGameId, tick.book || null, tick.market || null, tick.side || null,
          tick.line ?? null, tick.odds ?? null, tick.observedAt || null,
          lm.openSpreadHome ?? null, lm.openTotal ?? null, lm.openMoneylineHome ?? null,
          lm.currentSpreadHome ?? null, lm.currentTotal ?? null, lm.currentMoneylineHome ?? null,
          lm.spreadMove ?? null, lm.totalMove ?? null, lm.spreadDirection || null, lm.totalDirection || null, now,
        ]
      );
      movement += 1;
    }
  }

  return {
    observationId, books, splits, movement,
    props: persistProps && Array.isArray(row.playerProps) ? row.playerProps.length : 0,
    fbisEventId, confidence,
  };
}

/**
 * Championship denominators — keep these metrics separate.
 *
 * A. actionToFbisMatchRate = (EXACT+HIGH) / Action returned
 * B. fbisCoverageOfDatedSlate = matched unique FBIS / dated slate size
 *    (secondary; NOT the primary coverage score when maxItems << slate)
 * C. ambiguousRate = AMBIGUOUS / Action returned
 * D. unmatchedRate = UNMATCHED / Action returned
 *
 * Never treat (EXACT+HIGH)/datedSlate as Action→FBIS match rate when the
 * request was maxItems-bounded (e.g. free plan 10 of 83).
 */
export function computeMatchDenominators({
  fbisEvents = [],
  actionRows = [],
  matchDetails = [],
  requestedMaxItems = null,
} = {}) {
  const fbisDatedSlateCount = fbisEvents.length;
  const actionReturned = actionRows.length;
  const matched = matchDetails.filter((m) => m.comparisonEligible).length;
  const exact = matchDetails.filter((m) => m.confidence === MATCH_CONFIDENCE.EXACT).length;
  const high = matchDetails.filter((m) => m.confidence === MATCH_CONFIDENCE.HIGH).length;
  const ambiguous = matchDetails.filter((m) => m.confidence === MATCH_CONFIDENCE.AMBIGUOUS).length;
  const unmatched = matchDetails.filter((m) => m.confidence === MATCH_CONFIDENCE.UNMATCHED).length;
  const matchedFbisIds = new Set(
    matchDetails.filter((m) => m.comparisonEligible && m.fbisEventId).map((m) => String(m.fbisEventId))
  );
  const maxItems =
    requestedMaxItems != null && Number.isFinite(Number(requestedMaxItems))
      ? Math.max(0, Math.floor(Number(requestedMaxItems)))
      : null;
  return {
    fbisEventsExpected: fbisDatedSlateCount,
    fbisDatedSlateCount,
    actionRequestMaxItems: maxItems,
    actionEventsReturned: actionReturned,
    matchedEvents: matched,
    exactEvents: exact,
    highEvents: high,
    ambiguousEvents: ambiguous,
    unmatchedEvents: unmatched,
    actionOnlyEvents: unmatched,
    fbisOnlyEvents: Math.max(0, fbisDatedSlateCount - matchedFbisIds.size),
    /** A — primary Action→FBIS identity rate */
    actionToFbisMatchRate: actionReturned > 0 ? matched / actionReturned : null,
    /** B — full dated-slate coverage (secondary when maxItems-bounded) */
    fbisCoverageRate: fbisDatedSlateCount > 0 ? matchedFbisIds.size / fbisDatedSlateCount : null,
    fbisCoverageOfDatedSlate:
      fbisDatedSlateCount > 0 ? matchedFbisIds.size / fbisDatedSlateCount : null,
    /** C / D — never merge into one failure bucket */
    ambiguousRate: actionReturned > 0 ? ambiguous / actionReturned : null,
    unmatchedRate: actionReturned > 0 ? unmatched / actionReturned : null,
  };
}
