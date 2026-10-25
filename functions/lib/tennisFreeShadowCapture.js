/** Independent, immutable Tennis research forecast capture.
 * DB writes are restricted to TENNIS_DB shadow table; no authorized decisions.
 */
import {tennisKey} from './tennisPlayerBank.js';
import {loadValidatedCurrentTennisElo,loadCurrentTennisEloPlayers}
 from './tennisCurrentEloResearch.js';
import {loadCanonicalFreeTennisFeatures} from './tennisFreeCanonicalFeatures.js';
import {calculateTennisFreeShadow,FREE_TENNIS_SHADOW_VERSION}
 from './tennisFreeShadowModel.js';
const sha=async str=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(str)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const MAX=24;
export async function captureTennisFreeShadow(env,{now=new Date(),write=false}={}){
 if(!env?.TENNIS_DB?.prepare||!env?.DB?.prepare||!Number.isFinite(+now))
  throw Error('TENNIS_SHADOW_DB_OR_TIME_MISSING');
 if(write&&env.TENNIS_FREE_SHADOW_ENABLED!=='true')throw Error('TENNIS_SHADOW_NOT_ENABLED');
 const at=now.toISOString(),horizon=new Date(+now+72*3600000).toISOString();
 const rows=(await env.TENNIS_DB.prepare(`SELECT match_id,tour,source,
    player1_id,player2_id,match_time,observed_at,raw_artifact_key,
    surface,completion_state,provenance_json
 FROM tennis_official_matches
 WHERE completion_state='SCHEDULED' AND source IN ('ATP_OFFICIAL','WTA_OFFICIAL')
 AND match_time>? AND match_time<=? AND observed_at<=?
 ORDER BY match_time,match_id LIMIT ?`)
  .bind(new Date(+now+10*60000).toISOString(),horizon,at,MAX).all()).results||[];
 const existing=(await env.TENNIS_DB.prepare(`SELECT canonical_event_id
 FROM tennis_free_shadow_forecasts WHERE model_id=? AND event_start_time>?
 ORDER BY event_start_time LIMIT 100`)
  .bind(FREE_TENNIS_SHADOW_VERSION,at).all()).results||[];
 const captured=new Set(existing.map(x=>x.canonical_event_id));
 const ids=[...new Set(rows.flatMap(x=>[x.player1_id,x.player2_id]).filter(Boolean))];
 const byId=new Map();
 for(let i=0;i<ids.length;i+=35){
  const subset=ids.slice(i,i+35);
  const list=(await env.DB.prepare(`SELECT fbis_player_id,tour,canonical_name
    FROM tennis_players WHERE fbis_player_id IN (${subset.map(()=>'?').join(',')})`)
    .bind(...subset).all()).results||[];
  for(const p of list)byId.set(p.fbis_player_id,p);
 }
 const elo=await loadValidatedCurrentTennisElo(env.DB,{now});
 const keysByTour=new Map();
 for(const p of byId.values()){
  const k=tennisKey(p.canonical_name);
  if(!keysByTour.has(p.tour))keysByTour.set(p.tour,[]);
  keysByTour.get(p.tour).push(k);
 }
 await loadCurrentTennisEloPlayers(env.DB,elo,keysByTour);
 const result={ok:true,asOf:at,modelId:FREE_TENNIS_SHADOW_VERSION,
  observedUpcoming:rows.length,candidates:0,created:0,alreadyFrozen:0,
  reasons:{},snapshots:[],researchOnly:true,calibrated:false,
  contractTradingAuthorized:false};
 const skip=r=>result.reasons[r]=(result.reasons[r]||0)+1;
 for(const event of rows){
  if(captured.has(event.match_id)){result.alreadyFrozen++;continue}
  const p1=byId.get(event.player1_id),p2=byId.get(event.player2_id);
  if(!p1||!p2||p1.tour!==event.tour||p2.tour!==event.tour){
   skip('CANONICAL_PLAYER_IDENTITY_MISSING');continue;
  }
  const e1=elo.players.get(event.tour+'|'+tennisKey(p1.canonical_name));
  const e2=elo.players.get(event.tour+'|'+tennisKey(p2.canonical_name));
  if(!e1||!e2){skip('COMPLETE_ELO_SNAPSHOT_MISSING');continue}
  let f1,f2;
  try{
   [f1,f2]=await Promise.all([event.player1_id,event.player2_id].map(
    playerId=>loadCanonicalFreeTennisFeatures(env.TENNIS_DB,{playerId,asOf:now})));
  }catch(e){skip('SOURCE_STAT_READ_UNAVAILABLE');continue}
  const forecast=calculateTennisFreeShadow({event,one:f1,two:f2,elo1:e1,elo2:e2,now});
  if(!forecast.ok){skip(forecast.reason);continue}
  result.candidates++;
  if(!write){
   result.snapshots.push({eventId:event.match_id,p1:forecast.p1,
    p2:forecast.p2,surface:forecast.surface,dryRun:true});
   continue;
  }
  const inputJson=JSON.stringify(forecast.inputs),inputHash=await sha(inputJson);
  const snapshotId=await sha([forecast.modelId,event.match_id,at,inputHash].join('|'));
  const receipt=await env.TENNIS_DB.prepare(`INSERT OR IGNORE INTO tennis_free_shadow_forecasts(
   snapshot_id,canonical_event_id,tour,model_id,player1_id,player2_id,
   surface,event_source,event_observed_at,event_raw_artifact_key,
   forecast_at,event_start_time,p1_win,p2_win,input_hash,input_json,
   source_rights_status,calibrated,decision_eligible,contract_trading_authorized,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
    'RESEARCH_ONLY_REVIEW_REQUIRED',0,0,0,?)`)
   .bind(snapshotId,event.match_id,event.tour,forecast.modelId,
    event.player1_id,event.player2_id,forecast.surface,event.source,event.observed_at,
    event.raw_artifact_key,at,forecast.eventStartTime,forecast.p1,forecast.p2,
    inputHash,inputJson,at).run();
  if(Number(receipt.meta?.changes??receipt.changes??0)===1){
   result.created++;
   captured.add(event.match_id);
   result.snapshots.push({eventId:event.match_id,snapshotId,
    p1:forecast.p1,p2:forecast.p2,surface:forecast.surface,
    forecastAt:at,eventStartTime:forecast.eventStartTime,
    inputHash});
  }else{result.alreadyFrozen++}
 }
 return result;
}
