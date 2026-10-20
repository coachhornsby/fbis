/**
 * Market-history capacity planning: measured ingest → hot-window sizing,
 * coalesce policy, and fail-closed write gates for partitioned D1 stores.
 *
 * A quarterly partition name does NOT mean a full quarter of WS ticks fit in 10 GB.
 * D1 holds a bounded searchable hot window + compact latest state; R2 holds raw ticks.
 */
import { D1_HARD_LIMIT_BYTES, capacityAlertLevel } from "./databaseOwnership.js";

/** Target maximum fraction of the 10 GB hard limit for hot tick retention. */
export const MARKET_HISTORY_HOT_BUDGET_FRACTION = 0.45;

/** Leave write headroom: reject new D1 history inserts at HIGH (85%) and above. */
export const MARKET_HISTORY_WRITE_BLOCK_LEVELS = Object.freeze([
  "HIGH",
  "CRITICAL",
  "OVER_LIMIT",
]);

/**
 * Measured production baseline (Q4 partition, 2026-10-20).
 * Replaced at runtime when live probes supply fresher series.
 */
export const MEASURED_Q4_BASELINE = Object.freeze({
  measuredAt: "2026-10-20T14:21:30.862Z",
  databaseName: "fbis-market-history-2026q4",
  databaseId: "e8b0b65d-90a6-4842-8ee7-0f85d75afb4c",
  usedBytes: 960_995_328,
  rowCount: 279_606,
  bytesPerObservation: 3437,
  windowStart: "2026-10-20T12:23:19.634Z",
  windowEnd: "2026-10-20T14:21:30.862Z",
  hourlyRows: Object.freeze([91_944, 137_806, 49_856]),
  peakRowsPerMinute: 4052,
  medianRowsPerMinute: 2240,
  distinctObservationKeys: 279_606,
  duplicateKeys: 0,
  distinctMarkets: 1575,
  distinctOutcomes: 3150,
  coalesceProbe: Object.freeze({
    ticks: 188_382,
    perMinuteBuckets: 113_728,
    reductionRatio: Number((1 - 113_728 / 188_382).toFixed(3)),
  }),
  legacyLastWriteAt: "2026-10-20T07:12:07.595Z",
  liveWriterTarget: "MARKET_HISTORY_2026Q4",
  averagePayloadChars: 1697,
});

/** Compact latest-state upsert cadence is always-on; tick ledger is coalesced. */
export const WS_TICK_COALESCE_MS = 60_000;

/** Material price change that forces a new D1 tick even inside the coalesce window. */
export const WS_TICK_PRICE_DELTA = 0.001;

/**
 * Sustainable searchable hot window derived from ingest rate and budget.
 * Floor 2h (board/CLV recent compare), ceiling 24h (never pretend 7d is viable).
 */
export const MARKET_HISTORY_HOT_WINDOW_MS_MIN = 2 * 3600 * 1000;
export const MARKET_HISTORY_HOT_WINDOW_MS_MAX = 24 * 3600 * 1000;
/** Legacy 7-day policy — retained only as a documented non-viable reference. */
export const MARKET_HISTORY_HOT_WINDOW_MS_LEGACY_7D = 7 * 24 * 3600 * 1000;

export function rowsPerHourFromSeries(hourlyRows = []) {
  const vals = (hourlyRows || []).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (!vals.length) return { current: 0, median: 0, peak: 0 };
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return {
    current: vals[vals.length - 1],
    median,
    peak: Math.max(...vals),
  };
}

