/**
 * ACTION immutable observation time series.
 *
 * Append-only individual book + player-prop observations.
 * Snapshot types OPEN / CURRENT / DECISION / FINAL_PREGAME / CLOSE are derived
 * from the series (pointers may advance; observation rows are never rewritten).
 *
 * Ticket % and money % are preserved independently.
 * money−ticket is derived locally — never promoted to an assumed "sharp" label.
 *
 * Hard firewalls (always false for ACTION):
 *  1) PURE game features
 *  2) PURE player features
 *  3) direct wager qualification
 *  4) wager authorization
 */

import { createHash } from "node:crypto";
import {
  ACTION_APIFY_PROVIDER,
  ACTION_APIFY_SCHEMA_VERSION,
} from "./actionApifyShadow.js";
import { ODDS_PROVIDER_ORDER } from "./oddsProviderRouter.js";

export const ACTION_SERIES_SCHEMA_VERSION = "action-observation-series-v1";

export const ACTION_SNAPSHOT_TYPE = Object.freeze({
  OPEN: "OPEN",
  CURRENT: "CURRENT",
  DECISION: "DECISION",
  FINAL_PREGAME: "FINAL_PREGAME",
  CLOSE: "CLOSE",
  UNKNOWN: "UNKNOWN",
});

export const ACTION_FIREWALL = Object.freeze({
  inProductionRouter: false,
  decisionEligible: false,
  canQualify: false,
  canAuthorizeWager: false,
  pureGameFeatureAllowed: false,
  purePlayerFeatureAllowed: false,
});

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stableHash(parts) {
  return createHash("sha256")
    .update(parts.map((p) => String(p ?? "")).join("|"))
    .digest("hex")
    .slice(0, 40);
}

/**
 * Player-prop identity: event + player + market + period + selection + book + observation time.
 * Game markets omit player (empty) but keep the same collision rules.
 */
export function buildActionObservationKey({
  providerEventId,
  canonicalEventId = null,
  providerPlayerId = null,
  canonicalPlayerId = null,
  marketType,
  marketPeriod = "event",
  selection,
  sportsbook,
  providerTimestamp = null,
  collectedAt,
} = {}) {
  const eventPart = canonicalEventId || providerEventId;
  const playerPart = canonicalPlayerId || providerPlayerId || "";
  const observedAt = providerTimestamp || collectedAt;
  if (!eventPart || !marketType || !selection || !sportsbook || !observedAt) {
    throw new Error("action_observation_key_incomplete");
  }
  return stableHash([
    "action_obs_v1",
    eventPart,
    playerPart,
    String(marketType).toLowerCase(),
    String(marketPeriod || "event").toLowerCase(),
    String(selection).toLowerCase(),
    String(sportsbook).toLowerCase(),
    observedAt,
  ]);
}

/**
 * Preserve ticket % and money % independently. Derive differential ourselves.
 * Never promote provider "sharp" metadata into an FBIS label.
 */
export function derivePublicSplitMetrics({
  publicTicketPct = null,
  publicMoneyPct = null,
  trackedBetCount = null,
  trackedVolume = null,
  providerSharpLabel = null,
} = {}) {
  const ticket = numOrNull(publicTicketPct);
  const money = numOrNull(publicMoneyPct);
  return {
    publicTicketPct: ticket,
    publicMoneyPct: money,
    moneyMinusTicketPct:
      ticket != null && money != null ? Number((money - ticket).toFixed(6)) : null,
    trackedBetCount: numOrNull(trackedBetCount),
    trackedVolume: numOrNull(trackedVolume),
    providerSharpLabelIgnored:
      providerSharpLabel == null ? null : String(providerSharpLabel),
    sharpLabelApplied: false,
  };
}

/**
 * Classify snapshot type from collection context + event timing.
 * Labels are derived; prior observations are never mutated to "update" them.
 */
