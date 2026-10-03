#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";

const API = "https://api-web.nhle.com/v1";
const DEFAULT_SEASONS = ["20232024", "20242025", "20252026"];
const SHOT_TYPES = ["wrist","snap","slap","backhand","tip","deflected","wrap","poke"];
const FEATURE_ORDER = [
  "intercept","distance50","angle90","distanceSq2500","angleSq8100",
  "rebound","reboundDistance50",...SHOT_TYPES
];

function arg(name, fallback=null) {
  const p=process.argv.find((x)=>x.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : fallback;
}
const seasons=String(arg("seasons",DEFAULT_SEASONS.join(","))).split(",").map(s=>s.trim()).filter(Boolean);
const outPath=arg("out","data/models/nhl-fbis-v1-validation.json");
const concurrency=Math.max(2,Math.min(24,Number(arg("concurrency","12"))||12));
const maxGamesPerSeason=Math.max(0,Number(arg("max-games-per-season","0"))||0);

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function round(v,n=5){const p=10**n;return Math.round(Number(v)*p)/p;}
function sigmoid(z){return z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));}
function dot(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
function isoAdd(date,days){const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function seasonRange(season){const y=Number(String(season).slice(0,4));return {start:`${y}-09-15`,end:`${y+1}-06-30`};}

async function fetchJson(url, attempts=5){
  let last;
  for(let i=1;i<=attempts;i++){
    try{
      const res=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS-NHL-walkforward/1.0"},signal:AbortSignal.timeout(30000)});
      if(res.ok)return res.json();
      last=new Error(`HTTP_${res.status} ${url}`);
      if(res.status===404)throw last;
      if(res.status===429||res.status>=500)await sleep(i*700);else throw last;
    }catch(err){last=err;if(i<attempts)await sleep(i*700);}
  }
  throw last;
}

async function collectSchedule(season){
  const {start,end}=seasonRange(season);
  const games=new Map();
  for(let day=start;day<=end;day=isoAdd(day,7)){
    let json;
    try{json=await fetchJson(`${API}/schedule/${day}`);}catch{continue;}
    for(const block of json?.gameWeek||[]){
      for(const g of block?.games||[]){
        const id=String(g?.id||"");
        if(!id||Number(g?.gameType)!==2)continue;
        if(String(g?.season||season)!==season)continue;
        const hs=Number(g?.homeTeam?.score),as=Number(g?.awayTeam?.score);
        if(!Number.isFinite(hs)||!Number.isFinite(as))continue;
        games.set(id,{
          id,season,start:g.startTimeUTC||null,
          home:String(g?.homeTeam?.abbrev||"").toUpperCase(),
          away:String(g?.awayTeam?.abbrev||"").toUpperCase(),
          homeGoals:hs,awayGoals:as
        });
      }
    }
  }
  let rows=[...games.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.id.localeCompare(b.id));
  if(maxGamesPerSeason>0)rows=rows.slice(0,maxGamesPerSeason);
  return rows;
}

function eventSeconds(play){
  const period=Number(play?.periodDescriptor?.number||0);
  const m=String(play?.timeInPeriod||"").match(/^(\d+):(\d+)$/);
  if(!period||!m)return null;
  return (period-1)*1200+Number(m[1])*60+Number(m[2]);
}
function shotTypeKey(v){
  const s=String(v||"").toLowerCase().replace(/[^a-z]/g,"");
  if(s.includes("wrist"))return "wrist";
  if(s.includes("snap"))return "snap";
  if(s.includes("slap"))return "slap";
  if(s.includes("backhand"))return "backhand";
  if(s.includes("tip"))return "tip";
  if(s.includes("deflect"))return "deflected";
  if(s.includes("wrap"))return "wrap";
  if(s.includes("poke"))return "poke";
  return null;
}
function isFiveOnFive(play){return String(play?.situationCode||"").replace(/\D/g,"")==="1551";}
function features(play,rebound){
  const x=Number(play?.details?.xCoord),y=Number(play?.details?.yCoord);
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  const dx=Math.max(0,89-Math.abs(x));
  const dist=Math.sqrt(dx*dx+y*y);
  const angle=Math.atan2(Math.abs(y),Math.max(1,dx))*180/Math.PI;
  const type=shotTypeKey(play?.details?.shotType);
  return [
    1,clamp(dist/50,0,2.5),clamp(angle/90,0,1),
    clamp((dist*dist)/2500,0,6.25),clamp((angle*angle)/8100,0,1),
    rebound?1:0,rebound?clamp(dist/50,0,2.5):0,
    ...SHOT_TYPES.map(t=>type===t?1:0)
  ];
}
function parsePbp(game,json){
  const homeId=String(json?.homeTeam?.id??""),awayId=String(json?.awayTeam?.id??"");
  const ids=new Map([[homeId,game.home],[awayId,game.away]]);
  const shots=[];let prev=null;
  for(const play of json?.plays||[]){
    const type=String(play?.typeDescKey||"").toLowerCase();
    if(!["goal","shot-on-goal","missed-shot"].includes(type)||!isFiveOnFive(play))continue;
    const owner=ids.get(String(play?.details?.eventOwnerTeamId??""));
    const defender=owner===game.home?game.away:owner===game.away?game.home:null;
    if(!owner||!defender)continue;
    const sec=eventSeconds(play);
    const rebound=Boolean(prev&&sec!=null&&prev.sec!=null&&owner===prev.owner&&sec-prev.sec>=0&&sec-prev.sec<=3);
    const x=features(play,rebound);if(!x)continue;
    shots.push({gameId:game.id,season:game.season,owner,defender,x,y:type==="goal"?1:0});
    prev={sec,owner};
  }
  return shots;
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let idx=0;
  async function worker(){while(true){const i=idx++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch(err){out[i]={error:String(err?.message||err),shots:[]};}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return out;
}
function baseWeights(rows){
  const rate=rows.length?rows.reduce((s,r)=>s+r.y,0)/rows.length:0.06;
  const w=new Array(FEATURE_ORDER.length).fill(0);
  const p=clamp(rate,0.005,0.3);w[0]=Math.log(p/(1-p));return w;
}
function fitLogistic(rows,{epochs=6,lr=0.018,l2=0.00002}={}){
  const w=baseWeights(rows);
  for(let e=0;e<epochs;e++){
    const step=lr/(1+e*0.35);
    for(const r of rows){
      const p=sigmoid(dot(w,r.x)),err=r.y-p;
      for(let j=0;j<w.length;j++)w[j]+=step*(err*r.x[j]-(j===0?0:l2*w[j]));
    }
  }
  return w;
}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function homeWinProb(h,a){
  let hw=0,tie=0;
  for(let i=0;i<=12;i++)for(let j=0;j<=12;j++){
    const p=poisson(h,i)*poisson(a,j);
    if(i>j)hw+=p;else if(i===j)tie+=p;
  }
  const ot=1/(1+Math.exp(-(h-a)/0.7));
  return clamp(hw+tie*ot,0.01,0.99);
}
function teamPrior(trainGames,trainShots,w){
  const agg=new Map();
  const row=t=>{if(!agg.has(t))agg.set(t,{gp:0,gf:0,ga:0,xgf:0,xga:0});return agg.get(t);};
  for(const g of trainGames){
    const h=row(g.home),a=row(g.away);h.gp++;a.gp++;h.gf+=g.homeGoals;h.ga+=g.awayGoals;a.gf+=g.awayGoals;a.ga+=g.homeGoals;
  }
  for(const s of trainShots){
    const p=clamp(sigmoid(dot(w,s.x)),0.001,0.95);row(s.owner).xgf+=p;row(s.defender).xga+=p;
  }
  const league=trainGames.length?trainGames.reduce((n,g)=>n+g.homeGoals+g.awayGoals,0)/(trainGames.length*2):3.05;
  const leagueXg=trainGames.length?trainShots.reduce((n,s)=>n+clamp(sigmoid(dot(w,s.x)),0.001,0.95),0)/(trainGames.length*2):2.2;
  const out={};
  for(const [t,a] of agg)out[t]={gf:a.gp?a.gf/a.gp:league,ga:a.gp?a.ga/a.gp:league,xgf:a.gp?a.xgf/a.gp:leagueXg,xga:a.gp?a.xga/a.gp:leagueXg,gp:a.gp};
  return {teams:out,league,leagueXg};
}
function currentRow(map,t){if(!map.has(t))map.set(t,{gp:0,gf:0,ga:0,xgf:0,xga:0});return map.get(t);}
function blend(prior,current,field,league){
  if(!prior&&!current?.gp)return league;
  const p=Number(prior?.[field]);const c=current?.gp?Number(current?.[field]??0)/current.gp:null;
  if(!Number.isFinite(c))return Number.isFinite(p)?p:league;
  if(!Number.isFinite(p))return c;
  const w=clamp(current.gp/25,0,0.82);return p*(1-w)+c*w;
}
function summarize(rows){
  const n=rows.length;if(!n)return {n:0};
  let margin=0,total=0,winner=0,brier=0,home=0,away=0;
  for(const r of rows){
    margin+=Math.abs(r.predMargin-r.actualMargin);
    total+=Math.abs(r.predTotal-r.actualTotal);
    home+=Math.abs(r.predHome-r.actualHome);
    away+=Math.abs(r.predAway-r.actualAway);
    const y=r.actualHome>r.actualAway?1:0;
    winner+=(r.pHome>=0.5)===Boolean(y)?1:0;
    brier+=(r.pHome-y)**2;
  }
  return {n,marginMae:round(margin/n,4),totalMae:round(total/n,4),homeGoalsMae:round(home/n,4),awayGoalsMae:round(away/n,4),winnerAccuracy:round(winner/n,4),brier:round(brier/n,5)};
}

console.log("NHL walk-forward seasons",seasons.join(","));
const gamesBySeason={},shotsBySeason={},fetchErrors=[];
for(const season of seasons){
  const games=await collectSchedule(season);gamesBySeason[season]=games;
  console.log("schedule",season,games.length);
  const parsed=await mapLimit(games,concurrency,async(g)=>{
    try{return {shots:parsePbp(g,await fetchJson(`${API}/gamecenter/${g.id}/play-by-play`))};}
    catch(err){return {shots:[],error:String(err?.message||err),gameId:g.id};}
  });
  shotsBySeason[season]=parsed.flatMap(x=>x.shots||[]);
  for(const p of parsed)if(p.error)fetchErrors.push({season,gameId:p.gameId,error:p.error});
  console.log("shots",season,shotsBySeason[season].length);
}

const folds=[];
for(let idx=1;idx<seasons.length;idx++){
  const target=seasons[idx],trainSeasons=seasons.slice(0,idx);
  const trainGames=trainSeasons.flatMap(s=>gamesBySeason[s]||[]);
  const trainShots=trainSeasons.flatMap(s=>shotsBySeason[s]||[]);
  if(trainShots.length<25000)throw new Error(`insufficient training shots for ${target}: ${trainShots.length}`);
  const weights=fitLogistic(trainShots);
  const prior=teamPrior(trainGames,trainShots,weights);
  const current=new Map();
  const targetShotByGame=new Map();
  for(const s of shotsBySeason[target]||[]){if(!targetShotByGame.has(s.gameId))targetShotByGame.set(s.gameId,[]);targetShotByGame.get(s.gameId).push(s);}
  const rows=[];
  for(const g of gamesBySeason[target]||[]){
    const hp=prior.teams[g.home],ap=prior.teams[g.away],hc=currentRow(current,g.home),ac=currentRow(current,g.away);
    const hgf=blend(hp,hc,"gf",prior.league),hga=blend(hp,hc,"ga",prior.league);
    const agf=blend(ap,ac,"gf",prior.league),aga=blend(ap,ac,"ga",prior.league);
    const hxgf=blend(hp,hc,"xgf",prior.leagueXg),hxga=blend(hp,hc,"xga",prior.leagueXg);
    const axgf=blend(ap,ac,"xgf",prior.leagueXg),axga=blend(ap,ac,"xga",prior.leagueXg);
    const baseH=(hgf+aga)/2,baseA=(agf+hga)/2;
    const xgH=(hxgf+axga)/2,xgA=(axgf+hxga)/2;
    const non5=Math.max(0.35,prior.league-prior.leagueXg);
    const predHome=clamp(0.55*baseH+0.45*(xgH+non5)+0.12,1.3,5.5);
    const predAway=clamp(0.55*baseA+0.45*(xgA+non5),1.3,5.5);
    const pHome=homeWinProb(predHome,predAway);
    rows.push({
      gameId:g.id,start:g.start,home:g.home,away:g.away,
      predHome:round(predHome,3),predAway:round(predAway,3),
      predMargin:round(predHome-predAway,3),predTotal:round(predHome+predAway,3),
      pHome:round(pHome,5),
      actualHome:g.homeGoals,actualAway:g.awayGoals,
      actualMargin:g.homeGoals-g.awayGoals,actualTotal:g.homeGoals+g.awayGoals,
      homeGamesBefore:hc.gp,awayGamesBefore:ac.gp
    });
    const hs=targetShotByGame.get(g.id)||[];
    let hx=0,ax=0;
    for(const s of hs){const p=clamp(sigmoid(dot(weights,s.x)),0.001,0.95);if(s.owner===g.home){hx+=p;}else if(s.owner===g.away){ax+=p;}}
    hc.gp++;ac.gp++;hc.gf+=g.homeGoals;hc.ga+=g.awayGoals;ac.gf+=g.awayGoals;ac.ga+=g.homeGoals;hc.xgf+=hx;hc.xga+=ax;ac.xgf+=ax;ac.xga+=hx;
  }
  folds.push({targetSeason:target,trainSeasons,trainingGames:trainGames.length,trainingShots:trainShots.length,metrics:summarize(rows),rows});
  console.log("fold",target,summarize(rows));
}

const allRows=folds.flatMap(f=>f.rows);
const report={
  modelId:"NHL-FBIS-v1",
  validationVersion:"walkforward-v1-core",
  generatedAt:new Date().toISOString(),
  marketInformed:false,
  pointInTime:true,
  source:"NHL_OFFICIAL_API",
  sportsDataverseRole:"HISTORICAL_ARCHIVE_AUDIT",
  note:"Historical walk-forward validates the independent scoring/xG core using only prior seasons plus games already played in each target season. Live goalie, special-teams, and confirmed-lineup layers remain gated by prospective OOS validation.",
  seasons,
  featureOrder:FEATURE_ORDER,
  fetchErrors,
  folds:folds.map(({rows,...f})=>f),
  aggregate:summarize(allRows),
  sampleGames:allRows.length,
  integrity:{
    noMarketInputs:true,
    priorSeasonOnlyTraining:true,
    currentSeasonOnlyPastGames:true,
    minimumGamesMet:allRows.length>=1500,
    fetchErrors:fetchErrors.length
  },
  promotion:{
    historicalCoreValidated:allRows.length>=1500&&fetchErrors.length===0,
    fullModelPromotionEligible:false,
    reason:"Prospective validation is still required for goalie, special-teams, lineup, and market-relative calibration."
  }
};
await mkdir(outPath.split("/").slice(0,-1).join("/")||".",{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2)+"\n","utf8");
console.log(JSON.stringify({aggregate:report.aggregate,integrity:report.integrity,promotion:report.promotion},null,2));
if(!report.integrity.minimumGamesMet||fetchErrors.length>0)process.exitCode=2;
