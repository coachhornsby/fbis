/** Soft cap used only when STREAM_WS_PERSIST_PRIMARY=enabled restores primary-first. */
export const PRIMARY_WS_SOFT_CAP_BYTES = 8_000_000_000;

/**
 * Unified market-history write preference for the WS stream.
 * Prefer MARKET_HISTORY_2026Q4. Fail closed when Q4 is unbound unless
 * MARKET_HISTORY_ALLOW_LEGACY_WRITE=enabled (operator escape hatch only).
 *
 * High-volume WS CURRENT ticks prefer history so primary keeps FREEZE /
 * continuous-learning / live-board headroom.
 */
export function historyStore(env) {
  if (env?.MARKET_HISTORY_2026Q4_DB?.prepare) return "MARKET_HISTORY_2026Q4";
  if (env?.MARKET_HISTORY_ALLOW_LEGACY_WRITE === "enabled" && env?.MARKET_HISTORY_DB?.prepare) {
    return "MARKET_HISTORY";
  }
  return null;
}

export function resolveWsPersistTarget(env, primaryBytes = null) {
  const store = historyStore(env);
  if (!store) {
    const q4Missing = !env?.MARKET_HISTORY_2026Q4_DB?.prepare;
    return {
      store: null,
      reason: q4Missing
        ? "MARKET_HISTORY_2026Q4_UNBOUND_FAIL_CLOSED"
        : "history-binding-missing",
      preferHistory: false,
      blocked: true,
      primaryBytes: Number.isFinite(Number(primaryBytes)) ? Number(primaryBytes) : null,
    };
  }
  if (env.STREAM_WS_PERSIST_PRIMARY === "enabled") {
    const bytes = Number(primaryBytes);
    if (Number.isFinite(bytes) && bytes > 0 && bytes >= PRIMARY_WS_SOFT_CAP_BYTES) {
      return {
        store,
        reason: "PRIMARY_SOFT_CAP_HISTORY_ROUTE",
        preferHistory: true,
        blocked: false,
        primaryBytes: bytes,
        softCapBytes: PRIMARY_WS_SOFT_CAP_BYTES,
      };
    }
    return {
      store: "PRIMARY",
      reason: "STREAM_WS_PERSIST_PRIMARY",
      preferHistory: false,
      blocked: false,
      primaryBytes: Number.isFinite(bytes) ? bytes : null,
      softCapBytes: PRIMARY_WS_SOFT_CAP_BYTES,
    };
  }
  return {
    store,
    reason: store === "MARKET_HISTORY_2026Q4" ? "WS_Q4_DEFAULT" : "WS_HISTORY_LEGACY_ESCAPE",
    preferHistory: true,
    blocked: false,
    primaryBytes: Number.isFinite(Number(primaryBytes)) ? Number(primaryBytes) : null,
  };
}