export function deriveActionSnapshotType({
  lifecycle = null,
  temporalClass = null,
  explicit = null,
  eventStartTime = null,
  collectedAt = null,
  isFirstForMarket = false,
} = {}) {
  const e = String(explicit || "").toUpperCase();
  if (Object.values(ACTION_SNAPSHOT_TYPE).includes(e) && e !== ACTION_SNAPSHOT_TYPE.UNKNOWN) {
    return e;
  }
  const life = String(lifecycle || temporalClass || "").toLowerCase();
  if (life.includes("open") || life === "opening") return ACTION_SNAPSHOT_TYPE.OPEN;
  if (life.includes("decision") || life.includes("model_time") || life.includes("publication")) {
    return ACTION_SNAPSHOT_TYPE.DECISION;
  }
  if (life.includes("final_pregame") || life.includes("final-pregame") || life === "final") {
    return ACTION_SNAPSHOT_TYPE.FINAL_PREGAME;
  }
  if (life.includes("close") || life.includes("closing") || life === "evaluation_close") {
    return ACTION_SNAPSHOT_TYPE.CLOSE;
  }
  if (isFirstForMarket) return ACTION_SNAPSHOT_TYPE.OPEN;

  if (eventStartTime && collectedAt) {
    const start = Date.parse(eventStartTime);
    const collected = Date.parse(collectedAt);
    if (Number.isFinite(start) && Number.isFinite(collected)) {
      const mins = (start - collected) / 60000;
      if (mins <= 15 && mins >= -5) return ACTION_SNAPSHOT_TYPE.FINAL_PREGAME;
      if (mins < -5) return ACTION_SNAPSHOT_TYPE.CLOSE;
    }
  }
  return ACTION_SNAPSHOT_TYPE.CURRENT;
}

export function assertActionFirewall(context = {}) {
  const providerOrder = context.oddsProviderOrder || ODDS_PROVIDER_ORDER || [];
  const inRouter = providerOrder.map(String).some((p) => /action/i.test(p));
  const violations = [];
  if (inRouter) violations.push("in_production_router");
  if (context.pureGameFeature === true) violations.push("pure_game_feature");
  if (context.purePlayerFeature === true) violations.push("pure_player_feature");
  if (context.canQualify === true) violations.push("can_qualify");
  if (context.canAuthorizeWager === true) violations.push("can_authorize_wager");
  if (context.decisionEligible === true) violations.push("decision_eligible");
  return {
    ok: violations.length === 0,
    violations,
    ...ACTION_FIREWALL,
  };
}

export function actionMayEnterPureGameFeatures() {
  return false;
}

export function actionMayEnterPurePlayerFeatures() {
  return false;
}

export function actionMayDirectlyQualifyWager() {
  return false;
}

export function actionMayAuthorizeWager() {
  return false;
}

function normalizePublicMaps(pb = {}) {
  const out = {};
  const pairs = [
    ["spread", "home", pb.spreadHome],
    ["spread", "away", pb.spreadAway],
    ["moneyline", "home", pb.moneylineHome],
    ["moneyline", "away", pb.moneylineAway],
    ["total", "over", pb.over || pb.totalOver],
    ["total", "under", pb.under || pb.totalUnder],
  ];
  for (const [market, side, node] of pairs) {
    if (!node) continue;
    out[`${market}:${side}`] = node;
  }
  return out;
}

/**
 * Expand a game-level ACTION row + books into immutable per-book observation records.
 */
