/**
 * Compact latest-market-state upserts for bounded D1 hot storage.
 * Does not authorize wagers. Does not replace the immutable observation ledger.
 */
import {
  latestMarketStateKey,
  shouldPersistWsTickToD1,
  WS_TICK_COALESCE_MS,
} from "./marketHistoryCapacity.js";

export const LATEST_MARKET_STATE_DDL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS latest_market_state (
  state_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  sport TEXT NOT NULL,
  canonical_event_id TEXT,
  market_family TEXT NOT NULL,
  side TEXT,
  line REAL,
  source_market_id TEXT,
  source_outcome_id TEXT,
  contract_price REAL,
  decimal_odds REAL,
  american_odds REAL,
  source_observed_at TEXT,
  collected_at TEXT NOT NULL,
  snapshot_type TEXT NOT NULL DEFAULT 'CURRENT',
  raw_payload_json TEXT,
  observation_id TEXT,
  updated_at TEXT NOT NULL,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE INDEX IF NOT EXISTS idx_latest_market_event
  ON latest_market_state(sport, canonical_event_id, market_family, collected_at)`,
  `CREATE INDEX IF NOT EXISTS idx_latest_market_updated
  ON latest_market_state(updated_at)`,
]);

export async function ensureLatestMarketStateSchema(db) {
  if (!db?.prepare) return { ok: false, reason: "database-unavailable" };
  try {
    const existing = await db.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='latest_market_state' LIMIT 1"
    ).first();
    if (existing?.ok === 1 || existing?.ok === true || Number(existing?.ok) === 1) {
      return { ok: true, skipped: true };
    }
  } catch {
    /* fall through to create */
  }
  for (const sql of LATEST_MARKET_STATE_DDL) {
    const st = db.prepare(sql);
    if (typeof st.run === "function") await st.run();
    else if (typeof st.bind === "function") await st.bind().run();
  }
  return { ok: true, skipped: false };
}

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function offerToLatestStateRow(offer, {
  collectedAt = new Date().toISOString(),
  observationId = null,
  snapshotType = "CURRENT",
} = {}) {
  const source = offer.source || "Polymarket US WebSocket";
  const sport = String(offer.sport || "").toLowerCase();
  const marketFamily = offer.marketFamily || offer.market_family || "unknown";
  const row = {
    source,
    sport,
    canonical_event_id: offer.eventId || offer.canonical_event_id || null,
    market_family: marketFamily,
    side: offer.side || null,
    line: finite(offer.line),
    source_market_id: offer.sourceMarketId || offer.source_market_id || null,
    source_outcome_id: offer.sourceOutcomeId || offer.source_outcome_id || null,
    contract_price: finite(offer.contractPrice ?? offer.contract_price),
    decimal_odds: finite(offer.decimalOdds ?? offer.decimal_odds),
    american_odds: finite(offer.americanOdds ?? offer.american_odds),
    source_observed_at: offer.sourceObservedAt || offer.source_observed_at || collectedAt,
    collected_at: collectedAt,
    snapshot_type: snapshotType,
    raw_payload_json: typeof offer.raw === "string" ? offer.raw : JSON.stringify(offer.raw ?? offer),
    observation_id: observationId,
    updated_at: collectedAt,
    can_qualify: 0,
    can_authorize_wager: 0,
  };
  row.state_key = latestMarketStateKey(row);
  return row;
}

export async function upsertLatestMarketStates(db, offers = [], opts = {}) {
  if (!db?.prepare) return { ok: false, upserted: 0, reason: "database-unavailable" };
  const schema = await ensureLatestMarketStateSchema(db);
  if (!schema.ok) return { ok: false, upserted: 0, reason: schema.reason || "schema-unavailable" };
  const collectedAt = opts.collectedAt || new Date().toISOString();
  let upserted = 0;
  for (const offer of offers) {
    const row = offerToLatestStateRow(offer, {
      collectedAt,
      observationId: opts.observationId || null,
      snapshotType: opts.snapshotType || "CURRENT",
    });
    await db.prepare(
      `INSERT INTO latest_market_state(
        state_key, source, sport, canonical_event_id, market_family, side, line,
        source_market_id, source_outcome_id, contract_price, decimal_odds, american_odds,
        source_observed_at, collected_at, snapshot_type, raw_payload_json, observation_id,
        updated_at, can_qualify, can_authorize_wager
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)
      ON CONFLICT(state_key) DO UPDATE SET
        contract_price=excluded.contract_price,
        decimal_odds=excluded.decimal_odds,
        american_odds=excluded.american_odds,
        source_observed_at=excluded.source_observed_at,
        collected_at=excluded.collected_at,
        snapshot_type=excluded.snapshot_type,
        raw_payload_json=excluded.raw_payload_json,
        observation_id=excluded.observation_id,
        updated_at=excluded.updated_at`
    ).bind(
      row.state_key,
      row.source,
      row.sport,
      row.canonical_event_id,
      row.market_family,
      row.side,
      row.line,
      row.source_market_id,
      row.source_outcome_id,
      row.contract_price,
      row.decimal_odds,
      row.american_odds,
      row.source_observed_at,
      row.collected_at,
      row.snapshot_type,
      row.raw_payload_json,
      row.observation_id,
      row.updated_at,
    ).run();
    upserted += 1;
  }
  return { ok: true, upserted, schema };
}

/**
 * Filter offers for D1 ledger insert using in-memory last-saved map (slug → tick).
 * Always returns the full set for latest-state upserts.
 */
export function coalesceOffersForLedger(offers = [], lastByKey = new Map(), {
  nowMs = Date.now(),
  coalesceMs = WS_TICK_COALESCE_MS,
} = {}) {
  const ledger = [];
  const skipped = [];
  for (const offer of offers) {
    const key = latestMarketStateKey({
      source: offer.source || "Polymarket US WebSocket",
      sport: offer.sport,
      canonical_event_id: offer.eventId || offer.canonical_event_id,
      market_family: offer.marketFamily || offer.market_family,
      side: offer.side,
      line: offer.line,
      source_market_id: offer.sourceMarketId || offer.source_market_id,
      source_outcome_id: offer.sourceOutcomeId || offer.source_outcome_id,
    });
    const previous = lastByKey.get(key) || null;
    const decision = shouldPersistWsTickToD1({
      previous,
      next: {
        contract_price: offer.contractPrice ?? offer.contract_price,
        collected_at: offer.collectedAt || new Date(nowMs).toISOString(),
      },
      nowMs,
      coalesceMs,
    });
    if (decision.persist) {
      ledger.push(offer);
      lastByKey.set(key, {
        contract_price: offer.contractPrice ?? offer.contract_price,
        collected_at: new Date(nowMs).toISOString(),
      });
    } else {
      skipped.push({ key, reason: decision.reason });
    }
  }
  return { ledgerOffers: ledger, skipped, lastByKey };
}
