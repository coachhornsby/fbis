#!/usr/bin/env node
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {join} from "node:path";

const dir=process.argv[2]||"artifacts/nhl-opportunity";
const out=process.argv[3]||"artifacts/nhl-opportunity-v3-validation.json";
const years=String(process.argv[4]||"2024,2025,2026").split(",").map(Number).filter(Number.isFinite);
if(years.length<3)throw new Error("Need three completed seasons: discovery, validation, confirmation");
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
function clockSeconds(v){
  if(v==null||v==="")return null;
  const x=Number(v);if(Number.isFinite(x))return x;
  const m=String(v).match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if(m)return Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]);
  const mm=String(v).match(/^(\d+):(\d+)$/);return mm?Number(mm[1])*60+Number(mm[2]):null;
}
function idsList(v){
  return String(v??"").split(",").map(x=>x.trim()).filter(x=>x&&x!=="0"&&x.toLowerCase()!=="none").map(x=>x.replace(/\.0$/,""));
}
const gameId=r=>id(r,["game_id","gameId","id_game"]);
const playerId=r=>id(r,["player_id","playerId","id_player","nhl_id","id"]);
const teamId=r=>id(r,["team_id","teamId","id_team"]);
const team=r=>String(r?.team_abbrev??r?.teamAbbrev??r?.team_abbreviation??r?.teamAbbreviation??r?.team_tri_code??r?.teamTriCode??"").toUpperCase();
const gameDate=r=>{const v=pick(r,["game_date","gameDate","date","game_date_time","start_time_utc"]);const t=Date.parse(v||"");return Number.isFinite(t)?t:null};
const shots=r=>num(r?.shots_on_goal??r?.shotsOnGoal??r?.sog??r?.shots);
const goals=r=>num(pick(r,["goals"]));
const position=r=>String(r?.position??r?.position_code??r?.positionCode??r?.pos??"").toUpperCase();
const toi=r=>clockSeconds(pick(r,["toi","time_on_ice","timeOnIce","toi_seconds"]));