export function expandBookObservations(row, ctx = {}) {
  const collectedAt = ctx.collectedAt || new Date().toISOString();
  const providerEventId = String(row.actionGameId || row.gameId || row.providerEventId || "");
  const canonicalEventId = ctx.canonicalEventId || row.fbisEventId || null;
  const sport = String(ctx.sport || row.sport || "unknown").toLowerCase();
  const period = String(row.period || "event");
  const eventStartTime = row.startTime || row.eventStartTime || null;
  const matchConfidence = ctx.matchConfidence || row.matchConfidence || null;
  const schemaVersion = ctx.schemaVersion || ACTION_SERIES_SCHEMA_VERSION;
  const runId = ctx.runId || null;
  const sourceObservationId = ctx.sourceObservationId || null;
  const snapshotType = deriveActionSnapshotType({
    lifecycle: ctx.lifecycle,
    temporalClass: row.temporalClass || ctx.temporalClass,
    explicit: ctx.snapshotType,
    eventStartTime,
    collectedAt,
    isFirstForMarket: Boolean(ctx.isFirstForMarket),
  });
  const publicByMarket = normalizePublicMaps(row.publicBetting || {});
  const out = [];

  for (const book of row.books || []) {
    if (!book?.book) continue;
    const sportsbook = String(book.book);
    const periodBook = String(book.period || period);
    const candidates = [
      {
        marketType: "spread",
        selection: "home",
        line: numOrNull(book.spreadHome),
        americanPrice: numOrNull(book.spreadHomeOdds),
      },
      {
        marketType: "spread",
        selection: "away",
        line: numOrNull(book.spreadAway),
        americanPrice: numOrNull(book.spreadAwayOdds),
      },
      {
        marketType: "moneyline",
        selection: "home",
        line: null,
        americanPrice: numOrNull(book.moneylineHome),
      },
      {
        marketType: "moneyline",
        selection: "away",
        line: null,
        americanPrice: numOrNull(book.moneylineAway),
      },
      {
        marketType: "total",
        selection: "over",
        line: numOrNull(book.total),
        americanPrice: numOrNull(book.overOdds),
      },
      {
        marketType: "total",
        selection: "under",
        line: numOrNull(book.total),
        americanPrice: numOrNull(book.underOdds),
      },
    ];

    for (const c of candidates) {
      if (c.line == null && c.americanPrice == null) continue;
      const providerTimestamp = book.observedAt || row.observedAt || row.sourceObservedAt || null;
      const split = publicByMarket[`${c.marketType}:${c.selection}`] || {};
      const publicMetrics = derivePublicSplitMetrics({
        publicTicketPct: split.ticketsPercent ?? split.ticketPct,
        publicMoneyPct: split.moneyPercent ?? split.moneyPct,
        trackedBetCount: split.betCount ?? row.publicBetting?.betCount,
        trackedVolume: split.volume ?? split.trackedVolume,
        providerSharpLabel: split.sharpSide ?? row.publicBetting?.sharpSide,
      });
      const observationKey = buildActionObservationKey({
        providerEventId,
        canonicalEventId,
        marketType: c.marketType,
        marketPeriod: periodBook,
        selection: c.selection,
        sportsbook,
        providerTimestamp,
        collectedAt,
      });
      out.push({
        id: `abo_${observationKey.slice(0, 24)}`,
        observationKey,
        canonicalEventId,
        canonicalPlayerId: null,
        providerEventId,
        providerPlayerId: null,
        sport,
        marketType: c.marketType,
        marketPeriod: periodBook,
        selection: c.selection,
        line: c.line,
        americanPrice: c.americanPrice,
        sportsbook,
        providerTimestamp,
        collectedAt,
        eventStartTime,
        snapshotType,
        ...publicMetrics,
        rawPayloadHash:
          strOrNull(book.payloadHash) ||
          strOrNull(row.rawPayloadHash) ||
          stableHash([
            providerEventId,
            sportsbook,
            c.marketType,
            c.selection,
            c.line,
            c.americanPrice,
            collectedAt,
          ]),
        matchConfidence,
        schemaVersion,
        runId,
        sourceObservationId,
        decisionEligible: 0,
        canQualify: 0,
        canAuthorizeWager: 0,
        createdAt: collectedAt,
      });
    }
  }
  return out;
}

/**
 * Expand player-prop quotes into immutable observations.
 * Canonical key: event + player + market + period + selection + book + observation time.
 */
