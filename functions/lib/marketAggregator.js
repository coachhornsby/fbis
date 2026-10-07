import { priceMarketOffer, normalizeMarketOffer } from "./normalizedMarket.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const key=o=>[o.sport,o.eventId||"",norm(o.playerName||""),o.marketFamily,o.statFamily||"",o.period||"",o.side||""].join("|");
const thresholdKey=o=>[o.sport,o.eventId||"",norm(o.playerName||""),o.marketFamily,o.statFamily||"",o.period||""].join("|");

function probabilityAt(model,offer){
 if(typeof model?.probabilityAtLine==="function")return finite(model.probabilityAtLine({line:offer.line,side:offer.side,offer}));
 if(model?.probabilitiesByLine&&offer.line!=null){
   const p=finite(model.probabilitiesByLine[String(offer.line)]?.[offer.side]);if(p!=null)return p;
 }
 if(offer.marketFamily==="moneyline"){
   if(offer.side==="home")return finite(model?.homeWinProbability??model?.probability);
   if(offer.side==="away"){const h=finite(model?.homeWinProbability);return h==null?finite(model?.probability):1-h}
 }
 return finite(model?.probability);
}
function pairOdds(offer,offers){
 const opp=offer.side==="over"?"under":offer.side==="under"?"over":offer.side==="home"?"away":offer.side==="away"?"home":null;
 if(!opp)return null;
 const hit=offers.find(x=>x.source===offer.source&&key(x)===key({...offer,side:opp})&&x.line===offer.line);
 return finite(hit?.americanOdds);
}
export function compareMarketOffers({model={},offers=[],nowMs=Date.now(),staleAfterMs=45*60*1000,outlierThreshold=2}={}){
 const normalized=offers.map(normalizeMarketOffer);
 const priced=normalized.map(o=>priceMarketOffer(o,{modelProbability:probabilityAt(model,o),pairedAmericanOdds:pairOdds(o,normalized)}));
 const groups=new Map();
 for(const o of priced){const k=thresholdKey(o);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(o)}
 const comparisons=[];
 for(const rows of groups.values()){
   const lines=rows.map(x=>finite(x.line)).filter(x=>x!=null),median=lines.length?[...lines].sort((a,b)=>a-b)[Math.floor(lines.length/2)]:null;
   const annotated=rows.map(x=>{const ts=Date.parse(x.fetchedAt||"");return {...x,stale:!Number.isFinite(ts)||nowMs-ts>staleAfterMs,outlier:median!=null&&x.line!=null&&Math.abs(x.line-median)>=outlierThreshold}});
   const overs=annotated.filter(x=>x.side==="over"&&x.line!=null),unders=annotated.filter(x=>x.side==="under"&&x.line!=null);
   const executable=annotated.filter(x=>x.sourceType==="sportsbook"&&x.americanOdds!=null&&x.modelProbability!=null);
   const bestEv=executable.filter(x=>x.expectedReturnPerUnitRisk!=null).sort((a,b)=>b.expectedReturnPerUnitRisk-a.expectedReturnPerUnitRisk)[0]||null;
   const lineSpan=lines.length?Math.max(...lines)-Math.min(...lines):null;
   comparisons.push({sport:rows[0]?.sport,eventId:rows[0]?.eventId,playerName:rows[0]?.playerName,marketFamily:rows[0]?.marketFamily,statFamily:rows[0]?.statFamily,
     bestOverThreshold:overs.sort((a,b)=>a.line-b.line)[0]||null,bestUnderThreshold:unders.sort((a,b)=>b.line-a.line)[0]||null,
     bestDirectlyPricedOffer:bestEv,largestThresholdDiscrepancy:lineSpan,
     lineShoppingFlag:lineSpan==null?"NO_THRESHOLD_COMPARISON":lineSpan>=2?"VERIFY_OUTLIER":lineSpan>=1?"1.0+ UNIT DISAGREEMENT":lineSpan>=0.5?"0.5 UNIT DISAGREEMENT":"SAME/NEAR LINE",
     offers:annotated,governance:"INFORMATIONAL_ONLY"});
 }
 const conventional=priced.filter(x=>x.sourceType==="sportsbook"&&x.rawImpliedProbability!=null);
 const consensus=conventional.length?conventional.map(x=>x.rawImpliedProbability).sort((a,b)=>a-b):[];
 return {ok:true,projectionAuthority:"INDEPENDENT_MODEL_ONLY",offers:priced,comparisons,diagnostics:{
   conventionalOfferCount:conventional.length,consensusImpliedProbability:consensus.length?consensus.reduce((a,b)=>a+b,0)/consensus.length:null,
   medianImpliedProbability:consensus.length?consensus[Math.floor(consensus.length/2)]:null},authority:{canQualify:false,canAuthorize:false}};
}
