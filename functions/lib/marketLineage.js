/**
 * Market snapshot lineage + harvest-retry classification (ops only).
 * Does not change CFB model science or enable qualification.
 */

export const MARKET_SOURCE_MODE = Object.freeze({
  LIVE_PROVIDER: "LIVE_PROVIDER",
  CACHED_PROVIDER: "CACHED_PROVIDER",
  FALLBACK_PROVIDER: "FALLBACK_PROVIDER",
});

export const RETRY_CLASS = Object.freeze({
  PROVIDER_QUOTA: "PROVIDER_QUOTA",
  PROVIDER_RATE_LIMIT: "PROVIDER_RATE_LIMIT",
  PROVIDER_OUTAGE: "PROVIDER_OUTAGE",
  AUTH_FAILURE: "AUTH_FAILURE",
  SCHEDULE_MISS: "SCHEDULE_MISS",
  STALE_MARKET: "STALE_MARKET",
  MARKET_NOT_FOUND: "MARKET_NOT_FOUND",
  CACHE_AVAILABLE: "CACHE_AVAILABLE",
  TRANSIENT_NETWORK: "TRANSIENT_NETWORK",
  POST_KICKOFF: "POST_KICKOFF",
  ALREADY_SATISFIED: "ALREADY_SATISFIED",
  TERMINAL_OTHER: "TERMINAL_OTHER",
});

const PRIMARY_SOURCES = new Set(["parlay"]);
const FALLBACK_SOURCE_FRAGMENTS = [
  "theodds",
  "sharpapi",
  "therundown",
  "backup",
  "soft-backup",
  "fallback",
];

export function normalizeMarketSourceMode({ source = null, cached = false, provider = null } = {}) {
  if (cached) return MARKET_SOURCE_MODE.CACHED_PROVIDER;
  const s = String(source || provider || "").toLowerCase();
  if (!s || s === "parlay") return MARKET_SOURCE_MODE.LIVE_PROVIDER;
  if (PRIMARY_SOURCES.has(s)) return MARKET_SOURCE_MODE.LIVE_PROVIDER;
  if (FALLBACK_SOURCE_FRAGMENTS.some((frag) => s.includes(frag))) {
    return MARKET_SOURCE_MODE.FALLBACK_PROVIDER;
  }
  return MARKET_SOURCE_MODE.LIVE_PROVIDER;
}

function isSuccessfulFallbackOddsSource(meta = {}) {
  const source = String(meta.source || "").toLowerCase();
  const mode = String(meta.sourceMode || "");
  if (mode === MARKET_SOURCE_MODE.FALLBACK_PROVIDER) return true;
  return (
    source.includes("backup") ||
    source.includes("soft") ||
    source.includes("theodds") ||
    source.includes("sharp") ||
    source.includes("rundown")
  );
}

export function isUnusableCachedOddsMeta(meta = {}) {
  const source = String(meta.source || "").toLowerCase();
  const err = String(meta.parlayError || meta.error || meta.backupError || "").toLowerCase();
  if (meta.failClosed) return true;
  const games = Number(meta.games);
  const pinGames = Number(meta.pinGames);
  if (Number.isFinite(games) && Number.isFinite(pinGames) && games === 0 && pinGames === 0) return true;
  // Successful soft/backup providers remain usable even when primary Parlay
  // quota/auth diagnostics are retained on the same meta object.
  if (isSuccessfulFallbackOddsSource(meta) && Number.isFinite(games) && games > 0) {
    return false;
  }
  // Provider error shells must never terminate routing as market successes —
  // even when a prior board payload is still attached to the cache entry.
  if (
    (source.includes("credit-exhausted") ||
      source.includes("out_of_usage") ||
      source.includes("rate-limit") ||
      source.includes("auth-fail") ||
      source.includes("unauthorized") ||
      source.includes("forbidden") ||
      source.includes("empty") ||
      source.includes("malformed") ||
      source.includes("fail-closed") ||
      source.includes("fail_closed")) &&
    !isSuccessfulFallbackOddsSource(meta)
  ) {
    return true;
  }
  if (
    /(out_of_usage_credits|credit limit|quota|rate.?limit|401|403|429|unauthorized|forbidden|malformed|empty response)/i.test(
      err
    )
  ) {
    return true;
  }
  return false;
}

