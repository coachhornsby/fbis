import {selectPinnoddsGameMarkets} from "./pinnoddsMarketSelection.js";

/**
 * Prominent board decision: rank priced research candidates independently
 * from qualification. A captured PinnOdds quote is a reference, never
 * executable or proof of a calibrated advantage.
 */
const finite=v=>v==null||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const probability=v=>{const n=finite(v);return n!=null&&n>0&&n<1?n:null};
const marketLabel=v=>String(v??"").replace(/[_-]/g," ").trim().toUpperCase();
const americanReturn=odds=>odds>0?odds/100:100/Math.abs(odds);
const signedAmerican=odds=>odds>0?`+${Math.round(odds)}`:String(Math.round(odds));

function independentMoneyline(game,sport){
 if(sport==="nhl"){
  const p=game?.nhlProV2;
  const home=probability(p?.probability?.homeWinIncludingOt);
  const away=probability(p?.probability?.awayWinIncludingOt);
  const homeId=String(game?.home?.abbr||"").toUpperCase();
  const awayId=String(game?.away?.abbr||"").toUpperCase();
  if(p?.ok!==true||p.independent!==true||p.marketInformed!==false||
    !homeId||!awayId||String(p.home||"").toUpperCase()!==homeId||
    String(p.away||"").toUpperCase()!==awayId||
    game?.nhlUnifiedMoneylineShadow?.probabilityAudit?.ok===false||
    home==null||away==null||Math.abs(home+away-1)>.002)return null;
  return {home,away,provenance:"NHL-PRO-v2 research"};
 }
 if(game?.model?.marketInformed===true||game?.projection?.marketInformed===true||
    game?.model?.independent===false||game?.projection?.independent===false)return null;
 const home=probability(game?.pHome??game?.model?.pHomeFinal??game?.projection?.pHome);
 if(home==null)return null;
 return {home,away:1-home,provenance:"FBIS research probability"};
}

export function rankResearchMoneylines(game={},vm={},now=new Date()){
 const sport=String(game?.sport||vm?.sport||"").toLowerCase();
 if(game?.durableFallback?.statusUnverified===true||game?.status?.completed===true)return {candidates:[],reason:"Game status or snapshot unverified"};
 const start=Date.parse(String(game?.start||""));
 const clock=now instanceof Date?now.getTime():Date.parse(now);
 if(!Number.isFinite(clock))return {candidates:[],reason:"Current time unavailable"};
 if(Number.isFinite(start)&&clock>=start)return {candidates:[],reason:"Pregame market has started"};
 const model=independentMoneyline(game,sport);
 if(!model)return {candidates:[],reason:"No independent event-matched moneyline probabilities"};
 const paired=selectPinnoddsGameMarkets(game).families.moneyline;
 if(!paired||paired.quotes.length!==2)return {candidates:[],reason:"No paired PinnOdds moneyline prices"};
 const candidates=[];
 for(const side of ["home","away"]){
  const q=paired.quotes.find(item=>item.side===side);
  if(!q)continue;
  const odds=finite(q.american);
  const timestamp=Date.parse(String(q.capturedAt||q.collectedAt||""));
  if(odds==null||Math.abs(odds)<100||!Number.isFinite(timestamp)||
    clock-timestamp<0||clock-timestamp>45*60*1000||
    (Number.isFinite(start)&&timestamp>=start))continue;
  const p=model[side],roi=p*(1+americanReturn(odds))-1;
  candidates.push({side,probability:p,odds,roi,provider:"PinnOdds",
    capturedAt:new Date(timestamp).toISOString(),market:"moneyline",
    period:"full_game",provenance:model.provenance,
    executable:false,qualified:false});
 }
 return {candidates:candidates.sort((a,b)=>b.roi-a.roi),reason:candidates.length?null:"No current pregame paired price within 45 minutes"};
}

/** No projected-goal / puck-line / points difference can become EV. */
export function bestValuePresentation(game={},vm={},options={}){
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
 const stored=game?.durableFallback?.statusUnverified===true;
 if(stored)return {status:"pass",heading:"BEST VALUE / DECISION",value:"PRICE UNVERIFIED",
    detail:"STORED PREGAME · CANNOT RANK CURRENT MARKET VALUE",secondary:"RESEARCH ONLY · NO WAGER AUTHORITY"};
 const result=rankResearchMoneylines(game,vm,options.now||new Date());
 const leader=result.candidates[0];
 if(leader&&leader.roi>0){
  const team=leader.side==="home"?vm.home||game.home:vm.away||game.away;
  const abbr=team?.abbr||team?.name||leader.side.toUpperCase();
  return {status:"research",teamSide:leader.side,heading:"RESEARCH VALUE · NOT QUALIFIED",
   value:`${abbr} ML ${signedAmerican(leader.odds)}`,
   detail:`EST. ROI +${(leader.roi*100).toFixed(1)}% · ${(leader.probability*100).toFixed(1)}% MODEL · PINNODDS CAPTURED REFERENCE`,
   secondary:"PRICE / SETTLEMENT NEED VERIFICATION · NOT EXECUTABLE · NO WAGER AUTHORITY",
   research:{...leader,estimated:true}};
 }
 if(leader){
  return {status:"pass",heading:"BEST VALUE / DECISION",value:"NO POSITIVE PRICED VALUE",
   detail:"MODELED MONEYLINE RETURN IS NON-POSITIVE AT CAPTURED PRICES",
   secondary:"PUCK LINE / SPREAD / TOTAL NOT RANKED WITHOUT COVER/OVER PROBABILITIES"};
 }
 if(sport==="nhl"){
  const model=independentMoneyline(game,sport);
  const homeP=model?.home;
  const favorite=homeP!=null?`${homeP>=.5?(vm.home?.abbr||game.home?.abbr||"HOME"):(vm.away?.abbr||game.away?.abbr||"AWAY")} ML`:null;
  return {status:"unpriced",heading:"BEST VALUE / DECISION",value:"VALUE NOT PRICED",
   detail:result.reason||"NO CURRENT COMPARABLE MONEYLINE PRICES",
   secondary:favorite?`MODEL FAVORITE: ${favorite} · RESEARCH ONLY, NOT A BET`:
      "NO INDEPENDENT MATCHED RESEARCH SIGNAL"};
 }
 return {status:"unpriced",heading:"BEST VALUE / DECISION",value:"VALUE NOT PRICED",
   detail:result.reason||"NO CURRENT COMPARABLE MARKET",
   secondary:"MONEYLINE / SPREAD / TOTAL REQUIRE MATCHED PRICES AND OUTCOME PROBABILITIES"};
}
