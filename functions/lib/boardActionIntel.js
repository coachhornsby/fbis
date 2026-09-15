/**
 * Attach ACTION Apify market intelligence onto board game rows for DISPLAY.
 *
 * Hard rules:
 * - Shadow / market_intelligence only
 * - Never odds-router authority
 * - Never canQualify / canAuthorizeWager
 * - Never PURE feature input
 * - Fail-open: missing tables or unmatched ids → games unchanged
 */

import { actionPolicyFlags, normalizeActionSport } from "./actionMarketIntelligence.js";
import { matchShadowEvent } from "./actionApifyShadow.js";
import { matchEventWithConfidence, MATCH_CONFIDENCE } from "./actionApifyCandidate.js";
import {
  ACTION_BOARD_SOURCE,
  loadDurableActionEventStates,
  persistActionEventIdentityLink,
  isPersistableActionMatchConfidence,
} from "./actionEventState.js";

function safeJson(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickPct(...vals) {
  for (const v of vals) {
    const n = num(v);
    if (n != null) return n;
  }
  return null;
}

/**
 * Money−tickets lean for one market node (home/over anchored).
 * Positive gap ⇒ lean on home/over; negative ⇒ away/under.
 * Never invents an FBIS "sharp" label.
 */
function buildMarketLean(node, { market, posSide, negSide }) {
  if (!node || typeof node !== "object") return null;
  const ticketPct = pickPct(
    node.ticketsPercent,
    node.ticketPct,
    node.tickets,
    node.ticketPercent
  );
  const moneyPct = pickPct(
    node.moneyPercent,
    node.moneyPct,
    node.money,
    node.moneyPercentHandle
  );
  if (ticketPct == null && moneyPct == null) return null;
  const moneyTicketGap =
    ticketPct != null && moneyPct != null ? Math.round((moneyPct - ticketPct) * 10) / 10 : null;
  const leanSide =
    moneyTicketGap == null || moneyTicketGap === 0
      ? null
      : moneyTicketGap > 0
        ? posSide
        : negSide;
  return {
    market,
    ticketPct,
    moneyPct,
    moneyTicketGap,
    magnitude: moneyTicketGap == null ? null : Math.abs(moneyTicketGap),
    leanSide,
    // Research context only — never promote provider sharp metadata.
    sharpLabel: null,
  };
}

function pickPrimaryMarket(markets) {
  if (!markets.length) return null;
  const withGap = markets.filter((m) => m.magnitude != null);
  if (!withGap.length) return markets[0];
  return withGap.slice().sort((a, b) => b.magnitude - a.magnitude)[0];
}

/**
 * Normalize a shadow_market_observations row into a board-safe actionIntel payload.
 */
export function buildBoardActionIntel(row = {}) {
  if (!row || typeof row !== "object") return null;
  const consensus = safeJson(row.consensus_json) || {};
  const publicBetting = safeJson(row.public_betting_json) || {};
  const bestOdds = safeJson(row.best_odds_json) || {};
  const lineMovement = safeJson(row.line_movement_json) || {};
  const research = safeJson(row.research_fields_json) || {};

  const spreadHome =
    num(consensus.spreadHome) ??
    num(consensus.spread_home) ??
    num(consensus.homeSpread) ??
    num(consensus.spread);
  const total =
    num(consensus.total) ?? num(consensus.totalLine) ?? num(consensus.overUnder) ?? num(consensus.ou);
  const mlHome = num(consensus.moneylineHome) ?? num(consensus.mlHome) ?? num(consensus.homeMl);
  const mlAway = num(consensus.moneylineAway) ?? num(consensus.mlAway) ?? num(consensus.awayMl);

  const rl = buildMarketLean(publicBetting.spreadHome || publicBetting.spread, {
    market: "RL",
    posSide: "HOME",
    negSide: "AWAY",
  });
  const ml = buildMarketLean(publicBetting.moneylineHome || publicBetting.mlHome, {
    market: "ML",
    posSide: "HOME",
    negSide: "AWAY",
  });
  const tot = buildMarketLean(
    publicBetting.over || publicBetting.totalOver || publicBetting.total,
    {
      market: "TOTAL",
      posSide: "OVER",
      negSide: "UNDER",
    }
  );

  // Legacy single-split fallback when only research tickets/money exist.
  let markets = [rl, ml, tot].filter(Boolean);
  if (!markets.length) {
    const ticketPct = pickPct(research.ticketsPct, research.ticketPct);
    const moneyPct = pickPct(research.moneyPct);
    if (ticketPct != null || moneyPct != null) {
      const moneyTicketGap =
        ticketPct != null && moneyPct != null
          ? Math.round((moneyPct - ticketPct) * 10) / 10
          : null;
      markets = [
        {
          market: "RL",
          ticketPct,
          moneyPct,
          moneyTicketGap,
          magnitude: moneyTicketGap == null ? null : Math.abs(moneyTicketGap),
          leanSide:
            moneyTicketGap == null || moneyTicketGap === 0
              ? null
              : moneyTicketGap > 0
                ? "HOME"
                : "AWAY",
          sharpLabel: null,
        },
      ];
    }
  }

  // Legacy single-split fields stay RL-first for backward compatibility.
  // Full ML/RL/TOTAL leans live on publicSplits.markets for the knife UI.
  const primary = rl || pickPrimaryMarket(markets);
  const ticketPct = primary?.ticketPct ?? null;
  const moneyPct = primary?.moneyPct ?? null;
  const moneyTicketGap = primary?.moneyTicketGap ?? null;

  const openSpread =
    num(lineMovement.openSpreadHome) ??
    num(lineMovement.openingSpreadHome) ??
    num(lineMovement.open?.spreadHome) ??
    num(research.openingLine);
  const currentSpread = spreadHome ?? num(lineMovement.currentSpreadHome) ?? num(research.observedLine);
  const movementMagnitude =
    openSpread != null && currentSpread != null
      ? Math.round((currentSpread - openSpread) * 10) / 10
      : null;

  const bestBook =
    bestOdds?.spreadHome?.book ||
    bestOdds?.spread?.book ||
    bestOdds?.moneylineHome?.book ||
    bestOdds?.book ||
    null;

  const collectedAt =
    row.collected_at ||
    row.source_observed_at ||
    row.observed_at ||
    row.scraped_at ||
    row.created_at ||
    null;

  return {
    provider: "ACTION_APIFY",
    role: "market_intelligence",
    governanceMode: "shadow",
    displayOnly: true,
    eventId: row.fbis_event_id || null,
    sport: normalizeActionSport(row.sport),
    matchConfidence: row.match_confidence || null,
    collectedAt,
    consensus: {
      spreadHome,
      total,
      mlHome,
      mlAway,
    },
    publicSplits: {
      ticketPct,
      moneyPct,
      moneyTicketGap,
      // Never invent "sharp" — money/ticket lean is research context only.
      sharpLabel: null,
      primaryMarket: primary?.market ?? null,
      markets,
    },
    movement: {
      openingLine: openSpread,
      currentLine: currentSpread,
      movementMagnitude,
      bestBook: bestBook || null,
    },
    bestOdds: bestOdds && typeof bestOdds === "object" ? bestOdds : null,
    booksCount: Array.isArray(row.books) ? row.books.length : num(row.books_count),
    ...actionPolicyFlags(),
  };
}

/**
 * Load ACTION board intel for FBIS event ids.
 *
 * Hierarchy (never let a lower tier overwrite a higher one):
 *   1. canonical ACTION durable observations
 *   2. canonical snapshot pointers (via durable reader)
 *   3. durable identity links (via durable reader)
 *   4. legacy shadow_market_observations fallback
 *   5. no ACTION data
 *
 * @returns {Promise<Map<string, object>>} eventId → actionIntel
 */
export async function loadBoardActionIntelByEventIds(db, eventIds = []) {
  const map = new Map();
  if (!db?.prepare) return map;
  const ids = [...new Set((eventIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return map;

  // 1–3: durable series + pointers + identity links
  try {
    const durable = await loadDurableActionEventStates(db, ids);
    for (const [eid, state] of durable) {
      if (!state || map.has(eid)) continue;
      map.set(eid, {
        ...state,
        // Board UI historically reads these keys:
        publicSplits: {
          ticketPct: state.publicSplits?.ticketPct ?? null,
          moneyPct: state.publicSplits?.moneyPct ?? null,
          moneyTicketGap: state.publicSplits?.moneyTicketGap ?? null,
          sharpLabel: null,
          primaryMarket: state.publicSplits?.primaryMarket ?? null,
          markets: state.publicSplits?.markets || [],
        },
        lineHistory: state.lineHistory || [],
        source: state.source || ACTION_BOARD_SOURCE.DURABLE_SERIES,
      });
    }
  } catch {
    // Durable path unavailable — fall through to legacy shadow.
  }

  const missing = ids.filter((id) => !map.has(id));
  if (!missing.length) return map;

  // 4: legacy shadow_market_observations fallback (compatibility only)
  const chunkSize = 40;
  for (let i = 0; i < missing.length; i += chunkSize) {
    const chunk = missing.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const sql = `SELECT id, sport, fbis_event_id, home_team, away_team, home_abbr, away_abbr, start_time,
                        consensus_json, public_betting_json, best_odds_json, line_movement_json,
                        research_fields_json, match_confidence,
                        collected_at, source_observed_at, observed_at, scraped_at, created_at
                 FROM shadow_market_observations
                 WHERE fbis_event_id IN (${placeholders})
                   AND COALESCE(decision_eligible, 0) = 0
                   AND COALESCE(can_qualify, 0) = 0
                   AND COALESCE(can_authorize_wager, 0) = 0
                 ORDER BY COALESCE(collected_at, created_at) DESC`;
    try {
      const res = await db.prepare(sql).bind(...chunk).all();
      for (const row of res?.results || []) {
        const eid = String(row.fbis_event_id || "");
        // Never overwrite durable state with legacy shadow.
        if (!eid || map.has(eid)) continue;
        const intel = buildBoardActionIntel(row);
        if (intel) {
          intel.source = ACTION_BOARD_SOURCE.LEGACY_SHADOW;
          intel.lineHistory = intel.lineHistory || [];
          map.set(eid, intel);
        }
      }
    } catch {
      return map;
    }
  }
  return map;
}

/**
 * Display rematch: recent observations without fbis_event_id (or unmatched) → board games.
 * Fail-closed on ambiguous matches. Never grants qualify/authorize.
 */
export async function rematchBoardActionIntel(games = [], db = null, { lookbackHours = 72 } = {}) {
  const map = new Map();
  if (!db?.prepare || !games?.length) return map;
  const missing = games.filter((g) => {
    const id = String(g?.id || g?.eventId || g?.gameId || "");
    return id && !(g.actionIntel);
  });
  if (!missing.length) return map;

  const sports = [...new Set(missing.map((g) => normalizeActionSport(g.sport || g.league)).filter(Boolean))];
  const candidates = missing.map((g) => ({
    id: String(g.id || g.eventId || g.gameId),
    sport: normalizeActionSport(g.sport || g.league),
    league: normalizeActionSport(g.sport || g.league),
    homeTeam: g.home?.name || g.home?.team || g.homeTeam || g.home_team || g.home?.abbr,
    awayTeam: g.away?.name || g.away?.team || g.awayTeam || g.away_team || g.away?.abbr,
    homeAbbr: g.home?.abbr || g.homeAbbr || null,
    awayAbbr: g.away?.abbr || g.awayAbbr || null,
    startTime: g.start || g.startTime || g.commence_time || g.kickoff || null,
  }));

  const lookback = Math.max(6, Number(lookbackHours) || 72);
  for (const sport of sports.length ? sports : [null]) {
    let sql;
    let binds;
    if (sport) {
      sql = `SELECT id, sport, fbis_event_id, action_game_id, home_team, away_team, home_abbr, away_abbr, start_time, league,
                    consensus_json, public_betting_json, best_odds_json, line_movement_json,
                    research_fields_json, match_confidence,
                    collected_at, source_observed_at, observed_at, scraped_at, created_at
             FROM shadow_market_observations
             WHERE LOWER(COALESCE(sport, league, '')) IN (?, ?)
               AND COALESCE(decision_eligible, 0) = 0
               AND COALESCE(can_qualify, 0) = 0
               AND COALESCE(can_authorize_wager, 0) = 0
               AND COALESCE(collected_at, created_at) >= datetime('now', ?)
             ORDER BY COALESCE(collected_at, created_at) DESC
             LIMIT 250`;
      const aliases =
        sport === "cfb" ? ["cfb", "ncaaf"] :
        sport === "cbb" ? ["cbb", "ncaab"] :
        [sport, sport];
      binds = [aliases[0], aliases[1], `-${lookback} hours`];
    } else {
      sql = `SELECT id, sport, fbis_event_id, action_game_id, home_team, away_team, home_abbr, away_abbr, start_time, league,
                    consensus_json, public_betting_json, best_odds_json, line_movement_json,
                    research_fields_json, match_confidence,
                    collected_at, source_observed_at, observed_at, scraped_at, created_at
             FROM shadow_market_observations
             WHERE COALESCE(decision_eligible, 0) = 0
               AND COALESCE(can_qualify, 0) = 0
               AND COALESCE(can_authorize_wager, 0) = 0
               AND COALESCE(collected_at, created_at) >= datetime('now', ?)
             ORDER BY COALESCE(collected_at, created_at) DESC
             LIMIT 250`;
      binds = [`-${lookback} hours`];
    }
    let rows = [];
    try {
      const res = await db.prepare(sql).bind(...binds).all();
      rows = res?.results || [];
    } catch {
      continue;
    }

    const sportCands = candidates.filter((c) => !sport || c.sport === sport);
    for (const row of rows) {
      const actionRow = {
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        homeAbbr: row.home_abbr,
        awayAbbr: row.away_abbr,
        startTime: row.start_time,
        league: row.league || row.sport,
        sport: row.sport || row.league,
        actionGameId: row.action_game_id || row.id,
      };
      const m = matchEventWithConfidence(actionRow, sportCands);
      if (!m.matched || !m.candidate?.id) continue;
      // Ambiguous / weak matches stay unlinked and do not attach silently.
      if (!m.comparisonEligible && !isPersistableActionMatchConfidence(m.confidence)) continue;
      const eid = String(m.candidate.id);
      if (map.has(eid)) continue;
      const intel = buildBoardActionIntel({ ...row, fbis_event_id: eid });
      if (!intel) continue;
      intel.matchConfidence = m.confidence || intel.matchConfidence || m.reason || "REMATCH_DISPLAY";
      intel.rematchedForDisplay = true;
      intel.source = intel.source || ACTION_BOARD_SOURCE.LEGACY_SHADOW;

      if (isPersistableActionMatchConfidence(m.confidence)) {
        const persist = await persistActionEventIdentityLink(db, {
          providerEventId: row.action_game_id || row.id,
          sport: row.sport || row.league || m.candidate.sport,
          canonicalEventId: eid,
          matchConfidence: m.confidence,
          matchReason: m.reason || null,
          sourceObservationId: row.id || null,
        });
        intel.identityPersisted = Boolean(persist?.ok);
        intel.rematchedForDisplay = !persist?.ok;
      }
      map.set(eid, intel);
    }
  }
  return map;
}

/**
 * Attach actionIntel onto board/slate games (mutates shallow copies).
 * Also fills display sentiment/publicSplits from ACTION when those are empty,
 * without overwriting production-router odds fields.
 */
export async function attachActionIntelToGames(games = [], db = null) {
  const list = Array.isArray(games) ? games : [];
  if (!list.length || !db) {
    return { games: list, attached: 0, checked: 0 };
  }
  const ids = list.map((g) => g?.id || g?.eventId || g?.gameId).filter(Boolean);
  const byId = await loadBoardActionIntelByEventIds(db, ids);
  // Rematch recent observations when fbis_event_id join misses (common when collect skipped/unmatched).
  const needRematch = list.filter((g) => {
    const eid = String(g?.id || g?.eventId || g?.gameId || "");
    return eid && !byId.has(eid);
  });
  let rematched = 0;
  if (needRematch.length) {
    const rematchMap = await rematchBoardActionIntel(needRematch, db);
    for (const [eid, intel] of rematchMap) {
      if (!byId.has(eid)) {
        byId.set(eid, intel);
        rematched += 1;
      }
    }
  }
  let attached = 0;
  let durableMatched = 0;
  let legacyFallbackMatched = 0;
  const out = list.map((g) => {
    const eid = String(g?.id || g?.eventId || g?.gameId || "");
    const intel = byId.get(eid);
    if (!intel) return g;
    attached += 1;
    if (intel.source === ACTION_BOARD_SOURCE.DURABLE_SERIES || intel.source === ACTION_BOARD_SOURCE.IDENTITY_LINK) {
      durableMatched += 1;
    } else if (intel.source === ACTION_BOARD_SOURCE.LEGACY_SHADOW) {
      legacyFallbackMatched += 1;
    }
    const existingSentiment = g.sentiment || g.odds?.sentiment || null;
    const sentimentFromAction = {
      source: "ACTION_APIFY",
      displayOnly: true,
      ticketPct: intel.publicSplits?.ticketPct ?? null,
      moneyPct: intel.publicSplits?.moneyPct ?? null,
      moneyTicketGap: intel.publicSplits?.moneyTicketGap ?? null,
      primaryMarket: intel.publicSplits?.primaryMarket ?? null,
      markets: intel.publicSplits?.markets ?? null,
      openingLine: intel.movement?.openingLine ?? null,
      currentLine: intel.movement?.currentLine ?? null,
      magnitude: intel.movement?.movementMagnitude ?? null,
      bestBook: intel.movement?.bestBook ?? null,
      collectedAt: intel.collectedAt,
    };
    return {
      ...g,
      actionIntel: intel,
      sentiment: existingSentiment || sentimentFromAction,
      publicSplits: g.publicSplits || intel.publicSplits,
    };
  });
  return {
    games: out,
    attached,
    checked: ids.length,
    matchedIds: [...byId.keys()],
    rematched,
    durableMatched,
    legacyFallbackMatched,
  };
}
