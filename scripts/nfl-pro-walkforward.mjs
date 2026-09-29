import fs from "node:fs/promises";
import { parseCsv, aggregateTeamWeeks, aggregateQbWeeks } from "../functions/lib/nflVerseFeed.js";
import { projectNflProV2 } from "../functions/lib/nflProV2.js";
import { projectNflFormV0 } from "../functions/lib/nflModel.js";
import { gradeResearchScoreProjection } from "../functions/lib/nflResearchGrade.js";

const RELEASE="https://github.com/nflverse/nflverse-data/releases/download";
const SCHEDULES="https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const PBP_RELEASE=`${RELEASE}/pbp`;
const PRIOR_GAMES=8;
const seasons=(process.env.NFL_WF_SEASONS||"2022,2023,2024,2025").split(",").map(Number);
const outPath=process.env.NFL_WF_OUT||"artifacts/nfl-pro-walkforward.json";

const canon=(v)=>({JAC:"JAX",LA:"LAR",OAK:"LV",WSH:"WAS",SD:"LAC",STL:"LAR"}[String(v||"").trim().toUpperCase()]||String(v||"").trim().toUpperCase());
const num=(v)=>v==null||v===""?null:(Number.isFinite(Number(v))?Number(v):null);
const mean=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const round=(v,n=4)=>v==null?null:Number(v.toFixed(n));

async function csv(url){
  const res=await fetch(url,{headers:{"User-Agent":"FBIS-walkforward/1.0",Accept:"text/csv,*/*"}});
  if(!res.ok) throw new Error(`fetch ${res.status}: ${url}`);
  return parseCsv(await res.text());
}

async function gzCsv(url){
  const res=await fetch(url,{headers:{"User-Agent":"FBIS-walkforward/2.0",Accept:"application/gzip,*/*"}});
  if(!res.ok) throw new Error(`fetch ${res.status}: ${url}`);
  const ab=await res.arrayBuffer();
  const ds=new DecompressionStream("gzip");
  const text=await new Response(new Blob([ab]).stream().pipeThrough(ds)).text();
  return parseCsv(text);
}
function lineYards(y){
  y=num(y); if(y==null) return null;
  if(y<0) return y*1.2;
  if(y<=4) return y;
  if(y<=10) return 4+(y-4)*0.5;
  return 7;
}
function aggregatePbp(rows=[]){
  const off={},def={};
  const get=(m,t)=>m[t]||(m[t]={plays:0,success:0,earlyN:0,earlyEpa:0,explosive:0,dropbacks:0,pressures:0,rushN:0,line:0});
  for(const r of rows){
    if(String(r.season_type||"REG").toUpperCase()!=="REG") continue;
    if(num(r.play)==0||num(r.no_play)==1) continue;
    const posteam=canon(r.posteam), defteam=canon(r.defteam);
    if(!posteam||!defteam) continue;
    const pass=num(r.pass_attempt)==1||num(r.sack)==1;
    const rush=num(r.rush_attempt)==1;
    if(!pass&&!rush) continue;
    const epa=num(r.epa), down=num(r.down), yards=num(r.yards_gained);
    const o=get(off,posteam), d=get(def,defteam);
    for(const x of [o,d]){
      x.plays++;
      if(epa!=null&&epa>0) x.success++;
      if((down===1||down===2)&&epa!=null){x.earlyN++;x.earlyEpa+=epa;}
      if((pass&&yards!=null&&yards>=20)||(rush&&yards!=null&&yards>=10)) x.explosive++;
      if(pass){x.dropbacks++; if(num(r.sack)==1||num(r.qb_hit)==1) x.pressures++;}
      if(rush&&yards!=null){x.rushN++;x.line+=lineYards(yards);}
    }
  }
  const finish=m=>Object.fromEntries(Object.entries(m).map(([t,x])=>[t,{
    games:null,
    successRate:x.plays?x.success/x.plays:null,
    earlyDownEpa:x.earlyN?x.earlyEpa/x.earlyN:null,
    explosiveRate:x.plays?x.explosive/x.plays:null,
    pressureRate:x.dropbacks?x.pressures/x.dropbacks:null,
    lineYards:x.rushN?x.line/x.rushN:null
  }]));
  return {offense:finish(off),defense:finish(def)};
}
function pbpFeatures(team,prior,current,n){
  const po=prior.offense[team]||{}, pd=prior.defense[team]||{}, co=current.offense[team]||{}, cd=current.defense[team]||{};
  return {
    successRate:blend(po.successRate,co.successRate,n), successRateAllowed:blend(pd.successRate,cd.successRate,n),
    earlyDownEpa:blend(po.earlyDownEpa,co.earlyDownEpa,n), earlyDownEpaAllowed:blend(pd.earlyDownEpa,cd.earlyDownEpa,n),
    explosiveRate:blend(po.explosiveRate,co.explosiveRate,n), explosiveRateAllowed:blend(pd.explosiveRate,cd.explosiveRate,n),
    pressureRateAllowed:blend(po.pressureRate,co.pressureRate,n), pressureRate:blend(pd.pressureRate,cd.pressureRate,n),
    lineYards:blend(po.lineYards,co.lineYards,n), lineYardsAllowed:blend(pd.lineYards,cd.lineYards,n)
  };
}

