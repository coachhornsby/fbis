#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { rateNhlGoalieSavesConfidence, rateNhlShotsOnGoalConfidence } from "../functions/lib/nhlPropConfidence.js";

const API="https://api-web.nhle.com/v1";
function arg(name,fallback=null){const p=process.argv.find(x=>x.startsWith(`--${name}=`));return p?p.split("=").slice(1).join("="):fallback;}
const seasons=String(arg("seasons","20232024,20242025,20252026")).split(",").map(s=>s.trim()).filter(Boolean);
const cacheDir=arg("cache-dir",".cache/nhl-player-pro-v2");
const validationPath=arg("game-validation","data/models/nhl-pro-v2-validation.json");
const outPath=arg("out","data/models/nhl-player-pro-v2-validation.json");
const artifactPath=arg("artifact-out","data/models/nhl-player-pro-v2.js");
const concurrency=Math.max(2,Math.min(16,Number(arg("concurrency","8"))||8));

function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function round(v,n=4){const p=10**n;return Math.round(Number(v)*p)/p;}
function seasonRange(season){const y=Number(String(season).slice(0,4));return {start:`${y}-09-15`,end:`${y+1}-06-30`};}
function isoAdd(date,days){const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function toiSeconds(v){const m=String(v||"").match(/^(\d+):(\d+)$/);return m?Number(m[1])*60+Number(m[2]):0;}
function safeName(v){return typeof v==="string"?v:(v?.default||v?.en||null);}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0;}
function variance(a,m=mean(a)){return a.length>1?a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1):Math.max(0.1,m);}
async function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function fetchJson(url,attempts=5){
  let last;
  for(let i=1;i<=attempts;i++){
    try{
      const res=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS-NHL-PLAYER-PRO-v2/1.0"},signal:AbortSignal.timeout(25000)});
      if(res.ok)return res.json();
      last=new Error(`HTTP_${res.status} ${url}`);
      if(res.status===404)throw last;
      if(res.status===429||res.status>=500)await sleep(i*500);else throw last;
    }catch(err){last=err;if(i<attempts)await sleep(i*500);}
  }
  throw last;
}
async function cachedJson(path,url){
  try{return JSON.parse(await readFile(path,"utf8"));}catch{}
  const j=await fetchJson(url);
  await mkdir(path.split("/").slice(0,-1).join("/")||".",{recursive:true});
  await writeFile(path,JSON.stringify(j),"utf8");
  return j;
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let idx=0;
  async function worker(){while(true){const i=idx++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch(err){out[i]={error:String(err?.message||err),item:items[i]};}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out;
}
async function collectSchedule(season){
  const {start,end}=seasonRange(season),games=new Map();
  for(let day=start;day<=end;day=isoAdd(day,7)){
    let j;try{j=await cachedJson(`${cacheDir}/schedule/${season}-${day}.json`,`${API}/schedule/${day}`);}catch{continue;}
    for(const block of j?.gameWeek||[])for(const g of block?.games||[]){
      if(Number(g?.gameType)!==2||String(g?.season||season)!==season)continue;
      const id=String(g?.id||""),hs=Number(g?.homeTeam?.score),as=Number(g?.awayTeam?.score);
      if(!id||!Number.isFinite(hs)||!Number.isFinite(as))continue;
      games.set(id,{id,season,start:g.startTimeUTC||null,home:String(g?.homeTeam?.abbrev||"").toUpperCase(),away:String(g?.awayTeam?.abbrev||"").toUpperCase(),homeGoals:hs,awayGoals:as});
    }
  }
  return [...games.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.id.localeCompare(b.id));
}
async function boxscore(gameId){
  return cachedJson(`${cacheDir}/boxscore/${gameId}.json`,`${API}/gamecenter/${gameId}/boxscore`);
}
function parseBox(game,j){
  const out={home:{skaters:[],goalies:[]},away:{skaters:[],goalies:[]}};
  for(const side of ["home","away"]){
    const node=j?.playerByGameStats?.[`${side}Team`]||{};
    const team=game[side];
    for(const group of ["forwards","defense"]){
      for(const p of node?.[group]||[]){
        out[side].skaters.push({
          id:String(p.playerId||""),name:safeName(p.name),position:String(p.position||p.positionCode||"").toUpperCase(),
          team,shots:num(p.sog??p.shots),goals:num(p.goals),assists:num(p.assists),points:num(p.points??(num(p.goals)+num(p.assists))),
          toi:toiSeconds(p.toi),home:side==="home"
        });
      }
    }
    for(const p of node?.goalies||[]){
      out[side].goalies.push({
        id:String(p.playerId||""),name:safeName(p.name),position:"G",team,
        saves:num(p.saves),shotsAgainst:num(p.shotsAgainst),goalsAgainst:num(p.goalsAgainst),
        savePct:Number.isFinite(Number(p.savePctg))?Number(p.savePctg):null,toi:toiSeconds(p.toi),home:side==="home"
      });
    }
  }
  for(const side of ["home","away"])out[side].goalies.sort((a,b)=>b.toi-a.toi);
  return out;
}
function blankPlayer(){return {gp:0,shots:0,goals:0,assists:0,points:0,values:{shots:[],goals:[],assists:[],points:[]},recent:{shots:[],goals:[],assists:[],points:[]},team:null,position:null};}
function blankGoalie(){return {gp:0,starts:0,saves:0,shotsAgainst:0,goalsAgainst:0,values:{saves:[]},recent:{saves:[]},team:null};}
function blankTeam(){return {gp:0,sf:0,sa:0,gf:0,ga:0,lastGameAt:null};}
function get(map,key,factory){if(!map.has(key))map.set(key,factory());return map.get(key);}
function pushRecent(arr,v,n=10){arr.push(v);while(arr.length>n)arr.shift();}
function applyBox(game,parsed,state){
  const {players,goalies,teams}=state;
  const hSk=parsed.home.skaters,aSk=parsed.away.skaters;
  const hShots=hSk.reduce((s,p)=>s+p.shots,0),aShots=aSk.reduce((s,p)=>s+p.shots,0);
  const h=get(teams,game.home,blankTeam),a=get(teams,game.away,blankTeam);
  h.gp++;a.gp++;h.sf+=hShots;h.sa+=aShots;a.sf+=aShots;a.sa+=hShots;h.gf+=game.homeGoals;h.ga+=game.awayGoals;a.gf+=game.awayGoals;a.ga+=game.homeGoals;
  h.lastGameAt=Date.parse(game.start||"")||h.lastGameAt;a.lastGameAt=Date.parse(game.start||"")||a.lastGameAt;
  for(const side of ["home","away"]){
    for(const p of parsed[side].skaters){
      const r=get(players,p.id,blankPlayer);r.gp++;r.team=p.team;r.position=p.position||r.position;
      for(const [k,v] of [["shots",p.shots],["goals",p.goals],["assists",p.assists],["points",p.points]]){r[k]+=v;r.values[k].push(v);pushRecent(r.recent[k],v);}
    }
    for(let i=0;i<parsed[side].goalies.length;i++){
      const p=parsed[side].goalies[i],r=get(goalies,p.id,blankGoalie);r.gp++;if(i===0)r.starts++;r.team=p.team;r.saves+=p.saves;r.shotsAgainst+=p.shotsAgainst;r.goalsAgainst+=p.goalsAgainst;r.values.saves.push(p.saves);pushRecent(r.recent.saves,p.saves);
    }
  }
}
function mergeRate(prior,current,key,fallback,pseudo=12){
  const pr=prior?.gp?prior[key]/prior.gp:fallback,cr=current?.gp?current[key]/current.gp:pr;
  const shr=(pr*(prior?.gp||0)+fallback*pseudo)/((prior?.gp||0)+pseudo);
  const w=current?.gp?clamp(current.gp/(current.gp+12),0,0.85):0;
  const recent=current?.recent?.[key]?.length?mean(current.recent[key]):cr;
  return (shr*(1-w)+cr*w)*0.82+recent*0.18;
}
function teamRate(prior,current,key,fallback){
  const pr=prior?.gp?prior[key]/prior.gp:fallback,cr=current?.gp?current[key]/current.gp:pr,w=current?.gp?clamp(current.gp/(current.gp+16),0,0.85):0;
  return pr*(1-w)+cr*w;
}
function playerSigma(prior,current,key,proj){
  const vals=[...(prior?.values?.[key]||[]),...(current?.values?.[key]||[])];
  const s=Math.sqrt(Math.max(variance(vals),key==="shots"?0.6:key==="saves"?4:Math.max(0.12,proj*0.65)));
  return clamp(s,key==="shots"?0.75:key==="saves"?2.5:0.35,key==="shots"?3.5:key==="saves"?9:1.6);
}
function positionMeans(players){
  const buckets={F:{shots:[],goals:[],assists:[],points:[]},D:{shots:[],goals:[],assists:[],points:[]},ALL:{shots:[],goals:[],assists:[],points:[]}};
  for(const p of players.values()){
    if(p.gp<5)continue;const pos=p.position==="D"?"D":"F";
    for(const k of ["shots","goals","assists","points"]){buckets[pos][k].push(p[k]/p.gp);buckets.ALL[k].push(p[k]/p.gp);}
  }
  const out={};for(const [pos,b] of Object.entries(buckets)){out[pos]={};for(const k of Object.keys(b))out[pos][k]=mean(b[k])||({shots:1.8,goals:0.12,assists:0.22,points:0.34}[k]);}
  return out;
}
function goalieLeague(goalies){let saves=0,sa=0;for(const g of goalies.values()){saves+=g.saves;sa+=g.shotsAgainst;}return sa?saves/sa:0.905;}
function restDays(team,game,currentTeams,priorTeams){
  const row=currentTeams.get(team)||priorTeams.get(team);if(!row?.lastGameAt)return 4;
  const t=Date.parse(game.start||"");return Number.isFinite(t)?Math.max(0,(t-row.lastGameAt)/86400000-1):4;
}
function lineProbPoisson(lambda,line){
  let p=0,term=Math.exp(-lambda);for(let k=0;k<=Math.floor(line);k++){if(k===0)term=Math.exp(-lambda);else term*=lambda/k;p+=term;}return clamp(1-p,0.001,0.999);
}
function normalCdf(x){const t=1/(1+0.2316419*Math.abs(x));const d=0.3989423*Math.exp(-x*x/2);let p=1-d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>=0?p:1-p;}
function overProb(m,s,line){return clamp(1-normalCdf((line+0.5-m)/Math.max(0.25,s)),0.001,0.999);}
function propMetrics(rows,key="v2"){
  if(!rows.length)return null;let ae=0,se=0,bias=0,baseAe=0,baseSe=0,baseBias=0;
  for(const r of rows){const e=r[key]-r.actual,b=r.baseline-r.actual;ae+=Math.abs(e);se+=e*e;bias+=e;baseAe+=Math.abs(b);baseSe+=b*b;baseBias+=b;}
  return {n:rows.length,mae:round(ae/rows.length,4),rmse:round(Math.sqrt(se/rows.length),4),bias:round(bias/rows.length,4),
    baselineMae:round(baseAe/rows.length,4),baselineRmse:round(Math.sqrt(baseSe/rows.length),4),baselineBias:round(baseBias/rows.length,4),
    maeDelta:round((ae-baseAe)/rows.length,4)};
}
function thresholdMetrics(rows){
  let n=0,hit=0,brier=0,baseHit=0,baseBrier=0;
  for(const r of rows){
    for(const line of r.lines||[]){
      const y=r.actual>line?1:0,p=r.market==="saves"?overProb(r.v2,r.sigma,line):lineProbPoisson(r.v2,line);
      const bp=r.market==="saves"?overProb(r.baseline,r.baselineSigma||r.sigma,line):lineProbPoisson(r.baseline,line);
      hit+=(p>=0.5)===Boolean(y)?1:0;baseHit+=(bp>=0.5)===Boolean(y)?1:0;brier+=(p-y)**2;baseBrier+=(bp-y)**2;n++;
    }
  }
  return n?{n,accuracy:round(hit/n,4),baselineAccuracy:round(baseHit/n,4),brier:round(brier/n,5),baselineBrier:round(baseBrier/n,5),accuracyDelta:round((hit-baseHit)/n,4),brierDelta:round((brier-baseBrier)/n,5)}:null;
}
function groups(rows,keyFn,minN=100){
  const m=new Map();for(const r of rows){const k=String(keyFn(r)??"UNKNOWN");if(!m.has(k))m.set(k,[]);m.get(k).push(r);}
  return Object.fromEntries([...m.entries()].filter(([,v])=>v.length>=minN).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>[k,{projection:propMetrics(v),threshold:thresholdMetrics(v)}]));
}
function explodedLineMetrics(rows){
  if(!rows.length)return null;
  let hit=0,baseHit=0,brier=0,baseBrier=0;
  for(const r of rows){
    hit+=(r.p>=0.5)===Boolean(r.y)?1:0;
    baseHit+=(r.bp>=0.5)===Boolean(r.y)?1:0;
    brier+=(r.p-r.y)**2;baseBrier+=(r.bp-r.y)**2;
  }
  const n=rows.length;
  return {n,accuracy:round(hit/n,4),baselineAccuracy:round(baseHit/n,4),brier:round(brier/n,5),baselineBrier:round(baseBrier/n,5),accuracyDelta:round((hit-baseHit)/n,4),brierDelta:round((brier-baseBrier)/n,5)};
}
function lineGroups(rows,keyFn,minN=100){
  const m=new Map();for(const r of rows){const k=String(keyFn(r)??"UNKNOWN");if(!m.has(k))m.set(k,[]);m.get(k).push(r);}
  return Object.fromEntries([...m.entries()].filter(([,v])=>v.length>=minN).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>[k,{threshold:explodedLineMetrics(v)}]));
}

