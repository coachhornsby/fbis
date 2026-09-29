#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const API = "https://api-web.nhle.com/v1";
const DEFAULT_SEASONS = ["20232024","20242025","20252026"];
const SHOT_TYPES = ["wrist","snap","slap","backhand","tip","deflected","wrap","poke"];
const FEATURE_ORDER = [
  "intercept","distance50","angle90","distanceSq2500","angleSq8100",
  "rebound","reboundDistance50",...SHOT_TYPES
];

function arg(name, fallback=null) {
  const p = process.argv.find((x)=>x.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : fallback;
}
const seasons = String(arg("seasons", DEFAULT_SEASONS.join(","))).split(",").map(s=>s.trim()).filter(Boolean);
const outPath = arg("out","data/models/nhl-fbis-v1.js");
const concurrency = Math.max(2, Math.min(24, Number(arg("concurrency","12")) || 12));
const maxGames = Number(arg("max-games","0")) || 0;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function sigmoid(z){ return z >= 0 ? 1/(1+Math.exp(-z)) : Math.exp(z)/(1+Math.exp(z)); }
function dot(a,b){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function round(v,n=6){ const p=10**n; return Math.round(v*p)/p; }

async function fetchJson(url, attempts=5){
  let last;
  for(let i=1;i<=attempts;i++){
    try{
      const res=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS/1.0"},signal:AbortSignal.timeout(30000)});
      if(res.ok) return await res.json();
      last=new Error(`HTTP_${res.status} ${url}`);
      if(res.status===404) throw last;
      if(res.status===429 || res.status>=500) await sleep(i*750);
      else throw last;
    }catch(err){
      last=err;
      if(i<attempts) await sleep(i*750);
    }
  }
  throw last;
}
function isoAdd(date,days){
  const d=new Date(date+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10);
}
function seasonRange(season){
  const start=Number(String(season).slice(0,4));
  return { start:`${start}-09-15`, end:`${start+1}-06-30` };
}
async function collectSchedule(season){
  const {start,end}=seasonRange(season);
  const games=new Map();
  for(let day=start;day<=end;day=isoAdd(day,7)){
    let json;
    try{ json=await fetchJson(`${API}/schedule/${day}`); }
    catch(err){ console.error("schedule",season,day,String(err?.message||err)); continue; }
    for(const block of json?.gameWeek||[]){
      for(const g of block?.games||[]){
        const id=String(g?.id||"");
        const sid=String(g?.season||"");
        if(!id || Number(g?.gameType)!==2) continue;
        if(sid && sid!==season) continue;
        games.set(id,{id,season,start:g.startTimeUTC||null,home:g.homeTeam||{},away:g.awayTeam||{}});
      }
    }
  }
  return [...games.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
function eventSeconds(play){
  const period=Number(play?.periodDescriptor?.number||0);
  const m=String(play?.timeInPeriod||"").match(/^(\d+):(\d+)$/);
  if(!m || !period) return null;
  return (period-1)*1200 + Number(m[1])*60 + Number(m[2]);
}
function shotTypeKey(v){
  const s=String(v||"").toLowerCase().replace(/[^a-z]/g,"");
  if(s.includes("wrist")) return "wrist";
  if(s.includes("snap")) return "snap";
  if(s.includes("slap")) return "slap";
  if(s.includes("backhand")) return "backhand";
  if(s.includes("tip")) return "tip";
  if(s.includes("deflect")) return "deflected";
  if(s.includes("wrap")) return "wrap";
  if(s.includes("poke")) return "poke";
  return null;
}
function isFiveOnFive(play){
  const code=String(play?.situationCode||"").replace(/\D/g,"");
  return code==="1551";
}
function features(play,rebound){
  const x=Number(play?.details?.xCoord);
  const y=Number(play?.details?.yCoord);
  if(!Number.isFinite(x)||!Number.isFinite(y)) return null;
  const dx=Math.max(0,89-Math.abs(x));
  const dist=Math.sqrt(dx*dx+y*y);
  const angle=Math.atan2(Math.abs(y),Math.max(1,dx))*180/Math.PI;
  const type=shotTypeKey(play?.details?.shotType);
  const oneHot=SHOT_TYPES.map(t=>type===t?1:0);
  return [
    1,
    clamp(dist/50,0,2.5),
    clamp(angle/90,0,1),
    clamp((dist*dist)/2500,0,6.25),
    clamp((angle*angle)/8100,0,1),
    rebound?1:0,
    rebound?clamp(dist/50,0,2.5):0,
    ...oneHot
  ];
}
function parseGamePbp(game,json){
  const homeId=String(json?.homeTeam?.id??game?.home?.id??"");
  const awayId=String(json?.awayTeam?.id??game?.away?.id??"");
  const homeAbbr=String(json?.homeTeam?.abbrev??game?.home?.abbrev??"").toUpperCase();
  const awayAbbr=String(json?.awayTeam?.abbrev??game?.away?.abbrev??"").toUpperCase();
  if(!homeId||!awayId||!homeAbbr||!awayAbbr) return {shots:[],gameMeta:null,totalGoals:0};
  const idToAbbr=new Map([[homeId,homeAbbr],[awayId,awayAbbr]]);
  const shots=[];
  let totalGoals=0;
  let prevShot=null;
  for(const play of json?.plays||[]){
    const type=String(play?.typeDescKey||"").toLowerCase();
    if(type==="goal") totalGoals+=1;
    if(!["goal","shot-on-goal","missed-shot"].includes(type)) continue;
    if(!isFiveOnFive(play)) continue;
    const ownerId=String(play?.details?.eventOwnerTeamId??"");
    const owner=idToAbbr.get(ownerId);
    const defender=owner===homeAbbr?awayAbbr:owner===awayAbbr?homeAbbr:null;
    if(!owner||!defender) continue;
    const sec=eventSeconds(play);
    const rebound=Boolean(prevShot && sec!=null && prevShot.sec!=null && owner===prevShot.owner && sec-prevShot.sec>=0 && sec-prevShot.sec<=3);
    const x=features(play,rebound);
    if(!x) continue;
    const goalieId=play?.details?.goalieInNetId!=null?String(play.details.goalieInNetId):null;
    shots.push({
      x,
      y:type==="goal"?1:0,
      season:game.season,
      gameId:game.id,
      owner,
      defender,
      goalieId,
      goalieTeam:defender
    });
    prevShot={sec,owner};
  }
  return {shots,gameMeta:{gameId:game.id,season:game.season,home:homeAbbr,away:awayAbbr},totalGoals};
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);
  let index=0;
  async function worker(){
    while(true){
      const i=index++;
      if(i>=items.length) return;
      try{ out[i]=await fn(items[i],i); }
      catch(err){ out[i]={error:String(err?.message||err),item:items[i]}; }
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return out;
}
function baseRateWeights(rows){
  const rate=rows.length?rows.reduce((s,r)=>s+r.y,0)/rows.length:0.06;
  const w=new Array(FEATURE_ORDER.length).fill(0);
  w[0]=Math.log(clamp(rate,0.005,0.3)/(1-clamp(rate,0.005,0.3)));
  return w;
}
function fitLogistic(rows,{epochs=7,lr=0.025,l2=0.00002,initial=null}={}){
  const w=initial?[...initial]:baseRateWeights(rows);
  for(let epoch=0;epoch<epochs;epoch++){
    const step=lr/(1+epoch*0.35);
    for(const row of rows){
      const p=sigmoid(dot(w,row.x));
      const err=row.y-p;
      for(let j=0;j<w.length;j++){
        const penalty=j===0?0:l2*w[j];
        w[j]+=step*(err*row.x[j]-penalty);
      }
    }
  }
  return w;
}
function metrics(rows,w){
  if(!rows.length) return {n:0,goals:0,brier:null,logLoss:null};
  let brier=0,ll=0,goals=0;
  for(const r of rows){
    const p=clamp(sigmoid(dot(w,r.x)),1e-6,1-1e-6);
    goals+=r.y;
    brier+=(p-r.y)**2;
    ll+=-(r.y*Math.log(p)+(1-r.y)*Math.log(1-p));
  }
  return {n:rows.length,goals,brier:brier/rows.length,logLoss:ll/rows.length};
}
function addSet(map,key,value){
  if(!map.has(key)) map.set(key,new Set());
  map.get(key).add(value);
}
function aggregate(shots,games,w,seasons){
  const teamSeason=new Map();
  const teamGames=new Map();
  const goalie=new Map();
  const goalieGames=new Map();
  const goalieTeams=new Map();
  const goalieSeason=new Map();
  const goalieSeasonGames=new Map();
  const goalieSeasonTeams=new Map();
  let totalXg=0,totalGoals5=0;
  for(const g of games){
    if(!g) continue;
    addSet(teamGames,`${g.season}|${g.home}`,g.gameId);
    addSet(teamGames,`${g.season}|${g.away}`,g.gameId);
  }
  for(const s of shots){
    const p=clamp(sigmoid(dot(w,s.x)),0.001,0.95);
    totalXg+=p; totalGoals5+=s.y;
    const ok=`${s.season}|${s.owner}`;
    const dk=`${s.season}|${s.defender}`;
    if(!teamSeason.has(ok)) teamSeason.set(ok,{xgf:0,xga:0,goalsFor:0,goalsAgainst:0,shotsFor:0,shotsAgainst:0});
    if(!teamSeason.has(dk)) teamSeason.set(dk,{xgf:0,xga:0,goalsFor:0,goalsAgainst:0,shotsFor:0,shotsAgainst:0});
    const o=teamSeason.get(ok),d=teamSeason.get(dk);
    o.xgf+=p;o.goalsFor+=s.y;o.shotsFor+=1;
    d.xga+=p;d.goalsAgainst+=s.y;d.shotsAgainst+=1;
    if(s.goalieId){
      if(!goalie.has(s.goalieId)) goalie.set(s.goalieId,{xga:0,ga:0,shots:0});
      const g=goalie.get(s.goalieId);g.xga+=p;g.ga+=s.y;g.shots+=1;
      addSet(goalieGames,s.goalieId,s.gameId);
      const tk=`${s.goalieId}|${s.goalieTeam}`;
      goalieTeams.set(tk,(goalieTeams.get(tk)||0)+1);

      const sk=`${s.season}|${s.goalieId}`;
      if(!goalieSeason.has(sk)) goalieSeason.set(sk,{xga:0,ga:0,shots:0});
      const sg=goalieSeason.get(sk);sg.xga+=p;sg.ga+=s.y;sg.shots+=1;
      addSet(goalieSeasonGames,sk,s.gameId);
      const stk=`${s.season}|${s.goalieId}|${s.goalieTeam}`;
      goalieSeasonTeams.set(stk,(goalieSeasonTeams.get(stk)||0)+1);
    }
  }
  const recencyWeights=seasons.map((_,i)=>Math.exp((i-(seasons.length-1))*0.9));
  const teamNames=new Set([...teamSeason.keys()].map(k=>k.split("|")[1]));
  const teams={};
  for(const team of teamNames){
    let wxgf=0,wxga=0,w=0,gamesWeighted=0;
    const history={};
    for(let i=0;i<seasons.length;i++){
      const season=seasons[i],key=`${season}|${team}`;
      const a=teamSeason.get(key)||{xgf:0,xga:0,goalsFor:0,goalsAgainst:0,shotsFor:0,shotsAgainst:0};
      const gp=teamGames.get(key)?.size||0;
      if(!gp) continue;
      const xgfpg=a.xgf/gp,xgapg=a.xga/gp;
      history[season]={
        games:gp,xGF5v5PerGame:round(xgfpg,4),xGA5v5PerGame:round(xgapg,4),
        goalsFor5v5PerGame:round(a.goalsFor/gp,4),goalsAgainst5v5PerGame:round(a.goalsAgainst/gp,4),
        shotsFor5v5PerGame:round(a.shotsFor/gp,3),shotsAgainst5v5PerGame:round(a.shotsAgainst/gp,3)
      };
      const rw=recencyWeights[i];
      wxgf+=rw*xgfpg;wxga+=rw*xgapg;w+=rw;gamesWeighted+=rw*gp;
    }
    if(w>0) teams[team]={
      xGF5v5PerGame:round(wxgf/w,4),
      xGA5v5PerGame:round(wxga/w,4),
      effectiveGames:round(gamesWeighted/w,2),
      history
    };
  }
  const latest=seasons[seasons.length-1];
  const latestGames=games.filter(g=>g?.season===latest).length;
  let latestXg=0,latestGoals=0,latestShots=0;
  for(const s of shots) if(s.season===latest){latestXg+=clamp(sigmoid(dot(w,s.x)),0.001,0.95);latestGoals+=s.y;latestShots++;}
  const goalies={};
  const expectedGoalieByTeam={};
  const goaliePriorWeights={};
  const explicit=[0.15,0.25,0.60];
  for(let i=0;i<seasons.length;i++){
    goaliePriorWeights[seasons[i]]=explicit[i] ?? 0;
  }

  for(const [id,g] of goalie){
    const gp=goalieGames.get(id)?.size||0;
    if(!gp) continue;

    const history={};
    let weightedImpact=0;
    let usedWeight=0;
    let latestTeam=null;
    let latestTeamShots=0;
    let latestSeasonGames=0;

    for(const season of seasons){
      const sk=`${season}|${id}`;
      const sg=goalieSeason.get(sk);
      const sgp=goalieSeasonGames.get(sk)?.size||0;
      if(!sg || !sgp) continue;

      let seasonTeam=null;
      let seasonTeamShots=0;
      for(const [key,n] of goalieSeasonTeams){
        if(!key.startsWith(`${season}|${id}|`)) continue;
        if(n>seasonTeamShots){
          seasonTeamShots=n;
          seasonTeam=key.split("|")[2]||null;
        }
      }

      const raw=(sg.xga-sg.ga)/sgp;
      const workloadShrink=sgp/(sgp+12);
      const regressed=clamp(raw*workloadShrink,-0.35,0.35);
      const weight=Number(goaliePriorWeights[season]||0);
      weightedImpact+=weight*regressed;
      usedWeight+=weight;

      history[season]={
        team:seasonTeam,
        games:sgp,
        shots:sg.shots,
        xGA:round(sg.xga,3),
        goalsAgainst:sg.ga,
        gsax:round(sg.xga-sg.ga,3),
        gsaxPerGame:round(raw,4),
        workloadShrink:round(workloadShrink,4),
        regressedImpactGoalsPerGame:round(regressed,4),
        priorWeight:round(weight,4)
      };

      if(season===latest){
        latestTeam=seasonTeam;
        latestTeamShots=seasonTeamShots;
        latestSeasonGames=sgp;
      }
    }

    const priorImpact=usedWeight>0
      ? clamp(weightedImpact/usedWeight,-0.35,0.35)
      : 0;

    let team=latestTeam;
    if(!team){
      let best=0;
      for(const [key,n] of goalieTeams){
        if(!key.startsWith(id+"|")) continue;
        if(n>best){best=n;team=key.split("|")[1];}
      }
    }

    const raw=(g.xga-g.ga)/gp;
    goalies[id]={
      goalieId:id,
      team,
      games:gp,
      shots:g.shots,
      xGA:round(g.xga,3),
      goalsAgainst:g.ga,
      gsax:round(g.xga-g.ga,3),
      gsaxPerGame:round(raw,4),
      history,
      priorWeights:goaliePriorWeights,
      priorWeightUsed:round(usedWeight,4),
      latestSeason:latest,
      latestSeasonGames,
      latestSeasonTeam:latestTeam,
      latestSeasonTeamShots:latestTeamShots,
      regressedImpactGoalsPerGame:round(priorImpact,4)
    };

    if(latestTeam){
      const cur=expectedGoalieByTeam[latestTeam];
      if(!cur || latestSeasonGames>cur.games){
        expectedGoalieByTeam[latestTeam]={
          goalieId:id,
          games:latestSeasonGames,
          impactGoalsPerGame:round(priorImpact,4),
          status:"EXPECTED_STARTER_PRIOR",
          sourceSeason:latest,
          priorWeights:goaliePriorWeights
        };
      }
    }
  }
  return {
    teams,goalies,expectedGoalieByTeam,
    league:{
      fiveVFiveXgPerTeamGame: latestGames?round(latestXg/(latestGames*2),4):2.35,
      fiveVFiveGoalsPerTeamGame: latestGames?round(latestGoals/(latestGames*2),4):2.25,
      goalsPerTeamGame:3.05,
      ppOpportunitiesPerTeamGame:3.0,
      ppPct:0.21,
      latestSeasonShots5v5:latestShots
    }
  };
}
function artifactModule(data){
  return `/** AUTO-GENERATED by scripts/nhl-historical-fit.mjs. Do not hand edit. */\nexport const NHL_FBIS_V1_ARTIFACT = Object.freeze(${JSON.stringify(data,null,2)});\n`;
}

console.log("NHL historical fit seasons",seasons.join(","));
let allGames=[];
for(const season of seasons){
  const g=await collectSchedule(season);
  console.log("schedule",season,g.length);
  allGames.push(...g);
}
allGames=[...new Map(allGames.map(g=>[g.id,g])).values()];
if(maxGames>0) allGames=allGames.slice(0,maxGames);
console.log("games",allGames.length,"concurrency",concurrency);

let done=0;
const parsed=await mapLimit(allGames,concurrency,async(game)=>{
  try{
    const json=await fetchJson(`${API}/gamecenter/${game.id}/play-by-play`);
    const p=parseGamePbp(game,json);
    done++;
    if(done%100===0) console.log("pbp",done,"/",allGames.length);
    return p;
  }catch(err){
    done++;
    console.error("pbp_error",game.id,String(err?.message||err));
    return {shots:[],gameMeta:null,totalGoals:0,error:String(err?.message||err)};
  }
});
const shots=parsed.flatMap(p=>p?.shots||[]);
const games=parsed.map(p=>p?.gameMeta).filter(Boolean);
const failedGames=parsed.filter(p=>p?.error).length;
console.log("parsed games",games.length,"shots",shots.length,"failed",failedGames);

if(shots.length<5000) throw new Error(`insufficient historical shots: ${shots.length}`);
const validationSeason=seasons[seasons.length-1];
const train=shots.filter(s=>s.season!==validationSeason);
const valid=shots.filter(s=>s.season===validationSeason);
const wValidation=fitLogistic(train,{epochs:7,lr:0.018});
const validation=metrics(valid,wValidation);
console.log("validation",validation);

const finalWeights=fitLogistic(shots,{epochs:6,lr:0.014,initial:wValidation});
const agg=aggregate(shots,games,finalWeights,seasons);
const artifact={
  artifactVersion:"research-v1.1-historical-xg-goalie-recency",
  generatedAt:new Date().toISOString(),
  trained:true,
  marketInformed:false,
  seasons,
  gamesFetched:allGames.length,
  gamesParsed:games.length,
  failedGames,
  xg:{
    featureOrder:FEATURE_ORDER,
    coefficients:finalWeights.map(v=>round(v,8)),
    trainShots:train.length,
    trainGoals:train.reduce((s,r)=>s+r.y,0),
    validationSeason,
    validationShots:validation.n,
    validationGoals:validation.goals,
    validationBrier:round(validation.brier,8),
    validationLogLoss:round(validation.logLoss,8)
  },
  league:agg.league,
  teams:agg.teams,
  goaliePriorWeights:{"20232024":0.15,"20242025":0.25,"20252026":0.60},
  goaliePriorPolicy:"season-specific GSAx/game, workload-shrunk within season, then 60/25/15 recency blend",
  goalies:agg.goalies,
  expectedGoalieByTeam:agg.expectedGoalieByTeam
};
await writeFile(outPath,artifactModule(artifact),"utf8");
console.log("wrote",outPath,"teams",Object.keys(artifact.teams).length,"goalies",Object.keys(artifact.goalies).length);