export function forecastCapacityExhaustion({
  usedBytes,
  hardLimitBytes = D1_HARD_LIMIT_BYTES,
  bytesPerObservation,
  rowsPerHour,
  now = new Date(),
} = {}) {
  const remaining = Math.max(0, hardLimitBytes - Number(usedBytes || 0));
  const bpo = Math.max(1, Number(bytesPerObservation) || MEASURED_Q4_BASELINE.bytesPerObservation);
  const rates = typeof rowsPerHour === "object" && rowsPerHour
    ? rowsPerHour
    : { current: Number(rowsPerHour) || 0, median: Number(rowsPerHour) || 0, peak: Number(rowsPerHour) || 0 };

  function hoursUntil(rate) {
    const r = Number(rate) || 0;
    if (r <= 0) return null;
    const bytesPerHour = r * bpo;
    return Number((remaining / bytesPerHour).toFixed(2));
  }

  const scenarios = {
    current: { rowsPerHour: rates.current, hoursUntilExhaustion: hoursUntil(rates.current) },
    median: { rowsPerHour: rates.median, hoursUntilExhaustion: hoursUntil(rates.median) },
    peak: { rowsPerHour: rates.peak, hoursUntilExhaustion: hoursUntil(rates.peak) },
  };

  return {
    measuredAt: now instanceof Date ? now.toISOString() : String(now),
    usedBytes: Number(usedBytes) || 0,
    hardLimitBytes,
    remainingBytes: remaining,
    bytesPerObservation: bpo,
    percentUsed: Number((((Number(usedBytes) || 0) / hardLimitBytes) * 100).toFixed(3)),
    scenarios,
    sevenDayHotWindowBytesAtMedian: Math.round((rates.median || 0) * 24 * 7 * bpo),
    sevenDayHotWindowFitsIn10Gb: ((rates.median || 0) * 24 * 7 * bpo) < hardLimitBytes,
  };
}

/**
 * Choose a hot window that keeps median ingest under the hot budget.
 * Returns ms; callers should treat this as the retention cutoff for D1 tick rows.
 */
export function recommendHotWindowMs({
  bytesPerObservation = MEASURED_Q4_BASELINE.bytesPerObservation,
  medianRowsPerHour = MEASURED_Q4_BASELINE.hourlyRows[1],
  hardLimitBytes = D1_HARD_LIMIT_BYTES,
  budgetFraction = MARKET_HISTORY_HOT_BUDGET_FRACTION,
} = {}) {
  const budgetBytes = hardLimitBytes * budgetFraction;
  const bpo = Math.max(1, Number(bytesPerObservation) || 1);
  const rate = Math.max(1, Number(medianRowsPerHour) || 1);
  const hoursAffordable = budgetBytes / (rate * bpo);
  const ms = Math.round(hoursAffordable * 3600 * 1000);
  const clamped = Math.max(
    MARKET_HISTORY_HOT_WINDOW_MS_MIN,
    Math.min(MARKET_HISTORY_HOT_WINDOW_MS_MAX, ms),
  );
  return {
    hotWindowMs: clamped,
    hotWindowHours: Number((clamped / 3600000).toFixed(2)),
    hoursAffordableRaw: Number(hoursAffordable.toFixed(2)),
    budgetBytes: Math.round(budgetBytes),
    medianRowsPerHour: rate,
    bytesPerObservation: bpo,
    legacySevenDayRejected: true,
    reason: hoursAffordable < 24
      ? "MEDIAN_INGEST_EXCEEDS_24H_BUDGET_CLAMPED"
      : "WITHIN_BUDGET_CLAMPED",
  };
}

export function shouldBlockMarketHistoryWrite(capacity) {
  if (!capacity || capacity.level == null) return { blocked: false, reason: null };
  if (MARKET_HISTORY_WRITE_BLOCK_LEVELS.includes(capacity.level)) {
    return {
      blocked: true,
      reason: `CAPACITY_${capacity.level}`,
      capacity,
    };
  }
  return { blocked: false, reason: null, capacity };
}

/**
 * Decide whether a WS tick should land in the D1 observation ledger.
 * Latest-state upserts are independent and always recommended.
 */
export function shouldPersistWsTickToD1({
  previous,
  next,
  nowMs = Date.now(),
  coalesceMs = WS_TICK_COALESCE_MS,
  priceDelta = WS_TICK_PRICE_DELTA,
} = {}) {
  if (!next) return { persist: false, reason: "EMPTY_TICK" };
  if (!previous) return { persist: true, reason: "FIRST_SAMPLE" };
  const prevPrice = Number(previous.contract_price ?? previous.contractPrice);
  const nextPrice = Number(next.contract_price ?? next.contractPrice);
  if (Number.isFinite(prevPrice) && Number.isFinite(nextPrice)
    && Math.abs(nextPrice - prevPrice) >= priceDelta) {
    return { persist: true, reason: "PRICE_MOVED" };
  }
  const prevAt = Date.parse(previous.collected_at || previous.collectedAt || "");
  if (!Number.isFinite(prevAt) || (nowMs - prevAt) >= coalesceMs) {
    return { persist: true, reason: "COALESCE_INTERVAL_ELAPSED" };
  }
  return {
    persist: false,
    reason: "COALESCE_SKIP_REDUNDANT",
    nextPersistAt: new Date(prevAt + coalesceMs).toISOString(),
  };
}

