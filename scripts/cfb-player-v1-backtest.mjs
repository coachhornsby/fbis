#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { flattenGamesPlayersResponse, identifyGamePlayerRoles } from "../functions/lib/cfbPlayerIdentity.js";
import { projectCfbPlayerV1, flattenCfbPlayerProjectionRows } from "../functions/lib/cfbPlayerModel.js";
import fitted from "../data/models/cfb-fbis-v2-fitted-aa.js";

const seasons=(process.env.CFB_PLAYER_BT_SEASONS||"2023,2024,2025").split(",").map(Number).filter(Number.isFinite);
const MAX_WEEK=Number(process.env.CFB_PLAYER_BT_MAX_WEEK||15);
const BASE=process.env.FBIS_BASE||"https://fbis-myz.pages.dev";
const SECRET=process.env.HARVEST_SECRET||"";
if(!SECRET) throw new Error("HARVEST_SECRET required");
mkdirSync("artifacts/cfb-player-backtest",{recursive:true});

const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function chunk(year,weekStart,weekEnd){
  const u=new URL("/api/cfb-history-chunk",BASE);
  for(const [k,v] of Object.entries({year,weekStart,weekEnd,seasonType:"regular",includeStatic:0,coverageOnly:0}))u.searchParams.set(k,String(v));
  let last=null;
  for(let a=1;a<=4;a++){
    const res=await fetch(u,{headers:{"x-harvest-secret":SECRET,accept:"application/json"}});
    const body=await res.json().catch(()=>({})); last={status:res.status,body};
    if(res.ok&&body.ok)return body;
    if(![429,500,502,503,504].includes(res.status))break;
    await sleep(a*800);
  }
  throw new Error(`chunk failed year=${year} weeks=${weekStart}-${weekEnd} status=${last?.status||0} error=${last?.body?.error||"unknown"}`);
}
function gameProjection(row){
  const mb=n(row?.marginFeatures?.base),tb=n(row?.totalFeatures?.base_total);
  if(mb==null||tb==null)return null;
  const m=fitted.margin.intercept+fitted.margin.beta[0]*((mb-fitted.margin.means[0])/fitted.margin.stds[0]);
  const t=fitted.total.intercept+fitted.total.beta[0]*((tb-fitted.total.means[0])/fitted.total.stds[0]);
  return {margin:m,total:t,home:(t+m)/2,away:(t-m)/2};
}
function priorFor(rows,kickoff){const k=Date.parse(kickoff);return rows.filter(r=>Date.parse(r.startDate||"")<k);}
function byPlayer(rows,role){
  const pid=role?.player_id?String(role.player_id):null,nk=norm(role?.player_name);
  return rows.filter(r=>{const rid=r.athleteId!=null?String(r.athleteId):null;return (pid&&rid===pid)||(!pid&&nk&&norm(r.name)===nk);});
}
function histFor(role,rows,teamRows){
  if(!role)return{sample_size:0};
  const pr=byPlayer(rows,role).filter(r=>norm(r.team)===norm(role.team));
  if(!pr.length)return{sample_size:0};
  const sample=pr.length,sum=a=>a.reduce((s,x)=>s+x,0);
  if(role.role==="QB1"){
    const att=pr.map(r=>n(r.passingAttempts)).filter(Number.isFinite),comp=pr.map(r=>n(r.passingCompletions)).filter(Number.isFinite);
    const py=pr.map(r=>n(r.passingYards)).filter(Number.isFinite),ra=pr.map(r=>n(r.rushingAttempts)).filter(Number.isFinite),ry=pr.map(r=>n(r.rushingYards)).filter(Number.isFinite);
    const tp=teamRows.filter(r=>norm(r.team)===norm(role.team)).map(r=>n(r.passingAttempts)).filter(Number.isFinite);
    const tr=teamRows.filter(r=>norm(r.team)===norm(role.team)).map(r=>n(r.rushingAttempts)).filter(Number.isFinite);
    return {sample_size:sample,passAttempts:mean(att),compPct:sum(att)>0?sum(comp)/sum(att):null,ypa:sum(att)>0?sum(py)/sum(att):null,
      rushAttempts:mean(ra),rushYpc:sum(ra)>0?sum(ry)/sum(ra):null,dropbackShare:sum(tp)>0?sum(att)/sum(tp):null,qbRushShare:sum(tr)>0?sum(ra)/sum(tr):null};
  }
  if(role.role==="RB1"){
    const ca=pr.map(r=>n(r.rushingAttempts)).filter(Number.isFinite),ry=pr.map(r=>n(r.rushingYards)).filter(Number.isFinite);
    const tr=teamRows.filter(r=>norm(r.team)===norm(role.team)).map(r=>n(r.rushingAttempts)).filter(Number.isFinite);
    return {sample_size:sample,carries:mean(ca),ypc:sum(ca)>0?sum(ry)/sum(ca):null,carryShare:sum(tr)>0?sum(ca)/sum(tr):null};
  }
  const tg=pr.map(r=>n(r.targets)).filter(Number.isFinite),rec=pr.map(r=>n(r.receptions)).filter(Number.isFinite),ry=pr.map(r=>n(r.receivingYards)).filter(Number.isFinite);
  const den=tg.length?sum(tg):sum(rec)*1.35;
  const tt=teamRows.filter(r=>norm(r.team)===norm(role.team)).map(r=>n(r.targets)).filter(Number.isFinite);
  return {sample_size:sample,targets:tg.length?mean(tg):mean(rec.map(x=>x*1.35)),catchRate:den>0?sum(rec)/den:null,ypt:den>0?sum(ry)/den:null,
    targetShare:tt.length&&sum(tt)>0?den/sum(tt):null,targetProxy:tg.length?"targets":"receptions-proxy"};
}
function actualFor(role,current){
  if(!role)return null;
  const rows=byPlayer(current,role).filter(r=>norm(r.team)===norm(role.team));if(!rows.length)return null;
  const sumKey=k=>rows.map(r=>n(r[k])).filter(Number.isFinite).reduce((s,x)=>s+x,0);
  return {passing_yards:sumKey("passingYards"),rushing_yards:sumKey("rushingYards"),receiving_yards:sumKey("receivingYards")};
}
function qtile(a,p){if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.floor(p*(s.length-1))))]}
function metrics(rows){
  if(!rows.length)return{n:0};
  const e=rows.map(r=>r.projection-r.actual),ae=e.map(Math.abs),sq=e.map(x=>x*x);
  return {n:rows.length,mae:mean(ae),rmse:Math.sqrt(mean(sq)),bias:mean(e),medianAbsError:qtile(ae,.5),p90AbsError:qtile(ae,.9),within1Sigma:rows.filter(r=>Math.abs(r.actual-r.projection)<=r.sigma).length/rows.length};
}

