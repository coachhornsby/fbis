/** Read-only production heartbeat evaluation. Never calls a billable market provider. */
const ageMinutes = (value, now) => {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? Math.max(0, Math.round((now - time) / 60000)) : null;
};
const recent = (age, max) => age != null && age <= max;
export function evaluateMarketHeartbeat({pinnodds, polymarket, stream, now = Date.now()} = {}) {
  const failures = [], warnings = [];
  const addFail = message => failures.push(message);
  const addWarn = message => warnings.push(message);
  if (pinnodds?.ok !== true || !Array.isArray(pinnodds.results)) addFail("PINNODDS_STATUS_UNAVAILABLE");
  if (polymarket?.ok !== true || !Array.isArray(polymarket.sports)) addFail("POLYMARKET_STATUS_UNAVAILABLE");
  if (stream?.ok !== true) addFail("POLYMARKET_STREAM_HEALTH_UNAVAILABLE");
  const boards = (pinnodds?.results || []).filter(x => x.kind === "board");
  const freshBoards = boards.filter(x => recent(ageMinutes(x.collectedAt, now), 8 * 60));
  const incompleteBoards = freshBoards.filter(x => x.reconciled !== true);
  const newestPinnodds = freshBoards.reduce((max, x) => {
    const t = Date.parse(x.collectedAt || "");
    return Number.isFinite(t) ? Math.max(max,t) : max;
  }, 0);
  if (pinnodds?.ok === true) {
    if (!freshBoards.length) addFail("PINNODDS_NO_RECENT_FULL_BOARD_8H");
    else if (freshBoards.length !== 12) addWarn("PINNODDS_PARTIAL_FULL_BOARD");
    if (incompleteBoards.length) addWarn("PINNODDS_UNRECONCILED_BOARD");
  }
  const rests = (polymarket?.sports || []).filter(x => x.lastCapture);
  const recentRest = rests.reduce((max, x) => {
    const t = Date.parse(x.lastCapture);
    return Number.isFinite(t) ? Math.max(max,t) : max;
  }, 0);
  const restAgeMinutes = recentRest ? ageMinutes(new Date(recentRest).toISOString(), now) : null;
  if (polymarket?.ok === true && !recent(restAgeMinutes, 180)) addWarn("POLYMARKET_REST_CAPTURE_OVER_3H");
  const socketIdle = stream?.lastError === "no-active-markets";
  const connected = stream?.connected === true;
  const operational = stream?.operational === true && connected;
  if (stream?.ok === true && !operational && !socketIdle) addFail("POLYMARKET_WEBSOCKET_NOT_OPERATIONAL");
  if (polymarket?.ok === true && operational && polymarket.signedMarketWebsocket?.operational !== true) addWarn("POLYMARKET_STATUS_DISAGREES_WITH_STREAM");
  const persistedWsAgeMinutes = ageMinutes(polymarket?.signedMarketWebsocket?.lastBboCapture, now);
  if (operational && !recent(persistedWsAgeMinutes, 60)) addWarn("POLYMARKET_WEBSOCKET_NO_BBO_PERSISTED_60M");
  return {
    ok: failures.length === 0, failures, warnings,
    checkedAt: new Date(now).toISOString(), readOnly: true, paidProviderCalls: 0,
    pinnodds: {freshFullBoardScopes: freshBoards.length, expectedFullBoardScopes: 12,
      unreconciledFreshScopes: incompleteBoards.length,
      newestBoardAt: newestPinnodds ? new Date(newestPinnodds).toISOString() : null},
    polymarket: {lastRestCaptureAt: recentRest ? new Date(recentRest).toISOString() : null,
      restCaptureAgeMinutes: restAgeMinutes},
    websocket: {connected, operational, idleNoActiveMarkets: socketIdle,
      lastMessageAt: stream?.lastMessageAt || null,
      lastHeartbeatAt: stream?.lastHeartbeatAt || null,
      lastBboPersistedAt: polymarket?.signedMarketWebsocket?.lastBboCapture || null,
      persistedBboAgeMinutes: persistedWsAgeMinutes,
      lastError: stream?.lastError || null}
  };
}