/** Normalize provider pool attempts for diagnostics (never includes secrets). */
export function normalizeProviderAttempts(attempts = []) {
  return (attempts || []).map((a) => {
    const provider = String(a?.provider || a?.source || "unknown");
    let outcome = "UNKNOWN";
    if (a?.skipped || a?.reason === "not-configured") outcome = "NOT_CONFIGURED";
    else if (a?.quotaExhausted || /quota|credit|usage/i.test(String(a?.error || ""))) outcome = "PROVIDER_QUOTA";
    else if (a?.rateLimited || /429|rate.?limit/i.test(String(a?.error || ""))) outcome = "PROVIDER_RATE_LIMIT";
    else if (/401|403|unauthorized|forbidden|api.?key|auth/i.test(String(a?.error || ""))) outcome = "AUTH_FAILURE";
    else if (a?.ok && (a?.fresh || a?.complete || a?.success)) outcome = "SUCCESS";
    else if (a?.ok === false || a?.error) outcome = "PROVIDER_OUTAGE";
    return {
      provider,
      outcome,
      error: a?.error ? String(a.error).slice(0, 160) : null,
      skipped: Boolean(a?.skipped),
      asOf: a?.asOf || null,
    };
  });
}

/**
 * Derive board-vs-live health from last persisted odds summary meta.
 * A cached board can be available while live collection is unhealthy.
 */
export function deriveOddsBoardHealth(metaMap = {}, sports = ["mlb", "cfb", "nfl", "cbb"]) {
  const bySport = {};
  let boardAvailable = false;
  let liveCollectionHealthy = false;
  for (const sport of sports) {
    const prefix = `last_odds_${sport}_`;
    const source = metaMap[`${prefix}source`] || null;
    const sourceMode = metaMap[`${prefix}source_mode`] || null;
    const cached = metaMap[`${prefix}cached`] === "1";
    const usable = metaMap[`${prefix}usable`] === "1";
    const provider = metaMap[`${prefix}provider`] || null;
    const observedAt = metaMap[`${prefix}observed_at`] || null;
    const updatedAt = metaMap[`${prefix}at`] || null;
    const games = Number(metaMap[`${prefix}games`] || 0);
    const row = {
      sport,
      source,
      sourceMode,
      cached,
      usable,
      provider,
      observedAt,
      updatedAt,
      games: Number.isFinite(games) ? games : 0,
    };
    bySport[sport] = row;
    if (usable && row.games > 0) boardAvailable = true;
    if (
      usable &&
      !cached &&
      (sourceMode === MARKET_SOURCE_MODE.LIVE_PROVIDER || sourceMode === MARKET_SOURCE_MODE.FALLBACK_PROVIDER)
    ) {
      liveCollectionHealthy = true;
    }
  }
  let boardSourceMode = null;
  for (const row of Object.values(bySport)) {
    if (!row.usable || row.games <= 0) continue;
    if (!row.cached && row.sourceMode === MARKET_SOURCE_MODE.LIVE_PROVIDER) {
      boardSourceMode = MARKET_SOURCE_MODE.LIVE_PROVIDER;
      break;
    }
    if (!row.cached && row.sourceMode === MARKET_SOURCE_MODE.FALLBACK_PROVIDER) {
      boardSourceMode = MARKET_SOURCE_MODE.FALLBACK_PROVIDER;
    } else if (!boardSourceMode && row.cached) {
      boardSourceMode = MARKET_SOURCE_MODE.CACHED_PROVIDER;
    }
  }
  return {
    boardAvailable,
    liveCollectionHealthy,
    boardSourceMode,
    bySport,
  };
}

/**
 * Cache may be served only when original observation time is retained and still fresh.
 * Never rewrite observedAt to "now" on cache read.
 */
