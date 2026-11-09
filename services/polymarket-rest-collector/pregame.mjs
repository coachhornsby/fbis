import {validateStreamRoster} from '../polymarket-us-stream/boundedSession.mjs';
import {POLY_US_API,parsePolymarketUsPrice} from '../../functions/lib/polymarketUs.js';
// Pack independent fixture identities into bounded time windows. A single
// kickoff minute is not a whole slate: use the same four calls across as many
// games as fit, reserving unused calls for exact-event details.
export function pregameDiscoveryPlan(manifest,{now,slot}){
 const hours=manifest.sport==='cfb'&&manifest.fixtureHorizonHours===168?168:72;
 const fixtures=manifest.fixtures.filter(g=>Date.parse(g.start)>now&&Date.parse(g.start)<=now+hours*3600000).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const starts=new Map();for(const g of fixtures){const t=Date.parse(g.start);starts.set(t,(starts.get(t)||0)+1);}
 const groups=[];let group;
 for(const [start,count] of starts){
  if(!group||group.count+count>20){group={first:start,last:start,count:0};groups.push(group);}
  group.last=start;group.count+=count;
 }
 const all=groups.flatMap(g=>manifest.providerTags.flatMap(tag=>Array.from({length:Math.ceil(g.count/20)},(_,page)=>({tag,page,
  startTimeMin:new Date(g.first-60000).toISOString(),startTimeMax:new Date(g.last+60000).toISOString()}))));
 if(!all.length)return [];
 const cycle=Math.floor(slot/10),count=['cbb','cfb'].includes(manifest.sport)?3:4;
 const offset=all.length>count?(cycle*count)%all.length:0;
 const gcd=(a,b)=>b?gcd(b,a%b):a;
 const period=all.length>count?all.length/gcd(all.length,count):1;
 // Reserve a detail opportunity for CBB/CFB and advance its counter only
 // after the exact window/tag subset recurs. Short pages never exhaust a
 // different fixture window or imply that later provider events are absent.
 return Array.from({length:Math.min(count,all.length)},(_,i)=>({...all[(offset+i)%all.length],detailRotation:Math.floor(cycle/period)}));
}
export function pregameDiscoveryUrl(query){
 const u=new URL('/v1/events',POLY_US_API);
 for(const [k,v] of Object.entries({tagSlug:query.tag,active:true,closed:false,limit:20,offset:query.page*20,orderBy:'id',orderDirection:'asc',startTimeMin:query.startTimeMin,startTimeMax:query.startTimeMax}))u.searchParams.set(k,String(v));
 return u;
}
export function restReferenceSnapshot(selected,markets,now){
 const capturedAt=new Date(now).toISOString(),extended=selected.length>0&&selected.every(r=>r.sport==='cfb');
 if(selected.length)validateStreamRoster({version:2,source:'Polymarket US',capturedAt,expiresAt:new Date(now+900000).toISOString(),roster:selected},now,{allowCfbRestLookahead:extended});
 const quotes=[];
 for(const row of selected){
  const market=markets.get(row.source_market_id);
  if(!market)continue;
  const unavailable=market.closed===true?'MARKET_STATE_CLOSED':market.active!==true||market.closed!==false||market.archived===true||market.hidden===true?'MARKET_STATE_UNAVAILABLE':null;
  const bestAsk=parsePolymarketUsPrice(market.bestAskQuote),bestBid=parsePolymarketUsPrice(market.bestBidQuote);
  const invalid=!(bestAsk>0&&bestAsk<1)||bestBid!=null&&(!(bestBid>0&&bestBid<1)||bestBid>bestAsk);
  quotes.push({marketSlug:row.source_market_id,bestAsk,bestBid,receivedAt:capturedAt,sourceObservedAt:null,marketState:unavailable||(invalid?'MARKET_STATE_UNAVAILABLE':null),quoteKind:'DISPLAY_REFERENCE_NOT_EXECUTABLE'});
 }
 return {version:1,source:'Polymarket US',scope:'BOUNDED_RESEARCH_CAPTURE',transport:'REST',...(extended?{fixtureHorizonHours:168}:{}),startedAt:capturedAt,capturedAt,roster:selected,quotes,canQualify:false,canAuthorizeWager:false};
}
