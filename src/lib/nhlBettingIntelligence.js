/**
 * NHL game-card market research. Read-only presentation contract.
 * Never promotes model confidence, stale references, exchange display prices,
 * Action sentiments, or collector capture clocks to wagering evidence.
 */
import { buildNhlCardEvidence } from "./nhlCardEvidence.js";

const n=v=>v==null||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const label=v=>String(v??"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"");
const stamp=(v,now,maxAgeMs)=>{
  const ms=Date.parse(String(v||""));
  const age=now.getTime()-ms;
  return Number.isFinite(ms)&&Number.isFinite(age)&&age>=0&&age<=maxAgeMs?ms:null;
};
const periodValid=v=>["num_0","full_game","fullgame","game"].includes(label(v).replace("num0","num_0"));
const overTimeSafety=(item)=>item?.raw?.settlementVerified===true&&item?.raw?.includesOvertimeAndShootout===true;
export function impliedProbability(american){
  const a=n(american);
  if(a==null||a===0||Math.abs(a)<100)return null;
  return a<0?-a/(100-a):100/(a+100);
}
export function pairedNoVig(homeAmerican,awayAmerican){
  const h=impliedProbability(homeAmerican),a=impliedProbability(awayAmerican);
  if(h==null||a==null||h+a<=0)return null;
  return {home:h/(h+a),away:a/(h+a)};
}
const providerTime=o=>o?.raw?.collectorCapturedAt||o?.collectedAt||o?.observedAt||null;
const source=o=>label(o?.source);
const offersFor=game=>Array.isArray(game?.market?.venueOffers)?game.market.venueOffers:[];
const safePrice=v=>{const x=n(v);return x!=null&&x>0&&x<1?x:null};
function pairedPinnOdds(offers,now){
  const rows=offers.filter(o=>source(o)==="pinnodds"&&label(o.marketFamily)==="moneyline"&&periodValid(o.period)&&
    stamp(providerTime(o),now,45*60*1000)!=null&&
    (n(o?.raw?.boardAgeMs)==null||n(o.raw.boardAgeMs)<=300000)&&
    ["home","away"].includes(label(o.side)));
  const byMarket=new Map();
  for(const o of rows){
    const key=[String(o.sourceMarketId||""),String(o.period||"")].join("|");
    const set=byMarket.get(key)||{};
    set[label(o.side)]=o;
    byMarket.set(key,set);
  }
  for(const {home,away} of byMarket.values()){
    if(!home||!away)continue;
    const probs=pairedNoVig(home.americanOdds,away.americanOdds);
    if(probs)return {...probs,homeOdds:n(home.americanOdds),awayOdds:n(away.americanOdds),
      capturedAt:providerTime(home),source:"PinnOdds",role:"NON_EXECUTABLE_REFERENCE"};
  }
  return null;
}
function sideOf(o,vm){
  const side=label(o?.side);
  if(side==="home"||side==="away")return side;
  for(const direction of ["home","away"]){
    const team=vm?.[direction]||{};
    if(side&&[team.name,team.fullName,team.abbr].some(x=>label(x)===side))return direction;
  }
  return null;
}
function polymarket(offers,vm,now,selection){
  const refs=offers.filter(o=>source(o)==="polymarketus"&&label(o.marketFamily)==="moneyline"&&
    periodValid(o.period)&&sideOf(o,vm)===selection&&stamp(providerTime(o),now,15*60*1000)!=null&&
    safePrice(o.contractPrice)!=null);
  const reference=refs.sort((a,b)=>Date.parse(providerTime(b))-Date.parse(providerTime(a)))[0]||null;
  const books=offers.filter(o=>source(o)==="polymarketuswebsocket"&&label(o.marketFamily)==="moneyline"&&
    periodValid(o.period)&&sideOf(o,vm)===selection&&stamp(providerTime(o),now,15*60*1000)!=null);
  const bbo=books.sort((a,b)=>Date.parse(providerTime(b))-Date.parse(providerTime(a)))[0]||null;
  const bid=safePrice(bbo?.raw?.bestBid??bbo?.bestBid);
  const ask=safePrice(bbo?.raw?.bestAsk??bbo?.bestAsk);
  return {
    display:safePrice(reference?.contractPrice),displayAt:reference?providerTime(reference):null,
    bid,ask,askAt:bbo?providerTime(bbo):null,
    spread:bid!=null&&ask!=null&&ask>=bid?ask-bid:null,
    depth:null, // Current MARKET_DATA_LITE collector does NOT provide share quantities.
    comparable:Boolean((bbo||reference)&&overTimeSafety(bbo||reference)),
    executable:false, // Even a real BBO never guarantees a fill.
    sourceMarketId:bbo?.sourceMarketId||reference?.sourceMarketId||null
  };
}
function actionIntel(action,side,now){
  if(!action?.available||stamp(action.collectedAt,now,4*60*60*1000)==null)
    return {available:false,tickets:null,money:null,movement:null,divergence:null};
  const t=n(action.tickets?.[side+"Pct"]),m=n(action.money?.[side+"Pct"]);
  const tickets=t!=null&&t>=0&&t<=100?t:null;
  const money=m!=null&&m>=0&&m<=100?m:null;
  // The underlying Action snapshot may be spread, total, or unspecified:
  // never label its splits as moneyline-specific without a matching family.
  const family=label(action?.advanced?.marketFamily||action?.advanced?.publicSplitsMarket);
  const marketMatched=family==="moneyline"||family==="ml";
  return {available:Boolean(tickets!=null||money!=null||action.lineMove?.label),
    tickets,money,movement:action.lineMove?.label||action.movement?.label||null,
    divergence:tickets!=null&&money!=null?money-tickets:null,
    marketMatched,sourceAt:action.collectedAt};
}
export function buildNhlBettingIntelligence(game,vm,{now=new Date()}={}){
  if(label(game?.sport||vm?.sport)!=="nhl")return null;
  const evidence=buildNhlCardEvidence(game,vm);
  const valid=Boolean(evidence?.moneyline?.valid);
  const p=valid?game.nhlProV2.probability:null;
  const model=valid?{home:n(p.homeWinIncludingOt),away:n(p.awayWinIncludingOt)}:null;
  const offers=offersFor(game);
  const pinn=pairedPinnOdds(offers,now);
  const choose=()=>{
    if(!model)return "home";
    if(pinn){
      return (model.away-pinn.away)>(model.home-pinn.home)?"away":"home";
    }
    return model.away>model.home?"away":"home";
  };
  const selection=choose(),team=vm?.[selection]||{};
  const poly=polymarket(offers,vm,now,selection);
  const probability=model?.[selection]??null;
  const fair=pinn?.[selection]??null;
  const edge=probability!=null&&fair!=null?probability-fair:null;
  const polyGap=probability!=null&&poly.comparable&&poly.ask!=null?probability-poly.ask:null;
  const action=actionIntel(vm?.action,selection,now);
  const hasIndependentPrice=Boolean(pinn);
  const limitations=[];
  if(!valid)limitations.push("Independent NHL moneyline probability not verified");
  if(!pinn)limitations.push("No fresh paired PinnOdds moneyline");
  if(!poly.ask)limitations.push("No fresh matched Polymarket best ask");
  if(poly.ask&&!poly.comparable)limitations.push("Exchange settlement equivalence unverified");
  if(!action.available)limitations.push("No current Action split or line movement");
  return {
    selection,abbr:team.abbr||selection.toUpperCase(),team,
    modelProbability:probability,opponentProbability:model?.[selection==="home"?"away":"home"]??null,
    pinnedProbability:fair,pinnOdds: pinn?.[selection+"Odds"]??null,pinnCapturedAt:pinn?.capturedAt||null,
    gap:edge,polyGap,poly,action,
    headline:valid?(hasIndependentPrice?"MODEL / SHARP GAP":"FBIS MODEL · RESEARCH"):"MODEL PROBABILITY · N/A",
    betStatus:"RESEARCH ONLY",canQualify:false,canAuthorizeWager:false,
    limitations,modelId:evidence?.model||"NHL-PRO-v2",
    goalies:evidence?.goalies, // available to approved matchup logic; no separate goalie panel.
  };
}
