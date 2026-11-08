import {validateStreamRoster} from '../polymarket-us-stream/boundedSession.mjs';
import {POLY_US_API,parsePolymarketUsPrice} from '../../functions/lib/polymarketUs.js';
// Same /v1/events destination, four requests, no credentials or new storage.
// Narrow kickoff windows avoid repeatedly spending all discovery on old IDs.
export function pregameDiscoveryPlan(manifest,{now,slot}){
 const starts=[...new Set(manifest.fixtures.map(g=>Date.parse(g.start)).filter(t=>t>now&&t<=now+72*3600000))].sort((a,b)=>a-b);
 const windows=starts.map(start=>({startTimeMin:new Date(start-60000).toISOString(),startTimeMax:new Date(start+60000).toISOString()}));
 const all=windows.flatMap(window=>manifest.providerTags.map(tag=>({tag,...window})));
 if(!all.length)return [];
 const offset=(Math.floor(slot/10)*4)%all.length;
 return Array.from({length:Math.min(4,all.length)},(_,i)=>({...all[(offset+i)%all.length],page:0}));
}
export function pregameDiscoveryUrl(query){
 const u=new URL('/v1/events',POLY_US_API);
 for(const [k,v] of Object.entries({tagSlug:query.tag,active:true,closed:false,limit:20,offset:0,orderBy:'id',orderDirection:'asc',startTimeMin:query.startTimeMin,startTimeMax:query.startTimeMax}))u.searchParams.set(k,String(v));
 return u;
}
export function restReferenceSnapshot(selected,markets,now){
 const capturedAt=new Date(now).toISOString();
 if(selected.length)validateStreamRoster({version:2,source:'Polymarket US',capturedAt,expiresAt:new Date(now+900000).toISOString(),roster:selected},now);
 const quotes=[];
 for(const row of selected){
  const market=markets.get(row.source_market_id);
  if(!market)continue;
  const unavailable=market.closed===true?'MARKET_STATE_CLOSED':market.active!==true||market.closed!==false||market.archived===true||market.hidden===true?'MARKET_STATE_UNAVAILABLE':null;
  const bestAsk=parsePolymarketUsPrice(market.bestAskQuote),bestBid=parsePolymarketUsPrice(market.bestBidQuote);
  const invalid=!(bestAsk>0&&bestAsk<1)||bestBid!=null&&(!(bestBid>0&&bestBid<1)||bestBid>bestAsk);
  quotes.push({marketSlug:row.source_market_id,bestAsk,bestBid,receivedAt:capturedAt,sourceObservedAt:null,marketState:unavailable||(invalid?'MARKET_STATE_UNAVAILABLE':null),quoteKind:'DISPLAY_REFERENCE_NOT_EXECUTABLE'});
 }
 return {version:1,source:'Polymarket US',scope:'BOUNDED_RESEARCH_CAPTURE',transport:'REST',startedAt:capturedAt,capturedAt,roster:selected,quotes,canQualify:false,canAuthorizeWager:false};
}
