/**
 * Exchange-native Tennis catalogue. The presence of a public Polymarket US
 * event is sufficient for a RESEARCH market card, not for an FBIS projection
 * or executable wager. The public board only reads a bounded R2 snapshot;
 * provider calls run through the authenticated scheduled collector.
 */
import {POLY_US_API,marketEventStart,polymarketUsMarketOffers} from "./polymarketUs.js";
import {matchKalshiTennisResearch} from "./tennisKalshiResearch.js";
import {matchPolymarketGlobalTennis} from "./tennisPolymarketGlobal.js";

export const TENNIS_EXCHANGE_INVENTORY_KEY="tennis/exchange-inventory/polymarket-us-v1.json";
const MAX_PAGES=18,PAGE_SIZE=20;
const norm=x=>String(x||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
 .toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const key=(tour,a,b)=>[String(tour||"").toLowerCase(),...([norm(a),norm(b)].sort())].join("|");
const ctDate=value=>{
 const time=Date.parse(value||"");
 if(!Number.isFinite(time))return null;
 const pieces=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(time));
 const read=part=>pieces.find(x=>x.type===part)?.value;
 return [read("year"),read("month"),read("day")].join("-");
};
export function tennisExchangePlayers(title){
 if(/[\/&]/.test(String(title||"")))return null; // doubles require distinct contract
 const parts=String(title||"").split(/\s+(?:vs?\.?|versus)\s+/i).map(x=>x.trim());
 if(parts.length!==2||parts.some(x=>norm(x).split(" ").length<2)||
   norm(parts[0])===norm(parts[1]))return null;
 return parts;
}
const validMoneyline=(o,players)=>{
 if(o.marketFamily!=="moneyline"||typeof o.raw?.contractLong!=="boolean"||
  !(Number(o.contractPrice)>=0&&Number(o.contractPrice)<=1)||o.contractPrice==null)return false;
 return players.some(p=>norm(p)===norm(o.side));
};
export function normalizePolymarketUsTennisEvent(e,tour,now=new Date()){
 const names=tennisExchangePlayers(e?.title);
 const start=marketEventStart(e),ms=Date.parse(start||"");
 const seen=now.getTime();
 if(!names||!Number.isFinite(ms)||ms<seen-48*3600000||ms>seen+72*3600000||
  e?.id==null||!/^[a-z0-9_-]{1,160}$/i.test(String(e.id))||
  (e?.seriesSlug && !String(e.seriesSlug).toLowerCase().startsWith(tour)))return null;
 const eventId=String(e.id),id="tennis:polyus:"+tour+":"+eventId;
 const offers=polymarketUsMarketOffers(e,"tennis",{canonicalId:id,capturedAt:now.toISOString()})
  .filter(o=>validMoneyline(o,names)).map(o=>({
    source:o.source,sourceMarketId:o.sourceMarketId,
    sourceOutcomeId:o.sourceOutcomeId,marketFamily:"moneyline",
    side:norm(o.side)===norm(names[0])?"home":"away",
    participantName:o.side,contractPrice:o.contractPrice,
    collectedAt:now.toISOString(),providerObservedAt:null,
    sourceObservedAt:null,quoteKind:"DISPLAY_REFERENCE_NOT_EXECUTABLE",
    canQualify:false,canAuthorizeWager:false,executionEligible:false}));
 return {id,providerEventId:eventId,tour,start:new Date(ms).toISOString(),
  player1:names[0],player2:names[1],
  title:String(e.title),marketUrl:"https://polymarket.us/sports/"+tour+"/"+String(e.slug||""),
  providerSeries:String(e.seriesSlug||tour),providerState:String(e.eventState?.type||"UNVERIFIED"),
  marketCount:Number(e.marketCounts?.numMarkets)||e.markets?.length||0,
  offers,source:"POLYMARKET_US_PUBLIC",capturedAt:now.toISOString(),
  canQualify:false,canAuthorizeWager:false};
}
async function pageJson(fetchImpl,tour,offset,now){
 const url=new URL("/v1/events",POLY_US_API);
 for(const [name,value] of Object.entries({tagSlug:tour,active:"true",closed:"false",
  startTimeMin:new Date(+now-48*3600000).toISOString(),
  startTimeMax:new Date(+now+72*3600000).toISOString(),
  limit:PAGE_SIZE,offset,orderBy:"id",orderDirection:"asc"}))
  url.searchParams.set(name,String(value));
 const response=await fetchImpl(url.toString(),{headers:{accept:"application/json"},
  signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error("TENNIS_PROVIDER_HTTP_"+response.status);
 const body=await response.json();
 if(!Array.isArray(body?.events)||body.events.length>PAGE_SIZE)
  throw Error("TENNIS_PROVIDER_SCHEMA_INVALID");
 return body.events;
}
export async function collectPolymarketUsTennisInventory(env,{now=new Date(),fetchImpl=fetch}={}){
 if(!env.ARCHIVE?.put)throw Error("TENNIS_R2_BINDING_MISSING");
 const events=new Map(),sources=[],errors=[];
 for(const tour of ["atp","wta"]){
  const seenPages=new Set();let complete=false,pagesFetched=0;
  for(let page=0;page<MAX_PAGES;page++){
   const offset=page*PAGE_SIZE;let entries;
   try{entries=await pageJson(fetchImpl,tour,offset,now)}
   catch(e){errors.push({tour,code:String(e.message||e).slice(0,95)});break}
   pagesFetched++;
   const signature=entries.map(e=>String(e?.id)).join("|");
   if(entries.length&&seenPages.has(signature)){
    errors.push({tour,code:"REPEATED_PROVIDER_PAGE"});break;
   }
   if(entries.length)seenPages.add(signature);
   for(const entry of entries){
    const value=normalizePolymarketUsTennisEvent(entry,tour,now);
    if(value)events.set(value.id,value);
   }
   if(entries.length<PAGE_SIZE){complete=true;break}
  }
  sources.push({tour,pagesFetched,complete});
  if(!complete&&!errors.some(x=>x.tour===tour))
   errors.push({tour,code:"PROVIDER_PAGINATION_LIMIT"});
 }
 const snapshot={version:1,source:"POLYMARKET_US_PUBLIC",
  capturedAt:now.toISOString(),events:[...events.values()],
  sources,complete:errors.length===0,errors,
  scope:"ACTIVE_TENNIS_SINGLES_48H_BACK_72H_FORWARD",
  canQualify:false,canAuthorizeWager:false};
 if(snapshot.events.length)await env.ARCHIVE.put(TENNIS_EXCHANGE_INVENTORY_KEY,JSON.stringify(snapshot));
 return {ok:snapshot.events.length>0,complete:snapshot.complete,
  events:snapshot.events.length,atp:snapshot.events.filter(e=>e.tour==="atp").length,
  wta:snapshot.events.filter(e=>e.tour==="wta").length,
  sources,errors,capturedAt:snapshot.capturedAt};
}
export async function loadPolymarketUsTennisInventory(archive,{now=new Date(),maxAgeMs=25*60000}={}){
 if(!archive?.get)return {ok:false,code:"EXCHANGE_ARCHIVE_UNAVAILABLE",events:[]};
 try{
  const object=await archive.get(TENNIS_EXCHANGE_INVENTORY_KEY);
  if(!object)return {ok:false,code:"NO_EXCHANGE_INVENTORY",events:[]};
  const snapshot=await object.json(),at=Date.parse(snapshot?.capturedAt||"");
  if(snapshot?.version!==1||snapshot?.source!=="POLYMARKET_US_PUBLIC"||
   !Array.isArray(snapshot.events)||!Number.isFinite(at)||at>+now||
   +now-at>maxAgeMs)return {ok:false,code:"STALE_OR_INVALID_EXCHANGE_INVENTORY",events:[]};
  return {ok:true,code:snapshot.complete?"SOURCE_COMPLETE":"SOURCE_PARTIAL",
   complete:snapshot.complete,events:snapshot.events,
   sources:snapshot.sources,capturedAt:snapshot.capturedAt};
 }catch{return {ok:false,code:"EXCHANGE_INVENTORY_READ_FAILED",events:[]};}
}
export function mergePolymarketUsTennisCards(games=[],inventory={},{date,now=new Date(),kalshi={},polymarketGlobal={}}={}){
 const output=[...games],added=[];
 if(!inventory?.ok)return {games:output,added,matchedExisting:0,status:inventory?.code||"NO_EXCHANGE_INVENTORY"};
 let matchedExisting=0;
 for(const event of inventory.events||[]){
  if(ctDate(event.start)!==date)continue;
  const options=output.filter(g=>
   String(g.sport)==="tennis"&&String(g.tour||g.tennisProjection?.tour||"").toLowerCase()===event.tour&&
   key(event.tour,g.home?.fullName||g.home?.name,g.away?.fullName||g.away?.name)===
   key(event.tour,event.player1,event.player2)&&
   Math.abs(Date.parse(g.start)-Date.parse(event.start))<=2*3600000);
  const fixture={tour:event.tour,start:event.start,home_name:event.player1,away_name:event.player2};
  const kalshiResearchOffers=matchKalshiTennisResearch(fixture,kalshi[event.tour]||[],now);
  const polymarketGlobalOffers=matchPolymarketGlobalTennis(fixture,polymarketGlobal.events||[],{
   now,asOf:polymarketGlobal.asOf||now.toISOString()});
  const enriched={...event,kalshiResearchOffers,polymarketGlobalOffers};
  if(options.length===1){
   const g=options[0],t=g.tennisProjection||{},old=t.venueOffers||[];
   // Provider listing order is not the canonical FBIS home/away order.
   // Rebind BOTH player outcomes to the existing card's verified names.
   const homeName=g.home?.fullName||g.home?.name;
   const reoriented=event.offers.map(o=>({...o,side:
    norm(o.participantName)===norm(homeName)?"home":"away"}));
   const unique=new Map([...old,...reoriented].map(o=>[[o.source,o.sourceMarketId,o.sourceOutcomeId].join("|"),o]));
   g.tennisProjection={...t,venueOffers:[...unique.values()],
    polymarketUsMarketUrl:event.marketUrl,polymarketUsEventId:event.providerEventId,
    exchangeInventorySource:"POLYMARKET_US_PUBLIC",
    kalshiResearchOffers:[...(t.kalshiResearchOffers||[]),...kalshiResearchOffers].filter((o,i,a)=>
     a.findIndex(x=>x.ticker===o.ticker)===i),
    polymarketGlobalOffers:[...(t.polymarketGlobalOffers||[]),...polymarketGlobalOffers]};
   if(t.researchFixture){
    g.tennisProjection.researchFixture={...t.researchFixture,
     source:"POLYMARKET_US_PUBLIC",fixtureId:g.id,
     exchangeProviderEventId:event.providerEventId};
   }
   matchedExisting++;
   continue;
  }
  // Exchange event establishes a market-listing identity only, never an
  // independently validated FBIS projection, official schedule, or score.
  const game={id:event.id,sport:"tennis",tour:event.tour,start:event.start,
   home:{name:event.player1,fullName:event.player1},
   away:{name:event.player2,fullName:event.player2},
   projectionKind:"UNAVAILABLE",pureProjectionAvailable:false,
   projectionUnavailable:true,publicationStatus:"EXCHANGE_MARKET_RESEARCH",
   canQualify:false,canAuthorizeWager:false,qualificationBlocked:true,
   qualificationBlockReason:"NO_INDEPENDENT_FBIS_PROJECTION",
   quality:{state:"RESEARCH",flags:["exchange_listing","no_fbis_projection"]},
   market:{reference:{available:event.offers.length>0},venueOffers:event.offers,
    marketAvailable:false,executionActionable:false},
   tennisProjection:{researchFixture:{verified:true,source:"POLYMARKET_US_PUBLIC",
    fixtureId:event.id,providerEventId:event.providerEventId,
    capturedAt:event.capturedAt},
    eventIntegrity:{valid:false,reason:"INDEPENDENT_PROJECTION_NOT_VERIFIED"},
    tour:event.tour,player1:event.player1,player2:event.player2,
    player1WinProb:null,player2WinProb:null,
    blockedReason:"EXCHANGE_MARKET_ONLY_NO_MODEL_AUTHORITY",
    kalshiResearchOffers,polymarketGlobalOffers,polymarketGlobalStatus:
     polymarketGlobal.ok?"FRESH_SNAPSHOT":"NO_FRESH_SNAPSHOT",
    kalshiResearchStatus:kalshi[event.tour+"Status"]||kalshi.status||"NO_FRESH_SNAPSHOT",
    polymarketUsMarketUrl:event.marketUrl,
    polymarketUsEventId:event.providerEventId,
    exchangeInventorySource:"POLYMARKET_US_PUBLIC",
    marketCount:event.marketCount,venueOffers:event.offers,
    canQualify:false,canAuthorizeWager:false}};
  output.push(game);added.push(game.id);
 }
 return {games:output,added,matchedExisting,status:inventory.code,inventoryEvents:inventory.events.length};
}
