#!/usr/bin/env node
import fs from "node:fs";
import { projectNbaDeepGame } from "../functions/lib/nbaDeepModel.js";
import { teamHistoryRow } from "../functions/lib/nbaDeepFeatures.js";
import { buildNbaScheduleContext } from "../functions/lib/nbaTravelContext.js";
import { impactAvailabilityPoints } from "../functions/lib/nbaPlayerImpact.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const date=args.date||new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const priorFile=args.prior||"artifacts/frozen/nba-canonical.jsonl";
const currentFile=args.current||"artifacts/current/nba-canonical.jsonl";
const impactFile=args.impact||"artifacts/nba-player-impact-live.json";
const fitFile=args.fit||"artifacts/deep/nba-fbis-v2-deep-fit.json";
const out=args.out||"artifacts/nba-deep-shadow.json";
const sqlOut=args.sql||"artifacts/nba-deep-shadow.sql";
const checkpoint=args.checkpoint||"SHADOW";
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=finite(v);return n==null?"NULL":String(n)};
const readJsonl=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const fit=JSON.parse(fs.readFileSync(fitFile,"utf8"));
const impact=fs.existsSync(impactFile)&&fs.statSync(impactFile).size?JSON.parse(fs.readFileSync(impactFile,"utf8")):{players:{},roleContexts:{}};
const prior=readJsonl(priorFile),current=readJsonl(currentFile);
const all=[...new Map([...prior,...current].map(g=>[String(g.id),g])).values()].sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));

const teamHist=new Map();
const push=(id,row)=>{const k=String(id||"");if(!k)return;if(!teamHist.has(k))teamHist.set(k,[]);teamHist.get(k).push(row)};
for(const g of all){push(g.homeId,teamHistoryRow(g,"home"));push(g.awayId,teamHistoryRow(g,"away"))}