function quantileCuts(values){
  const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y);
  const q=p=>a.length?a[Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*p)))]:null;
  return {q25:q(.25),q50:q(.50),q75:q(.75)};
}
function quartile(v,cuts,{invert=false}={}){
  if(!Number.isFinite(v)||!Number.isFinite(cuts?.q25))return "UNKNOWN";
  const q=v<=cuts.q25?"Q1":v<=cuts.q50?"Q2":v<=cuts.q75?"Q3":"Q4";
  if(!invert)return q;
  return ({Q1:"Q4",Q2:"Q3",Q3:"Q2",Q4:"Q1"})[q];
}
function lineGapBucket(g){
  const a=Math.abs(g);
  return a<1?"<1":a<2?"1-1.99":a<3?"2-2.99":a<4?"3-3.99":"4+";
}
function savesLineBucket(line){
  return line<=22.5?"20.5-22.5":line<=26.5?"23.5-26.5":line<=30.5?"27.5-30.5":"31.5+";
}
function sogLineBucket(line){
  return line<=1.5?"0.5-1.5":line<=2.5?"2.5":line<=3.5?"3.5":"4.5+";
}
function savesBetStats(rows){
  if(!rows.length)return null;
  let hit=0,brier=0;
  for(const r of rows){
    const actualOver=r.y===1,callOver=r.direction==="OVER";
    hit+=actualOver===callOver?1:0;
    brier+=(r.p-r.y)**2;
  }
  return {n:rows.length,accuracy:round(hit/rows.length,4),brier:round(brier/rows.length,5)};
}
function savesGroups(rows,keyFn,minN=50){
  const m=new Map();for(const r of rows){const k=String(keyFn(r)??"UNKNOWN");if(!m.has(k))m.set(k,[]);m.get(k).push(r);}
  return Object.fromEntries([...m.entries()].filter(([,v])=>v.length>=minN).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>[k,savesBetStats(v)]));
}
function starValidation(rows,{coreFilter=null,minN=100}={}){
  const seasons=[...new Set(rows.map(r=>r.season).filter(Boolean))].sort();
  const summarize=(xs)=>{
    const byStars=savesGroups(xs,r=>`${r.stars} STAR`,minN);
    const ordered=[1,2,3,4,5].map(star=>({star,...(byStars[`${star} STAR`]||{})})).filter(x=>x.n);
    let monotonic=ordered.length===5,prev=-Infinity;
    for(const x of ordered){if(x.accuracy+1e-12<prev)monotonic=false;prev=x.accuracy;}
    return {byStars,monotonic,starsPresent:ordered.map(x=>x.star),n:ordered.reduce((s,x)=>s+x.n,0)};
  };
  const aggregate=summarize(rows);
  const core=coreFilter?summarize(rows.filter(coreFilter)):null;
  const bySeason=Object.fromEntries(seasons.map(season=>{
    const xs=rows.filter(r=>r.season===season);
    return [season,{all:summarize(xs),core:coreFilter?summarize(xs.filter(coreFilter)):null}];
  }));
  const allSeasonsMonotonic=Object.values(bySeason).every(x=>x.all.monotonic&&(!x.core||x.core.monotonic));
  return {aggregate,core,bySeason,allSeasonsMonotonic,validated:Boolean(aggregate.monotonic&&(!core||core.monotonic)&&allSeasonsMonotonic)};
}
function halfPoints(lo,hi){const out=[];for(let x=lo;x<=hi;x+=1)out.push(x+0.5);return out;}
function marketLines(m){
  return m==="shots_on_goal"?halfPoints(0,6)
    :m==="goals"?halfPoints(0,1)
    :m==="assists"?halfPoints(0,2)
    :m==="points"?halfPoints(0,3)
    :m==="saves"?halfPoints(15,39)
    :[];
}
function phase(i,n){const x=i/Math.max(1,n);return x<1/3?"EARLY":x<2/3?"MIDDLE":"LATE";}
function sampleBand(n){return n<10?"<10":n<30?"10-29":n<60?"30-59":"60+";}
function projectionBand(m,v){if(m==="shots_on_goal")return v<1.5?"LOW":v<2.75?"MID":v<4?"HIGH":"ELITE";if(m==="saves")return v<22?"LOW":v<27?"MID":v<31?"HIGH":"VERY_HIGH";return v<0.35?"LOW":v<0.75?"MID":v<1.2?"HIGH":"ELITE";}

