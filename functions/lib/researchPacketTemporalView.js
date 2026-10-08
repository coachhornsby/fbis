import {buildNflWagerIntelligence} from "./nflWagerDecision.js";
import {currentActionDisplay} from './actionDisplayFreshness.js';
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
        wagerIntelligence:validAction?buildNflWagerIntelligence(view,decision.independentProjection||{},{decisionAt:now}):null}}:{})};
  });
  return {...packet,games,temporalUse:'HISTORICAL_RESEARCH',currentUse:false};
}
