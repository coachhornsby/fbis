/** Bounded CFB pregame source freeze and immutable display-only retrieval.
 * Never backfills same-season aggregates into completed games.
 */
import {sha256Hex} from "./sha256Hex.js";
import {loadCfbDeepFeatures,attachCfbDeepFeatures} from "./cfbDeepFeed.js";
import {insertCfbPregameFeatureVector} from "./collegeStore.js";
import {cfbUnitFeatureAudit} from "./cfbProspectiveAudit.js";
import {isFbsVsFbsGame} from "./cfbGameVisibility.js";
import {loadSdvIntelligence} from "./cfbSdvIntelligence.js";
import {buildSdvPitResearchFeed} from "./cfbSdvPitFallback.js";
const time=v=>{const t=Date.parse(String(v||""));return Number.isFinite(t)?t:null;};
const dateCT=now=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
export function safeCfbFeatureFreeze(game,feed,{now=new Date().toISOString()}={}){
 const asOf=feed?.meta?.asOf,start=game?.start||game?.startTime||game?.startDate;
 const stamp=time(asOf),kick=time(start),clock=time(now);
 if(!game?.id||!isFbsVsFbsGame(game))return {ok:false,reason:"not-fbs-vs-fbs-or-no-id"};
 if(stamp==null||kick==null||clock==null||stamp>=kick||clock>=kick||stamp>clock+60000)return {ok:false,reason:"not-pregame-or-source-cutoff-unverified"};
 const features=game?.cfbDeepInput||{};
 const audit=cfbUnitFeatureAudit({cfbDeepInput:features,featureCutoffOk:true,featureSnapshotAt:asOf,start});
 if(audit.available!==4)return {ok:false,reason:"four-directional-features-unavailable",audit};
 const id="cfb-pit:"+game.id+":"+sha256Hex(JSON.stringify([asOf,features])).slice(0,20);
 return {ok:true,record:{id,gameId:String(game.id),season:Number(feed.season)||Number(asOf.slice(0,4)),week:Number(game.week)||null,kickoffTimestamp:start,
 homeTeam:game.home?.school||game.home?.fullName||game.home?.name,awayTeam:game.away?.school||game.away?.fullName||game.away?.name,
 featureAsOfTimestamp:asOf,featureCutoffTimestamp:new Date(kick-60000).toISOString(),
 sourceVersion:feed.meta.source==="SPORTSDATAVERSE_2026_FBS_TEAM_SUMMARIES"?"cfb-sdv-source-observed-research-v1":"cfb-deep-pit-freeze-v1",sourceEndpoint:feed.meta.source||"cfbd-cached",collectionTimestamp:now,
 features,modelId:"CFB-PIT-DIRECTIONAL-RESEARCH",contentHash:sha256Hex(JSON.stringify({asOf,features})),
 decomposition:{directionalAudit:audit.available,source:feed.meta.source||"cached-pregame-aggregates",
 attribution:feed.meta.attribution||null,sourceHash:feed.meta.sourceHash||null,
 providerPublicationAt:feed.meta.providerPublicationAt||null,
 historicalPitVerified:false,sourceAcquiredAt:asOf,authority:"display-only"},
 uncertainty:{provisional:audit.available!==4,sourcePublicationTimeVerified:feed.meta.publicationTimeVerified===true},
 jobRunId:null}};
}
export async function freezeCfbPregameFeatures(env,{dates=null,games=null,now=new Date().toISOString(),fetchFn=fetch}={}){
 const clock=time(now);
 if(clock==null||!env?.DB)return {ok:false,reason:"time-or-db-unavailable"};
 // Collection already acquired and cached this feed. Never spend extra CFBD quota
 // inside the follow-up freeze (a cache miss is explicit, not a hidden fetch).
 let feed=await loadCfbDeepFeatures({...env,cfbdCacheOnly:true},{now:clock,fetchFn});
 const cfbdMeta=feed?.meta||null;
 let fallback=null;
 const hasSource=source=>source?.meta?.asOf && Object.keys(source.byEspnId||{}).length>0;
 if(!hasSource(feed)){
  try {
   const intelligence=await loadSdvIntelligence({caches:env.caches},fetchFn);
   fallback=buildSdvPitResearchFeed(intelligence,{now});
   if(fallback.ok)feed=fallback;
  }catch(error) {
   fallback={ok:false,reason:"SDV_SOURCE_FETCH_FAILED",error:String(error?.message||error).slice(0,180)};
  }
 }
 if(!hasSource(feed))return {ok:false,reason:"independent-cfb-feature-sources-unavailable",
  cfbd:cfbdMeta,sdv:fallback?.ok===false?fallback:null,checked:0,eligible:0,inserted:0,
  authority:"research-only",canQualify:false,canAuthorizeWager:false};
 const datesToCheck=dates||Array.from({length:8},(_,i)=>dateCT(clock+i*86400000));
 const summary={ok:true,checked:0,eligible:0,inserted:0,existing:0,failed:0,missing:0,skippedDates:[],feed:feed.meta,cfbd:cfbdMeta,days:datesToCheck,authority:"research-only",canQualify:false,canAuthorizeWager:false,source:feed.meta.source||"CFBD_CACHED_PREGAME"};
 const process=async slateGames=>{
  // Dedupe by event ID; never backfill completed games or overwrite historical PIT.
  const seen=new Set();
  for(const game of attachCfbDeepFeatures((slateGames||[]).slice(0,500),feed)){
   if(seen.has(String(game?.id)))continue;
   seen.add(String(game?.id));
   summary.checked++;
   const candidate=safeCfbFeatureFreeze(game,feed,{now});
   if(!candidate.ok){summary.missing++;continue;}
   summary.eligible++;
   const save=await insertCfbPregameFeatureVector(env,candidate.record);
   if(save.ok){summary.inserted+=Number(save.inserted||0);summary.existing+=Number(save.already||0);}
   else {summary.failed++;summary.lastWriteError=save.reason||"feature-vector-write-failed";}
  }
 };
 if(Array.isArray(games)){
  await process(games);
 }else{
  const {buildSlate}=await import("./slateEngineCore.js");
  const gathered=[];
  for(const date of datesToCheck.slice(0,8)){
   try{const slate=await buildSlate("cfb",date,{...env,cfbdCacheOnly:true,parlayCacheOnly:true});gathered.push(...(slate?.games||[]));}
   catch(err){summary.skippedDates.push({date,reason:String(err?.message||err).slice(0,160)});}
  }
  await process(gathered);
 }
 summary.ok=summary.failed===0;
 const upcoming=(Array.isArray(games)?games:[]).filter(g=>isFbsVsFbsGame(g)&&time(g?.start||g?.startTime||g?.startDate)>clock);
 if(summary.checked>0&&upcoming.length>0&&summary.eligible===0) {
   summary.ok=false; summary.reason="zero-eligible-pregame-feature-observations";
 }
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