export function expandPlayerPropObservations(row, ctx = {}) {
  const collectedAt = ctx.collectedAt || new Date().toISOString();
  const providerEventId = String(row.actionGameId || row.gameId || row.providerEventId || "");
  const canonicalEventId = ctx.canonicalEventId || row.fbisEventId || null;
  const sport = String(ctx.sport || row.sport || "unknown").toLowerCase();
  const period = String(row.period || "event");
  const eventStartTime = row.startTime || row.eventStartTime || null;
  const matchConfidence = ctx.matchConfidence || row.matchConfidence || null;
  const schemaVersion = ctx.schemaVersion || ACTION_SERIES_SCHEMA_VERSION;
  const runId = ctx.runId || null;
  const sourceObservationId = ctx.sourceObservationId || null;
  const snapshotType = deriveActionSnapshotType({
    lifecycle: ctx.lifecycle,
    temporalClass: row.temporalClass || ctx.temporalClass,
    explicit: ctx.snapshotType,
    eventStartTime,
    collectedAt,
  });

  const props = Array.isArray(row.playerProps) ? row.playerProps : [];
  const out = [];
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    const providerPlayerId = strOrNull(p.providerPlayerId ?? p.playerId);
    const canonicalPlayerId = strOrNull(p.canonicalPlayerId ?? p.fbisPlayerId);
    const marketType = strOrNull(p.marketCanonical || p.market || p.marketType);
    const sportsbook = strOrNull(p.book || p.sportsbook || p.bookName) || "action_consensus";
    const marketPeriod = strOrNull(p.period || period) || "event";
    const providerTimestamp = p.observedAt || p.providerTimestamp || row.observedAt || null;
    if (!marketType) continue;

    const sides = [];
    if (p.overOdds != null || p.side === "over" || p.selection === "over") {
      sides.push({
        selection: "over",
        line: numOrNull(p.line ?? p.overLine ?? p.point),
        americanPrice: numOrNull(
          p.overOdds ?? (p.side === "over" || p.selection === "over" ? p.price : null)
        ),
      });
    }
    if (p.underOdds != null || p.side === "under" || p.selection === "under") {
      sides.push({
        selection: "under",
        line: numOrNull(p.line ?? p.underLine ?? p.point),
        americanPrice: numOrNull(
          p.underOdds ?? (p.side === "under" || p.selection === "under" ? p.price : null)
        ),
      });
    }
    if (!sides.length && (p.price != null || p.line != null)) {
      sides.push({
        selection: strOrNull(p.selection || p.side) || "unknown",
        line: numOrNull(p.line ?? p.point),
        americanPrice: numOrNull(p.price ?? p.odds),
      });
    }

    for (const side of sides) {
      if (side.selection === "unknown" && side.line == null && side.americanPrice == null) continue;
      const publicMetrics = derivePublicSplitMetrics({
        publicTicketPct: p.ticketsPercent ?? p.publicTicketPct,
        publicMoneyPct: p.moneyPercent ?? p.publicMoneyPct,
        trackedBetCount: p.betCount ?? p.trackedBetCount,
        trackedVolume: p.volume ?? p.trackedVolume,
        providerSharpLabel: p.sharpSide || p.sharpLabel,
      });
      const observationKey = buildActionObservationKey({
        providerEventId,
        canonicalEventId,
        providerPlayerId,
        canonicalPlayerId,
        marketType,
        marketPeriod,
        selection: side.selection,
        sportsbook,
        providerTimestamp,
        collectedAt,
      });
      out.push({
        id: `apo_${observationKey.slice(0, 24)}`,
        observationKey,
        canonicalEventId,
        canonicalPlayerId,
        providerEventId,
        providerPlayerId,
        sport,
        marketType,
        marketPeriod,
        selection: side.selection,
        line: side.line,
        americanPrice: side.americanPrice,
        sportsbook,
        providerTimestamp,
        collectedAt,
        eventStartTime,
        snapshotType,
        ...publicMetrics,
        rawPayloadHash:
          strOrNull(p.payloadHash) ||
          stableHash([
            providerEventId,
            providerPlayerId,
            marketType,
            marketPeriod,
            side.selection,
            sportsbook,
            side.line,
            side.americanPrice,
            collectedAt,
          ]),
        matchConfidence,
        schemaVersion,
        runId,
        sourceObservationId,
        decisionEligible: 0,
        canQualify: 0,
        canAuthorizeWager: 0,
        createdAt: collectedAt,
      });
    }
  }
  return out;
}

