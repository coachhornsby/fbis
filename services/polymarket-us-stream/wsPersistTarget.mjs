/** Soft cap used only when STREAM_WS_PERSIST_PRIMARY=enabled restores primary-first. */
export const PRIMARY_WS_SOFT_CAP_BYTES = 8_000_000_000;

/**
 * High-volume WS CURRENT ticks prefer MARKET_HISTORY by default so primary
 * keeps FREEZE / continuous-learning / live-board headroom.
 * Opt into legacy primary-first with STREAM_WS_PERSIST_PRIMARY=enabled
 * (still routes to history at/above PRIMARY_WS_SOFT_CAP_BYTES).
 */
export function resolveWsPersistTarget(env, primaryBytes = null) {
  if (!env?.MARKET_HISTORY_DB?.prepare) {
    return { store: "PRIMARY", reason: "history-binding-missing", preferHistory: false };
  }
  if (env.STREAM_WS_PERSIST_PRIMARY === "enabled") {
    const bytes = Number(primaryBytes);
    if (Number.isFinite(bytes) && bytes > 0 && bytes >= PRIMARY_WS_SOFT_CAP_BYTES) {
      return {
        store: "MARKET_HISTORY",
        reason: "PRIMARY_SOFT_CAP_HISTORY_ROUTE",
        preferHistory: true,
        primaryBytes: bytes,
        softCapBytes: PRIMARY_WS_SOFT_CAP_BYTES,
      };
    }
    return {
      store: "PRIMARY",
      reason: "STREAM_WS_PERSIST_PRIMARY",
      preferHistory: false,
      primaryBytes: Number.isFinite(bytes) ? bytes : null,
      softCapBytes: PRIMARY_WS_SOFT_CAP_BYTES,
    };
  }
  return {
    store: "MARKET_HISTORY",
    reason: "WS_HISTORY_DEFAULT",
    preferHistory: true,
    primaryBytes: Number.isFinite(Number(primaryBytes)) ? Number(primaryBytes) : null,
  };
}
