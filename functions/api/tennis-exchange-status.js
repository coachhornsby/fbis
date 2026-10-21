import {loadPolymarketUsTennisInventory} from "../lib/tennisExchangeInventory.js";
import {loadKalshiTennisResearch,TENNIS_KALSHI_SPORTS} from "../lib/tennisKalshiResearch.js";
import {kalshiTennisContractPairs} from "../lib/tennisKalshiInventory.js";
const respond=(body,status=200)=>Response.json(body,{status,headers:{
 "cache-control":"no-store","x-content-type-options":"nosniff"}});
/** Public source coverage only: no model probabilities or wager authority. */
export async function onRequestGet({env}){
 const now=new Date();
 const [polymarket,kalshi]=await Promise.all([
  loadPolymarketUsTennisInventory(env?.ARCHIVE,{now}),
  loadKalshiTennisResearch(env,now)]);
 const pairs=kalshiTennisContractPairs(kalshi,now);
 const byTour=Object.fromEntries(["atp","wta"].map(tour=>{
  const events=(polymarket.events||[]).filter(x=>x.tour===tour);
  const currentPairs=pairs.filter(p=>p.tour===tour);
  return [tour,{polymarketUsEvents:events.length,
    polymarketUsMoneylineEvents:events.filter(x=>x.offers?.length>0).length,
    polymarketUsQuotedSides:events.reduce((n,x)=>n+(x.offers?.length||0),0),
    kalshiContractEvents:currentPairs.length,
    kalshiQuotedSides:currentPairs.reduce((n,x)=>n+x.offers.filter(o=>o.yesAskDollars!=null).length,0)}];
 }));
 const dates={};
 for(const e of polymarket.events||[]){
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",
   year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(e.start));
  dates[date]=(dates[date]||0)+1;
 }
 const kalshiBySeries=Object.fromEntries(TENNIS_KALSHI_SPORTS.map(sport=>{
  const matches=pairs.filter(p=>p.seriesSport===sport);
  return [sport,{status:kalshi[sport+"Status"]||"NO_FRESH_SNAPSHOT",
   matchedEvents:matches.length,quotedSides:matches.reduce((n,x)=>n+
    x.offers.filter(o=>o.yesAskDollars!=null).length,0)}];
 }));
 const polyOk=Boolean(polymarket.ok);
 const kalshiOk=pairs.length>0;
 const ok=polyOk||kalshiOk;
 return respond({ok,source:"POLYMARKET_AND_KALSHI",
  status:polyOk&&kalshiOk?"BOTH_EXCHANGES_PRESENT":ok?"SINGLE_EXCHANGE_PRESENT":"NO_FRESH_EXCHANGE_INVENTORY",
  sources:{
   polymarketUs:{available:polyOk,status:polymarket.code,
    capturedAt:polymarket.capturedAt||null,complete:polymarket.complete===true,
    events:polymarket.events?.length||0,sources:polymarket.sources||[]},
   kalshi:{available:kalshiOk,status:kalshi.status,
    atpStatus:kalshi.atpStatus,wtaStatus:kalshi.wtaStatus,
    bySeries:kalshiBySeries,events:pairs.length,quotedSides:pairs.reduce((n,x)=>n+x.offers.filter(o=>o.yesAskDollars!=null).length,0)}
  },inventoryFresh:ok,byTour,byDate:dates,
  modelIndependent:true,quotesDoNotGuaranteeExecution:true,
  canQualify:false,canAuthorizeWager:false},ok?200:503);
}
export async function onRequestPost(){return respond({ok:false,error:"READ_ONLY"},405)}