export function evaluateCachedMarketFreshness(meta = {}, { nowMs = Date.now(), maxAgeMs = 15 * 60 * 1000 } = {}) {
  const observedAt = meta.observedAt || meta.asOf || meta.marketAt || null;
  if (!observedAt) {
    return { ok: false, code: "MARKET_STALE", reason: "missing-observedAt", observedAt: null, ageMs: null };
  }
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) {
    return { ok: false, code: "MARKET_STALE", reason: "invalid-observedAt", observedAt, ageMs: null };
  }
  const ageMs = nowMs - t;
  if (ageMs > maxAgeMs) {
    return { ok: false, code: "MARKET_STALE", reason: "stale", observedAt, ageMs };
  }
  return { ok: true, code: null, reason: null, observedAt, ageMs };
}

export function attachMarketLineage(
  meta = {},
  { provider = null, cached = false, receivedAt = null, jobId = null, retryOf = null } = {}
) {
  const observedAt = meta.observedAt || meta.asOf || meta.marketAt || null;
  const sourceMode = normalizeMarketSourceMode({
    source: meta.source,
    cached: Boolean(cached || meta.cached),
    provider: provider || meta.provider,
  });
  return {
    ...meta,
    provider: provider || meta.provider || null,
    sourceMode,
    observedAt,
    receivedAt: receivedAt || meta.receivedAt || new Date().toISOString(),
    cached: Boolean(cached || meta.cached),
    collectionJobId: jobId || meta.collectionJobId || null,
    retryOf: retryOf || meta.retryOf || null,
  };
}

export function classifyHarvestRetryReason(reason = "") {
  const s = String(reason || "").toLowerCase();
  if (!s) return RETRY_CLASS.TERMINAL_OTHER;
  if (/(out_of_usage_credits|credit limit|quota|usage credits)/i.test(s)) return RETRY_CLASS.PROVIDER_QUOTA;
  if (/(rate.?limit|429|too many requests)/i.test(s)) return RETRY_CLASS.PROVIDER_RATE_LIMIT;
  if (/(401|403|unauthorized|forbidden|api.?key|auth)/i.test(s)) return RETRY_CLASS.AUTH_FAILURE;
  if (/(timeout|econnreset|enotfound|network|fetch failed|502|503|504|524)/i.test(s)) {
    return RETRY_CLASS.TRANSIENT_NETWORK;
  }
  if (/(stale|asof|observedat|market_stale)/i.test(s)) return RETRY_CLASS.STALE_MARKET;
  if (/(not found|404|no events|empty slate|market.?missing)/i.test(s)) return RETRY_CLASS.MARKET_NOT_FOUND;
  if (/(post.?kick|after.?start|kickoff|game.?started)/i.test(s)) return RETRY_CLASS.POST_KICKOFF;
  if (/(already|satisfied|resolved|noop)/i.test(s)) return RETRY_CLASS.ALREADY_SATISFIED;
  if (/(schedule|missed slot|watchdog)/i.test(s)) return RETRY_CLASS.SCHEDULE_MISS;
  if (/(5\d\d|provider|upstream|parlay|theodds|sharpapi|therundown)/i.test(s)) {
    return RETRY_CLASS.PROVIDER_OUTAGE;
  }
  if (/(cache)/i.test(s)) return RETRY_CLASS.CACHE_AVAILABLE;
  return RETRY_CLASS.TERMINAL_OTHER;
}

export function isRetryableClass(cls) {
  return [
    RETRY_CLASS.PROVIDER_QUOTA,
    RETRY_CLASS.PROVIDER_RATE_LIMIT,
    RETRY_CLASS.PROVIDER_OUTAGE,
    RETRY_CLASS.TRANSIENT_NETWORK,
    RETRY_CLASS.SCHEDULE_MISS,
    RETRY_CLASS.CACHE_AVAILABLE,
    RETRY_CLASS.STALE_MARKET,
    RETRY_CLASS.MARKET_NOT_FOUND,
  ].includes(cls);
}

