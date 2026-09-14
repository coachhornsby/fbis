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
import { buildActionIntelligenceEnrichment } from "./actionMarketSignals.js";

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


function movementHistory(lineMovement) {
  const hist = Array.isArray(lineMovement?.history) ? lineMovement.history : [];
  return hist
    .filter((h) => h && (h.line != null || h.odds != null || h.observedAt))
    .slice(0, 40)
    .map((h) => ({
      book: h.book || null,
      market: h.market || null,
      side: h.side || null,
      line: num(h.line),
      odds: num(h.odds),
      observedAt: h.observedAt || null,
    }));
}

function bookRowsFromObservation(row, bestOdds) {
  if (Array.isArray(row.books) && row.books.length) {
    return row.books.map((b) => ({
      book: b.book || b.sportsbook || null,
      sportsbook: b.book || b.sportsbook || null,
      line: num(b.spreadHome ?? b.line ?? b.point ?? b.total),
      point: num(b.spreadHome ?? b.line ?? b.point),
      americanPrice: num(b.spreadHomeOdds ?? b.americanPrice ?? b.price ?? b.overOdds),
      price: num(b.spreadHomeOdds ?? b.americanPrice ?? b.price ?? b.overOdds),
    }));
  }
  const out = [];
  if (bestOdds && typeof bestOdds === "object") {
    for (const [key, node] of Object.entries(bestOdds)) {
      if (!node || typeof node !== "object" || !node.book) continue;
      out.push({
        book: node.book,
        sportsbook: node.book,
        line: num(node.line ?? node.point ?? node.value),
        point: num(node.line ?? node.point ?? node.value),
        americanPrice: num(node.price ?? node.odds ?? node.americanPrice),
        price: num(node.price ?? node.odds ?? node.americanPrice),
        marketKey: key,
      });
    }
  }
  return out;
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
  const marketQuality = safeJson(row.market_quality_json) || {};

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
  // Focus = strongest magnitude across markets (may be TOTAL/ML).
  const strongest = pickPrimaryMarket(markets);
  const primary = rl || strongest;
  const focus = strongest || primary;
  const ticketPct = primary?.ticketPct ?? null;
  const moneyPct = primary?.moneyPct ?? null;
  const moneyTicketGap = primary?.moneyTicketGap ?? null;

  const openSpread =
    num(lineMovement.openSpreadHome) ??
    num(lineMovement.openingSpreadHome) ??
    num(lineMovement.open?.spreadHome) ??
    num(research.openingLine);
  const currentSpread =
    num(lineMovement.currentSpreadHome) ?? spreadHome ?? num(research.observedLine);
  const movementMagnitude =
    openSpread != null && currentSpread != null
      ? Math.round((currentSpread - openSpread) * 10) / 10
      : null;

  const openTotal =
    num(lineMovement.openTotal) ?? num(lineMovement.openingTotal) ?? num(lineMovement.open?.total);
  const currentTotal = total ?? num(lineMovement.currentTotal);
  const totalMovementMagnitude =
    openTotal != null && currentTotal != null
      ? Math.round((currentTotal - openTotal) * 10) / 10
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

  const booksCount =
    num(marketQuality.bookCount) ??
    (Array.isArray(row.books) ? row.books.length : null) ??
    num(row.books_count);

  const history = movementHistory(lineMovement);
  const bookRows = bookRowsFromObservation(row, bestOdds);

  const enrichment = buildActionIntelligenceEnrichment({
    publicBetting,
    research,
    lineMovement,
    markets,
    ticketPct: focus?.ticketPct ?? ticketPct,
    moneyPct: focus?.moneyPct ?? moneyPct,
    moneyTicketGap: focus?.moneyTicketGap ?? moneyTicketGap,
    openLine: openSpread,
    currentLine: currentSpread,
    // RLM pairs RL public splits with spread open→current (not TOTAL focus %).
    rlmContext: {
      ticketPct: rl?.ticketPct ?? ticketPct,
      moneyPct: rl?.moneyPct ?? moneyPct,
      openLine: openSpread,
      currentLine: currentSpread,
    },
    trackedBetCount:
      num(publicBetting.betCount) ?? num(publicBetting.numBets) ?? num(research.betCount),
    trackedVolume: num(publicBetting.trackedVolume) ?? num(publicBetting.volume),
    booksCount,
    bookRows,
  });

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
      bookCount: booksCount,
    },
    publicSplits: {
      ticketPct,
      moneyPct,
      moneyTicketGap,
      // Never invent FBIS "sharp" — provider signals are separate fields.
      sharpLabel: null,
      primaryMarket: primary?.market ?? null,
      focusMarket: focus?.market ?? null,
      markets,
      trackedBetCount: enrichment.trackedBetCount,
      trackedVolume: enrichment.trackedVolume,
      sampleQuality: enrichment.sampleQuality,
    },
    movement: {
      openingLine: openSpread,
      currentLine: currentSpread,
      movementMagnitude,
      openingTotal: openTotal,
      currentTotal,
      totalMovementMagnitude,
      bestBook: bestBook || null,
      history,
      sparkline: history
        .map((h) => num(h.line))
        .filter((n) => n != null)
        .slice(-24),
    },
    bestOdds: bestOdds && typeof bestOdds === "object" ? bestOdds : null,
    booksCount,
    providerSharpSignal: enrichment.providerSharpSignal,
    providerSteamSignal: enrichment.providerSteamSignal,
    providerSharpMarket: enrichment.providerSharpMarket,
    providerSteamMarket: enrichment.providerSteamMarket,
    providerSharpRaw: enrichment.providerSharpRaw,
    providerSteamRaw: enrichment.providerSteamRaw,
    providerSignalSource: enrichment.providerSignalSource,
    sampleQuality: enrichment.sampleQuality,
    trackedBetCount: enrichment.trackedBetCount,
    trackedVolume: enrichment.trackedVolume,
    sampleEvidence: enrichment.sampleEvidence,
    bookDisagreement: enrichment.bookDisagreement,
    signals: enrichment.signals,
    marketFocus: enrichment.marketFocus,
    marketRegime: enrichment.marketRegime,
    marketRegimeEvidence: enrichment.marketRegimeEvidence,
    marketSignal: enrichment.marketSignal,
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
                        research_fields_json, market_quality_json, match_confidence,
                        collected_at, source_observed_at, observed_at, scraped_at, created_at
                 FROM shadow_market_observations
                 WHERE fbis_event_id IN (${placeholders})
                   AND COALESCE(decision_eligible, 0) = 0
                   AND COALESCE(can_qualify, 0) = 0
                   AND COALESCE(can_authorize_wager, 0) = 0
                 ORDER BY COALESCE(collected_at, created_at) DESC`;
    try {
      const res = await db.prepare(sql).bind(...chunk).all();
      const pending = [];
      const obsIds = [];
      for (const row of res?.results || []) {
        const eid = String(row.fbis_event_id || "");
        if (!eid || map.has(eid)) continue;
        pending.push(row);
        if (row.id) obsIds.push(row.id);
      }
      const booksByObs = new Map();
      if (obsIds.length) {
        try {
          const bPlace = obsIds.map(() => "?").join(",");
          const bSql = `SELECT observation_id, book, spread_home, spread_home_odds, total, over_odds
                        FROM shadow_market_books
                        WHERE observation_id IN (${bPlace})`;
          const bRes = await db.prepare(bSql).bind(...obsIds).all();
          for (const b of bRes?.results || []) {
            const list = booksByObs.get(b.observation_id) || [];
            list.push({
              sportsbook: b.book,
              book: b.book,
              line:
                b.spread_home != null
                  ? Number(b.spread_home)
                  : b.total != null
                    ? Number(b.total)
                    : null,
              point: b.spread_home != null ? Number(b.spread_home) : null,
              americanPrice:
                b.spread_home_odds != null
                  ? Number(b.spread_home_odds)
                  : b.over_odds != null
                    ? Number(b.over_odds)
                    : null,
              price:
                b.spread_home_odds != null
                  ? Number(b.spread_home_odds)
                  : b.over_odds != null
                    ? Number(b.over_odds)
                    : null,
            });
            booksByObs.set(b.observation_id, list);
          }
        } catch {
          // fail-open: board still builds without book matrix
        }
      }
      for (const row of pending) {
        const eid = String(row.fbis_event_id || "");
        if (!eid || map.has(eid)) continue;
        const books = booksByObs.get(row.id) || [];
        const intel = buildBoardActionIntel({ ...row, books });
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
      providerSharpSignal: intel.providerSharpSignal ?? null,
      providerSteamSignal: intel.providerSteamSignal ?? null,
      sampleQuality: intel.sampleQuality ?? null,
      marketRegime: intel.marketRegime ?? null,
    };
    return {
      ...g,
      actionIntel: intel,
      sentiment: existingSentiment || sentimentFromAction,
      publicSplits: g.publicSplits || intel.publicSplits,
    };
  });
  return { games: out, attached, checked: ids.length, matchedIds: [...byId.keys()] };
}
