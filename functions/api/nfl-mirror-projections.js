import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { canonicalizeProPlayerPropMarket } from "../lib/proPlayerProps.js";

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const finite=v=>v!=null&&v!==""&&Number.isFinite(Number(v))?Number(v):null;

// This read-only surface publishes independent, pregame NFL player model values.
// It never imports the third-party line as a feature, never sets wager eligibility,
// and is intentionally independent of the paid PrizePicks acquisition scheduler.
export function independentNflPlayerProjections(slate={}){
 const found=new Map();
 for(const game of slate.games||[]){
  const start=game.start||game.startTime||null;
  if(start&&Number.isFinite(Date.parse(start))&&Date.parse(start)<=Date.now())continue;
  for(const row of game.playerProjectionRows||[]){
   const player=String(row.playerName||"").trim();
   const market=canonicalizeProPlayerPropMarket("nfl",row.market)||row.market;
   const value=finite(row.fbisProjection);
   if(!player||!market||value==null)continue;
   const key=norm(player)+"|"+String(market).toLowerCase();
   const entry={
    player_name:player,canonical_market:market,fbis_projection:value,
    model_version:row.modelVersion||game.playerProjectionStatus?.version||game.playerProjectionStatus?.model||null,
    model_source:row.source||null,
    team:row.team||row.teamAbbr||null,
    opponent:row.opponent||null,
    fbis_event_id:game.id||game.eventId||null,
    start_time:start,
    projection_kind:"INDEPENDENT_MODEL_RESEARCH",
    wagering_authorized:false,
    decision_eligible:false,
   };
   if(!found.has(key))found.set(key,[]);
   found.get(key).push(entry);
  }
 }
 const rows=[];
 let ambiguous=0;
 for(const entries of found.values()){
  const byEvent=new Map();
  for(const entry of entries){const key=entry.fbis_event_id||"unknown";if(!byEvent.has(key))byEvent.set(key,entry);}
  if(byEvent.size!==1){ambiguous++;continue;}
  rows.push([...byEvent.values()][0]);
 }
 return {rows,ambiguous};
}
export async function onRequestGet(context){
 const u=new URL(context.request.url);
 const requested=u.searchParams.get("date")||"";
 const resolved=resolveSlateDate(requested,{maxPast:2,maxFuture:3});
 if(!resolved.ok)return json({ok:false,error:resolved.error,rows:[]},400);
 const env={
  PARLAY_API_KEY:context.env.PARLAY_API_KEY,
  THEODDS_API_KEY:context.env.THEODDS_API_KEY,
  SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,
  THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,
  DB:context.env.DB,ARCHIVE:context.env.ARCHIVE,
  caches:caches.default,parlayCacheOnly:true,cfbdScheduleFallback:false,
 };
 try{
  const slate=await buildSlate("nfl",resolved.date,env);
  const result=independentNflPlayerProjections(slate);
  return json({ok:true,date:resolved.date,rows:result.rows,count:result.rows.length,ambiguous:result.ambiguous,
   source:"FBIS_NFL_PLAYER_MODEL",researchOnly:true,decisionEligible:false,wageringAuthorized:false,
   note:result.rows.length?"Independent pregame FBIS player projections (not market-derived).":"No independent NFL player projections in the current slate."});
 }catch(e){return json({ok:false,error:"NFL_MODEL_SLATE_UNAVAILABLE",rows:[],detail:String(e?.message||e)},503)}
}
