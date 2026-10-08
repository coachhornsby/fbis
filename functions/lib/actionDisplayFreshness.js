import {actionTemporalValidity, historicalActionRows, currentActionRows} from './actionTemporalValidity.js';
// Current display eligibility only; retained captures and model/wager authority are untouched.
export function currentActionDisplay(game, now = Date.now(), freshnessSeconds = 600) {
  const intel = game?.actionIntel;
  const actionSentiment = /ACTION/i.test(String(game?.sentiment?.source || ''));
  if (!intel && !actionSentiment) return game;
  const capturedAt = intel ? intel.collectedAt : game?.sentiment?.collectedAt;
  if (actionTemporalValidity({collectedAt:capturedAt,sourceObservedAt:intel?.sourceObservedAt ?? intel?.observedAt}, {now,freshnessSeconds}).valid) {
    if (!Array.isArray(intel?.lineHistory)) return game;
    const history=historicalActionRows(intel.lineHistory,{now});
    // Keep older opening context only alongside a valid current terminal row.
    const latest=history.slice().sort((a,b)=>Date.parse(a.collectedAt||a.collected_at)-Date.parse(b.collectedAt||b.collected_at)).at(-1);
    const lineHistory=currentActionRows(latest?[latest]:[],{now,freshnessSeconds}).length?history:[];
    return {...game,actionIntel:{...intel,lineHistory}};
  }
  return {...game, actionIntel: null, publicSplits: null,
    sentiment: actionSentiment ? null : game.sentiment,
    actionFreshness: {state: 'STALE', reason: 'ACTION_CAPTURE_NOT_CURRENT', capturedAt: capturedAt || null}};
}