const validation=JSON.parse(await readFile(validationPath,"utf8"));
const gamePred=new Map((validation.gamePredictions||[]).map(r=>[String(r.id),r]));
if(!gamePred.size)throw new Error("game validation missing gamePredictions; rerun NHL-PRO-v2 walk-forward first");

const gamesBySeason={},boxesBySeason={},errors=[];
for(const season of seasons){
  const games=await collectSchedule(season);gamesBySeason[season]=games;console.log("schedule",season,games.length);
  const rows=await mapLimit(games,concurrency,async g=>{try{return {id:g.id,parsed:parseBox(g,await boxscore(g.id))};}catch(err){return {id:g.id,error:String(err?.message||err)};}});
  const m=new Map();for(const r of rows){if(r.error)errors.push({season,id:r.id,error:r.error});else m.set(r.id,r.parsed);}boxesBySeason[season]=m;
  console.log("boxscores",season,m.size,"errors",rows.filter(r=>r.error).length);
}
if(errors.length)throw new Error(`boxscore fetch errors: ${errors.length}`);

function buildStateFromSeasons(list){
  const state={players:new Map(),goalies:new Map(),teams:new Map()};
  for(const s of list)for(const g of gamesBySeason[s]||[]){const p=boxesBySeason[s].get(g.id);if(p)applyBox(g,p,state);}
  return state;
}
const allRows=[],folds=[];
for(let idx=1;idx<seasons.length;idx++){
  const target=seasons[idx],priorState=buildStateFromSeasons(seasons.slice(0,idx)),current={players:new Map(),goalies:new Map(),teams:new Map()};
  const posMeans=positionMeans(priorState.players),leagueSave=goalieLeague(priorState.goalies),rows=[];
  const targetGames=gamesBySeason[target]||[];
  for(let gi=0;gi<targetGames.length;gi++){
    const g=targetGames[gi],parsed=boxesBySeason[target].get(g.id);if(!parsed)continue;
    const env=gamePred.get(g.id);
    const homeGoalPred=env?.projHome??teamRate(priorState.teams.get(g.home),current.teams.get(g.home),"gf",3.05);
    const awayGoalPred=env?.projAway??teamRate(priorState.teams.get(g.away),current.teams.get(g.away),"gf",3.05);
    const homeRest=env?.homeRestDays??restDays(g.home,g,current.teams,priorState.teams),awayRest=env?.awayRestDays??restDays(g.away,g,current.teams,priorState.teams);

    for(const side of ["home","away"]){
      const team=g[side],opp=g[side==="home"?"away":"home"],teamGoals=side==="home"?homeGoalPred:awayGoalPred,oppGoals=side==="home"?awayGoalPred:homeGoalPred;
      const teamPrior=priorState.teams.get(team),teamCur=current.teams.get(team),oppPrior=priorState.teams.get(opp),oppCur=current.teams.get(opp);
      const sf=teamRate(teamPrior,teamCur,"sf",30),oppSa=teamRate(oppPrior,oppCur,"sa",30),teamShots=clamp((sf+oppSa)/2,20,42);
      const skaters=parsed[side].skaters;
      const rateCache=skaters.map(p=>{
        const pr=priorState.players.get(p.id),cr=current.players.get(p.id),pos=p.position==="D"?"D":"F",fallback=posMeans[pos]||posMeans.ALL;
        return {p,pr,cr,pos,
          shots:mergeRate(pr,cr,"shots",fallback.shots,10),
          goals:mergeRate(pr,cr,"goals",fallback.goals,18),
          assists:mergeRate(pr,cr,"assists",fallback.assists,16),
          points:mergeRate(pr,cr,"points",fallback.points,14)};
      });
      const shotSum=rateCache.reduce((s,x)=>s+x.shots,0)||1,goalSum=rateCache.reduce((s,x)=>s+x.goals,0)||1,assistSum=rateCache.reduce((s,x)=>s+x.assists,0)||1;
      for(let pi=0;pi<rateCache.length;pi++){
        const x=rateCache[pi],p=x.p,rest=side==="home"?homeRest:awayRest,restFactor=rest<0.6?0.96:rest>2.5?1.01:1;
        const scoringBase=teamRate(teamPrior,teamCur,"gf",3.05),scoringFactor=clamp(teamGoals/Math.max(1.5,scoringBase),0.78,1.25);
        const baselineShots=x.shots*scoringFactor,shareShots=teamShots*(x.shots/shotSum),sog=clamp((0.55*x.shots+0.45*shareShots)*restFactor,0.15,7.5);
        const shootPct=clamp(x.goals/Math.max(0.35,x.shots),0.025,0.28),goalIndividual=sog*shootPct,goalTeam=teamGoals*(x.goals/goalSum);
        const goals=clamp((0.55*goalIndividual+0.45*goalTeam)*restFactor,0.015,1.4);
        const assistTeam=teamGoals*1.65*(x.assists/assistSum),assists=clamp((0.55*x.assists+0.45*assistTeam)*restFactor,0.02,1.8),points=clamp(goals+assists,0.04,2.5);
        const base={shots_on_goal:baselineShots,goals:x.goals*scoringFactor,assists:x.assists*scoringFactor,points:x.points*scoringFactor};
        const pred={shots_on_goal:sog,goals,assists,points};
        const actual={shots_on_goal:p.shots,goals:p.goals,assists:p.assists,points:p.points};
        const histGp=(x.pr?.gp||0),curGp=(x.cr?.gp||0),roleRank=pi<6?"TOP6":pi<12?"MIDDLE6":"DEPTH";
        for(const market of Object.keys(pred)){
          const key=market==="shots_on_goal"?"shots":market;
          const sigma=playerSigma(x.pr,x.cr,key,pred[market]);
          rows.push({season:target,date:String(g.start||"").slice(0,10),gameId:g.id,team,opp,home:side==="home",position:x.pos,playerId:p.id,playerName:p.name,
            market,actual:actual[market],baseline:base[market],v2:pred[market],sigma,baselineSigma:sigma,
            priorGp:histGp,currentGp:curGp,restDays:rest,b2b:rest<0.6,seasonPhase:phase(gi,targetGames.length),roleTier:roleRank,
            projectedTeamGoals:teamGoals,projectedTeamShots:teamShots,
            teamShotsFor:sf,opponentShotsAgainst:oppSa,playerShotRate:x.shots,playerShotShare:x.shots/shotSum,
            recentShotRate:x.cr?.recent?.shots?.length?mean(x.cr.recent.shots):null,
            lines:marketLines(market)});
        }
      }

      const starter=parsed[side].goalies[0];
      if(starter&&starter.toi>=1800){
        const gp=priorState.goalies.get(starter.id),gc=current.goalies.get(starter.id);
        const priorSave=gp?.shotsAgainst?gp.saves/gp.shotsAgainst:leagueSave,currentSave=gc?.shotsAgainst?gc.saves/gc.shotsAgainst:priorSave;
        const w=gc?.starts?clamp(gc.starts/(gc.starts+10),0,0.85):0,savePct=clamp(priorSave*(1-w)+currentSave*w,0.84,0.95);
        const oppSf=teamRate(oppPrior,oppCur,"sf",30),teamSa=teamRate(teamPrior,teamCur,"sa",30),oppShots=clamp((oppSf+teamSa)/2,20,42);
        const baseline=oppShots*savePct,v2=clamp(0.60*baseline+0.40*Math.max(8,oppShots-oppGoals),10,40);
        const sigma=playerSigma(gp,gc,"saves",v2),rest=side==="home"?homeRest:awayRest;
        rows.push({season:target,date:String(g.start||"").slice(0,10),gameId:g.id,team,opp,home:side==="home",position:"G",playerId:starter.id,playerName:starter.name,
          market:"saves",actual:starter.saves,baseline,v2,sigma,baselineSigma:sigma,priorGp:gp?.starts||0,currentGp:gc?.starts||0,
          restDays:rest,b2b:rest<0.6,seasonPhase:phase(gi,targetGames.length),roleTier:"STARTER",projectedTeamGoals:teamGoals,projectedTeamShots:oppShots,
          opponentShotsFor:oppSf,teamShotsAgainst:teamSa,lines:marketLines("saves")});
      }
    }
    applyBox(g,parsed,current);
  }
  const fold={season:target,n:rows.length,markets:Object.fromEntries(["shots_on_goal","goals","assists","points","saves"].map(m=>[m,{projection:propMetrics(rows.filter(r=>r.market===m)),threshold:thresholdMetrics(rows.filter(r=>r.market===m))}]))};
  folds.push(fold);for(const row of rows)allRows.push(row);console.log("fold",target,fold);
}

