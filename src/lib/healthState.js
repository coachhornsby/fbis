export const HEALTH_STATE = {
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  UNAVAILABLE: "UNAVAILABLE",
  STALE: "STALE",
};

export function badgeLabel(state, meta = {}) {
  const liveOk = meta.liveCollectionHealthy;
  const mode = String(meta.boardSourceMode || meta.sourceMode || "").toUpperCase();
  const cached =
    liveOk === false ||
    mode.includes("CACHE") ||
    mode.includes("FALLBACK") ||
    mode.includes("CACHED");
  if (state === HEALTH_STATE.HEALTHY) {
    // Healthy D1/read path ≠ live provider collection.
    return cached ? "CACHED" : "LIVE";
  }
  if (state === HEALTH_STATE.STALE) return "STALE";
  if (state === HEALTH_STATE.UNAVAILABLE) return "DATA UNAVAILABLE";
  return "DEGRADED";
}

export function badgeTone(state) {
  if (state === HEALTH_STATE.HEALTHY) return "GREEN";
  if (state === HEALTH_STATE.STALE) return "YELLOW";
  if (state === HEALTH_STATE.UNAVAILABLE) return "RED";
  return "YELLOW";
}

export function valueOrUnavailable(unavailable, value, fallback = "—") {
  if (unavailable) return "Unavailable";
  return value ?? fallback;
}

function preferredState(...states) {
  const xs = states.filter(Boolean);
  if (xs.includes(HEALTH_STATE.UNAVAILABLE)) return HEALTH_STATE.UNAVAILABLE;
  if (xs.includes(HEALTH_STATE.STALE)) return HEALTH_STATE.STALE;
  if (xs.includes(HEALTH_STATE.DEGRADED)) return HEALTH_STATE.DEGRADED;
  return HEALTH_STATE.HEALTHY;
}

export function deriveViewState({ apiState, error, stale, hasData = true } = {}) {
  if (error && !hasData) return HEALTH_STATE.UNAVAILABLE;
  if (stale) return HEALTH_STATE.STALE;
  if (apiState === HEALTH_STATE.UNAVAILABLE) return HEALTH_STATE.UNAVAILABLE;
  if (apiState === HEALTH_STATE.STALE) return HEALTH_STATE.STALE;
  if (error || apiState === HEALTH_STATE.DEGRADED) return HEALTH_STATE.DEGRADED;
  return HEALTH_STATE.HEALTHY;
}

export function deriveGlobalState({ activeTab, pipelineState, todayState, betsState, sysState, boardState } = {}) {
  if (activeTab === "today") return preferredState(todayState, pipelineState);
  if (activeTab === "bets") return preferredState(betsState, pipelineState);
  if (activeTab === "sys") return preferredState(sysState, pipelineState);
  return preferredState(boardState, pipelineState);
}
