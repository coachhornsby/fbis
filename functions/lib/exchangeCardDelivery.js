import {footballRuleIdentity} from './kalshiFootballRuleIdentity.js';
import {collegeRuleIdentity} from './kalshiCollegeRuleIdentity.js';
import {nbaRuleIdentity} from './kalshiNbaRuleIdentity.js';
import {beginJobExecution} from '../../services/account-budget/jobScope.mjs';
import {loadBoundedPolymarketSnapshot,selectBoundedPolymarketOffers} from './boundedPolymarketBoard.js';
import {validateFixtureManifest,fixtureKey} from './polymarketFixtureArchive.js';
import {KALSHI_SHADOW_SERIES} from './kalshiMarketShadow.js';
import {matchedKalshiBasketballLineQuotes} from './kalshiBasketballLineQuotes.js';
import {matchedKalshiCbbFirstHalfTotals} from './kalshiFirstHalfTotalQuotes.js';
export const EXCHANGE_CARD_JOB='functions/lib/exchangeCardDelivery.js';
const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const fresh=(t,now,age)=>Number.isFinite(Date.parse(t))&&Date.parse(t)<=now&&now-Date.parse(t)<=age;
const price=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<1;
export function matchedKalshiCardQuotes(fixtures,snapshot,stream,{sport,now=Date.now()}={}){
 const byEvent={};
 if(snapshot?.ok!==true||snapshot.sport!==sport||snapshot.seriesTicker!==KALSHI_SHADOW_SERIES[sport]||!fresh(snapshot.capturedAt,now,1800000)||!Array.isArray(snapshot.records)||snapshot.records.length>4000)return byEvent;
 const ticks=new Map(fresh(stream?.capturedAt,now,120000)&&Array.isArray(stream.quotes)?stream.quotes.map(q=>[q.ticker,q]):[]);
 for(const m of snapshot.records){
  if(m.sport!==sport||m.seriesTicker!==KALSHI_SHADOW_SERIES[sport]||!m.ticker?.startsWith(KALSHI_SHADOW_SERIES[sport]+'-')||m.status!=='active')continue;
  // Require provider kickoff and both full team names. Never treat expiration as kickoff.
  const at=Date.parse(m.occurrenceAt),title=' '+norm(m.title)+' ',label=norm(m.yesLabel);
  const ruleMatch=sport==='nba'?nbaRuleIdentity(m,fixtures,snapshot.records):sport==='cbb'?collegeRuleIdentity(m,fixtures,snapshot.records):['nfl','cfb'].includes(sport)?footballRuleIdentity(m,fixtures,snapshot.records,{sport,now}):null;
  if(!Number.isFinite(at)&&!ruleMatch)continue;
  const candidates=fixtures.filter(g=>Math.abs(Date.parse(g.start)-at)<=900000&&[g.home_name,g.away_name].every(n=>norm(n).split(' ').length>=2&&title.includes(' '+norm(n)+' ')));
  if(['nfl','cfb'].includes(sport)&&!ruleMatch)continue;
  if(candidates.length!==1&&!ruleMatch)continue;const g=ruleMatch?.fixture||candidates[0],home=ruleMatch?ruleMatch.side==='home':label===norm(g.home_name),away=ruleMatch?ruleMatch.side==='away':label===norm(g.away_name);if(home===away)continue;
  const tick=ticks.get(m.ticker),live=tick&&fresh(tick.receivedAt,now,120000)&&price(tick.yesAsk);
  const ask=live?tick.yesAsk:m.yesAskDollars,receivedAt=live?tick.receivedAt:m.fetchedAt;
  if(!price(ask)||!fresh(receivedAt,now,live?120000:900000))continue;
  (byEvent[g.id]??=[]).push({venue:'Kalshi',marketFamily:'moneyline',line:null,side:home?'home':'away',ask,receivedAt,eventStart:g.start,transport:live?'WebSocket':'REST',marketId:m.ticker,canAuthorizeWager:false});
 }
 return byEvent;
}
export async function readExchangeCardQuotes(original,{sport,date,now=Date.now()}={}){
 const env=await beginJobExecution(original,EXCHANGE_CARD_JOB);
 const read=async key=>{const o=await env.ARCHIVE.get(key);return o?o.json():null;};
 const manifest=validateFixtureManifest(await read(fixtureKey(sport)),now);
 if(manifest.sport!==sport)throw Error('FIXTURE_SPORT_MISMATCH');
 const fixtures=manifest.fixtures.filter(g=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(g.start))===date);
 const derivativeSports=['nba','cbb'].includes(sport)?[sport+'_spread',sport+'_total',sport+'_team_total']:[];
 const [snapshot,stream,poly,...derivativeSnapshots]=await Promise.all([
  read('kalshi/public-shadow/v1/sports/'+sport+'.json'),
  read('kalshi/public-shadow/v1/market-ws/latest.json'),
  loadBoundedPolymarketSnapshot(original,{now:new Date(now)}),
  ...derivativeSports.map(key=>read('kalshi/public-shadow/v1/sports/'+key+'.json')),
  ...(sport==='cbb'?[read('kalshi/public-shadow/v1/sports/cbb_1h_total.json')]:[])
 ]);
 const byEvent=matchedKalshiCardQuotes(fixtures,snapshot,stream,{sport,now});
 const firstHalfSnapshot=sport==='cbb'?derivativeSnapshots[derivativeSports.length]:null;
 if(sport==='cbb')for(const [id,quotes] of Object.entries(matchedKalshiCbbFirstHalfTotals(fixtures,firstHalfSnapshot,{now})))(byEvent[id]??=[]).push(...quotes);
 derivativeSports.forEach((sourceSport,i)=>{
  const matched=matchedKalshiBasketballLineQuotes(fixtures,derivativeSnapshots[i],{sourceSport,now});
  for(const [id,quotes] of Object.entries(matched))(byEvent[id]??=[]).push(...quotes);
 });
 const selected=selectBoundedPolymarketOffers(poly,fixtures.map(g=>({id:g.id,sport,start:g.start})),sport);
 for(const [id,offers] of selected.byId)for(const o of offers){if(!['moneyline','spread','total'].includes(o.marketFamily))continue;if(o.marketFamily!=='moneyline'&&(typeof o.line!=='number'||!Number.isFinite(o.line)))continue;(byEvent[id]??=[]).push({venue:'Polymarket',marketFamily:o.marketFamily,period:o.period,line:o.marketFamily==='moneyline'?null:o.line,side:o.side,ask:o.contractPrice,receivedAt:o.collectedAt,eventStart:fixtures.find(g=>g.id===id).start,transport:'WebSocket',marketId:o.sourceMarketId,canAuthorizeWager:false});}
 const inspect=source=>{
  if(!source?.ok)return {state:'NOT_CAPTURED',capturedAt:null};
  const at=Date.parse(source.capturedAt);
  return {state:Number.isFinite(at)&&at<=now&&now-at<=1800000?'CAPTURED':'STALE',
    capturedAt:Number.isFinite(at)?source.capturedAt:null};
 };
 const marketSources={
  Kalshi:{moneyline:inspect(snapshot),spread:inspect(derivativeSnapshots[0]),
   total:inspect(derivativeSnapshots[1]),team_total:inspect(derivativeSnapshots[2]),first_half_total:inspect(firstHalfSnapshot)},
  Polymarket:{state:poly.ok?'CAPTURED':poly.code||'NOT_CAPTURED',
   capturedAt:poly.ok?poly.capturedAt:null}
 };
 const matched=Object.values(byEvent).flat().reduce((acc,q)=>{
  const venue=q.venue||'UNKNOWN',family=q.marketFamily||'moneyline';
  (acc[venue]??={})[family]=(acc[venue][family]||0)+1;
  return acc;
 },{});
 return {ok:true,sport,date,byEvent,capturedAt:new Date(now).toISOString(),
  marketSources,matchedQuoteCounts:matched,referenceOnly:true,canAuthorizeWager:false};
}