const subset={
  byMarket:groups(allRows,r=>r.market,200),
  bySeason:groups(allRows,r=>r.season,500),
  byHomeAway:groups(allRows,r=>r.home?"HOME":"AWAY",500),
  byPosition:groups(allRows,r=>r.position,300),
  byRoleTier:groups(allRows,r=>r.roleTier,300),
  byPriorSample:groups(allRows,r=>sampleBand(r.priorGp),300),
  byCurrentSample:groups(allRows,r=>sampleBand(r.currentGp),300),
  bySeasonPhase:groups(allRows,r=>r.seasonPhase,300),
  byRest:groups(allRows,r=>r.b2b?"B2B":r.restDays>=2.5?"2PLUS_REST":"NORMAL_REST",300),
  byProjectionTier:groups(allRows,r=>`${r.market}:${projectionBand(r.market,r.v2)}`,150),
  byTeam:groups(allRows,r=>r.team,150)
};
const lineRows=[];
for(const r of allRows)for(const line of r.lines||[]){
  const y=r.actual>line?1:0,p=r.market==="saves"?overProb(r.v2,r.sigma,line):lineProbPoisson(r.v2,line),bp=r.market==="saves"?overProb(r.baseline,r.sigma,line):lineProbPoisson(r.baseline,line);
  lineRows.push({...r,line,y,p,bp,edge:Math.abs(p-0.5)});
}
const byLine=lineGroups(lineRows,r=>`${r.market}:${r.line}`,100);
const byEdge=lineGroups(lineRows,r=>r.edge<0.05?"<5%":r.edge<0.10?"5-9.9%":r.edge<0.15?"10-14.9%":r.edge<0.20?"15-19.9%":"20%+",200);

