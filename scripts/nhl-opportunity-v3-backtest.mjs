#!/usr/bin/env node
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {join} from "node:path";

const dir=process.argv[2]||"artifacts/nhl-opportunity";
const out=process.argv[3]||"artifacts/nhl-opportunity-v3-validation.json";
const years=String(process.argv[4]||"2025,2026").split(",").map(Number).filter(Number.isFinite);
const round=(v,n=4)=>{const p=10**n;return Math.round(Number(v)*p)/p};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;

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
const pick=(r,names)=>{
  for(const k of names)if(r?.[k]!=null&&r[k]!=="")return r[k];
  const lower=Object.fromEntries(Object.keys(r||{}).map(k=>[k.toLowerCase(),k]));
  for(const n of names){const k=lower[String(n).toLowerCase()];if(k&&r[k]!=="")return r[k];}
  return null;
};
const num=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const id=(r,names)=>{const v=pick(r,names);return v==null?"":String(v).replace(/\.0$/,"")};
function seconds(v){
  if(v==null||v==="")return null;
  const n=Number(v);if(Number.isFinite(n))return n>180? n : n;
  const m=String(v).match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if(m)return (Number(m[1]||0)*3600)+(Number(m[2])*60)+Number(m[3]);
  const mm=String(v).match(/^(\d+):(\d+)$/);return mm?Number(mm[1])*60+Number(mm[2]):null;
}
function shiftDuration(r){
  const d=seconds(pick(r,["duration","shift_duration","duration_seconds","durationSeconds"]));if(d!=null)return d;
  const a=seconds(pick(r,["start_time","startTime","start"])),b=seconds(pick(r,["end_time","endTime","end"]));
  return a!=null&&b!=null&&b>=a?b-a:null;
}
function gameId(r){return id(r,["game_id","gameId","id_game"]);}
function playerId(r){return id(r,["player_id","playerId","id_player","nhl_id"]);}
function team(r){return String(pick(r,["team_abbr","teamAbbrev","team","team_abbreviation","teamAbbreviation"])||"").toUpperCase();}
function gameDate(r){const v=pick(r,["game_date","gameDate","date","game_date_time","start_time_utc"]);const t=Date.parse(v||"");return Number.isFinite(t)?t:null;}
function shots(r){return num(pick(r,["sog","shots","shots_on_goal","shotsOnGoal"]))}
function goals(r){return num(pick(r,["goals"]))}
function toi(r){return seconds(pick(r,["toi","time_on_ice","timeOnIce","toi_seconds"]))}

function blankPlayer(){return{gp:0,shots:0,goals:0,toi:0,team:null,recentShots:[],recentToi:[]};}
function push(a,v,n=8){if(v==null)return;a.push(v);while(a.length>n)a.shift();}
function baseline(p){
  if(!p||p.gp<3)return null;
  const season=p.shots/p.gp,recent=mean(p.recentShots)??season;
  return .68*season+.32*recent;
}
function projectedToi(p){
  if(!p||p.gp<3)return null;
  const season=p.toi/Math.max(1,p.gp),recent=mean(p.recentToi)??season;
  return clamp(.58*recent+.42*season,300,1800);
}
function rate60(p){return p?.toi>0?p.shots/(p.toi/3600):null}
function metrics(rows,a="base",b="cand"){
  if(!rows.length)return{n:0};
  let ae=0,be=0,se=0,sbe=0;
  for(const r of rows){const x=r.actual,ea=r[a]-x,eb=r[b]-x;ae+=Math.abs(ea);be+=Math.abs(eb);se+=ea*ea;sbe+=eb*eb;}
  return{n:rows.length,baselineMae:round(ae/rows.length),candidateMae:round(be/rows.length),maeGain:round((ae-be)/rows.length),baselineRmse:round(Math.sqrt(se/rows.length)),candidateRmse:round(Math.sqrt(sbe/rows.length))};
}
function gameMetrics(rows){
  if(!rows.length)return{n:0};
  let bm=0,cm=0,bt=0,ct=0,bw=0,cw=0;
  for(const r of rows){
    const am=r.homeGoals-r.awayGoals,at=r.homeGoals+r.awayGoals;
    bm+=Math.abs(r.baseMargin-am);cm+=Math.abs(r.candMargin-am);bt+=Math.abs(r.baseTotal-at);ct+=Math.abs(r.candTotal-at);
    const y=r.homeGoals>r.awayGoals;bw+=((r.baseMargin>=0)===y)?1:0;cw+=((r.candMargin>=0)===y)?1:0;
  }
  return{n:rows.length,baselineMarginMae:round(bm/rows.length),candidateMarginMae:round(cm/rows.length),marginGain:round((bm-cm)/rows.length),baselineTotalMae:round(bt/rows.length),candidateTotalMae:round(ct/rows.length),totalGain:round((bt-ct)/rows.length),baselineWinnerAccuracy:round(bw/rows.length),candidateWinnerAccuracy:round(cw/rows.length),winnerGain:round((cw-bw)/rows.length)};
}

