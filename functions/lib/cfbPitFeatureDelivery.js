/** Bounded CFB pregame source freeze and immutable display-only retrieval.
 * Never backfills same-season aggregates into completed games.
 */
import {sha256Hex} from "./sha256Hex.js";
import {loadCfbDeepFeatures,attachCfbDeepFeatures} from "./cfbDeepFeed.js";
import {insertCfbPregameFeatureVector} from "./collegeStore.js";
import {cfbUnitFeatureAudit} from "./cfbProspectiveAudit.js";
import {isFbsVsFbsGame} from "./cfbGameVisibility.js";
const time=v=>{const t=Date.parse(String(v||""));return Number.isFinite(t)?t:null;};
const dateCT=now=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
export function safeCfbFeatureFreeze(game,feed,{now=new Date().toISOString()}={}){
 const asOf=feed?.meta?.asOf,start=game?.start||game?.startTime||game?.startDate;
 const stamp=time(asOf),kick=time(start),clock=time(now);
 if(!game?.id||!isFbsVsFbsGame(game))return {ok:false,reason:"not-fbs-vs-fbs-or-no-id"};
 if(stamp==null||kick==null||clock==null||stamp>=kick||clock>=kick||stamp>clock+60000)return {ok:false,reason:"not-pregame-or-source-cutoff-unverified"};
 const features=game?.cfbDeepInput||{};
 const audit=cfbUnitFeatureAudit({cfbDeepInput:features,featureCutoffOk:true,featureSnapshotAt:asOf,start});
 if(!audit.available)return {ok:false,reason:"directional-features-unavailable",audit};
 const id="cfb-pit:"+game.id+":"+sha256Hex(JSON.stringify([asOf,features])).slice(0,20);
 return {ok:true,record:{id,gameId:String(game.id),season:Number(feed.season)||Number(asOf.slice(0,4)),week:Number(game.week)||null,kickoffTimestamp:start,
 homeTeam:game.home?.school||game.home?.fullName||game.home?.name,awayTeam:game.away?.school||game.away?.fullName||game.away?.name,
 featureAsOfTimestamp:asOf,featureCutoffTimestamp:new Date(kick-60000).toISOString(),
 sourceVersion:"cfb-deep-pit-freeze-v1",sourceEndpoint:feed.meta.source||"cfbd-cached",collectionTimestamp:now,
 features,modelId:"CFB-PIT-DIRECTIONAL-RESEARCH",contentHash:sha256Hex(JSON.stringify({asOf,features})),
 decomposition:{directionalAudit:audit.available,source:"cached-pregame-aggregates",authority:"display-only"},uncertainty:{provisional:audit.available!==4},jobRunId:null}};
}
export async function freezeCfbPregameFeatures(env,{dates=null,now=new Date().toISOString(),fetchFn=fetch}={}){
 const clock=time(now);
 if(clock==null||!env?.DB)return {ok:false,reason:"time-or-db-unavailable"};
 const feed=await loadCfbDeepFeatures(env,{now:clock,fetchFn});
 if(!feed?.meta?.asOf||!Object.keys(feed.bySchool||{}).length)return {ok:false,reason:Number(feed?.meta?.httpStatus)===429?"CFBD 429 rate-limited":"deep-feed-unavailable",feed:feed?.meta||null};
 const {buildSlate}=await import("./slateEngineCore.js");
 const datesToCheck=dates||Array.from({length:8},(_,i)=>dateCT(clock+i*86400000));
 const summary={ok:true,checked:0,eligible:0,inserted:0,existing:0,failed:0,missing:0,skippedDates:[],feed:feed.meta,days:datesToCheck,authority:"research-only"};
 for(const date of datesToCheck.slice(0,8)){
  let slate;
  try{slate=await buildSlate("cfb",date,{...env,cfbdCacheOnly:true,parlayCacheOnly:true});}
  catch(err){summary.skippedDates.push({date,reason:String(err?.message||err).slice(0,160)});continue;}
  for(const game of attachCfbDeepFeatures((slate?.games||[]).slice(0,100),feed)){
   summary.checked++;
   const candidate=safeCfbFeatureFreeze(game,feed,{now});
   if(!candidate.ok){summary.missing++;continue;}
   summary.eligible++;
   const save=await insertCfbPregameFeatureVector(env,candidate.record);
   if(save.ok){summary.inserted+=Number(save.inserted||0);summary.existing+=Number(save.already||0);}
   else summary.failed++;
  }
 }
 summary.ok=summary.failed===0;
 return summary;
}
export async function loadCfbFrozenUnitEvidence(db,games=[]){
 if(!db?.prepare)return {byGameId:{},records:0,error:"db-unavailable"};
 const ids=[...new Set(games.map(g=>String(g?.id||"")).filter(Boolean))].slice(0,100);
 if(!ids.length)return {byGameId:{},records:0};
 try{
  const placeholders=ids.map(()=>"?").join(",");
  const query=`SELECT game_id,kickoff_timestamp,feature_as_of_timestamp,features_json
   FROM cfb_pregame_feature_vectors WHERE game_id IN (${placeholders})
   ORDER BY feature_as_of_timestamp DESC LIMIT 500`;
  const rows=(await db.prepare(query).bind(...ids).all()).results||[],byGameId={};
  const gamesById=new Map(games.map(g=>[String(g.id),g]));
  for(const r of rows){
   const game=gamesById.get(String(r.game_id));if(!game||byGameId[r.game_id])continue;
   const start=time(game.start||game.startTime||game.startDate),asOf=time(r.feature_as_of_timestamp),storedKick=time(r.kickoff_timestamp);
   if(start==null||asOf==null||storedKick==null||asOf>=start||Math.abs(storedKick-start)>15*60000)continue;
   const parsed=JSON.parse(r.features_json||"{}");
   const audit=cfbUnitFeatureAudit({cfbDeepInput:parsed,featureCutoffOk:true,featureSnapshotAt:r.feature_as_of_timestamp,start:game.start||game.startTime||game.startDate});
   if(audit.available)byGameId[r.game_id]=audit;
  }
  return {byGameId,records:rows.length};
 }catch(e){return {byGameId:{},records:0,error:String(e?.message||e)};}
}
