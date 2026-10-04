#!/usr/bin/env node
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {join} from "node:path";

const dir=process.argv[2]||"artifacts/nhl-role-toi";
const out=process.argv[3]||"artifacts/nhl-role-toi-v4-validation.json";
const years=String(process.argv[4]||"2024,2025,2026").split(",").map(Number).filter(Number.isFinite);
if(years.length<3)throw new Error("Need 2024,2025,2026 completed-season files");
const round=(v,n=4)=>{const p=10**n;return Math.round(Number(v)*p)/p};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const sd=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};

function csv(text){
  const rows=[];let row=[],s="",q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){if(q&&text[i+1]==='"'){s+='"';i++;}else q=!q;}
    else if(ch===","&&!q){row.push(s);s="";}
    else if((ch==="\n"||ch==="\r")&&!q){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(s);s="";if(row.some(x=>x!==""))rows.push(row);row=[];}
    else s+=ch;
  }
  if(s||row.length){row.push(s);rows.push(row);}
  if(!rows.length)return[];
  const h=rows[0].map(x=>String(x||"").trim());
  return rows.slice(1).map(a=>Object.fromEntries(h.map((k,i)=>[k,a[i]??""])));
}
const num=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const sid=v=>v==null?"":String(v).replace(/\.0$/,"");
const gameId=r=>sid(r?.game_id??r?.gameId);
const playerId=r=>sid(r?.player_id??r?.playerId??r?.id);
const team=r=>String(r?.team_abbrev??r?.teamAbbrev??"").toUpperCase();
const position=r=>String(r?.position??r?.position_code??r?.positionCode??"").toUpperCase();
const shots=r=>num(r?.shots_on_goal??r?.shotsOnGoal??r?.sog??r?.shots);
const goals=r=>num(r?.goals);
const gameDate=r=>{const t=Date.parse(r?.game_date??r?.gameDate??"");return Number.isFinite(t)?t:null};
function seconds(v){
  if(v==null||v==="")return null;const x=Number(v);if(Number.isFinite(x))return x;
  const m=String(v).match(/^(\d+):(\d+)$/);return m?Number(m[1])*60+Number(m[2]):null;
}
const toi=r=>seconds(r?.toi??r?.time_on_ice??r?.timeOnIce);
const idsList=v=>String(v??"").split(",").map(x=>x.trim()).filter(x=>x&&x!=="0"&&x.toLowerCase()!=="none").map(sid);