const sogRows=allRows.filter(r=>r.market==="shots_on_goal");
const sogCuts={
  teamShotsFor:quantileCuts(sogRows.map(r=>r.teamShotsFor)),
  opponentShotsAgainst:quantileCuts(sogRows.map(r=>r.opponentShotsAgainst)),
  projectedTeamShots:quantileCuts(sogRows.map(r=>r.projectedTeamShots)),
  playerShotRate:quantileCuts(sogRows.map(r=>r.playerShotRate)),
  playerShotShare:quantileCuts(sogRows.map(r=>r.playerShotShare)),
  priorGames:quantileCuts(sogRows.map(r=>r.priorGp)),
};
const sogLineRows=lineRows.filter(r=>r.market==="shots_on_goal").map(r=>({
  ...r,
  direction:r.v2>r.line?"OVER":"UNDER",
  gap:r.v2-r.line,
  gapBucket:lineGapBucket(r.v2-r.line),
  lineBucket:sogLineBucket(r.line),
  teamAttackQuartile:quartile(r.teamShotsFor,sogCuts.teamShotsFor),
  opponentAllowanceQuartile:quartile(r.opponentShotsAgainst,sogCuts.opponentShotsAgainst),
  projectedTeamShotsQuartile:quartile(r.projectedTeamShots,sogCuts.projectedTeamShots),
  playerShotRateQuartile:quartile(r.playerShotRate,sogCuts.playerShotRate),
  playerShotShareQuartile:quartile(r.playerShotShare,sogCuts.playerShotShare),
  priorSampleQuartile:quartile(r.priorGp,sogCuts.priorGames),
}));
const sogStarRows=sogLineRows.map(r=>{
  const rated=rateNhlShotsOnGoalConfidence({
    projection:r.v2,line:r.line,
    teamShotsFor:r.teamShotsFor,
    opponentShotsAgainst:r.opponentShotsAgainst,
    projectedTeamShots:r.projectedTeamShots,
    playerShotRate:r.playerShotRate,
    playerShotShare:r.playerShotShare,
    lineValidated:true,
    modelValidated:true,
    cuts:sogCuts,
  });
  return {...r,stars:rated.stars,starTier:rated.tier,starSide:rated.side};
});
const sogAudit={
  cuts:sogCuts,
  byLine:savesGroups(sogLineRows,r=>r.line,250),
  byLineBucket:savesGroups(sogLineRows,r=>r.lineBucket,500),
  byDirection:savesGroups(sogLineRows,r=>r.direction,500),
  byGap:savesGroups(sogLineRows,r=>r.gapBucket,500),
  byDirectionGap:savesGroups(sogLineRows,r=>`${r.direction}|${r.gapBucket}`,250),
  byTeamAttackQuartile:savesGroups(sogLineRows,r=>r.teamAttackQuartile,500),
  byOpponentAllowanceQuartile:savesGroups(sogLineRows,r=>r.opponentAllowanceQuartile,500),
  byAttackDefenseMatrix:savesGroups(sogLineRows,r=>`${r.teamAttackQuartile}|${r.opponentAllowanceQuartile}`,300),
  byProjectedTeamShotsQuartile:savesGroups(sogLineRows,r=>r.projectedTeamShotsQuartile,500),
  byPlayerShotRateQuartile:savesGroups(sogLineRows,r=>r.playerShotRateQuartile,500),
  byPlayerShotShareQuartile:savesGroups(sogLineRows,r=>r.playerShotShareQuartile,500),
  byRoleTier:savesGroups(sogLineRows,r=>r.roleTier,500),
  byPosition:savesGroups(sogLineRows,r=>r.position,500),
  byHomeAway:savesGroups(sogLineRows,r=>r.home?"HOME":"AWAY",500),
  byRest:savesGroups(sogLineRows,r=>r.b2b?"B2B":r.restDays>=2.5?"2PLUS_REST":"NORMAL_REST",500),
  bySeasonPhase:savesGroups(sogLineRows,r=>r.seasonPhase,500),
  byPriorSampleQuartile:savesGroups(sogLineRows,r=>r.priorSampleQuartile,500),
  byStars:savesGroups(sogStarRows,r=>`${r.stars} STAR`,250),
  byStarsDirection:savesGroups(sogStarRows,r=>`${r.stars} STAR|${r.direction}`,150),
  byStarsCoreLines:savesGroups(sogStarRows.filter(r=>r.line>=1.5&&r.line<=4.5),r=>`${r.stars} STAR`,150),
  byStarsCoreLinesDirection:savesGroups(sogStarRows.filter(r=>r.line>=1.5&&r.line<=4.5),r=>`${r.stars} STAR|${r.direction}`,100),
  sportsbookStyle:{
    highVolumeGoodMatchupOver:savesGroups(
      sogLineRows.filter(r=>r.playerShotRateQuartile==="Q4"&&r.opponentAllowanceQuartile==="Q4"&&r.direction==="OVER"),
      r=>r.gapBucket,100
    ),
    lowVolumeToughMatchupUnder:savesGroups(
      sogLineRows.filter(r=>r.playerShotRateQuartile==="Q1"&&r.opponentAllowanceQuartile==="Q1"&&r.direction==="UNDER"),
      r=>r.gapBucket,100
    ),
    overByLineAndGap:savesGroups(sogLineRows.filter(r=>r.direction==="OVER"),r=>`${r.lineBucket}|${r.gapBucket}`,150),
    underByLineAndGap:savesGroups(sogLineRows.filter(r=>r.direction==="UNDER"),r=>`${r.lineBucket}|${r.gapBucket}`,150),
    top6OverByGap:savesGroups(sogLineRows.filter(r=>r.roleTier==="TOP6"&&r.direction==="OVER"),r=>r.gapBucket,150),
    defenseOverByGap:savesGroups(sogLineRows.filter(r=>r.position==="D"&&r.direction==="OVER"),r=>r.gapBucket,150)
  }
};

