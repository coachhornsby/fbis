/**
 * One decision for the prominent bar on compact and expanded game cards.
 * Projected margin/total line deltas are NOT betting EV or expected return.
 * NHL research is frozen and cannot authorize wagers.
 */
const finite=v=>v==null||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const marketLabel=v=>String(v??"").replace(/[_-]/g," ").trim().toUpperCase();
export function bestValuePresentation(game={},vm={}){
 const sport=String(game.sport||vm.sport||"").toLowerCase();
 const eligible=game?.canQualify===true&&game?.canAuthorizeWager===true&&
  vm?.decision?.evAvailable===true&&vm?.decision?.executionActionable===true&&
  vm?.decision?.qualification==="QUALIFIED"&&
  !!game?.rec?.pick&&!!game?.rec?.market&&finite(vm.decision.ev)>0;
 if(eligible){
  const roi=finite(vm.decision.ev);
  const side=String(game.rec.side||game.rec.selection||"").toLowerCase();
  const teamSide=side==="home"||side==="away"?side:null;
  const totalDirection=side==="over"||side==="under"?side:null;
  return {status:"qualified",teamSide,totalDirection,heading:"PRICE-SUPPORTED VALUE",value:String(game.rec.pick),
   detail:`${marketLabel(game.rec.market)} · EST. EV +${roi.toFixed(1)}% · VERIFIED EXECUTION INPUT`,
   secondary:"See market details and confirm price before placing a bet"};
 }
 if(game?.durableFallback?.statusUnverified===true){
  return {status:"pass",heading:"BEST VALUE / DECISION",value:"NO VERIFIED BET",
   detail:"STORED PREGAME · CURRENT PRICES UNVERIFIED",secondary:"PASS"};
 }
 if(sport==="nhl"){
  const pro=game.nhlProV2;
  const evidence=pro?.ok===true&&pro.independent===true&&pro.marketInformed===false;
  const homeP=evidence?finite(pro?.probability?.homeWinIncludingOt):null;
  const modelFavorite=homeP!=null&&homeP>0&&homeP<1?
   `${homeP>=.5?(vm.home?.abbr||game.home?.abbr||"HOME"):(vm.away?.abbr||game.away?.abbr||"AWAY")} ML`:null;
  return {status:"pass",heading:"BEST VALUE / DECISION",value:"NO VERIFIED BET",
   detail:"NHL ML / PUCK LINE / TOTAL · NO QUALIFIED POSITIVE-EV MARKET",
   secondary:modelFavorite?`MODEL FAVORITE: ${modelFavorite} · RESEARCH ONLY, NOT A BET`:
     "MODEL AND MARKET EVIDENCE NOT YET QUALIFIED"};
 }
 return {status:"pass",heading:"BEST VALUE / DECISION",value:"NO VERIFIED BET",
  detail:"NO QUALIFIED, PRICE-SUPPORTED MARKET SELECTION",
  secondary:"ML / SPREAD / TOTAL · RAW LINE GAPS ARE NOT EXPECTED RETURN"};
}