function statusFactor(s){
 const x=String(s||"AVAILABLE").toUpperCase();
 return x==="OUT"?0:x==="DOUBTFUL"?0.25:x==="QUESTIONABLE"?0.72:x==="PROBABLE"?0.94:1;
}
function teamImpactContext(teamId){
 const roster=Object.values(impact.players||{}).filter(p=>String(p.teamId||"")===String(teamId));
 const unavailMap=new Map();
 for(const p of roster){
   const rc=impact.roleContexts?.[String(p.playerId||p.id)]||{};
   for(const u of rc.unavailable||[])unavailMap.set(String(u.playerId),u);
 }
 const rows=roster.map(p=>{
   const id=String(p.playerId||p.id),rc=impact.roleContexts?.[id]||{},u=unavailMap.get(id);
   const baseMin=finite(p.skill?.minutes)||24,delta=finite(rc.role?.minutesDelta)||0;
   const min=Math.max(0,(baseMin+delta)*statusFactor(u?.status));
   return {id,p,rc,u,min};
 }).filter(x=>x.min>0).sort((a,b)=>b.min-a.min).slice(0,10);
 const den=rows.reduce((s,x)=>s+x.min,0)||1;
 const avg=k=>rows.reduce((s,x)=>s+(finite(x.p?.[k])||0)*x.min,0)/den;
 const net=avg("net"),offense=avg("offense"),defense=avg("defense");
 const top8=rows.slice(0,8),continuity=Math.min(1,top8.reduce((s,x)=>s+x.min,0)/240);
 const verified=rows.some(x=>Boolean(x.rc?.availabilityVerified))||[...unavailMap.values()].some(x=>x.source&&x.observedAt);
 const availability=[...unavailMap.entries()].map(([id,u])=>{
   const p=impact.players?.[id];return {playerId:id,status:u.status,impactPoints:Math.abs(impactAvailabilityPoints(p,u.status)||0),source:u.source||null,observedAt:u.observedAt||null};
 });
 return {lineup:{offense,defense,net,continuity,minutesKnown:Math.min(240,den),availabilityVerified:verified},availability,players:rows.map(x=>x.id)};
}
async function board(){
 const stamp=date.replaceAll("-","");
 const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${stamp}&limit=100`,{headers:{"user-agent":"FBIS-NBA-DEEP/1.0",accept:"application/json"}});
 if(!r.ok)throw new Error("NBA scoreboard HTTP "+r.status);
 return r.json();
}
function sqlRow(r){
 return `INSERT OR REPLACE INTO nba_deep_game_shadow (
 id,game_id,tipoff_timestamp,feature_cutoff_timestamp,model_id,model_version,incumbent_model_id,
 projected_home,projected_away,projected_margin,projected_total,expected_possessions,p_home_win,sigma_margin,sigma_total,
 incumbent_margin,incumbent_total,margin_adjustment,total_adjustment,availability_verified,feature_json,decomposition_json,
 can_qualify,can_authorize,created_at) VALUES (
 ${q(r.id)},${q(r.gameId)},${q(r.tipoff)},${q(r.featureCutoff)},${q(r.modelId)},${q(r.modelVersion)},'NBA-FBIS-v1',
 ${num(r.home)},${num(r.away)},${num(r.margin)},${num(r.total)},${num(r.expectedPossessions)},${num(r.pHomeWin)},${num(r.sigmaMargin)},${num(r.sigmaTotal)},
 ${num(r.incumbentMargin)},${num(r.incumbentTotal)},${num(r.marginAdjustment)},${num(r.totalAdjustment)},${r.availabilityVerified?1:0},
 ${q(JSON.stringify(r.features))},${q(JSON.stringify(r.decomposition))},0,0,${q(r.createdAt)});`;
}
const b=await board(),createdAt=new Date().toISOString(),rows=[];
for(const ev of b.events||[]){
 const comp=ev.competitions?.[0],cs=comp?.competitors||[],h=cs.find(x=>x.homeAway==="home"),a=cs.find(x=>x.homeAway==="away");
 if(!h||!a||ev.status?.type?.completed||comp?.status?.type?.completed)continue;
 const homeId=String(h.team?.id||h.id||""),awayId=String(a.team?.id||a.id||""),gameId=String(ev.id);
 const hh=teamHist.get(homeId)||[],ah=teamHist.get(awayId)||[];
 if(hh.length<6||ah.length<6)continue;
 const target={id:gameId,start:ev.date,date:date,homeId,awayId,home:{id:homeId,abbr:h.team?.abbreviation||""},away:{id:awayId,abbr:a.team?.abbreviation||""},neutralSite:Boolean(comp?.neutralSite),featureCutoff:createdAt};
 const seq=[...all,target];
 const hs=buildNbaScheduleContext(seq,target,seq.length-1,"home"),as=buildNbaScheduleContext(seq,target,seq.length-1,"away");
 const hi=teamImpactContext(homeId),ai=teamImpactContext(awayId);
 const p=projectNbaDeepGame(target,{homeHistory:hh,awayHistory:ah,homeSchedule:hs,awaySchedule:as,homeLineup:hi.lineup,awayLineup:ai.lineup,homeAvailability:hi.availability,awayAvailability:ai.availability},fit);
 if(!p.ok)continue;
 rows.push({
   id:[date,gameId,checkpoint,p.modelVersion].join(":"),gameId,tipoff:ev.date||null,featureCutoff:createdAt,createdAt,
   modelId:p.modelId,modelVersion:p.modelVersion,homeTeam:h.team?.abbreviation||"",awayTeam:a.team?.abbreviation||"",
   home:p.home,away:p.away,margin:p.margin,total:p.total,expectedPossessions:p.expectedPossessions,pHomeWin:p.pHomeWin,sigmaMargin:p.sigmaMargin,sigmaTotal:p.sigmaTotal,
   incumbentMargin:p.incumbent.margin,incumbentTotal:p.incumbent.total,marginAdjustment:p.residualAdjustments.margin,totalAdjustment:p.residualAdjustments.total,
   availabilityVerified:Boolean(p.provenance.availabilityVerified),features:p.decomposition, decomposition:p.decomposition,
 });
}
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify({date,checkpoint,createdAt,modelId:"NBA-FBIS-v2-DEEP",fitId:fit.id,rows,governance:{canQualify:false,canAuthorize:false,marketInformed:false}},null,2)+"\n");
fs.writeFileSync(sqlOut,rows.map(sqlRow).join("\n")+(rows.length?"\n":""));
console.log(JSON.stringify({ok:true,date,checkpoint,rows:rows.length,availabilityVerified:rows.filter(r=>r.availabilityVerified).length,out,sqlOut},null,2));