export function snapshotPointerId(obs) {
  return stableHash([
    "action_ptr_v1",
    obs.canonicalEventId || obs.providerEventId,
    obs.canonicalPlayerId || obs.providerPlayerId || "",
    obs.marketType,
    obs.marketPeriod,
    obs.selection,
    obs.sportsbook,
    obs.snapshotType,
  ]);
}

async function dbQueryOne(db, sql, params = []) {
  if (typeof db.queryOne === "function") return db.queryOne(sql, params);
  if (typeof db.prepare === "function") {
    return (await db.prepare(sql).bind(...params).first()) || null;
  }
  return null;
}

async function dbExec(db, sql, params = []) {
  if (typeof db.exec === "function") return db.exec(sql, params);
  if (typeof db.prepare === "function") return db.prepare(sql).bind(...params).run();
  throw new Error("action_series_db_adapter_missing");
}

/**
 * Append-only persist. INSERT OR IGNORE — never UPDATE observation rows.
 * Snapshot pointers may advance to newer observation ids.
 */
export async function persistActionObservationSeries(db, observations = []) {
  if (!db || !observations.length) return { inserted: 0, ignored: 0, pointers: 0 };

  let inserted = 0;
  let ignored = 0;
  let pointers = 0;

  for (const obs of observations) {
    const firewall = assertActionFirewall({
      canQualify: Boolean(obs.canQualify),
      canAuthorizeWager: Boolean(obs.canAuthorizeWager),
      decisionEligible: Boolean(obs.decisionEligible),
    });
    if (!firewall.ok) {
      throw new Error(`action_firewall_violation:${firewall.violations.join(",")}`);
    }
  }

  // Cloudflare D1 has substantial round-trip cost when every book quote is
  // queried and inserted serially. The IDs are deterministic from the natural
  // observation key, so INSERT OR IGNORE plus pointer upserts are safe to batch.
  if (typeof db.batch === "function") {
    const insertStatements = observations.map((obs) => ({
      sql: `INSERT OR IGNORE INTO action_market_book_observations (
        id, observation_key, canonical_event_id, canonical_player_id,
        provider_event_id, provider_player_id, sport, market_type, market_period, selection,
        line, american_price, sportsbook, provider_timestamp, collected_at, event_start_time,
        snapshot_type, public_ticket_pct, public_money_pct, money_minus_ticket_pct,
        tracked_bet_count, tracked_volume, raw_payload_hash, match_confidence, schema_version,
        run_id, source_observation_id, decision_eligible, can_qualify, can_authorize_wager, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
      params: [
        obs.id, obs.observationKey, obs.canonicalEventId, obs.canonicalPlayerId,
        obs.providerEventId, obs.providerPlayerId, obs.sport, obs.marketType,
        obs.marketPeriod, obs.selection, obs.line, obs.americanPrice, obs.sportsbook,
        obs.providerTimestamp, obs.collectedAt, obs.eventStartTime, obs.snapshotType,
        obs.publicTicketPct, obs.publicMoneyPct, obs.moneyMinusTicketPct,
        obs.trackedBetCount, obs.trackedVolume, obs.rawPayloadHash, obs.matchConfidence,
        obs.schemaVersion, obs.runId, obs.sourceObservationId, obs.createdAt,
      ],
    }));
    const insertResults = await db.batch(insertStatements);
    inserted = insertResults.reduce(
      (sum, result) => sum + (Number(result?.meta?.changes ?? result?.changes ?? 0) > 0 ? 1 : 0),
      0
    );
    ignored = Math.max(0, observations.length - inserted);

    const pointerStatements = observations
      .filter((obs) => obs.snapshotType && obs.snapshotType !== ACTION_SNAPSHOT_TYPE.UNKNOWN)
      .map((obs) => ({
        sql: `INSERT INTO action_market_snapshot_pointers (
          id, sport, canonical_event_id, canonical_player_id, provider_event_id, provider_player_id,
          market_type, market_period, selection, sportsbook, snapshot_type,
          observation_id, observation_key, derived_at, event_start_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET observation_id = excluded.observation_id,
          observation_key = excluded.observation_key, derived_at = excluded.derived_at`,
        params: [
          snapshotPointerId(obs), obs.sport, obs.canonicalEventId, obs.canonicalPlayerId,
          obs.providerEventId, obs.providerPlayerId, obs.marketType, obs.marketPeriod,
          obs.selection, obs.sportsbook, obs.snapshotType, obs.id, obs.observationKey,
          obs.collectedAt, obs.eventStartTime,
        ],
      }));
    if (pointerStatements.length) await db.batch(pointerStatements);
    pointers = pointerStatements.length;
    return { inserted, ignored, pointers, provider: ACTION_APIFY_PROVIDER };
  }

  for (const obs of observations) {
    const existing = await dbQueryOne(
      db,
      "SELECT id FROM action_market_book_observations WHERE observation_key = ?",
      [obs.observationKey]
    );

    await dbExec(
      db,
      `INSERT OR IGNORE INTO action_market_book_observations (
        id, observation_key, canonical_event_id, canonical_player_id,
        provider_event_id, provider_player_id, sport, market_type, market_period, selection,
        line, american_price, sportsbook, provider_timestamp, collected_at, event_start_time,
        snapshot_type, public_ticket_pct, public_money_pct, money_minus_ticket_pct,
        tracked_bet_count, tracked_volume, raw_payload_hash, match_confidence, schema_version,
        run_id, source_observation_id, decision_eligible, can_qualify, can_authorize_wager, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
      [
        obs.id,
        obs.observationKey,
        obs.canonicalEventId,
        obs.canonicalPlayerId,
        obs.providerEventId,
        obs.providerPlayerId,
        obs.sport,
        obs.marketType,
        obs.marketPeriod,
        obs.selection,
        obs.line,
        obs.americanPrice,
        obs.sportsbook,
        obs.providerTimestamp,
        obs.collectedAt,
        obs.eventStartTime,
        obs.snapshotType,
        obs.publicTicketPct,
        obs.publicMoneyPct,
        obs.moneyMinusTicketPct,
        obs.trackedBetCount,
        obs.trackedVolume,
        obs.rawPayloadHash,
        obs.matchConfidence,
        obs.schemaVersion,
        obs.runId,
        obs.sourceObservationId,
        obs.createdAt,
      ]
    );

    if (existing?.id) ignored += 1;
    else inserted += 1;

    if (obs.snapshotType && obs.snapshotType !== ACTION_SNAPSHOT_TYPE.UNKNOWN) {
      const ptrId = snapshotPointerId(obs);
      await dbExec(
        db,
        `INSERT INTO action_market_snapshot_pointers (
          id, sport, canonical_event_id, canonical_player_id, provider_event_id, provider_player_id,
          market_type, market_period, selection, sportsbook, snapshot_type,
          observation_id, observation_key, derived_at, event_start_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          observation_id = excluded.observation_id,
          observation_key = excluded.observation_key,
          derived_at = excluded.derived_at`,
        [
          ptrId,
          obs.sport,
          obs.canonicalEventId,
          obs.canonicalPlayerId,
          obs.providerEventId,
          obs.providerPlayerId,
          obs.marketType,
          obs.marketPeriod,
          obs.selection,
          obs.sportsbook,
          obs.snapshotType,
          obs.id,
          obs.observationKey,
          obs.collectedAt,
          obs.eventStartTime,
        ]
      );
      pointers += 1;
    }
  }

  return { inserted, ignored, pointers, provider: ACTION_APIFY_PROVIDER };
}

export function selectSeriesSnapshot(observations, snapshotType) {
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

export { ACTION_APIFY_SCHEMA_VERSION };
