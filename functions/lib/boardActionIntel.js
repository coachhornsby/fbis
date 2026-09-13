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

  const ticketPct = pickPct(
    publicBetting?.spreadHome?.ticketsPercent,
    publicBetting?.spreadHome?.ticketPct,
    publicBetting?.spread?.ticketsPercent,
    research.ticketsPct
  );
  const moneyPct = pickPct(
    publicBetting?.spreadHome?.moneyPercent,
    publicBetting?.spreadHome?.moneyPct,
    publicBetting?.spread?.moneyPercent,
    research.moneyPct
  );
  const moneyTicketGap =
    ticketPct != null && moneyPct != null ? Math.round((moneyPct - ticketPct) * 10) / 10 : null;

  const openSpread =
    num(lineMovement.openSpreadHome) ??
    num(lineMovement.openingSpreadHome) ??
    num(lineMovement.open?.spreadHome) ??
    num(research.openingLine);
  const currentSpread = spreadHome ?? num(lineMovement.currentSpreadHome) ?? num(research.observedLine);
  const movementMagnitude =
    openSpread != null && currentSpread != null ? Math.round((currentSpread - openSpread) * 10) / 10 : null;

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
      // Never invent "sharp" — divergence is research context only.
      sharpLabel: null,
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
 * Load newest matched ACTION observations for a set of FBIS event ids.
 * @returns {Promise<Map<string, object>>} eventId → actionIntel
 */
export async function loadBoardActionIntelByEventIds(db, eventIds = []) {
  const map = new Map();
  if (!db?.prepare) return map;
  const ids = [...new Set((eventIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return map;

  // Chunk to stay under D1 bind limits.
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
      // Table missing or schema lag — fail open.
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
      openingLine: intel.movement?.openingLine ?? null,
      currentLine: intel.movement?.currentLine ?? null,
      magnitude: intel.movement?.movementMagnitude ?? null,
      bestBook: intel.movement?.bestBook ?? null,
      collectedAt: intel.collectedAt,
    };
    return {
      ...g,
      actionIntel: intel,
      // Prefer existing non-ACTION sentiment; otherwise expose ACTION splits for movers UI.
      sentiment: existingSentiment || sentimentFromAction,
      publicSplits: g.publicSplits || intel.publicSplits,
    };
  });
  return { games: out, attached, checked: ids.length, matchedIds: [...byId.keys()] };
}
