/**
 * Prospective NFL personnel v1.3 shadow ledger. No production projection or
 * qualification writes. GET exposes research status; POST requires operator key.
 */
import {authorizeOperatorWrite,unauthorizedBody} from "../lib/auth.js";
import {loadFootballRankingGames} from "./football-simulation-rankings.js";
import {loadNflPersonnelSlate,NFL_PERSONNEL_MODEL} from "../lib/nflPersonnelChallenger.js";
import {sha256Hex} from "../lib/sha256Hex.js";

const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const num=x=>x==null||x===""||!Number.isFinite(Number(x))?null:Number(x);
const dateKey=iso=>{const pieces=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(iso));const p=Object.fromEntries(pieces.map(x=>[x.type,x.value]));return p.year+"-"+p.month+"-"+p.day};
function checkpoint(kickoff,asOf){
 const h=(Date.parse(kickoff)-Date.parse(asOf))/3600000;
 return h>4&&h<=72?"EARLY":h>=.25&&h<=4?"LATE":null;
}
async function currentSlate(env,now){
 const base=await loadFootballRankingGames(env,{sport:"nfl",now,weekOffset:0});
 const contexts=await loadNflPersonnelSlate(env.NFL_DB,base.games,now);
 return base.games.map(g=>({game:g,challenge:contexts.get(String(g.gameId))}));
}
async function capture(env){
 const now=new Date().toISOString(),db=env.NFL_DB;
 if(!db?.prepare)throw Error("NFL_DB_UNBOUND");
 const candidates=await currentSlate(env,now);
 const report={ok:true,modelId:NFL_PERSONNEL_MODEL,observedAt:now,eligible:0,inserted:0,already:0,blocked:0,missing:[]};
 for(const {game,challenge} of candidates){
  const cp=checkpoint(game.kickoff,now);
  if(!cp)continue;
  if(!challenge?.ok||!challenge.researchEligible||!challenge.adjusted){
   report.blocked++;
   report.missing.push({gameId:String(game.gameId),reasons:challenge?.warnings||[challenge?.reason||"NO_PERSONNEL_CONTEXT"]});
   continue;
  }
  report.eligible++;
  const id=sha256Hex([NFL_PERSONNEL_MODEL,game.gameId,cp].join("|"));
  const evidence=JSON.stringify(challenge);
  const inserted=await db.prepare(
   "INSERT OR IGNORE INTO nfl_personnel_shadow_predictions "+
   "(id,event_id,checkpoint,model_id,kickoff,captured_at,baseline_snapshot_id,baseline_frozen_at,"+
   "home_abbr,away_abbr,baseline_home,baseline_away,baseline_margin,baseline_total,"+
   "challenger_home,challenger_away,challenger_margin,challenger_total,"+
   "severe_wr_home,severe_wr_away,source_evidence_json,can_qualify,can_authorize_wager) "+
   "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)"
  ).bind(
   id,String(game.gameId),cp,NFL_PERSONNEL_MODEL,game.kickoff,now,String(game.snapshotId||""),game.sourceFrozenAt,
   game.homeAbbr,game.awayAbbr,
   challenge.baseline.home,challenge.baseline.away,challenge.baseline.margin,challenge.baseline.total,
   challenge.adjusted.home,challenge.adjusted.away,challenge.adjusted.margin,challenge.adjusted.total,
   challenge.home.severeWrLoss?1:0,challenge.away.severeWrLoss?1:0,evidence
  ).run();
  if(Number(inserted?.meta?.changes||0)>0)report.inserted++;else report.already++;
 }
 report.noRetroactiveCreation=true;report.canQualify=false;report.canAuthorizeWager=false;
 return report;
}
async function officialFinals(localDate){
 const key=localDate.replaceAll("-","");
 const response=await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates="+key,{
  headers:{"user-agent":"FBIS-NFL-Personnel-Prospective/1.0"}});
 if(!response.ok)throw Error("OFFICIAL_RESULTS_HTTP_"+response.status);
 const data=await response.json(),finals=new Map();
 for(const game of data?.events||[]){
  const comp=game.competitions?.[0];
  if(!Boolean(game.status?.type?.completed||comp?.status?.type?.completed))continue;
  const period=num(game.status?.period??comp?.status?.period);
  // Model simulates 60-minute regulation scores; exclude overtime for exact pairing.
  if(period!=null&&period>4)continue;
  const home=comp?.competitors?.find(c=>c.homeAway==="home");
  const away=comp?.competitors?.find(c=>c.homeAway==="away");
  const h=num(home?.score),a=num(away?.score);
  if(h==null||a==null||h<0||a<0)continue;
  finals.set(String(game.id),{home:h,away:a,source:"ESPN_COMPLETED_REGULATION"});
 }
 return finals;
}
async function grade(env){
 const db=env.NFL_DB;if(!db?.prepare)throw Error("NFL_DB_UNBOUND");
 const rows=(await db.prepare("SELECT id,event_id,kickoff,baseline_margin,challenger_margin,baseline_total,challenger_total FROM nfl_personnel_shadow_predictions WHERE graded_at IS NULL AND kickoff < ? ORDER BY kickoff ASC LIMIT 120").bind(new Date().toISOString()).all())?.results;
 if(!Array.isArray(rows))throw Error("NFL_PERSONNEL_LEDGER_READ_FAILED");
 const days=[...new Set(rows.map(r=>dateKey(r.kickoff)))];
 const resultMap=new Map();
 for(const day of days)resultMap.set(day,await officialFinals(day));
 let graded=0,unresolved=0;
 for(const row of rows){
  const final=resultMap.get(dateKey(row.kickoff))?.get(String(row.event_id));
  if(!final){unresolved++;continue}
  const margin=final.home-final.away,total=final.home+final.away;
  await db.prepare("UPDATE nfl_personnel_shadow_predictions SET actual_home=?,actual_away=?,actual_margin=?,actual_total=?,baseline_margin_ae=?,challenger_margin_ae=?,baseline_total_ae=?,challenger_total_ae=?,graded_at=?,result_source=? WHERE id=? AND graded_at IS NULL")
   .bind(final.home,final.away,margin,total,Math.abs(num(row.baseline_margin)-margin),Math.abs(num(row.challenger_margin)-margin),
     Math.abs(num(row.baseline_total)-total),Math.abs(num(row.challenger_total)-total),
     new Date().toISOString(),final.source,row.id).run();
  graded++;
 }
 return {ok:true,modelId:NFL_PERSONNEL_MODEL,candidates:rows.length,graded,unresolved,daysChecked:days,
  canQualify:false,canAuthorizeWager:false};
}
async function summary(db){
 if(!db?.prepare)throw Error("NFL_DB_UNBOUND");
 const r=await db.prepare("SELECT checkpoint,severe_wr_home,severe_wr_away,baseline_margin_ae,challenger_margin_ae,baseline_total_ae,challenger_total_ae FROM nfl_personnel_shadow_predictions WHERE graded_at IS NOT NULL").all();
 if(!Array.isArray(r?.results))throw Error("NFL_PERSONNEL_LEDGER_READ_FAILED");
 const cohort=rows=>({
  n:rows.length,
  baselineMarginMAE:rows.length?rows.reduce((s,x)=>s+num(x.baseline_margin_ae),0)/rows.length:null,
  challengerMarginMAE:rows.length?rows.reduce((s,x)=>s+num(x.challenger_margin_ae),0)/rows.length:null,
  baselineTotalMAE:rows.length?rows.reduce((s,x)=>s+num(x.baseline_total_ae),0)/rows.length:null,
  challengerTotalMAE:rows.length?rows.reduce((s,x)=>s+num(x.challenger_total_ae),0)/rows.length:null
 });
 const latestByGame=[]; // Summary is by checkpoint, not falsely independent game observations.
 const severe=r.results.filter(x=>x.severe_wr_home||x.severe_wr_away);
 return {ok:true,modelId:NFL_PERSONNEL_MODEL,lifecycle:"RESEARCH_SHADOW_ONLY",
  all:cohort(r.results),severeReceiverDepletion:cohort(severe),
  early:cohort(r.results.filter(x=>x.checkpoint==="EARLY")),
  late:cohort(r.results.filter(x=>x.checkpoint==="LATE")),
  validationStatus:"NOT_PROSPECTIVELY_VALIDATED",economics:null,
  noAutomaticPromotion:true,canQualify:false,canAuthorizeWager:false};
}
export async function onRequestGet({request,env}){
 const mode=new URL(request.url).searchParams.get("mode")||"summary";
 try{
  if(mode==="summary")return json(await summary(env.NFL_DB));
  if(mode==="preview"){
   const now=new Date().toISOString();
   const candidates=await currentSlate(env,now);
   return json({ok:true,modelId:NFL_PERSONNEL_MODEL,asOf:now,
    results:candidates.map(({game,challenge})=>({id:String(game.gameId),kickoff:game.kickoff,
      homeAbbr:game.homeAbbr,awayAbbr:game.awayAbbr,challenge})),
    canQualify:false,canAuthorizeWager:false});
  }
  return json({ok:false,error:"INVALID_MODE"},400);
 }catch(e){return json({ok:false,error:String(e.message||e),canAuthorizeWager:false},503)}
}
export async function onRequestPost({request,env}){
 const auth=authorizeOperatorWrite(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 const mode=new URL(request.url).searchParams.get("mode");
 try{
  if(mode==="capture")return json(await capture(env));
  if(mode==="grade")return json(await grade(env));
  return json({ok:false,error:"INVALID_MODE"},400);
 }catch(e){return json({ok:false,error:String(e.message||e),canAuthorizeWager:false},503)}
}