function blankPlayer(){return{gp:0,shots:0,goals:0,toi:0,team:null,position:null,recentShots:[],recentToi:[]};}
function push(a,v,n=8){if(v==null)return;a.push(v);while(a.length>n)a.shift();}
function baseline(p){
  if(!p||p.gp<3)return null;
  const season=p.shots/p.gp,recent=mean(p.recentShots)??season;
  return .68*season+.32*recent;
}
function projectedToi(p){
  if(!p||p.gp<3||p.toi<=0)return null;
  const season=p.toi/Math.max(1,p.gp),recent=mean(p.recentToi)??season;
  return clamp(.58*recent+.42*season,300,1800);
}
const rate60=p=>p?.toi>0?p.shots/(p.toi/3600):null;
function propMetrics(rows,a="base",b="cand"){
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
  const [box,shifts,scratches,rosters]=await Promise.all([
    readFile(join(dir,`skater_box_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`shifts_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`scratches_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`game_rosters_${y}.csv`),"utf8").then(csv),
  ]);
  return{y,box,shifts,scratches,rosters};
}
const datasets=await Promise.all(years.map(loadYear));
const shiftByGamePlayer=new Map(),scratchByGame=new Map(),rosterByGame=new Map(),actualByGamePlayer=new Map(),gameMeta=new Map();
const teamAbbrByGameTeamId=new Map();

for(const d of datasets){
  for(const r of d.box){
    const g=gameId(r),p=playerId(r),tm=team(r),tid=teamId(r),s=shots(r);if(!g||!p||!tm||s==null)continue;
    if(tid)teamAbbrByGameTeamId.set(g+"|"+tid,tm);
    actualByGamePlayer.set(g+"|"+p,{playerId:p,team:tm,teamId:tid,position:position(r),shots:s,goals:goals(r)||0,toi:toi(r),season:d.y,date:gameDate(r)});
    if(!gameMeta.has(g))gameMeta.set(g,{g,t:gameDate(r)??Number(g),year:d.y});
  }
}
for(const d of datasets){
  for(const r of d.scratches){
    const g=gameId(r),p=playerId(r);if(!g||!p)continue;if(!scratchByGame.has(g))scratchByGame.set(g,new Set());scratchByGame.get(g).add(p);
  }
  for(const r of d.rosters){
    const g=gameId(r),p=playerId(r),tid=teamId(r),tm=team(r)||teamAbbrByGameTeamId.get(g+"|"+tid)||"";
    if(!g||!p||!tm)continue;
    if(!rosterByGame.has(g))rosterByGame.set(g,[]);
    rosterByGame.get(g).push({playerId:p,team:tm,teamId:tid,position:position(r),date:gameDate(r),season:d.y});
    if(!gameMeta.has(g))gameMeta.set(g,{g,t:gameDate(r)??Number(g),year:d.y});
  }
}

// Released SportsDataverse shifts are CHANGE events. Reconstruct player TOI
// from ids_on / ids_off and event game_seconds; never use the target game's
// reconstructed TOI until after its prediction has been frozen.
for(const d of datasets){
  const byGameTeam=new Map();
  for(const r of d.shifts){
    const g=gameId(r),tm=String(r?.event_team??r?.event_team_abbr??r?.team_abbrev??r?.teamAbbrev??"").toUpperCase();
    const sec=num(pick(r,["game_seconds","gameSeconds","start_game_seconds"]));
    if(!g||!tm||sec==null)continue;
    const k=g+"|"+tm;if(!byGameTeam.has(k))byGameTeam.set(k,[]);
    byGameTeam.get(k).push({sec,on:idsList(pick(r,["ids_on","idsOn"])),off:idsList(pick(r,["ids_off","idsOff"]))});
  }
  for(const [k,events] of byGameTeam){
    events.sort((a,b)=>a.sec-b.sec);
    const g=k.split("|")[0],active=new Map(),totals=new Map();
    let maxSec=events.length?events[events.length-1].sec:3600;
    if(maxSec<3600)maxSec=3600;
    for(const e of events){
      for(const pid of e.off){
        const st=active.get(pid);if(st!=null&&e.sec>=st)totals.set(pid,(totals.get(pid)||0)+(e.sec-st));
        active.delete(pid);
      }
      for(const pid of e.on)if(!active.has(pid))active.set(pid,e.sec);
    }
    for(const [pid,st] of active)if(maxSec>=st)totals.set(pid,(totals.get(pid)||0)+(maxSec-st));
    for(const [pid,seconds] of totals)if(seconds>0)shiftByGamePlayer.set(g+"|"+pid,{seconds,shifts:null});
  }
}
const games=[...gameMeta.values()].sort((a,b)=>a.t-b.t||a.g.localeCompare(b.g));

function simulate(oppWeight=.35,goalShotWeight=.25){
  const players=new Map(),teams=new Map(),props=[],gameRows=[];
  for(const game of games){
    const roster=rosterByGame.get(game.g)||[];
    const scratch=scratchByGame.get(game.g)||new Set();
    const eligible=roster.filter(r=>!scratch.has(r.playerId)&&r.position!=="G");
    const teamScratchSeconds=new Map();
    for(const sid of scratch){
      const p=players.get(sid);if(!p?.team)continue;const pt=projectedToi(p);if(pt==null)continue;
      teamScratchSeconds.set(p.team,(teamScratchSeconds.get(p.team)||0)+pt);
    }
    const rosterCount=new Map();
    for(const r of eligible)rosterCount.set(r.team,(rosterCount.get(r.team)||0)+1);
    const predictions=[];
    for(const r of eligible){
      const p=players.get(r.playerId),actual=actualByGamePlayer.get(game.g+"|"+r.playerId);
      const b=baseline(p),pt=projectedToi(p),r60=rate60(p);
      if(b==null||pt==null||r60==null)continue;
      const redistributed=(teamScratchSeconds.get(r.team)||0)/Math.max(1,rosterCount.get(r.team)||1);
      const oppToi=clamp(pt+redistributed,300,1800),opp=r60*(oppToi/3600),cand=(1-oppWeight)*b+oppWeight*opp;
      predictions.push({pid:r.playerId,team:r.team,actual:actual?.shots??0,base:b,cand,baseToi:pt,projectedToi:oppToi,scratchRedistributedSeconds:redistributed,played:Boolean(actual)});
      if(actual)props.push({season:game.year,gameId:game.g,...predictions.at(-1)});
    }
    const teamPred={};
    for(const x of predictions){
      if(!teamPred[x.team])teamPred[x.team]={baseShots:0,candShots:0};
      teamPred[x.team].baseShots+=x.base;teamPred[x.team].candShots+=x.cand;
    }
    const actualTeams={};
    for(const r of eligible){
      const a=actualByGamePlayer.get(game.g+"|"+r.playerId);if(!a)continue;
      if(!actualTeams[r.team])actualTeams[r.team]={goals:0,shots:0};
      actualTeams[r.team].goals+=a.goals;actualTeams[r.team].shots+=a.shots;
    }
    const tms=Object.keys(actualTeams);
    if(tms.length===2){
      const [a,b]=tms,ta=teams.get(a),tb=teams.get(b);
      if(ta?.gp>=8&&tb?.gp>=8&&teamPred[a]&&teamPred[b]){
        const baseA=ta.goals/ta.gp,baseB=tb.goals/tb.gp;
        const adjA=clamp((teamPred[a].candShots/Math.max(1,teamPred[a].baseShots))-1,-.18,.18);
        const adjB=clamp((teamPred[b].candShots/Math.max(1,teamPred[b].baseShots))-1,-.18,.18);
        const candA=baseA*(1+goalShotWeight*adjA),candB=baseB*(1+goalShotWeight*adjB);
        gameRows.push({season:game.year,gameId:game.g,home:a,away:b,homeGoals:actualTeams[a].goals,awayGoals:actualTeams[b].goals,baseMargin:baseA-baseB,candMargin:candA-candB,baseTotal:baseA+baseB,candTotal:candA+candB});
      }
    }

    // State updates occur only after predictions are frozen.
    for(const r of roster){
      const a=actualByGamePlayer.get(game.g+"|"+r.playerId);if(!a)continue;
      let p=players.get(r.playerId);if(!p){p=blankPlayer();players.set(r.playerId,p);}
      const shift=shiftByGamePlayer.get(game.g+"|"+r.playerId),sec=(shift?.seconds&&shift.seconds>0)?shift.seconds:a.toi;
      p.gp++;p.shots+=a.shots;p.goals+=a.goals;p.team=r.team;p.position=r.position||p.position;
      if(sec!=null&&sec>0)p.toi+=sec;push(p.recentShots,a.shots);if(sec!=null&&sec>0)push(p.recentToi,sec);
    }
    for(const [tm,a] of Object.entries(actualTeams)){
      let t=teams.get(tm);if(!t){t={gp:0,goals:0,shots:0};teams.set(tm,t);}
      t.gp++;t.goals+=a.goals;t.shots+=a.shots;
    }
  }
  return{props,gameRows};
}

const discovery=years[0],validation=years[1],confirmation=years[2];
let best=null;
for(const w of [.15,.25,.35,.45,.55,.65]){
  const sim=simulate(w,.25),m=propMetrics(sim.props.filter(r=>r.season===discovery));
  if(!best||m.candidateMae<best.metrics.candidateMae)best={weight:w,metrics:m};
}
let bestGame=null;
for(const gw of [0,.15,.25,.35,.5]){
  const sim=simulate(best.weight,gw),m=gameMetrics(sim.gameRows.filter(r=>r.season===discovery));
  const score=(m.candidateMarginMae||99)+(m.candidateTotalMae||99)-2*(m.candidateWinnerAccuracy||0);
  if(!bestGame||score<bestGame.score)bestGame={goalShotWeight:gw,score,metrics:m};
}
const final=simulate(best.weight,bestGame.goalShotWeight);
const propBySeason=Object.fromEntries(years.map(y=>[y,propMetrics(final.props.filter(r=>r.season===y))]));
const gameBySeason=Object.fromEntries(years.map(y=>[y,gameMetrics(final.gameRows.filter(r=>r.season===y))]));
const pVal=propBySeason[validation],pConf=propBySeason[confirmation],gVal=gameBySeason[validation],gConf=gameBySeason[confirmation];
const report={
  modelId:"NHL-OPPORTUNITY-v3",version:"research-v3.1-shifts-scratches-rosters",
  generatedAt:new Date().toISOString(),pointInTime:true,marketInformed:false,
  sources:["SportsDataverse nhl_shifts","SportsDataverse nhl_scratches","SportsDataverse nhl_game_rosters","SportsDataverse nhl_skater_boxscores"],
  seasonMap:{discovery,validation,confirmation,currentProspective:2027,note:"2027 file represents 2026-27 and is excluded from historical promotion because the season is only about one week old."},
  selected:{playerOpportunityWeight:best.weight,goalShotWeight:bestGame.goalShotWeight,selectionSeason:discovery},
  diagnostics:{
    firstBoxRaw:datasets[0]?.box?.[0]||null,
    firstBoxParsed:datasets[0]?.box?.[0]?{gameId:gameId(datasets[0].box[0]),playerId:playerId(datasets[0].box[0]),team:team(datasets[0].box[0]),directTeam:datasets[0].box[0].team_abbrev,shots:shots(datasets[0].box[0]),toi:toi(datasets[0].box[0])}:null,
    firstShiftRaw:datasets[0]?.shifts?.[0]||null,
    firstShiftParsed:datasets[0]?.shifts?.[0]?{gameId:gameId(datasets[0].shifts[0]),team:String(pick(datasets[0].shifts[0],["event_team","event_team_abbr"])||""),sec:num(pick(datasets[0].shifts[0],["game_seconds"])),on:idsList(pick(datasets[0].shifts[0],["ids_on"]))}:null
  },
  counts:{
    rosterRows:datasets.reduce((s,d)=>s+d.rosters.length,0),boxRows:datasets.reduce((s,d)=>s+d.box.length,0),
    shiftRows:datasets.reduce((s,d)=>s+d.shifts.length,0),scratchRows:datasets.reduce((s,d)=>s+d.scratches.length,0),
    shiftPlayerGames:shiftByGamePlayer.size,rosterGames:rosterByGame.size,actualPlayerGames:actualByGamePlayer.size,propPredictions:final.props.length,gamePredictions:final.gameRows.length
  },
  playerProps:{bySeason:propBySeason,promote:Boolean(pVal.maeGain>0&&pConf.maeGain>0)},
  gameProjection:{bySeason:gameBySeason,promote:Boolean(gVal.marginGain>0&&gVal.totalGain>=0&&gVal.winnerGain>=0&&gConf.marginGain>0&&gConf.totalGain>=0&&gConf.winnerGain>=0)},
  promotion:{
    playerOpportunityHistoricalEligible:Boolean(pVal.maeGain>0&&pConf.maeGain>0),
    gameOpportunityHistoricalEligible:Boolean(gVal.marginGain>0&&gVal.totalGain>=0&&gVal.winnerGain>=0&&gConf.marginGain>0&&gConf.totalGain>=0&&gConf.winnerGain>=0),
    edgeHistoricalEligible:false,
    edgeReason:"Official EDGE season/current endpoints are not frozen pregame snapshots; live EDGE remains advisory/prospective only.",
    canQualify:false,canAuthorizeWager:false
  },
  integrity:{
    pregamePopulationSource:"game_rosters minus scratches",
    sameGameShiftUsedAsInput:false,sameGameBoxUsedAsInput:false,sameGameBoxUsedAsOutcomeOnly:true,
    sameGameScratchUsedAsPregameAvailability:true,selectionOnDiscoveryOnly:true,
    validationAndConfirmationUntouchedForSelection:true,current2027ExcludedFromPromotion:true
  }
};
await mkdir(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
await writeFile(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