async function loadYear(y){
  const [box,shifts,scratches]=await Promise.all([
    readFile(join(dir,`skater_box_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`shifts_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`scratches_${y}.csv`),"utf8").then(csv),
  ]);
  return{y,box,shifts,scratches};
}
const datasets=await Promise.all(years.map(loadYear));
const shiftByGamePlayer=new Map(),scratchByGame=new Map();
for(const d of datasets){
  for(const r of d.shifts){
    const g=gameId(r),p=playerId(r);if(!g||!p)continue;const k=g+"|"+p,cur=shiftByGamePlayer.get(k)||{seconds:0,shifts:0};
    const sec=shiftDuration(r);if(sec!=null&&sec>=0&&sec<=300)cur.seconds+=sec;cur.shifts++;shiftByGamePlayer.set(k,cur);
  }
  for(const r of d.scratches){
    const g=gameId(r),p=playerId(r);if(!g||!p)continue;if(!scratchByGame.has(g))scratchByGame.set(g,new Set());scratchByGame.get(g).add(p);
  }
}
const boxRows=datasets.flatMap(d=>d.box.map(r=>({...r,__year:d.y}))).filter(r=>gameId(r)&&playerId(r)&&shots(r)!=null);
const byGame=new Map();
for(const r of boxRows){const g=gameId(r);if(!byGame.has(g))byGame.set(g,[]);byGame.get(g).push(r);}
const games=[...byGame.entries()].map(([g,rows])=>({g,rows,t:gameDate(rows[0])??Number(g),year:rows[0].__year})).sort((a,b)=>a.t-b.t||a.g.localeCompare(b.g));

