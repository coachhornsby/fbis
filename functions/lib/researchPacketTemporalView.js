import {buildNflWagerIntelligence} from "./nflWagerDecision.js";
import {currentActionDisplay} from './actionDisplayFreshness.js';
// Saved confidence/market-intelligence fields may embed old ACTION derivations.
// Preserve owned price/probability/EV and recorded decisions, not stale advisory values.
function withoutSavedActionDerivation(candidate) {
  return candidate?{...candidate,marketIntelligence:null,rawConfidenceScore:null,
    confidenceScore:null,confidenceBin:null,confidenceGatePassed:null}:candidate;
}
// Exported research is a point-in-time record, never a reusable current decision.
// Stored/raw packets are not modified. Apply this view after every JSON reload.
export function researchPacketTemporalView(packet={}, {now=Date.now()}={}) {
  const games=(packet.games||[]).map(game=>{
    const view=currentActionDisplay(game,now);
    const decision=game.nflWagerDecision;
    // Older packets may contain derived ACTION comparisons without raw evidence.
    // Do not infer provenance from the packet's generation/save timestamp.
    const validAction=Boolean(view.actionIntel);
    return {...view,temporalUse:'HISTORICAL_RESEARCH',currentUse:false,
      ...(decision?{nflWagerDecision:{...decision,
        confidenceScore:null,
        candidates:(decision.candidates||[]).map(withoutSavedActionDerivation),
        bestWager:withoutSavedActionDerivation(decision.bestWager),
        wagerIntelligence:validAction?buildNflWagerIntelligence(view,decision.independentProjection||{},{decisionAt:now}):null}}:{})};
  });
  return {...packet,games,temporalUse:'HISTORICAL_RESEARCH',currentUse:false};
}
