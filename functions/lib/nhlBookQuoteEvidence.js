/**
 * Source-time and capture-time classification. Research audit only.
 * Never infer original sportsbook timestamp from a response/receipt clock.
 */
export function classifyNhlQuoteEvidence({ gameStart, sourceObservedAt, capturedAt }) {
 const captured=Date.parse(capturedAt||"");
 if(!Number.isFinite(captured))return {valid:false,captureClass:"UNKNOWN_START",sourceObservedAt:null};
 const kickoff=Date.parse(gameStart||"");
 if(!Number.isFinite(kickoff))return {valid:true,captureClass:"UNKNOWN_START",sourceObservedAt:null};
 if(captured>=kickoff)return {valid:true,captureClass:"POST_START",sourceObservedAt:null};
 const observed=Date.parse(sourceObservedAt||"");
 const verified=Number.isFinite(observed)&&observed<=captured&&observed<kickoff;
 return {
  valid:true,
  captureClass:verified?"PREGAME_SOURCE_TIME_VERIFIED":"PREGAME_UNVERIFIED_SOURCE_TIME",
  sourceObservedAt:verified?new Date(observed).toISOString():null,
 };
}
