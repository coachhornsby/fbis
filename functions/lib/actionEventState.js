/**
 * Durable ACTION event-state reader for the FBIS board.
 *
 * Read hierarchy (lower tiers never overwrite higher tiers):
 *   1. canonical ACTION durable observations (action_market_book_observations)
 *   2. canonical snapshot pointers (action_market_snapshot_pointers)
 *   3. durable identity links (action_event_identity_links)
 *   4. legacy shadow_market_observations fallback (boardActionIntel)
 *   5. no ACTION data → null (never fabricate 0% splits)
 *
 * ACTION remains market_intelligence only. Firewalls always stay false.
 */

import { actionPolicyFlags, normalizeActionSport } from "./actionMarketIntelligence.js";
import { MATCH_CONFIDENCE } from "./actionApifyCandidateConfig.js";

/** Local snapshot/firewall helpers so this module stays browser-safe. */
const ACTION_SNAPSHOT_TYPE = Object.freeze({
  OPEN: "OPEN",
  CURRENT: "CURRENT",
  DECISION: "DECISION",
  FINAL_PREGAME: "FINAL_PREGAME",
  CLOSE: "CLOSE",
  UNKNOWN: "UNKNOWN",
});

const ACTION_FIREWALL = Object.freeze({
  inProductionRouter: false,
  decisionEligible: false,
  canQualify: false,
  canAuthorizeWager: false,
  pureGameFeatureAllowed: false,
  purePlayerFeatureAllowed: false,
});

function selectSeriesSnapshot(observations, snapshotType) {
  const wanted = String(snapshotType || "").toUpperCase();
  const rows = (observations || []).filter(
    (o) => String(o.snapshotType || o.snapshot_type) === wanted
  );
  if (!rows.length) return null;
  const sorted = rows
    .slice()
    .sort((a, b) =>
      String(a.collectedAt || a.collected_at).localeCompare(String(b.collectedAt || b.collected_at))
    );
  return wanted === ACTION_SNAPSHOT_TYPE.OPEN ? sorted[0] : sorted[sorted.length - 1];
}

/** Deterministic non-crypto id hash (identity links only — not auth material). */
function fingerprintHex(input) {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  const s = String(input || "");
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).repeat(3).slice(0, 40);
}

export const ACTION_BOARD_SOURCE = Object.freeze({
  DURABLE_SERIES: "durable-series",
  IDENTITY_LINK: "durable-identity-link",
  LEGACY_SHADOW: "legacy-shadow",
  NONE: "none",
});

const PERSISTABLE_CONFIDENCE = new Set([
  MATCH_CONFIDENCE.EXACT,
  MATCH_CONFIDENCE.HIGH,
]);

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function tsOf(row) {
  return (
    strOrNull(row?.provider_timestamp) ||
    strOrNull(row?.providerTimestamp) ||
    strOrNull(row?.collected_at) ||
    strOrNull(row?.collectedAt) ||
    strOrNull(row?.created_at) ||
    strOrNull(row?.createdAt) ||
    ""
  );
}

function sortByTimeAsc(rows) {
  return [...(rows || [])].sort((a, b) => tsOf(a).localeCompare(tsOf(b)));
}

function marketFamily(marketType) {
  const m = String(marketType || "").toLowerCase();
  if (m.includes("spread") || m === "rl" || m === "run_line" || m === "puck_line") return "spread";
  if (m.includes("total") || m.includes("over_under") || m === "ou") return "total";
  if (m.includes("money") || m === "ml" || m === "h2h") return "moneyline";
  return m || "unknown";
}

function isHomeish(selection) {
  const s = String(selection || "").toLowerCase();
  return s === "home" || s === "h" || s.includes("home");
}

function isAwayish(selection) {
  const s = String(selection || "").toLowerCase();
  return s === "away" || s === "a" || s.includes("away");
}

function isOverish(selection) {
  const s = String(selection || "").toLowerCase();
  return s === "over" || s === "o";
}

