// Current display eligibility only; retained captures and model/wager authority are untouched.
export function currentActionDisplay(game, now = Date.now(), freshnessSeconds = 600) {
  const intel = game?.actionIntel;
  const actionSentiment = /ACTION/i.test(String(game?.sentiment?.source || ''));
  if (!intel && !actionSentiment) return game;
  const capturedAt = intel?.collectedAt || intel?.sourceObservedAt || game?.sentiment?.collectedAt;
  const ageMs = Number(now) - Date.parse(capturedAt || '');
  if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= freshnessSeconds * 1000) return game;
  return {...game, actionIntel: null, publicSplits: null,
    sentiment: actionSentiment ? null : game.sentiment,
    actionFreshness: {state: 'STALE', reason: 'ACTION_CAPTURE_NOT_CURRENT', capturedAt: capturedAt || null}};
}