const savesRows=allRows.filter(r=>r.market==="saves");
const savesCuts={
  opponentShotsFor:quantileCuts(savesRows.map(r=>r.opponentShotsFor)),
  teamShotsAgainst:quantileCuts(savesRows.map(r=>r.teamShotsAgainst)),
  projectedShotsFaced:quantileCuts(savesRows.map(r=>r.projectedTeamShots)),
  priorStarts:quantileCuts(savesRows.map(r=>r.priorGp))
};
const savesLineRows=lineRows.filter(r=>r.market==="saves").map(r=>({
  ...r,
  direction:r.v2>r.line?"OVER":"UNDER",
  gap:r.v2-r.line,
  gapBucket:lineGapBucket(r.v2-r.line),
  lineBucket:savesLineBucket(r.line),
  oppShotQuartile:quartile(r.opponentShotsFor,savesCuts.opponentShotsFor),
  defenseSuppressionQuartile:quartile(r.teamShotsAgainst,savesCuts.teamShotsAgainst,{invert:true}),
  projectedShotsFacedQuartile:quartile(r.projectedTeamShots,savesCuts.projectedShotsFaced),
  starterExperienceQuartile:quartile(r.priorGp,savesCuts.priorStarts)
}));
const savesStarRows=savesLineRows.map(r=>{
  const rated=rateNhlGoalieSavesConfidence({
    projection:r.v2,line:r.line,
    opponentShotsFor:r.opponentShotsFor,
    teamShotsAgainst:r.teamShotsAgainst,
    projectedShotsFaced:r.projectedTeamShots,
    starterConfirmed:true,
    lineValidated:true,
    modelValidated:true,
    cuts:savesCuts,
  });
  return {...r,stars:rated.stars,starTier:rated.tier,starSide:rated.side};
});
const savesAudit={
  cuts:savesCuts,
  byLine:savesGroups(savesLineRows,r=>r.line,100),
  byLineBucket:savesGroups(savesLineRows,r=>r.lineBucket,200),
  byDirection:savesGroups(savesLineRows,r=>r.direction,200),
  byGap:savesGroups(savesLineRows,r=>r.gapBucket,200),
  byDirectionGap:savesGroups(savesLineRows,r=>`${r.direction}|${r.gapBucket}`,100),
  byOpponentShotQuartile:savesGroups(savesLineRows,r=>r.oppShotQuartile,200),
  byDefenseSuppressionQuartile:savesGroups(savesLineRows,r=>r.defenseSuppressionQuartile,200),
  byOffenseDefenseMatrix:savesGroups(savesLineRows,r=>`${r.oppShotQuartile}|${r.defenseSuppressionQuartile}`,120),
  byProjectedShotsFacedQuartile:savesGroups(savesLineRows,r=>r.projectedShotsFacedQuartile,200),
  byStarterExperienceQuartile:savesGroups(savesLineRows,r=>r.starterExperienceQuartile,200),
  byHomeAway:savesGroups(savesLineRows,r=>r.home?"HOME":"AWAY",200),
  byRest:savesGroups(savesLineRows,r=>r.b2b?"B2B":r.restDays>=2.5?"2PLUS_REST":"NORMAL_REST",200),
  bySeasonPhase:savesGroups(savesLineRows,r=>r.seasonPhase,200),
  byStars:savesGroups(savesStarRows,r=>`${r.stars} STAR`,100),
  byStarsDirection:savesGroups(savesStarRows,r=>`${r.stars} STAR|${r.direction}`,80),
  byStarsCoreLines:savesGroups(savesStarRows.filter(r=>r.line>=20.5&&r.line<=32.5),r=>`${r.stars} STAR`,80),
  sportsbookStyle:{
    weakOffenseStrongDefenseUnder:savesGroups(
      savesLineRows.filter(r=>r.oppShotQuartile==="Q1"&&r.defenseSuppressionQuartile==="Q4"&&r.direction==="UNDER"),
      r=>r.gapBucket,40
    ),
    strongOffenseWeakDefenseOver:savesGroups(
      savesLineRows.filter(r=>r.oppShotQuartile==="Q4"&&r.defenseSuppressionQuartile==="Q1"&&r.direction==="OVER"),
      r=>r.gapBucket,40
    ),
    underByLineAndGap:savesGroups(savesLineRows.filter(r=>r.direction==="UNDER"),r=>`${r.lineBucket}|${r.gapBucket}`,60),
    overByLineAndGap:savesGroups(savesLineRows.filter(r=>r.direction==="OVER"),r=>`${r.lineBucket}|${r.gapBucket}`,60)
  }
};
const confidenceValidation={
  shots_on_goal:starValidation(sogStarRows,{coreFilter:r=>r.line>=1.5&&r.line<=4.5,minN:100}),
  saves:starValidation(savesStarRows,{coreFilter:r=>r.line>=20.5&&r.line<=32.5,minN:80}),
};
const lineValidation=Object.fromEntries(Object.entries(byLine).map(([key,v])=>{
  const t=v.threshold||{};
  const status=t.brierDelta<0&&t.accuracyDelta>=0?"PROMOTE_RESEARCH":t.brierDelta<0?"WATCH_RESEARCH":"HOLD_RESEARCH";
  return [key,{status,...t}];
}));