/** Build board-safe publicSplits. Missing ticket/money stay null — never coerce to 0. */
export function buildPublicSplitsFromObservations(rows = []) {
  const sorted = sortByTimeAsc(rows);
  const latestByMarket = new Map();
  for (const row of sorted) {
    const family = marketFamily(row.market_type || row.marketType);
    const sel = String(row.selection || "").toLowerCase();
    const anchor =
      family === "total"
        ? isOverish(sel)
        : family === "spread" || family === "moneyline"
          ? isHomeish(sel)
          : true;
    if (!anchor && latestByMarket.has(family)) continue;
    const ticketPct = numOrNull(row.public_ticket_pct ?? row.publicTicketPct);
    const moneyPct = numOrNull(row.public_money_pct ?? row.publicMoneyPct);
    if (ticketPct == null && moneyPct == null) continue;
    const moneyTicketGap =
      ticketPct != null && moneyPct != null
        ? Math.round((moneyPct - ticketPct) * 10) / 10
        : numOrNull(row.money_minus_ticket_pct ?? row.moneyMinusTicketPct);
    latestByMarket.set(family, {
      market:
        family === "spread"
          ? "RL"
          : family === "moneyline"
            ? "ML"
            : family === "total"
              ? "TOTAL"
              : family.toUpperCase(),
      ticketPct,
      moneyPct,
      moneyTicketGap,
      magnitude: moneyTicketGap == null ? null : Math.abs(moneyTicketGap),
      leanSide:
        moneyTicketGap == null || moneyTicketGap === 0
          ? null
          : moneyTicketGap > 0
            ? family === "total"
              ? "OVER"
              : "HOME"
            : family === "total"
              ? "UNDER"
              : "AWAY",
      sharpLabel: null,
    });
  }
  const markets = [...latestByMarket.values()];
  const primary =
    markets.find((m) => m.market === "RL") ||
    markets.slice().sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0))[0] ||
    null;
  return {
    ticketPct: primary?.ticketPct ?? null,
    moneyPct: primary?.moneyPct ?? null,
    moneyTicketGap: primary?.moneyTicketGap ?? null,
    sharpLabel: null,
    primaryMarket: primary?.market ?? null,
    markets,
  };
}

export function buildConsensusFromObservations(rows = []) {
  const sorted = sortByTimeAsc(rows);
  let spreadHome = null;
  let total = null;
  let mlHome = null;
  let mlAway = null;
  for (const row of sorted) {
    const family = marketFamily(row.market_type || row.marketType);
    const line = numOrNull(row.line);
    const price = numOrNull(row.american_price ?? row.americanPrice);
    const sel = row.selection;
    if (family === "spread" && isHomeish(sel) && line != null) spreadHome = line;
    if (family === "total" && isOverish(sel) && line != null) total = line;
    if (family === "moneyline" && isHomeish(sel) && price != null) mlHome = price;
    if (family === "moneyline" && isAwayish(sel) && price != null) mlAway = price;
  }
  return { spreadHome, total, mlHome, mlAway };
}

export function buildLineHistoryFromObservations(rows = []) {
  const gameRows = (rows || []).filter((r) => {
    const family = marketFamily(r.market_type || r.marketType);
    return family === "spread" || family === "moneyline" || family === "total";
  });
  return sortByTimeAsc(gameRows).map((r) => ({
    sportsbook: strOrNull(r.sportsbook),
    market: marketFamily(r.market_type || r.marketType),
    selection: strOrNull(r.selection),
    line: numOrNull(r.line),
    americanPrice: numOrNull(r.american_price ?? r.americanPrice),
    snapshotType: strOrNull(r.snapshot_type ?? r.snapshotType),
    providerTimestamp: strOrNull(r.provider_timestamp ?? r.providerTimestamp),
    collectedAt: strOrNull(r.collected_at ?? r.collectedAt),
  }));
}

