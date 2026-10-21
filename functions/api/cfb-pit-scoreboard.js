import {productSportDbHandle} from "../lib/databaseTopology.js";
import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
import {gradeCfbFrozenRows,cfbErrorSegments} from "../lib/cfbProspectiveAudit.js";
import {resolveTeamExact} from "../lib/teams.js";
import {isFbsVsFbsGame} from "../lib/cfbGameVisibility.js";
const response=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const stamp=v=>{const t=Date.parse(String(v||""));return Number.isFinite(t)?t:null;};
const num=v=>v==null||v===""?null:Number.isFinite(Number(v))?Number(v):null;
function fbs(row){
 const away=resolveTeamExact("cfb",{name:row.away_name,school:row.away_name});
 const home=resolveTeamExact("cfb",{name:row.home_name,school:row.home_name});
 if(!home?.espnId||!away?.espnId)return false;
 return isFbsVsFbsGame({sport:"cfb",season:Number(String(row.start).slice(0,4)),start:row.start,home:{espnId:home.espnId},away:{espnId:away.espnId}});
}
export function auditCfbFrozenDatabaseRows(rows=[],features=[]){
 const featureByGame=new Map();
 for(const v of features){const key=String(v.game_id),list=featureByGame.get(key)||[];list.push(v);featureByGame.set(key,list);}
 const byGame=new Map(),invalidGrades=[],excluded=[];
 for(const r of rows){
  const id=String(r.game_id),kick=stamp(r.start),frozen=stamp(r.frozen_at),graded=stamp(r.graded_at);
  if(!fbs(r)){excluded.push({gameId:id,reason:"not-verified-fbs-versus-fbs"});continue;}
  if(kick==null||frozen==null||frozen>=kick||num(r.proj_home)==null||num(r.proj_away)==null)continue;
  if(r.actual_home!=null&&graded!=null&&graded<kick)invalidGrades.push({gameId:id,reason:"graded-before-kickoff"});
  const prev=byGame.get(id);if(!prev||stamp(prev.frozen_at)<frozen)byGame.set(id,r);
 }
 const validRows=[];
 for(const [id,p] of byGame){
  const kick=stamp(p.start),frozen=stamp(p.frozen_at);
  const records=rows.filter(r=>String(r.game_id)===id&&num(r.actual_home)!=null&&num(r.actual_away)!=null&&stamp(r.graded_at)!=null&&stamp(r.graded_at)>=kick).sort((a,b)=>stamp(a.graded_at)-stamp(b.graded_at));
  const final=records[0];if(!final)continue;
  const cutoffOk=(featureByGame.get(id)||[]).some(v=>{const at=stamp(v.feature_as_of_timestamp),originalKick=stamp(v.kickoff_timestamp);return at!=null&&originalKick!=null&&at<=frozen&&at<kick&&Math.abs(originalKick-kick)<=900000;});
  validRows.push({gameId:id,eventStartAt:p.start,predictionAt:p.frozen_at,gradedAt:final.graded_at,featureCutoffOk:cutoffOk,projHome:num(p.proj_home),projAway:num(p.proj_away),actualHome:num(final.actual_home),actualAway:num(final.actual_away),conference:p.conference||"UNKNOWN"});
 }
 const graded=gradeCfbFrozenRows(validRows);
 return {snapshots:rows.length,pregameGames:byGame.size,finalScoresWithValidGradeTimestamp:validRows.length,strictPitGames:graded.n,
  suspiciousPrematureGrades:invalidGrades.length,excludedNonFbsEntries:excluded.length,
  strictMetrics:graded.metrics,strictSegments:cfbErrorSegments(validRows),excluded:graded.rejected,
  governance:{independentProofRequired:true,automaticPromotion:false,canQualify:false,canAuthorizeWager:false}};
}
export async function onRequestGet(context){
 const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return response(unauthorizedBody(auth.reason),403);
 const db=productSportDbHandle(context.env,"cfb").db;
 if(!db?.prepare)return response({ok:false,error:"cfb-d1-authority-unavailable"},503);
 const date=new URL(context.request.url).searchParams.get("date");
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(String(date||"")))return response({ok:false,error:"date-required-YYYY-MM-DD"},400);
 try{
 const snapshots=(await db.prepare(`SELECT p.game_id,p.frozen_at,p.graded_at,p.proj_home,p.proj_away,p.actual_home,p.actual_away,g.start,g.home_name,g.away_name
 FROM prediction_snapshots p JOIN games g ON g.id=p.game_id WHERE p.sport='cfb' AND p.date=? AND p.model_version='CFB-FBIS-v2' ORDER BY p.game_id,p.frozen_at LIMIT 5000`).bind(date).all()).results||[];
 const features=(await db.prepare("SELECT game_id,kickoff_timestamp,feature_as_of_timestamp FROM cfb_pregame_feature_vectors WHERE season=? LIMIT 5000").bind(Number(date.slice(0,4))).all()).results||[];
 return response({ok:true,date,report:auditCfbFrozenDatabaseRows(snapshots,features)});
 }catch(err){return response({ok:false,error:"cfb-pit-scoreboard-query-failed",detail:String(err?.message||err)},503);}
}