const full=buildStateFromSeasons(seasons),artifactPlayers={},artifactGoalies={};
for(const [id,p] of full.players){
  if(p.gp<5)continue;
  artifactPlayers[id]={team:p.team,position:p.position,games:p.gp,
    shotsPerGame:round(p.shots/p.gp,5),goalsPerGame:round(p.goals/p.gp,5),assistsPerGame:round(p.assists/p.gp,5),pointsPerGame:round(p.points/p.gp,5),
    shootingPct:round(p.goals/Math.max(1,p.shots),5),
    sigma:{shots_on_goal:round(playerSigma(p,null,"shots",p.shots/p.gp),4),goals:round(playerSigma(p,null,"goals",p.goals/p.gp),4),assists:round(playerSigma(p,null,"assists",p.assists/p.gp),4),points:round(playerSigma(p,null,"points",p.points/p.gp),4)}};
}
for(const [id,g] of full.goalies){
  if(g.starts<3)continue;
  artifactGoalies[id]={team:g.team,games:g.gp,starts:g.starts,savePct:round(g.shotsAgainst?g.saves/g.shotsAgainst:leagueSave,5),
    savesPerStart:round(g.starts?g.saves/g.starts:0,4),sigmaSaves:round(playerSigma(g,null,"saves",g.starts?g.saves/g.starts:25),4)};
}
const marketValidation=Object.fromEntries(["shots_on_goal","goals","assists","points","saves"].map(m=>{
  const aggregateRows=allRows.filter(r=>r.market===m),aggP=propMetrics(aggregateRows),aggT=thresholdMetrics(aggregateRows);
  const foldChecks=folds.map(f=>f.markets[m]).filter(Boolean);
  const strict=aggP?.maeDelta<0&&aggT?.brierDelta<0&&aggT?.accuracyDelta>=0&&foldChecks.every(x=>x.projection?.maeDelta<=0&&x.threshold?.brierDelta<=0&&x.threshold?.accuracyDelta>=0);
  const watch=!strict&&aggP?.maeDelta<=0&&aggT?.brierDelta<=0;
  return [m,{status:strict?"PROMOTE_RESEARCH":watch?"WATCH_RESEARCH":"HOLD_RESEARCH",aggregateProjection:aggP,aggregateThreshold:aggT,folds:foldChecks.map((x,i)=>({season:folds[i]?.season,projection:x.projection,threshold:x.threshold}))}];
}));