const designText=readFileSync("data/cfbd/calibration/design-rows.jsonl","utf8");
const design=designText.trim().split(/\n+/).map(JSON.parse).filter(r=>seasons.includes(Number(r.season))&&Number(r.week)<=MAX_WEEK);
const dmap=new Map(design.map(r=>[String(r.gameId),r]));
const out=[],seasonStats=[];

for(const season of seasons){
  const games=[],rawPlayers=[];
  for(let a=1;a<=MAX_WEEK;a+=3){
    const b=Math.min(MAX_WEEK,a+2),c=await chunk(season,a,b);
    games.push(...(c.games||[]));rawPlayers.push(...(c.players||[]));
  }
  const uniqGames=[...new Map(games.filter(g=>dmap.has(String(g.gameId||g.id))).map(g=>[String(g.gameId||g.id),{...g,id:String(g.gameId||g.id),startDate:g.startDate||g.start_date}])).values()];
  const byId=new Map(uniqGames.map(g=>[String(g.id),g.startDate||null]));
  const allFlat=flattenGamesPlayersResponse(rawPlayers,{gamesById:byId,season});
  for(const g of uniqGames.sort((a,b)=>Date.parse(a.startDate)-Date.parse(b.startDate))){
    const dr=dmap.get(String(g.id)),gp=gameProjection(dr),kick=g.startDate||g.start_date;if(!gp||!kick)continue;
    const prior=priorFor(allFlat,kick),current=allFlat.filter(r=>String(r.gameId)===String(g.id));
    const game={id:String(g.id),week:g.week,start:kick,startDate:kick,home:{name:g.homeTeam},away:{name:g.awayTeam},homeTeam:g.homeTeam,awayTeam:g.awayTeam,
      cfbFbisV2:{ok:true,modelId:"CFB-FBIS-v2",home:gp.home,away:gp.away,margin:gp.margin,total:gp.total,decomposition:{expectedPossessions:12.2}},
      cfbFbisV2Input:{home:{},away:{}},featureCutoffOk:true};
    const roles=identifyGamePlayerRoles(game,{playerGameRows:prior,identityAsOf:new Date(Date.parse(kick)-60000).toISOString()});
    const ph={};
    for(const side of ["home","away"]){ph[side]={};for(const roleName of ["QB1","RB1","WR1"]){const role=roles.roles?.[side]?.[roleName];ph[side][roleName]=histFor(role,prior,prior);}}
    const proj=projectCfbPlayerV1(game,{roles,playerHistory:ph});
    const identities={};
    for(const side of ["home","away"])for(const role of ["QB1","RB1","WR1"]){const ro=roles.roles?.[side]?.[role];if(ro?.player_name)identities[norm(ro.player_name)]={side,role,obj:ro};}
    for(const row of flattenCfbPlayerProjectionRows(proj)){
      const id=identities[norm(row.playerName)];if(!id)continue;
      const actuals=actualFor(id.obj,current),actual=n(actuals?.[row.market]);if(actual==null)continue;
      out.push({season,week:Number(g.week),gameId:String(g.id),start:kick,team:row.team,playerName:row.playerName,role:id.role,market:row.market,
        projection:row.fbisProjection,sigma:row.fbisSigma,actual,error:row.fbisProjection-actual,absError:Math.abs(row.fbisProjection-actual),
        dataQuality:row.dataQuality,uncertaintyState:row.uncertaintyState,roleConfidence:row.roleConfidence,sampleSize:row.sampleSize});
    }
  }
  seasonStats.push({season,rows:out.filter(r=>r.season===season).length});
}
const byMarket={},byRole={},bySeason={};
for(const m of ["passing_yards","rushing_yards","receiving_yards"])byMarket[m]=metrics(out.filter(r=>r.market===m));
for(const role of ["QB1","RB1","WR1"])byRole[role]=metrics(out.filter(r=>r.role===role));
for(const s of seasons)bySeason[s]=metrics(out.filter(r=>r.season===s));
const report={modelId:"CFB-PLAYER-v1",gameModelId:"CFB-FBIS-v2",generatedAt:new Date().toISOString(),
 method:"strict chronological role/history reconstruction; current fitted CFB-FBIS-v2 game environment; no market inputs",seasons,maxWeek:MAX_WEEK,
 overall:metrics(out),byMarket,byRole,bySeason,seasonStats,
 caveats:["CFB-PLAYER-v1 artifact is provisional/unfitted.","Historical game environment uses current fitted CFB-FBIS-v2 base-only production package.","No PrizePicks ROI is reported unless a timestamp-valid pregame line is paired separately."]};
writeFileSync("artifacts/cfb-player-backtest/report.json",JSON.stringify(report,null,2));
writeFileSync("artifacts/cfb-player-backtest/predictions.jsonl",out.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
if(out.length<100)throw new Error(`insufficient backtest rows: ${out.length}`);