export function buildBooksFromObservations(rows = []) {
  const byBook = new Map();
  for (const r of sortByTimeAsc(rows)) {
    const book = strOrNull(r.sportsbook);
    if (!book) continue;
    const prev = byBook.get(book) || { sportsbook: book, markets: {} };
    const family = marketFamily(r.market_type || r.marketType);
    prev.markets[family] = {
      selection: strOrNull(r.selection),
      line: numOrNull(r.line),
      americanPrice: numOrNull(r.american_price ?? r.americanPrice),
      collectedAt: strOrNull(r.collected_at ?? r.collectedAt),
    };
    byBook.set(book, prev);
  }
  return [...byBook.values()];
}

function slimSnapshot(row, type) {
  if (!row) return null;
  return {
    snapshotType: String(type || row.snapshot_type || row.snapshotType || "").toUpperCase() || null,
    observationId: row.id || null,
    sportsbook: strOrNull(row.sportsbook),
    market: marketFamily(row.market_type || row.marketType),
    selection: strOrNull(row.selection),
    line: numOrNull(row.line),
    americanPrice: numOrNull(row.american_price ?? row.americanPrice),
    ticketPct: numOrNull(row.public_ticket_pct ?? row.publicTicketPct),
    moneyPct: numOrNull(row.public_money_pct ?? row.publicMoneyPct),
    providerTimestamp: strOrNull(row.provider_timestamp ?? row.providerTimestamp),
    collectedAt: strOrNull(row.collected_at ?? row.collectedAt),
  };
}

function pickSnapshots(rows, pointersByType) {
  const out = {
    open: null,
    current: null,
    decision: null,
    finalPregame: null,
    close: null,
  };
  const wanted = [
    [ACTION_SNAPSHOT_TYPE.OPEN, "open"],
    [ACTION_SNAPSHOT_TYPE.CURRENT, "current"],
    [ACTION_SNAPSHOT_TYPE.DECISION, "decision"],
    [ACTION_SNAPSHOT_TYPE.FINAL_PREGAME, "finalPregame"],
    [ACTION_SNAPSHOT_TYPE.CLOSE, "close"],
  ];
  for (const [snapType, key] of wanted) {
    const ptr = pointersByType.get(snapType);
    if (ptr) {
      const obs =
        rows.find((r) => String(r.id) === String(ptr.observation_id || ptr.observationId)) || null;
      if (obs) {
        out[key] = slimSnapshot(obs, snapType);
        continue;
      }
    }
    // Derive from immutable series only when labeled rows exist.
    // Never invent CLOSE / FINAL_PREGAME / DECISION.
    const derived = selectSeriesSnapshot(rows, snapType);
    if (derived) out[key] = slimSnapshot(derived, snapType);
  }
  if (!out.open && rows.length) {
    out.open = slimSnapshot(sortByTimeAsc(rows)[0], ACTION_SNAPSHOT_TYPE.OPEN);
  }
  if (!out.current && rows.length) {
    out.current = slimSnapshot(sortByTimeAsc(rows).at(-1), ACTION_SNAPSHOT_TYPE.CURRENT);
  }
  return out;
}

function movementFromSnapshots(snapshots, consensus) {
  const openingLine =
    snapshots.open?.market === "spread" ? snapshots.open.line : snapshots.open?.line ?? null;
  const currentLine =
    snapshots.current?.market === "spread"
      ? snapshots.current.line
      : snapshots.current?.line ?? consensus.spreadHome ?? null;
  const movementMagnitude =
    openingLine != null && currentLine != null
      ? Math.round((currentLine - openingLine) * 10) / 10
      : null;
  return {
    openingLine,
    currentLine,
    movementMagnitude,
    bestBook: snapshots.current?.sportsbook || null,
  };
}

/**
 * Assemble one board-safe ACTION state object for a canonical FBIS event.
 */