/**
 * A retry may recreate a pregame market snapshot only before kickoff.
 * Harvest settle/grade retries are not gated by this helper.
 */
export function canRetryPregameSnapshot({
  kickoffAt,
  nowMs = Date.now(),
  hasContemporaneousSnapshot = false,
} = {}) {
  if (hasContemporaneousSnapshot) {
    return { allowed: false, class: RETRY_CLASS.ALREADY_SATISFIED, temporalValid: true };
  }
  if (!kickoffAt) {
    return { allowed: true, class: null, temporalValid: true, reason: "kickoff-unknown-allow-with-caution" };
  }
  const t = Date.parse(kickoffAt);
  if (!Number.isFinite(t)) {
    return { allowed: true, class: null, temporalValid: true, reason: "kickoff-unparseable" };
  }
  if (nowMs >= t) {
    return { allowed: false, class: RETRY_CLASS.POST_KICKOFF, temporalValid: false, reason: "post-kickoff" };
  }
  return { allowed: true, class: null, temporalValid: true };
}

export function classifyOpenHarvestRetries(rows = [], { nowMs = Date.now(), kickoffByGameId = {} } = {}) {
  const classified = [];
  const counts = Object.fromEntries(Object.keys(RETRY_CLASS).map((k) => [k, 0]));
  for (const row of rows) {
    const cls = classifyHarvestRetryReason(row.reason);
    counts[cls] = (counts[cls] || 0) + 1;
    const kickoffAt = row.kickoffAt || kickoffByGameId[row.game_id] || null;
    const temporal = canRetryPregameSnapshot({
      kickoffAt,
      nowMs,
      hasContemporaneousSnapshot: Boolean(row.hasContemporaneousSnapshot),
    });
    // Harvest settle retries remain retryable after kickoff; only pregame market
    // snapshot rows (kind=market|collect) are temporally gated.
    const kind = String(row.kind || row.retry_kind || "harvest").toLowerCase();
    const isPregameMarketRetry = kind === "market" || kind === "collect" || kind === "pregame";
    const temporalBlocks = isPregameMarketRetry && !temporal.allowed;
    const retryable = isRetryableClass(cls) && !temporalBlocks;
    const finalClass = temporalBlocks ? RETRY_CLASS.POST_KICKOFF : cls;
    if (temporalBlocks) {
      counts[cls] = Math.max(0, (counts[cls] || 1) - 1);
      counts[RETRY_CLASS.POST_KICKOFF] = (counts[RETRY_CLASS.POST_KICKOFF] || 0) + 1;
    }
    classified.push({
      id: row.id,
      sport: row.sport,
      date: row.date,
      gameId: row.game_id || null,
      scheduledCollectionAt: row.scheduled_collection_at || row.created_at || null,
      kickoffAt,
      state: row.status || "open",
      provider: row.provider || null,
      failureReason: row.reason || null,
      kind,
      class: finalClass,
      retryable,
      temporalValid: isPregameMarketRetry ? temporal.temporalValid : true,
      attempts: Number(row.attempts || 0),
      lastAttemptAt: row.last_attempt_at || null,
      createdAt: row.created_at || null,
    });
  }
  return {
    total: classified.length,
    counts,
    retryable: classified.filter((r) => r.retryable).length,
    terminal: classified.filter((r) => !r.retryable).length,
    postKickoff: classified.filter((r) => r.class === RETRY_CLASS.POST_KICKOFF).length,
    rows: classified,
  };
}

/** Boolean-only provider secret presence. Never returns secret values. */
export function providerConfigFlags(env = {}) {
  return {
    parlay: Boolean(env.PARLAY_API_KEY && String(env.PARLAY_API_KEY).trim()),
    theodds: Boolean(env.THEODDS_API_KEY && String(env.THEODDS_API_KEY).trim()),
    sharpapi: Boolean(env.SHARPAPI_API_KEY && String(env.SHARPAPI_API_KEY).trim()),
    therundown: Boolean(env.THERUNDOWN_API_KEY && String(env.THERUNDOWN_API_KEY).trim()),
  };
}
