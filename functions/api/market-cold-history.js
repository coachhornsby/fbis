import {harvestSecret} from '../lib/auth.js';
import {coldMarketPartitions} from '../lib/coldMarketHistory.js';
import {marketObservationPage} from './market-observations.js';
import {auditPlatformMarketCoverage,auditPartitionedMarketCoverage} from '../lib/marketCoverageAudit.js';
import {FBIS_POLY_SPORTS} from '../lib/polymarketUs.js';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
/** Independent, fixed-clock pre-retirement query parity. No public data dump,
 * source writes, switch changes or retention release can occur here.
 */
export async function onRequestPost({env,request}){
 if(!harvestSecret(env)||request.headers.get('x-harvest-secret')!==harvestSecret(env))return reply({ok:false,error:'FORBIDDEN'},403);
 try{
  const body=await request.json();if(body.operation!=='verify')return reply({ok:false,error:'INVALID_OPERATION'},400);
  const qualified={...env,COLD_MARKET_ARCHIVE_READS:'enabled'};await coldMarketPartitions(qualified);
  let events=body.events;
  if(events==null){const r=await env.COLD_HISTORY_DB.prepare("SELECT sport,canonical_event_id eventId FROM normalized_market_observations WHERE snapshot_type='RESEARCH' AND canonical_event_id IS NOT NULL GROUP BY sport,canonical_event_id ORDER BY sport,canonical_event_id LIMIT 8").all();events=r.results;}
  if(!Array.isArray(events)||events.length<1||events.length>10||events.some(e=>!FBIS_POLY_SPORTS.includes(e.sport)||typeof e.eventId!=='string'||e.eventId.length<1||e.eventId.length>160))return reply({ok:false,error:'INVALID_EVENT_SCOPE'},400);
  const now=new Date(),checks=[];
  for(const event of events){
   for(const clock of [now,new Date('2026-10-15T12:00:00Z')]){
    const input={...event,now:clock,pageSize:100,offset:0};
    const a=await marketObservationPage({...env,COLD_MARKET_ARCHIVE_READS:'disabled'},input),b=await marketObservationPage(qualified,input);
    if(JSON.stringify(a)!==JSON.stringify(b))throw Error('EVENT_QUERY_PARITY_FAILED');checks.push({sport:event.sport,eventId:event.eventId,asOf:clock.toISOString(),rows:a.rows.length,fullResponseParity:true});
   }
  }
  const sports=[...new Set(events.map(e=>e.sport))],options={now,lookbackHours:168,sports};
  const a=await auditPlatformMarketCoverage(env.DB,options),b=await auditPartitionedMarketCoverage(qualified,options);
  if(JSON.stringify(a.sports)!==JSON.stringify(b.sports))throw Error('COVERAGE_QUERY_PARITY_FAILED');
  return reply({ok:true,state:'HISTORICAL_QUERY_PARITY_VERIFIED',checks,coverageSports:sports,readOnly:true,productionRowsDeleted:0,retentionReleaseAuthorized:false,canAuthorizeWager:false});
 }catch(error){return reply({ok:false,error:String(error.message||error),retentionReleaseAuthorized:false},503);}
}