function simulate(oppWeight=0.4,goalShotWeight=.25){
  const players=new Map(),teams=new Map(),props=[],gameRows=[];
  for(const game of games){
    const scratch=scratchByGame.get(game.g)||new Set(),teamScratchSeconds=new Map();
    for(const sid of scratch){const p=players.get(sid);if(!p?.team)continue;const pt=projectedToi(p);if(pt==null)continue;teamScratchSeconds.set(p.team,(teamScratchSeconds.get(p.team)||0)+pt);}
    const predictions=[];
    for(const r of game.rows){
      const pid=playerId(r),tm=team(r),p=players.get(pid),act=shots(r);if(act==null||!tm)continue;
      const b=baseline(p),pt=projectedToi(p),r60=rate60(p);
      if(b==null||pt==null||r60==null)continue;
      const teammates=game.rows.filter(x=>team(x)===tm&&!scratch.has(playerId(x))).length||1;
      const redistributed=(teamScratchSeconds.get(tm)||0)/teammates;
      const oppToi=clamp(pt+redistributed,300,1800);
      const opp=r60*(oppToi/3600);
      const cand=(1-oppWeight)*b+oppWeight*opp;
      predictions.push({pid,team:tm,actual:act,base:b,cand,baseToi:pt,projectedToi:oppToi,scratchRedistributedSeconds:redistributed});
      props.push({season:game.year,gameId:game.g,...predictions.at(-1)});
    }
    const teamPred={};
    for(const x of predictions){
      if(!teamPred[x.team])teamPred[x.team]={baseShots:0,candShots:0};
      teamPred[x.team].baseShots+=x.base;teamPred[x.team].candShots+=x.cand;
    }
    const actualTeams={};
    for(const r of game.rows){
      const tm=team(r);if(!tm)continue;if(!actualTeams[tm])actualTeams[tm]={goals:0,shots:0};actualTeams[tm].goals+=goals(r)||0;actualTeams[tm].shots+=shots(r)||0;
    }
    const tms=Object.keys(actualTeams);
    if(tms.length===2){
      const [a,b]=tms,ta=teams.get(a),tb=teams.get(b);
      if(ta?.gp>=8&&tb?.gp>=8&&teamPred[a]&&teamPred[b]){
        const baseA=ta.goals/ta.gp,baseB=tb.goals/tb.gp;
        const priorShotsA=ta.shots/ta.gp,priorShotsB=tb.shots/tb.gp;
        const adjA=clamp((teamPred[a].candShots/Math.max(1,teamPred[a].baseShots))-1,-.18,.18);
        const adjB=clamp((teamPred[b].candShots/Math.max(1,teamPred[b].baseShots))-1,-.18,.18);
        const candA=baseA*(1+goalShotWeight*adjA),candB=baseB*(1+goalShotWeight*adjB);
        gameRows.push({season:game.year,gameId:game.g,home:a,away:b,homeGoals:actualTeams[a].goals,awayGoals:actualTeams[b].goals,baseMargin:baseA-baseB,candMargin:candA-candB,baseTotal:baseA+baseB,candTotal:candA+candB});
      }
    }
    for(const r of game.rows){
      const pid=playerId(r),tm=team(r);if(!pid||!tm)continue;let p=players.get(pid);if(!p){p=blankPlayer();players.set(pid,p);}
      const s=shots(r)||0,g=goals(r)||0,shift=shiftByGamePlayer.get(game.g+"|"+pid),boxToi=toi(r),sec=(shift?.seconds&&shift.seconds>0)?shift.seconds:boxToi;
      p.gp++;p.shots+=s;p.goals+=g;p.team=tm;if(sec!=null&&sec>0)p.toi+=sec;push(p.recentShots,s);if(sec!=null&&sec>0)push(p.recentToi,sec);
      let t=teams.get(tm);if(!t){t={gp:0,goals:0,shots:0};teams.set(tm,t);} // update once per game below
    }
    for(const [tm,a] of Object.entries(actualTeams)){let t=teams.get(tm);if(!t){t={gp:0,goals:0,shots:0};teams.set(tm,t);}t.gp++;t.goals+=a.goals;t.shots+=a.shots;}
  }
  return{props,gameRows};
}
const trainYear=Math.min(...years),testYear=Math.max(...years);
let best=null;
for(const w of [.15,.25,.35,.45,.55,.65]){
  const sim=simulate(w,.25),m=metrics(sim.props.filter(r=>r.season===trainYear));
  if(!best||m.candidateMae<best.metrics.candidateMae)best={weight:w,metrics:m};
}
let bestGame=null;
for(const gw of [0,.15,.25,.35,.5]){
  const sim=simulate(best.weight,gw),m=gameMetrics(sim.gameRows.filter(r=>r.season===trainYear));
  const score=(m.candidateMarginMae||99)+(m.candidateTotalMae||99)-2*(m.candidateWinnerAccuracy||0);
  if(!bestGame||score<bestGame.score)bestGame={goalShotWeight:gw,score,metrics:m};
}
const final=simulate(best.weight,bestGame.goalShotWeight);
const trainProps=metrics(final.props.filter(r=>r.season===trainYear)),testProps=metrics(final.props.filter(r=>r.season===testYear));
const trainGames=gameMetrics(final.gameRows.filter(r=>r.season===trainYear)),testGames=gameMetrics(final.gameRows.filter(r=>r.season===testYear));
const report={
  modelId:"NHL-OPPORTUNITY-v3",version:"research-v3.0-shifts-scratches",
  generatedAt:new Date().toISOString(),pointInTime:true,marketInformed:false,
  sources:["SportsDataverse nhl_shifts","SportsDataverse nhl_scratches","SportsDataverse nhl_skater_boxscores"],
  trainYear,testYear,selected:{playerOpportunityWeight:best.weight,goalShotWeight:bestGame.goalShotWeight},
  counts:{boxRows:boxRows.length,shiftRows:datasets.reduce((s,d)=>s+d.shifts.length,0),scratchRows:datasets.reduce((s,d)=>s+d.scratches.length,0),shiftPlayerGames:shiftByGamePlayer.size,propPredictions:final.props.length,gamePredictions:final.gameRows.length},
  playerProps:{train:trainProps,test:testProps,promote:Boolean(trainProps.maeGain>0&&testProps.maeGain>0)},
  gameProjection:{train:trainGames,test:testGames,promote:Boolean(trainGames.marginGain>0&&trainGames.totalGain>=0&&testGames.marginGain>0&&testGames.totalGain>=0&&testGames.winnerGain>=0)},
  promotion:{playerOpportunityHistoricalEligible:Boolean(trainProps.maeGain>0&&testProps.maeGain>0),gameOpportunityHistoricalEligible:Boolean(trainGames.marginGain>0&&trainGames.totalGain>=0&&testGames.marginGain>0&&testGames.totalGain>=0&&testGames.winnerGain>=0),edgeHistoricalEligible:false,edgeReason:"Official EDGE season/current endpoints are not frozen pregame snapshots; live EDGE remains advisory/prospective only.",canQualify:false,canAuthorizeWager:false},
  integrity:{sameGameShiftUsedAsInput:false,sameGameBoxUsedAsInput:false,sameGameScratchUsedAsPregameAvailability:true,weightSelectedOnTrainOnly:true,testYearUntouchedForSelection:true}
};
await mkdir(out.split("/").slice(0,-1).join("/")||".",{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