export function buildDurableActionEventState({
  eventId,
  sport = null,
  observations = [],
  pointers = [],
  source = ACTION_BOARD_SOURCE.DURABLE_SERIES,
  matchConfidence = null,
} = {}) {
  if (!observations.length) return null;
  const pointersByType = new Map();
  for (const p of pointers || []) {
    const t = String(p.snapshot_type || p.snapshotType || "").toUpperCase();
    if (!t) continue;
    const prev = pointersByType.get(t);
    if (
      !prev ||
      String(p.derived_at || p.derivedAt || "") >= String(prev.derived_at || prev.derivedAt || "")
    ) {
      pointersByType.set(t, p);
    }
  }
  const consensus = buildConsensusFromObservations(observations);
  const publicSplits = buildPublicSplitsFromObservations(observations);
  const snapshots = pickSnapshots(observations, pointersByType);
  const lineHistory = buildLineHistoryFromObservations(observations);
  const books = buildBooksFromObservations(observations);
  const newest = sortByTimeAsc(observations).at(-1);
  const collectedAt = strOrNull(newest?.collected_at ?? newest?.collectedAt);
  const observedAt =
    strOrNull(newest?.provider_timestamp ?? newest?.providerTimestamp) || collectedAt;

  return {
    provider: "ACTION_APIFY",
    role: "market_intelligence",
    governanceMode: "shadow",
    displayOnly: true,
    source,
    eventId: eventId || null,
    sport: normalizeActionSport(sport || newest?.sport),
    matchConfidence:
      matchConfidence || strOrNull(newest?.match_confidence ?? newest?.matchConfidence),
    collectedAt,
    observedAt,
    consensus,
    publicSplits,
    movement: movementFromSnapshots(snapshots, consensus),
    snapshots,
    lineHistory,
    books,
    bestOdds: null,
    historyAvailable: lineHistory.length > 0,
    booksCount: books.length,
    ...actionPolicyFlags(),
    ...ACTION_FIREWALL,
  };
}

async function queryAll(db, sql, binds = []) {
  if (!db?.prepare) return [];
  try {
    const res = await db.prepare(sql).bind(...binds).all();
    return res?.results || res?.rows || [];
  } catch {
    return [];
  }
}

/**
 * Load durable ACTION board state for one or more canonical FBIS event ids.
 * @returns {Promise<Map<string, object>>}
 */