function blend(p,c,n){
  p=num(p); c=num(c);
  if(p==null) return c; if(c==null) return p;
  const w=Math.max(0,n||0)/(Math.max(0,n||0)+PRIOR_GAMES);
  return p*(1-w)+c*w;
}
function combinedFeatures(team, priorTeam, priorQb, curTeam, curQb){
  const p={...(priorTeam.offense[team]||{}),...(priorTeam.defense[team]||{})};
  const c={...(curTeam.offense[team]||{}),...(curTeam.defense[team]||{})};
  const pq=priorQb[team]||{}, cq=curQb[team]||{};
  const n=c.games||0, qn=cq.games||0;
  const out={games:n,priorGames:PRIOR_GAMES,source:"nflverse-strict-walkforward"};
  for(const f of ["offenseEpa","defenseEpa","passEpa","passEpaAllowed","rushEpa","rushEpaAllowed","pressureRate"]) out[f]=blend(p[f],c[f],n);
  out.qbEpa=blend(pq.qbEpa,cq.qbEpa,qn);
  out.qbCpoe=blend(pq.qbCpoe,cq.qbCpoe,qn);
  out.qbSackRate=blend(pq.qbSackRate,cq.qbSackRate,qn);
  out.qbPrior=num(pq.qbEpa);
  return out;
}
function formRows(schedule, season, beforeWeek=null){
  const map=new Map();
  for(const g of schedule){
    if(num(g.season)!==season||String(g.game_type)!=="REG") continue;
    const week=num(g.week); if(beforeWeek!=null && !(week<beforeWeek)) continue;
    const hs=num(g.home_score), as=num(g.away_score); if(hs==null||as==null) continue;
    for(const [team,pf,pa] of [[canon(g.home_team),hs,as],[canon(g.away_team),as,hs]]){
      const r=map.get(team)||{games:0,pointsFor:0,pointsAgainst:0};
      r.games++; r.pointsFor+=pf; r.pointsAgainst+=pa; map.set(team,r);
    }
  }
  return map;
}
function summarize(rows,key){
  const r=rows.map(x=>x[key]).filter(Boolean);
  const winner=r.filter(x=>x.winnerCorrect!=null);
  return {
    n:r.length,
    marginMae:round(mean(r.map(x=>x.marginAbsError))),
    totalMae:round(mean(r.map(x=>x.totalAbsError))),
    marginBias:round(mean(r.map(x=>x.marginError))),
    totalBias:round(mean(r.map(x=>x.totalError))),
    winnerAccuracy:round(winner.length?winner.filter(x=>x.winnerCorrect).length/winner.length:null)
  };
}
const schedule=await csv(SCHEDULES);
const bundles={};
for(const y of new Set(seasons.flatMap(y=>[y-1,y]))){
  const [team,player]=await Promise.all([
    csv(`${RELEASE}/stats_team/stats_team_week_${y}.csv`),
    csv(`${RELEASE}/stats_player/stats_player_week_${y}.csv`)
  ]);
  const pbp=await gzCsv(`${PBP_RELEASE}/play_by_play_${y}.csv.gz`);
  const pbpFull=aggregatePbp(pbp);
  const pbpByWeek=new Map();
  for(let w=1;w<=19;w++){
    const admissible=pbp.filter(r=>String(r.season_type||"REG").toUpperCase()==="REG"&&num(r.week)<w);
    if(admissible.some(r=>num(r.week)>=w)) throw new Error(`PIT PBP precompute leakage season=${y} week=${w}`);
    pbpByWeek.set(w,aggregatePbp(admissible));
  }
  bundles[y]={team,player,teamFull:aggregateTeamWeeks(team),qbFull:aggregateQbWeeks(player),pbpFull,pbpByWeek};
}
const rows=[];
for(const season of seasons){
  const games=schedule.filter(g=>num(g.season)===season&&String(g.game_type)==="REG"&&num(g.home_score)!=null&&num(g.away_score)!=null);
  const prior=bundles[season-1], current=bundles[season];
  const priorForm=formRows(schedule,season-1);
  for(const g of games){
    const week=num(g.week); if(week==null) continue;
    if(!weekCache.has(week)){
      const currentTeamRows=current.team.filter(r=>String(r.season_type||"REG").toUpperCase()==="REG"&&num(r.week)<week);
      const currentPlayerRows=current.player.filter(r=>String(r.season_type||"REG").toUpperCase()==="REG"&&num(r.week)<week);
      if(currentTeamRows.some(r=>num(r.week)>=week)||currentPlayerRows.some(r=>num(r.week)>=week)) throw new Error(`PIT leakage detected season=${season} week=${week}`);
      const curPbp=current.pbpByWeek.get(week);
      weekCache.set(week,{curTeam:aggregateTeamWeeks(currentTeamRows),curQb:aggregateQbWeeks(currentPlayerRows),curPbp,curForm:formRows(schedule,season,week)});
    }
    const {curTeam,curQb,curPbp,curForm}=weekCache.get(week);
    const home=canon(g.home_team), away=canon(g.away_team);
    const game={sport:"nfl",neutralSite:String(g.location||"").toLowerCase()==="neutral",home:{abbr:home},away:{abbr:away},nflFeatures:{
      home:{...combinedFeatures(home,prior.teamFull,prior.qbFull,curTeam,curQb),...pbpFeatures(home,prior.pbpFull,curPbp,curTeam.offense[home]?.games||0)},
      away:{...combinedFeatures(away,prior.teamFull,prior.qbFull,curTeam,curQb),...pbpFeatures(away,prior.pbpFull,curPbp,curTeam.offense[away]?.games||0)}
    }};
    const pro=projectNflProV2(game);

    const form=projectNflFormV0(game,{homePrior:priorForm.get(home),awayPrior:priorForm.get(away),homeCurrent:curForm.get(home),awayCurrent:curForm.get(away)});
    if(!pro.ok||!form.ok) continue;
    const actualHome=num(g.home_score), actualAway=num(g.away_score);
    rows.push({season,week,gameId:g.game_id,home,away,actualHome,actualAway,
      pro:gradeResearchScoreProjection({projectedHome:pro.home,projectedAway:pro.away,actualHome,actualAway}),
      form:gradeResearchScoreProjection({projectedHome:form.home,projectedAway:form.away,actualHome,actualAway})
    });
  }
}
const overall={pro:summarize(rows,"pro"),form:summarize(rows,"form")};
const bySeason=Object.fromEntries(seasons.map(s=>{const r=rows.filter(x=>x.season===s);return [s,{pro:summarize(r,"pro"),form:summarize(r,"form")}]}));
const deltas={
  marginMae:round(overall.pro.marginMae-overall.form.marginMae),
  totalMae:round(overall.pro.totalMae-overall.form.totalMae),
  winnerAccuracy:round(overall.pro.winnerAccuracy-overall.form.winnerAccuracy)
};
const promotionPass=deltas.marginMae<0&&deltas.totalMae<0&&deltas.winnerAccuracy>0;
const report={generatedAt:new Date().toISOString(),method:"strict point-in-time v2; target week W uses only current-season weekly and PBP rows with week < W; prior season is shrinkage prior; paired identical games only",seasons,n:rows.length,overall,deltas,promotionRule:"NFL-PRO-v2 must strictly beat calibrated form on margin MAE, total MAE, and winner accuracy",promotionPass,bySeason};
await fs.mkdir(outPath.split("/").slice(0,-1).join("/")||".",{recursive:true});
await fs.writeFile(outPath,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
