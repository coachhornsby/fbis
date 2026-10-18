/**
 * Capacity-aware write routing for high-volume market observation persistence.
 * When primary D1 is at/near the hard cap, prefer MARKET_HISTORY_DB so live
 * product writers (FREEZE, continuous-learning, cards) retain headroom.
 * Never enables wagering. CURRENT quotes older than the live board window
 * belong on the history shard under database-ownership-v1.
 */
export const PRIMARY_MARKET_WRITE_SOFT_LIMIT_BYTES = 9_500_000_000;

/**
 * @param {object} env
 * @param {unknown} sizeAfter bytes from D1 meta.size_after (or null/undefined)
 * @returns {{db: object|null, store: 'PRIMARY'|'MARKET_HISTORY'|null, primaryBytes: number|null, blocked?: string, preferHistory: boolean}}
 */
export function primaryMarketWriteTarget(env, sizeAfter) {
  const bytes = Number(sizeAfter);
  const knownFull =
    Number.isFinite(bytes) && bytes > 0 && bytes >= PRIMARY_MARKET_WRITE_SOFT_LIMIT_BYTES;
  const unknown = !Number.isFinite(bytes) || bytes <= 0;
  if ((knownFull || unknown) && env?.MARKET_HISTORY_DB?.prepare) {
    return {
      db: env.MARKET_HISTORY_DB,
      store: "MARKET_HISTORY",
      primaryBytes: Number.isFinite(bytes) ? bytes : null,
      preferHistory: true,
    };
  }
  if (knownFull) {
    return {
      db: null,
      store: null,
      primaryBytes: bytes,
      preferHistory: true,
      blocked: "PRIMARY_WRITE_CAPACITY_UNAVAILABLE",
    };
  }
  if (unknown) {
    return {
      db: null,
      store: null,
      primaryBytes: null,
      preferHistory: true,
      blocked: "PRIMARY_WRITE_CAPACITY_UNAVAILABLE",
    };
  }
  return {
    db: env?.DB || null,
    store: "PRIMARY",
    primaryBytes: bytes,
    preferHistory: false,
  };
}

/**
 * WS stream should skip primary only when size_after is known and at/over the
 * soft limit. Probe failures and missing meta fall through to the existing
 * try-primary-then-recover path so healthy primary inserts keep working.
 */
export function streamPreferHistoryPersistence(env, sizeAfter) {
  const bytes = Number(sizeAfter);
  const knownFull =
    Number.isFinite(bytes) && bytes > 0 && bytes >= PRIMARY_MARKET_WRITE_SOFT_LIMIT_BYTES;
  return Boolean(knownFull && env?.MARKET_HISTORY_DB?.prepare);
}

/** Probe primary size_after when the Workers/Pages D1 binding exposes it. */
export async function probePrimaryMarketWriteTarget(env) {
  if (!env?.DB?.prepare) {
    return primaryMarketWriteTarget(env, undefined);
  }
  try {
    const probe = await env.DB.prepare("SELECT 1 AS healthy").all();
    return primaryMarketWriteTarget(env, probe?.meta?.size_after);
  } catch {
    // Probe failure: do not skip primary; let the insert attempt decide.
    return {
      db: env.DB,
      store: "PRIMARY",
      primaryBytes: null,
      preferHistory: false,
    };
  }
}

/** Stream flush helper: prefer history only on known-full primary. */
export async function probeStreamPreferHistory(env) {
  if (!env?.DB?.prepare || !env?.MARKET_HISTORY_DB?.prepare) return false;
  try {
    const probe = await env.DB.prepare("SELECT 1 AS healthy").all();
    return streamPreferHistoryPersistence(env, probe?.meta?.size_after);
  } catch {
    return false;
  }
}
