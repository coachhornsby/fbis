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
  const openTotal =
    num(lineMovement.openTotal) ??
    num(lineMovement.openingTotal) ??
    num(lineMovement.open?.total) ??
    num(research.openingTotal);
  const currentTotal = total ?? num(lineMovement.currentTotal) ?? num(research.observedTotal);
  const openMlHome =
    num(lineMovement.openMlHome) ??
    num(lineMovement.openingMlHome) ??
    num(lineMovement.open?.mlHome);
  const openMlAway =
    num(lineMovement.openMlAway) ??
    num(lineMovement.openingMlAway) ??
    num(lineMovement.open?.mlAway);
  const movementMagnitude =
    openSpread != null && currentSpread != null
      ? Math.round((currentSpread - openSpread) * 10) / 10
      : null;
  const movementDirection =
    movementMagnitude == null || movementMagnitude === 0
      ? null
      : movementMagnitude < 0
        ? "TOWARD_HOME"
        : "TOWARD_AWAY";

  const bestBook =
    bestOdds?.spreadHome?.book ||
    bestOdds?.spread?.book ||
    bestOdds?.moneylineHome?.book ||
    bestOdds?.book ||
    null;

  const quality = safeJson(row.market_quality_json) || safeJson(row.quality_json) || {};
  const booksCount =
    Array.isArray(row.books) ? row.books.length : num(row.books_count) ?? num(quality.bookCount) ?? num(quality.books);

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
    // Board market context — Action sets consensus/public/movement; FBIS projection overlays.
    boardMarketSource: true,
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
      bookCount: booksCount,
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
      openingTotal: openTotal,
      currentTotal,
      openingMlHome: openMlHome,
      openingMlAway: openMlAway,
      movementMagnitude,
      direction: movementDirection,
      bestBook: bestBook || null,
    },
    open: {
      spreadHome: openSpread,
      total: openTotal,
      mlHome: openMlHome,
      mlAway: openMlAway,
    },
    current: {
      spreadHome: currentSpread,
      total: currentTotal,
      mlHome,
      mlAway,
    },
    bestOdds: bestOdds && typeof bestOdds === "object" ? bestOdds : null,
    booksCount,
    ...actionPolicyFlags(),
  };
}

/**
 * Load newest matched ACTION observations for a set of FBIS event ids.
 * @returns {Promise<Map<string, object>>} eventId → actionIntel
 */
export async function loadBoardActionIntelByEventIds(db, eventIds = []) {
  const map = new Map();
  if (!db?.prepare) return map;
  const ids = [...new Set((eventIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return map;

  const chunkSize = 40;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const sql = `SELECT id, sport, fbis_event_id, home_team, away_team,
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
        if (!eid || map.has(eid)) continue;
        const intel = buildBoardActionIntel(row);
        if (intel) map.set(eid, intel);
      }
    } catch {
      return map;
    }
  }
  return map;
}

/**
 * Attach actionIntel onto board/slate games (mutates shallow copies).
 * Re-merges Action into game.market so Board consensus prefers Action after
 * toBoardGame (which resolves market before intel is available).
 * Fills display sentiment/publicSplits when empty — never sets qualify/authorize.
 */
export async function attachActionIntelToGames(games = [], db = null) {
  const list = Array.isArray(games) ? games : [];
  if (!list.length || !db) {
    return { games: list, attached: 0, checked: 0 };
  }
  const { mergeActionIntelIntoMarket } = await import("./canonical/marketRoles.js");
  const ids = list.map((g) => g?.id || g?.eventId || g?.gameId).filter(Boolean);
  const byId = await loadBoardActionIntelByEventIds(db, ids);
  let attached = 0;
  const out = list.map((g) => {
    const eid = String(g?.id || g?.eventId || g?.gameId || "");
    const intel = byId.get(eid);
    if (!intel) return g;
    attached += 1;
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
    const next = {
      ...g,
      actionIntel: intel,
      sentiment: existingSentiment || sentimentFromAction,
      publicSplits: g.publicSplits || intel.publicSplits,
    };
    // Board rows already carry a pre-Action market — merge Action consensus/intel in.
    next.market = mergeActionIntelIntoMarket(g.market, intel);
    if (next.market) {
      next.marketAvailable = Boolean(next.market.marketAvailable);
      next.executionMarketAvailable = Boolean(next.market.executionMarketAvailable);
      next.referenceMarketAvailable = Boolean(next.market.referenceMarketAvailable);
      next.consensusAvailable = Boolean(next.market.consensus?.available);
      next.intelligenceAvailable = Boolean(next.market.intelligence?.available);
      next.marketUnavailable = !next.market.marketAvailable;
      next.executionMarketUnavailable = !next.market.executionMarketAvailable;
      next.referenceMarketUnavailable = !next.market.referenceMarketAvailable;
    }
    return next;
  });
  return { games: out, attached, checked: ids.length, matchedIds: [...byId.keys()] };
}