async function loadYear(y){
  const [box,shifts,scratches,rosters]=await Promise.all([
    readFile(join(dir,`skater_box_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`shifts_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`scratches_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`game_rosters_${y}.csv`),"utf8").then(csv),
  ]);
  return{y,box,shifts,scratches,rosters};
}
const datasets=await Promise.all(years.map(loadYear));
const rosterByGame=new Map(),scratchByGame=new Map(),actualByGamePlayer=new Map(),gameMeta=new Map(),shiftToi=new Map();
for(const d of datasets){
  for(const r of d.box){
    const g=gameId(r),p=playerId(r),tm=team(r),s=shots(r);if(!g||!p||!tm||s==null)continue;
    actualByGamePlayer.set(g+"|"+p,{playerId:p,team:tm,position:position(r),shots:s,goals:goals(r)||0,toi:toi(r),season:d.y,date:gameDate(r)});
    if(!gameMeta.has(g))gameMeta.set(g,{g,t:gameDate(r)??Number(g),year:d.y});
  }
  for(const r of d.rosters){
    const g=gameId(r),p=playerId(r),tm=team(r);if(!g||!p||!tm)continue;
    if(!rosterByGame.has(g))rosterByGame.set(g,[]);
    rosterByGame.get(g).push({playerId:p,team:tm,position:position(r),season:d.y,date:gameDate(r)});
    if(!gameMeta.has(g))gameMeta.set(g,{g,t:gameDate(r)??Number(g),year:d.y});
  }
  for(const r of d.scratches){
    const g=gameId(r),p=playerId(r);if(!g||!p)continue;
    if(!scratchByGame.has(g))scratchByGame.set(g,new Set());scratchByGame.get(g).add(p);
  }
  const byGameTeam=new Map();
  for(const r of d.shifts){
    const g=gameId(r),tm=String(r?.event_team??"").toUpperCase(),sec=num(r?.game_seconds);
    if(!g||!tm||sec==null)continue;const k=g+"|"+tm;
    if(!byGameTeam.has(k))byGameTeam.set(k,[]);
    byGameTeam.get(k).push({sec,on:idsList(r?.ids_on),off:idsList(r?.ids_off)});
  }
  for(const [k,events] of byGameTeam){
    events.sort((a,b)=>a.sec-b.sec);const g=k.split("|")[0],active=new Map(),totals=new Map();
    const maxSec=Math.max(3600,events.at(-1)?.sec||0);
    for(const e of events){
      for(const p of e.off){const st=active.get(p);if(st!=null&&e.sec>=st)totals.set(p,(totals.get(p)||0)+e.sec-st);active.delete(p);}
      for(const p of e.on)if(!active.has(p))active.set(p,e.sec);
    }
    for(const [p,st] of active)if(maxSec>=st)totals.set(p,(totals.get(p)||0)+maxSec-st);
    for(const [p,s] of totals)if(s>0)shiftToi.set(g+"|"+p,s);
  }
}
const games=[...gameMeta.values()].sort((a,b)=>a.t-b.t||a.g.localeCompare(b.g));

function blank(){return{gp:0,shots:0,goals:0,toi:0,recentShots:[],recentToi:[],lastToi:0,team:null,position:null};}
function push(a,v,n=10){if(v==null)return;a.push(v);while(a.length>n)a.shift();}
function baseToi(p){
  if(!p||p.gp<3||p.toi<=0)return null;
  const season=p.toi/p.gp,recent=mean(p.recentToi)??season;return clamp(.58*recent+.42*season,240,1800);
}
function baseSog(p){
  if(!p||p.gp<3)return null;const season=p.shots/p.gp,recent=mean(p.recentShots)??season;return .68*season+.32*recent;
}
const shotRate60=p=>p?.toi>0?p.shots/(p.toi/3600):null;

const FEATURES=["baseToi","recentToi","lastToi","toiSd","gp30","defense","roleRank","roleShare","scratchCount","scratchMinutes","shotRate60","recentShots"];
function vector({p,base,teamRows,roleIndex,scratchCount,scratchMinutes}){
  const rec=mean(p.recentToi)??base,rt=mean(p.recentShots)??0,total=teamRows.reduce((s,x)=>s+(x.base||0),0)||1;
  return[
    base,rec,p.lastToi||base,sd(p.recentToi),Math.min(30,p.gp)/30,p.position==="D"?1:0,
    teamRows.length>1?roleIndex/(teamRows.length-1):0,base/total,scratchCount,scratchMinutes/1200,
    shotRate60(p)??0,rt
  ];
}
function solve(A,b){const m=A.map((r,i)=>[...r,b[i]]),N=m.length;for(let i=0;i<N;i++){let p=i;for(let j=i+1;j<N;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;[m[i],m[p]]=[m[p],m[i]];const d=m[i][i]||1e-12;for(let k=i;k<=N;k++)m[i][k]/=d;for(let j=0;j<N;j++){if(j===i)continue;const q=m[j][i];for(let k=i;k<=N;k++)m[j][k]-=q*m[i][k]}}return m.map(r=>r[N]);}
function fit(rows,lambda){
  const p=FEATURES.length,means=Array(p).fill(0),sds=Array(p).fill(1);
  for(let j=0;j<p;j++){means[j]=mean(rows.map(r=>r.x[j]))||0;sds[j]=sd(rows.map(r=>r.x[j]))||1;}
  const ym=mean(rows.map(r=>r.actualToi-r.baseToi))||0,A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);
  for(const r of rows){const z=r.x.map((v,j)=>(v-means[j])/sds[j]),y=(r.actualToi-r.baseToi)-ym;for(let i=0;i<p;i++){b[i]+=z[i]*y;for(let j=0;j<p;j++)A[i][j]+=z[i]*z[j];}}
  for(let j=0;j<p;j++)A[j][j]+=lambda;
  return{means,sds,beta:solve(A,b),intercept:ym,lambda};
}
function predToi(model,r){let y=model.intercept;for(let j=0;j<model.beta.length;j++)y+=model.beta[j]*(r.x[j]-model.means[j])/model.sds[j];return clamp(r.baseToi+y,240,1800);}
function mae(rows,key){return rows.length?mean(rows.map(r=>Math.abs(r[key]-r.actual))):null;}

function collectFeatureRows(){
  const state=new Map(),samples=[],gameContexts=[];
  for(const game of games){
    const roster=(rosterByGame.get(game.g)||[]),scratch=scratchByGame.get(game.g)||new Set();
    const active=roster.filter(r=>r.position!=="G"&&!scratch.has(r.playerId));
    const byTeam=new Map();
    for(const r of active){
      const p=state.get(r.playerId),b=baseToi(p);if(!p||b==null)continue;
      if(!byTeam.has(r.team))byTeam.set(r.team,[]);byTeam.get(r.team).push({r,p,base:b});
    }
    const scratchStats=new Map();
    for(const sid0 of scratch){const p=state.get(sid0);if(!p?.team)continue;const bt=baseToi(p);if(bt==null)continue;
      const x=scratchStats.get(p.team)||{count:0,minutes:0};x.count++;x.minutes+=bt;scratchStats.set(p.team,x);}
    const gameSample=[];
    for(const [tm,rows] of byTeam){
      rows.sort((a,b)=>b.base-a.base);const ss=scratchStats.get(tm)||{count:0,minutes:0};
      for(let idx=0;idx<rows.length;idx++){
        const {r,p,base}=rows[idx],a=actualByGamePlayer.get(game.g+"|"+r.playerId);if(!a||a.toi==null)continue;
        const sample={season:game.year,gameId:game.g,playerId:r.playerId,team:tm,position:r.position,actualToi:a.toi,actual:a.shots,baseToi:base,baseSog:baseSog(p),shotRate60:shotRate60(p),x:null};
        sample.x=vector({p,base,teamRows:rows,roleIndex:idx,scratchCount:ss.count,scratchMinutes:ss.minutes});samples.push(sample);gameSample.push(sample);
      }
    }
    gameContexts.push({season:game.year,gameId:game.g,samples:gameSample});
    // update only after prediction sample is captured
    for(const r of roster){
      const a=actualByGamePlayer.get(game.g+"|"+r.playerId);if(!a)continue;let p=state.get(r.playerId);if(!p){p=blank();state.set(r.playerId,p);}
      const sec=shiftToi.get(game.g+"|"+r.playerId)??a.toi;if(sec==null||sec<=0)continue;
      p.gp++;p.shots+=a.shots;p.goals+=a.goals;p.toi+=sec;p.lastToi=sec;p.team=r.team;p.position=r.position||p.position;push(p.recentShots,a.shots);push(p.recentToi,sec);
    }
  }
  return{samples,gameContexts};
}
const {samples,gameContexts}=collectFeatureRows(),discovery=years[0],validation=years[1],confirmation=years[2];
const train=samples.filter(r=>r.season===discovery);
let bestModel=null;
for(const lambda of [1,10,100,500,1000,5000]){
  const cut=Math.floor(train.length*.7),m=fit(train.slice(0,cut),lambda),va=train.slice(cut);
  const score=mae(va.map(r=>({...r,pred:predToi(m,r)})),"pred");
  if(!bestModel||score<bestModel.score)bestModel={lambda,score};
}
const model=fit(train,bestModel.lambda);
const projected=samples.map(r=>({...r,predToi:predToi(model,r)}));

function toiMetrics(rows){
  if(!rows.length)return{n:0};return{n:rows.length,baselineMae:round(mae(rows.map(r=>({...r,base:r.baseToi})),"base")/60),modelMae:round(mae(rows.map(r=>({...r,pred:r.predToi})),"pred")/60),gainMinutes:round((mae(rows.map(r=>({...r,base:r.baseToi})),"base")-mae(rows.map(r=>({...r,pred:r.predToi})),"pred"))/60)};
}
let bestBlend=null;
for(const w of [.15,.25,.35,.45,.55,.65,.75]){
  const rows=projected.filter(r=>r.season===discovery&&r.baseSog!=null&&r.shotRate60!=null).map(r=>({...r,cand:(1-w)*r.baseSog+w*r.shotRate60*(r.predToi/3600)}));
  const b=mean(rows.map(r=>Math.abs(r.baseSog-r.actual))),m=mean(rows.map(r=>Math.abs(r.cand-r.actual)));
  if(!bestBlend||m<bestBlend.mae)bestBlend={weight:w,mae:m,baseMae:b};
}
const props=projected.filter(r=>r.baseSog!=null&&r.shotRate60!=null).map(r=>({...r,cand:(1-bestBlend.weight)*r.baseSog+bestBlend.weight*r.shotRate60*(r.predToi/3600)}));
function propMetrics(rows){
  if(!rows.length)return{n:0};const b=mean(rows.map(r=>Math.abs(r.baseSog-r.actual))),m=mean(rows.map(r=>Math.abs(r.cand-r.actual)));
  const br=Math.sqrt(mean(rows.map(r=>(r.baseSog-r.actual)**2))),mr=Math.sqrt(mean(rows.map(r=>(r.cand-r.actual)**2)));
  return{n:rows.length,baselineMae:round(b),modelMae:round(m),maeGain:round(b-m),baselineRmse:round(br),modelRmse:round(mr)};
}
const byGame=new Map();
for(const r of props){if(!byGame.has(r.gameId))byGame.set(r.gameId,[]);byGame.get(r.gameId).push(r);}
function gameRows(goalWeight){
  const state=new Map(),out=[];
  for(const game of games){
    const actuals=[...(rosterByGame.get(game.g)||[])].map(r=>actualByGamePlayer.get(game.g+"|"+r.playerId)).filter(Boolean);
    const teams=[...new Set(actuals.map(a=>a.team))];if(teams.length!==2)continue;
    const [a,b]=teams,ta=state.get(a),tb=state.get(b),ps=byGame.get(game.g)||[];
    const pa=ps.filter(x=>x.team===a),pb=ps.filter(x=>x.team===b);
    if(ta?.gp>=8&&tb?.gp>=8&&pa.length&&pb.length){
      const baseA=ta.goals/ta.gp,baseB=tb.goals/tb.gp;
      const ratioA=clamp(pa.reduce((s,x)=>s+x.cand,0)/Math.max(.1,pa.reduce((s,x)=>s+x.baseSog,0)),.82,1.18);
      const ratioB=clamp(pb.reduce((s,x)=>s+x.cand,0)/Math.max(.1,pb.reduce((s,x)=>s+x.baseSog,0)),.82,1.18);
      const candA=baseA*(1+goalWeight*(ratioA-1)),candB=baseB*(1+goalWeight*(ratioB-1));
      const aa=actuals.filter(x=>x.team===a).reduce((s,x)=>s+x.goals,0),ab=actuals.filter(x=>x.team===b).reduce((s,x)=>s+x.goals,0);
      out.push({season:game.year,gameId:game.g,home:a,away:b,homeGoals:aa,awayGoals:ab,baseMargin:baseA-baseB,candMargin:candA-candB,baseTotal:baseA+baseB,candTotal:candA+candB});
    }
    for(const tm of teams){const vals=actuals.filter(x=>x.team===tm),g=vals.reduce((s,x)=>s+x.goals,0);let t=state.get(tm);if(!t){t={gp:0,goals:0};state.set(tm,t);}t.gp++;t.goals+=g;}
  }
  return out;
}
function gm(rows){
  if(!rows.length)return{n:0};let bm=0,cm=0,bt=0,ct=0,bw=0,cw=0;
  for(const r of rows){const m=r.homeGoals-r.awayGoals,t=r.homeGoals+r.awayGoals;bm+=Math.abs(r.baseMargin-m);cm+=Math.abs(r.candMargin-m);bt+=Math.abs(r.baseTotal-t);ct+=Math.abs(r.candTotal-t);const y=r.homeGoals>r.awayGoals;bw+=((r.baseMargin>=0)===y);cw+=((r.candMargin>=0)===y);}
  return{n:rows.length,baselineMarginMae:round(bm/rows.length),modelMarginMae:round(cm/rows.length),marginGain:round((bm-cm)/rows.length),baselineTotalMae:round(bt/rows.length),modelTotalMae:round(ct/rows.length),totalGain:round((bt-ct)/rows.length),baselineWinnerAccuracy:round(bw/rows.length),modelWinnerAccuracy:round(cw/rows.length),winnerGain:round((cw-bw)/rows.length)};
}
let bestGoal=null;
for(const w of [0,.1,.2,.3,.4,.5]){const m=gm(gameRows(w).filter(r=>r.season===discovery)),score=m.modelMarginMae+m.modelTotalMae-2*m.modelWinnerAccuracy;if(!bestGoal||score<bestGoal.score)bestGoal={weight:w,score,m};}
const gamesOut=gameRows(bestGoal.weight);
const toiBy=Object.fromEntries(years.map(y=>[y,toiMetrics(projected.filter(r=>r.season===y))]));
const propBy=Object.fromEntries(years.map(y=>[y,propMetrics(props.filter(r=>r.season===y))]));
const gameBy=Object.fromEntries(years.map(y=>[y,gm(gamesOut.filter(r=>r.season===y))]));
const pVal=propBy[validation],pConf=propBy[confirmation],gVal=gameBy[validation],gConf=gameBy[confirmation],tVal=toiBy[validation],tConf=toiBy[confirmation];
const report={
  modelId:"NHL-ROLE-TOI-v4",version:"research-v4.0-learned-deployment",
  generatedAt:new Date().toISOString(),pointInTime:true,marketInformed:false,
  sources:["SportsDataverse nhl_shifts","SportsDataverse nhl_scratches","SportsDataverse nhl_game_rosters","SportsDataverse nhl_skater_boxscores"],
  seasonMap:{discovery,validation,confirmation,currentProspective:2027},
  architecture:{target:"pregame player TOI",features:FEATURES,lambda:bestModel.lambda,discoveryTailMaeMinutes:round(bestModel.score/60),sogBlendWeight:bestBlend.weight,gameGoalWeight:bestGoal.weight},
  counts:{samples:samples.length,propPredictions:props.length,gamePredictions:gamesOut.length,shiftPlayerGames:shiftToi.size},
  toi:{bySeason:toiBy,promote:Boolean(tVal.gainMinutes>0&&tConf.gainMinutes>0)},
  playerSog:{bySeason:propBy,promote:Boolean(pVal.maeGain>0&&pConf.maeGain>0)},
  gameProjection:{bySeason:gameBy,promote:Boolean(gVal.marginGain>0&&gVal.totalGain>=0&&gVal.winnerGain>=0&&gConf.marginGain>0&&gConf.totalGain>=0&&gConf.winnerGain>=0)},
  promotion:{
    toiHistoricalEligible:Boolean(tVal.gainMinutes>0&&tConf.gainMinutes>0),
    playerSogHistoricalEligible:Boolean(pVal.maeGain>0&&pConf.maeGain>0),
    gameHistoricalEligible:Boolean(gVal.marginGain>0&&gVal.totalGain>=0&&gVal.winnerGain>=0&&gConf.marginGain>0&&gConf.totalGain>=0&&gConf.winnerGain>=0),
    canQualify:false,canAuthorizeWager:false,requiresProspectiveValidation:true
  },
  integrity:{sameGameShiftUsedAsInput:false,sameGameBoxUsedAsInput:false,sameGameBoxUsedAsOutcomeOnly:true,current2027ExcludedFromSelection:true,modelFitOnDiscoveryOnly:true,validationAndConfirmationUntouchedForFit:true}
};
await mkdir(out.split("/").slice(0,-1).join("/")||".",{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