const report={
  modelId:"NHL-PLAYER-PRO-v2",version:"research-v2.0-share-environment",generatedAt:new Date().toISOString(),
  conditionalOnActive:true,conditionalOnConfirmedStarter:true,marketInformed:false,
  integrity:{priorSeasonsOnlyTraining:true,currentSeasonOnlyPastGames:true,usesSameGameBoxscoreOnlyForParticipationSet:true,fetchErrors:errors.length,targetSeasons:seasons.slice(1)},
  aggregate:{projection:propMetrics(allRows),threshold:thresholdMetrics(allRows),rows:allRows.length,lineTests:lineRows.length},
  folds,marketValidation,lineValidation,confidenceValidation,subsets:subset,bySyntheticLine:byLine,byModelEdge:byEdge,sogAudit,savesAudit,
  limitations:[
    "Historical prop validation is conditional on the player being active in the game; same-game boxscore participation is used only to define the active set, never as a performance input.",
    "Goalie save validation is conditional on the actual primary goalie (>=30 minutes); live use remains gated on starter confirmation.",
    "Synthetic half-point thresholds test calibration and directional accuracy, not sportsbook profitability; no historical market prices are used."
  ]
};
const artifact={modelId:"NHL-PLAYER-PRO-v2",version:"research-v2.0-share-environment",generatedAt:new Date().toISOString(),trained:true,marketInformed:false,
  training:{seasons,games:seasons.reduce((n,s)=>n+(gamesBySeason[s]?.length||0),0),boxscoreErrors:errors.length},
  players:artifactPlayers,goalies:artifactGoalies,validation:{aggregate:report.aggregate,folds:report.folds,markets:report.marketValidation,lines:report.lineValidation,confidence:report.confidenceValidation},
  canQualify:false,canAuthorizeWager:false};
await mkdir(outPath.split("/").slice(0,-1).join("/")||".",{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2)+"\n","utf8");
await writeFile(artifactPath,`export const NHL_PLAYER_PRO_V2_ARTIFACT = Object.freeze(${JSON.stringify(artifact,null,2)});\n`,"utf8");
console.log(JSON.stringify({aggregate:report.aggregate,markets:report.subsets.byMarket,training:artifact.training,players:Object.keys(artifactPlayers).length,goalies:Object.keys(artifactGoalies).length},null,2));
if(errors.length||allRows.length<40000)process.exitCode=2;