export async function loadDurableActionEventStates(db, eventIds = []) {
  const map = new Map();
  if (!db?.prepare) return map;
  const ids = [...new Set((eventIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return map;

  const chunkSize = 40;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const ph = chunk.map(() => "?").join(",");

    const linkRows = await queryAll(
      db,
      `SELECT provider_event_id, sport, canonical_event_id, match_confidence
       FROM action_event_identity_links
       WHERE canonical_event_id IN (${ph})`,
      chunk
    );
    const providerIds = [
      ...new Set(linkRows.map((r) => strOrNull(r.provider_event_id)).filter(Boolean)),
    ];

    const obsBinds = providerIds.length ? [...chunk, ...providerIds] : [...chunk];
    const providerClause = providerIds.length
      ? `OR provider_event_id IN (${providerIds.map(() => "?").join(",")})`
      : "";
    const observations = await queryAll(
      db,
      `SELECT *
       FROM action_market_book_observations
       WHERE (
         canonical_event_id IN (${ph})
         ${providerClause}
       )
         AND COALESCE(decision_eligible, 0) = 0
         AND COALESCE(can_qualify, 0) = 0
         AND COALESCE(can_authorize_wager, 0) = 0
       ORDER BY COALESCE(provider_timestamp, collected_at, created_at) ASC`,
      obsBinds
    );
    if (!observations.length) continue;

    const pointers = await queryAll(
      db,
      `SELECT *
       FROM action_market_snapshot_pointers
       WHERE canonical_event_id IN (${ph})
          ${providerClause}`,
      obsBinds
    );

    const byEvent = new Map();
    for (const row of observations) {
      let eid = strOrNull(row.canonical_event_id);
      if (!eid) {
        const link = linkRows.find(
          (l) =>
            String(l.provider_event_id) === String(row.provider_event_id) &&
            (!l.sport ||
              !row.sport ||
              String(l.sport).toLowerCase() === String(row.sport).toLowerCase())
        );
        eid = link ? strOrNull(link.canonical_event_id) : null;
      }
      if (!eid || !chunk.includes(eid)) continue;
      if (!byEvent.has(eid)) byEvent.set(eid, []);
      byEvent.get(eid).push(row);
    }

    const ptrsByEvent = new Map();
    for (const p of pointers) {
      let eid = strOrNull(p.canonical_event_id);
      if (!eid) {
        const link = linkRows.find(
          (l) => String(l.provider_event_id) === String(p.provider_event_id)
        );
        eid = link ? strOrNull(link.canonical_event_id) : null;
      }
      if (!eid) continue;
      if (!ptrsByEvent.has(eid)) ptrsByEvent.set(eid, []);
      ptrsByEvent.get(eid).push(p);
    }

    for (const eid of chunk) {
      if (map.has(eid)) continue;
      const rows = byEvent.get(eid) || [];
      if (!rows.length) continue;
      const link = linkRows.find((l) => String(l.canonical_event_id) === eid);
      const state = buildDurableActionEventState({
        eventId: eid,
        sport: rows[0]?.sport,
        observations: rows,
        pointers: ptrsByEvent.get(eid) || [],
        source: link ? ACTION_BOARD_SOURCE.IDENTITY_LINK : ACTION_BOARD_SOURCE.DURABLE_SERIES,
        matchConfidence: link?.match_confidence || null,
      });
      if (state) map.set(eid, state);
    }
  }
  return map;
}

export function isPersistableActionMatchConfidence(confidence) {
  return PERSISTABLE_CONFIDENCE.has(String(confidence || "").toUpperCase());
}

export function actionIdentityLinkId({ provider = "ACTION_APIFY", providerEventId, sport }) {
  return fingerprintHex(
      ["action_identity_v1", provider, providerEventId, normalizeActionSport(sport)].join("|")
    );
}

/**
 * Persist a durable provider→canonical identity link (idempotent upsert).
 * Does not rewrite immutable observation market values.
 */
export async function persistActionEventIdentityLink(
  db,
  {
    provider = "ACTION_APIFY",
    providerEventId,
    sport,
    canonicalEventId,
    matchConfidence,
    matchReason = null,
    sourceObservationId = null,
    linkedAt = new Date().toISOString(),
  } = {}
) {
  if (!db?.prepare) return { ok: false, reason: "no-db" };
  if (!providerEventId || !canonicalEventId || !sport) {
    return { ok: false, reason: "incomplete-identity" };
  }
  if (!isPersistableActionMatchConfidence(matchConfidence)) {
    return { ok: false, reason: "confidence-not-persistable", matchConfidence };
  }
  const id = actionIdentityLinkId({ provider, providerEventId, sport });
  try {
    await db
      .prepare(
        `INSERT INTO action_event_identity_links (
           id, provider, provider_event_id, sport, canonical_event_id,
           match_confidence, match_reason, source_observation_id, linked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, provider_event_id, sport) DO UPDATE SET
           canonical_event_id = excluded.canonical_event_id,
           match_confidence = excluded.match_confidence,
           match_reason = excluded.match_reason,
           source_observation_id = COALESCE(excluded.source_observation_id, action_event_identity_links.source_observation_id),
           linked_at = excluded.linked_at`
      )
      .bind(
        id,
        provider,
        String(providerEventId),
        normalizeActionSport(sport),
        String(canonicalEventId),
        String(matchConfidence).toUpperCase(),
        matchReason,
        sourceObservationId,
        linkedAt
      )
      .run();
    return { ok: true, id, persisted: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}