export function latestMarketStateKey(offer = {}) {
  return [
    offer.source || "",
    offer.sport || "",
    offer.canonical_event_id || offer.eventId || "",
    offer.market_family || offer.marketFamily || "",
    offer.side || "",
    offer.line == null ? "" : String(offer.line),
    offer.source_market_id || offer.sourceMarketId || "",
    offer.source_outcome_id || offer.sourceOutcomeId || "",
  ].join("|");
}

export function buildVerifiedCapacityPlan(live = {}) {
  const baseline = { ...MEASURED_Q4_BASELINE, ...live };
  const rates = rowsPerHourFromSeries(baseline.hourlyRows);
  const forecast = forecastCapacityExhaustion({
    usedBytes: baseline.usedBytes,
    bytesPerObservation: baseline.bytesPerObservation,
    rowsPerHour: rates,
  });
  const hot = recommendHotWindowMs({
    bytesPerObservation: baseline.bytesPerObservation,
    medianRowsPerHour: rates.median || MEASURED_Q4_BASELINE.hourlyRows[1],
  });
  const coalescedMedian = Math.round(
    (rates.median || 0) * (1 - (baseline.coalesceProbe?.reductionRatio || 0.4)),
  );
  const hotAfterCoalesce = recommendHotWindowMs({
    bytesPerObservation: baseline.bytesPerObservation,
    medianRowsPerHour: Math.max(1, coalescedMedian),
  });

  return {
    contract: "fbis-market-history-capacity-plan-v1",
    generatedAt: new Date().toISOString(),
    canAuthorizeWager: false,
    verifiedLiveWriters: {
      legacyMarketHistoryLastWriteAt: baseline.legacyLastWriteAt,
      liveTarget: baseline.liveWriterTarget,
      legacyWritesActive: false,
      q4ReceivingLiveObservations: true,
    },
    measured: {
      ...baseline,
      rowsPerHour: rates,
      capacity: capacityAlertLevel(baseline.usedBytes),
    },
    forecast,
    architecture: {
      d1HotTicks: {
        windowMs: hotAfterCoalesce.hotWindowMs,
        windowHours: hotAfterCoalesce.hotWindowHours,
        coalesceMs: WS_TICK_COALESCE_MS,
        priceDelta: WS_TICK_PRICE_DELTA,
        failClosedFromLevel: "HIGH",
        note: "Bounded searchable ticks only; not a full quarter of WS history.",
      },
      d1LatestState: {
        table: "latest_market_state",
        role: "compact_current_quotes_for_board_and_comparisons",
        expectedRows: baseline.distinctOutcomes,
        estimatedBytes: Math.round((baseline.distinctOutcomes || 3150) * 800),
      },
      r2Archive: {
        binding: "ARCHIVE",
        role: "raw_ws_batches_and_cold_observation_json",
        retention: "durable_with_sha256_manifests",
        requiredBeforeD1Retirement: true,
      },
      rejectedApproaches: [
        "Create another unbounded quarterly D1 and repeat 10 GB fill",
        "Retain 7-day full-resolution WS ticks in D1 at measured ingest",
        "Silent fallback writes to near-full legacy market-history",
      ],
    },
    hotWindowWithoutCoalesce: hot,
    hotWindowWithCoalesce: hotAfterCoalesce,
    sevenDayPolicy: {
      legacyMs: MARKET_HISTORY_HOT_WINDOW_MS_LEGACY_7D,
      estimatedBytesAtMedian: forecast.sevenDayHotWindowBytesAtMedian,
      fitsIn10Gb: forecast.sevenDayHotWindowFitsIn10Gb,
      verdict: "REJECTED_UNSUSTAINABLE",
    },
    operatorActions: [
      "Keep WS writes on MARKET_HISTORY_2026Q4 only (legacy last write frozen).",
      "Upsert latest_market_state on every tick; coalesce D1 ledger inserts to 60s/price-move.",
      "Archive ticks older than the recommended hot window to R2 before any retention delete.",
      "Fail closed history writes at HIGH (85%) — do not wait for CRITICAL.",
      "Do not open a new quarterly D1 until hot-window + R2 architecture is proven.",
    ],
  };
}
