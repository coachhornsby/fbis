#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  durationSeconds,
  parseShiftRows,
  deploymentFromShifts,
} from "../functions/lib/nhlPersistentProfiles.js";

const WEB="https://api-web.nhle.com/v1";
const STATS="https://api.nhle.com/stats/rest/en";
const SOURCE_DEFAULT="data/models/nhl-pro-v2-validation.json";
const OUT_DEFAULT="data/models/nhl-persistent-state-challenger-v1.json";
const CACHE_DEFAULT=".cache/nhl-persistent-state-v1";

function arg(name,fallback=null){
  const p=process.argv.find(x=>x.startsWith(\`--\${name}=\`));
  return p?p.split("=").slice(1).join("="):fallback;
}
const sourcePath=arg("source",SOURCE_DEFAULT);
const outPath=arg("out",OUT_DEFAULT);
const cacheDir=arg("cache-dir",CACHE_DEFAULT);
const concurrency=Math.max(2,Math.min(16,Number(arg("concurrency","8"))||8));
const maxGames=Math.max(0,Number(arg("max-games","0"))||0);

const source=JSON.parse(await readFile(sourcePath,"utf8"));
let rows=(source.gamePredictions||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));
if(maxGames>0)rows=rows.slice(0,maxGames);
if(!rows.length)throw new Error("NHL_PERSISTENT_STATE_NO_ROWS");

const TO_OFFICIAL={LA:"LAK",NJ:"NJD",SJ:"SJS",TB:"TBL"};
const FROM_OFFICIAL={LAK:"LA",NJD:"NJ",SJS:"SJ",TBL:"TB"};
function product(v){const s=String(v||"").toUpperCase();return FROM_OFFICIAL[s]||s;}
function official(v){const s=String(v||"").toUpperCase();return TO_OFFICIAL[s]||s;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function round(v,n=5){return Number(Number(v).toFixed(n));}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function mean(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;}
function jaccard(a=[],b=[]){
  const A=new Set(a),B=new Set(b); if(!A.size&&!B.size)return null;
  let i=0;for(const x of A)if(B.has(x))i++;
  return i/Math.max(1,A.size+B.size-i);
}
function monthKey(row){return String(row.date||"").slice(0,7);}
function sideKey(box,team){
  const h=product(box?.homeTeam?.abbrev?.default??box?.homeTeam?.abbrev);
  return h===product(team)?"homeTeam":"awayTeam";
}
async function fetchJson(url,attempts=4){
  let last;
  for(let i=1;i<=attempts;i++){
    try{
      const r=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS-NHL-PERSISTENT-STATE-RESEARCH/1.0"},signal:AbortSignal.timeout(15000)});
      if(r.ok)return r.json();
      last=new Error(\`HTTP_\${r.status} \${url}\`);
      if(r.status===404)throw last;
      if(r.status===429||r.status>=500)await sleep(i*500);else throw last;
    }catch(err){last=err;if(i<attempts)await sleep(i*500);}
  }
  throw last;
}
async function cachedJson(kind,id,url){
  const dir=\`\${cacheDir}/\${kind}\`,path=\`\${dir}/\${id}.json\`;
  try{return JSON.parse(await readFile(path,"utf8"));}catch{}
  const json=await fetchJson(url);
  await mkdir(dir,{recursive:true});
  await writeFile(path,JSON.stringify(json),"utf8");
  return json;
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let idx=0;
  async function worker(){
    while(true){
      const i=idx++;if(i>=items.length)return;
      try{out[i]=await fn(items[i],i);}catch(err){out[i]={ok:false,error:String(err?.message||err),gameId:String(items[i]?.id||"")};}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return out;
}
function boxRoster(box,team){
  const side=sideKey(box,team),root=box?.playerByGameStats?.[side]||{};
  const out=[];
  for(const [group,pos] of [["forwards","F"],["defense","D"],["goalies","G"]]){
    for(const p of root?.[group]||[]){
      const id=String(p.playerId??p.id??"");if(!id)continue;
      out.push({id,name:String(p.name?.default??p.name??p.playerName??id),position:String(p.position||p.positionCode||pos).toUpperCase().startsWith("D")?"D":pos,raw:p});
    }
  }
  return out;
}
function playerGameStats(p={}){
  const toi=durationSeconds(p.toi??p.timeOnIce);
  const pp=durationSeconds(p.powerPlayToi??p.powerPlayTimeOnIce??p.ppToi);
  const pk=durationSeconds(p.shorthandedToi??p.shortHandedTimeOnIce??p.pkToi);
  const goals=finite(p.goals)||0,assists=finite(p.assists)||0,shots=finite(p.sog??p.shots)||0;
  return {toi:toi??0,pp:pp??0,pk:pk??0,goals,assists,points:goals+assists,shots};
}
function inferUnits(roster){
  const sk=roster.filter(p=>p.position!=="G").map(p=>({id:p.id,...playerGameStats(p.raw)}));
  const pp=sk.filter(x=>x.pp>0).sort((a,b)=>b.pp-a.pp),pk=sk.filter(x=>x.pk>0).sort((a,b)=>b.pk-a.pk);
  return {
    pp1:pp.slice(0,5).map(x=>x.id),pp2:pp.slice(5,10).map(x=>x.id),
    pk1:pk.slice(0,4).map(x=>x.id),pk2:pk.slice(4,8).map(x=>x.id),
  };
}
function buildGameTeamState(game,team,box,shifts){
  const roster=boxRoster(box,team),ids=new Set(roster.map(p=>p.id));
  const shiftRows=parseShiftRows(shifts,team,ids);
  const deploy=deploymentFromShifts(roster,[{gameId:String(game.id),rows:shiftRows}]);
  const units=inferUnits(roster);
  const players={};
  for(const p of roster){
    const s=playerGameStats(p.raw),role=deploy.lines.get(p.id)||{};
    players[p.id]={id:p.id,name:p.name,position:p.position,toi:s.toi||deploy.toi.get(p.id)||0,pp:s.pp,pk:s.pk,points:s.points,shots:s.shots,evLine:role.evLine??null,dPair:role.dPair??null};
  }
  const pairEdges=[...deploy.pairs.values()].sort((a,b)=>b.seconds-a.seconds).slice(0,24).map(x=>({a:x.a,b:x.b,seconds:x.seconds,key:[x.a,x.b].sort().join("|")}));
  const goalies=roster.filter(p=>p.position==="G").map(p=>({id:p.id,toi:playerGameStats(p.raw).toi})).sort((a,b)=>b.toi-a.toi);
  return {
    team:product(team),gameId:String(game.id),date:String(game.date||""),players,
    active:Object.keys(players),units,pairEdges,
    starterId:goalies[0]?.id||null,
    roleCoverage:Object.values(players).filter(p=>p.position!=="G"&&(p.evLine!=null||p.dPair!=null)).length/Math.max(1,Object.values(players).filter(p=>p.position!=="G").length),
    shiftRows:shiftRows.length
  };
}
async function fetchHistoricalGame(row){
  const id=String(row.id);
  const [box,shifts]=await Promise.all([
    cachedJson("box",id,\`\${WEB}/gamecenter/\${id}/boxscore\`),
    cachedJson("shifts",id,\`\${STATS}/shiftcharts?limit=-1&cayenneExp=\${encodeURIComponent(\`gameId=\${id}\`)}\`)
  ]);
  return {
    ok:true,gameId:id,
    home:buildGameTeamState(row,row.home,box,shifts),
    away:buildGameTeamState(row,row.away,box,shifts)
  };
}

function roleKey(p){return p?.position==="D"?\`D\${p.dPair??"?"}\`:\`F\${p.evLine??"?"}\`;}
function baselinePlayer(hist,id,excludeLast=true){
  const games=(excludeLast?hist.slice(0,-1):hist).slice(-5);
  const obs=games.map(g=>g.players[id]).filter(Boolean);
  if(!obs.length)return null;
  const toi=mean(obs.map(x=>x.toi)),pp=mean(obs.map(x=>x.pp)),pts=obs.reduce((s,x)=>s+x.points,0),mins=obs.reduce((s,x)=>s+x.toi,0)/60;
  return {games:obs.length,avgToi:toi||0,avgPp:pp||0,points60:mins>0?pts*60/mins:0,position:obs.at(-1)?.position||null};
}
function teamPitState(hist){
  if(!hist.length)return {known:false,coverage:0,reason:"NO_PRIOR_GAME"};
  const last=hist.at(-1),prev=hist.at(-2)||null,prior=hist.slice(0,-1).slice(-5);
  const lastSkaters=Object.values(last.players).filter(p=>p.position!=="G");
  const common=prev?lastSkaters.filter(p=>prev.players[p.id]):[];
  const sameRole=prev&&common.length?common.filter(p=>roleKey(p)===roleKey(prev.players[p.id])).length/common.length:null;
  const line1Now=lastSkaters.filter(p=>p.evLine===1).map(p=>p.id),line1Prev=prev?Object.values(prev.players).filter(p=>p.evLine===1).map(p=>p.id):[];
  const d1Now=lastSkaters.filter(p=>p.dPair===1).map(p=>p.id),d1Prev=prev?Object.values(prev.players).filter(p=>p.dPair===1).map(p=>p.id):[];
  const line1Continuity=prev?jaccard(line1Now,line1Prev):null;
  const pair1Continuity=prev?jaccard(d1Now,d1Prev):null;
  const pp1Continuity=prev?jaccard(last.units.pp1,prev.units.pp1):null;
  const edgeNow=last.pairEdges.slice(0,16).map(x=>x.key),edgePrev=prev?prev.pairEdges.slice(0,16).map(x=>x.key):[];
  const linemateContinuity=prev?jaccard(edgeNow,edgePrev):null;
  const totalToi=lastSkaters.reduce((s,p)=>s+p.toi,0),top6=lastSkaters.slice().sort((a,b)=>b.toi-a.toi).slice(0,6).reduce((s,p)=>s+p.toi,0);
  const toiConcentration=totalToi>0?top6/totalToi:null;

  const ids=new Set(prior.flatMap(g=>Object.keys(g.players)));
  const established=[];
  for(const id of ids){
    const b=baselinePlayer(hist,id,true);
    if(b&&b.games>=Math.min(2,prior.length)&&b.avgToi>=600)established.push({id,...b});
  }
  const absent=established.filter(x=>!last.players[x.id]);
  const absenceToi=absent.reduce((s,x)=>s+x.avgToi,0);
  const majorForwardAbsence=absent.some(x=>x.position!=="D"&&x.avgToi>=960);
  const topPairDefenseAbsence=absent.some(x=>x.position==="D"&&x.avgToi>=1140);
  const baselineActiveIds=new Set(prior.flatMap(g=>Object.keys(g.players)));
  const replacements=[];
  for(const p of lastSkaters){
    const b=baselinePlayer(hist,p.id,true);
    const evGain=Math.max(0,p.toi-(b?.avgToi||0)),ppGain=Math.max(0,p.pp-(b?.avgPp||0));
    if(evGain>=90||ppGain>=30){
      const minsHist=hist.slice(-5).map(g=>g.players[p.id]).filter(Boolean);
      const pts=minsHist.reduce((s,x)=>s+x.points,0),mins=minsHist.reduce((s,x)=>s+x.toi,0)/60;
      replacements.push({id:p.id,evGain,ppGain,points60:mins>0?pts*60/mins:0,newToRole:!baselineActiveIds.has(p.id)});
    }
  }
  replacements.sort((a,b)=>(b.evGain+b.ppGain)-(a.evGain+a.ppGain));
  const inheritedEv=replacements.slice(0,4).reduce((s,x)=>s+x.evGain,0)/3600;
  const inheritedPp=replacements.slice(0,4).reduce((s,x)=>s+x.ppGain,0)/1200;
  const absentQuality=absent.length?mean(absent.map(x=>x.points60)):null;
  const replQuality=replacements.length?mean(replacements.slice(0,4).map(x=>x.points60)):null;
  const replacementQualityGap=absentQuality!=null&&replQuality!=null?clamp((replQuality-absentQuality)/3,-1,1):0;

  const recent=hist.slice(-5),starts={};
  for(const g of recent)if(g.starterId)starts[g.starterId]=(starts[g.starterId]||0)+1;
  const starterRank=Object.entries(starts).sort((a,b)=>b[1]-a[1]);
  const expectedStarterId=starterRank[0]?.[0]||last.starterId||null;
  const expectedStartProbability=starterRank.length?starterRank[0][1]/recent.filter(g=>g.starterId).length:null;

  return {
    known:true,
    coverage:last.roleCoverage,
    roleContinuity:sameRole,
    line1Continuity,pair1Continuity,pp1Continuity,linemateContinuity,toiConcentration,
    roleChangeRate:sameRole==null?null:1-sameRole,
    absenceBurden:absenceToi/3600,
    majorForwardAbsence,topPairDefenseAbsence,
    inheritedEv,inheritedPp,replacementQualityGap,replacementCount:replacements.length,
    pp1PersonnelChange:pp1Continuity==null?null:1-pp1Continuity,
    expectedStarterId,expectedStartProbability,
    starterUncertainty:expectedStartProbability==null?true:expectedStartProbability<0.65,
    currentScratchState:"UNKNOWN",
    currentInjuryState:"UNKNOWN",
    currentGoalieConfirmation:"UNKNOWN",
    sourceCutoffGameId:last.gameId,
    sourceCutoffDate:last.date
  };
}
function stateFeatures(home,away,family){
  const h=home,a=away;
  const v=x=>Number.isFinite(Number(x))?Number(x):0;
  if(family==="deployment")return [
    v(h.roleContinuity),v(a.roleContinuity),v(h.line1Continuity),v(a.line1Continuity),
    v(h.pair1Continuity),v(a.pair1Continuity),v(h.pp1Continuity),v(a.pp1Continuity),
    v(h.toiConcentration),v(a.toiConcentration),v(h.roleChangeRate),v(a.roleChangeRate),
    v(h.pp1PersonnelChange),v(a.pp1PersonnelChange)
  ];
  if(family==="linemate")return [
    v(h.linemateContinuity),v(a.linemateContinuity),v(h.line1Continuity),v(a.line1Continuity),
    v(h.pair1Continuity),v(a.pair1Continuity),v(h.roleChangeRate),v(a.roleChangeRate)
  ];
  if(family==="replacement")return [
    v(h.absenceBurden),v(a.absenceBurden),v(h.inheritedEv),v(a.inheritedEv),v(h.inheritedPp),v(a.inheritedPp),
    v(h.replacementQualityGap),v(a.replacementQualityGap),h.majorForwardAbsence?1:0,a.majorForwardAbsence?1:0,
    h.topPairDefenseAbsence?1:0,a.topPairDefenseAbsence?1:0
  ];
  return [...stateFeatures(h,a,"deployment"),...stateFeatures(h,a,"linemate"),...stateFeatures(h,a,"replacement")];
}
function gate(row,family){
  const h=row.state.home,a=row.state.away;
  if(family==="deployment")return Boolean(h.known&&a.known&&Math.min(h.coverage,a.coverage)>=0.55&&(
    (h.roleChangeRate??0)>=0.14||(a.roleChangeRate??0)>=0.14||(h.pp1PersonnelChange??0)>=0.20||(a.pp1PersonnelChange??0)>=0.20));
  if(family==="linemate")return Boolean(h.known&&a.known&&h.linemateContinuity!=null&&a.linemateContinuity!=null&&(
    h.linemateContinuity>=0.72||a.linemateContinuity>=0.72||h.linemateContinuity<=0.42||a.linemateContinuity<=0.42));
  if(family==="replacement")return Boolean((h.absenceBurden??0)>=0.20||(a.absenceBurden??0)>=0.20);
  return gate(row,"deployment")||gate(row,"linemate")||gate(row,"replacement");
}

function solve(A,b){
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<n;i++){
    let best=i;for(let j=i+1;j<n;j++)if(Math.abs(M[j][i])>Math.abs(M[best][i]))best=j;
    [M[i],M[best]]=[M[best],M[i]];
    const p=M[i][i];if(Math.abs(p)<1e-10)continue;
    for(let k=i;k<=n;k++)M[i][k]/=p;
    for(let j=0;j<n;j++)if(j!==i){const f=M[j][i];for(let k=i;k<=n;k++)M[j][k]-=f*M[i][k];}
  }
  return M.map(r=>r[n]||0);
}
function ridgeFit(X,y,lambda=18){
  if(!X.length)return null;
  const p=X[0].length+1,A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);
  for(let i=0;i<X.length;i++){
    const z=[1,...X[i]];
    for(let j=0;j<p;j++){b[j]+=z[j]*y[i];for(let k=0;k<p;k++)A[j][k]+=z[j]*z[k];}
  }
  for(let j=1;j<p;j++)A[j][j]+=lambda;
  return solve(A,b);
}
function predict(beta,x){if(!beta)return 0;return beta[0]+x.reduce((s,v,i)=>s+v*(beta[i+1]||0),0);}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function scoreHomeWin(h,a){
  const shared=Math.min(0.32,0.10*Math.min(h,a)),lh=Math.max(0.05,h-shared),la=Math.max(0.05,a-shared);
  let hw=0,tie=0;
  for(let x=0;x<=11;x++)for(let y=0;y<=11;y++)for(let z=0;z<=5;z++){
    const p=poisson(lh,x)*poisson(la,y)*poisson(shared,z),hg=x+z,ag=y+z;
    if(hg>ag)hw+=p;else if(hg===ag)tie+=p;
  }
  return clamp(hw+tie/(1+Math.exp(-(h-a)/0.65)),0.01,0.99);
}
function probability(row,h,a){
  const elo=1/(1+10**(-((Number(row.eloDiff||0)+35)/400)));
  return clamp(0.5+0.86*((0.78*scoreHomeWin(h,a)+0.22*elo)-0.5),0.04,0.96);
}
function fitFamily(train,family){
  const eligible=train.filter(r=>gate(r,family));
  if(eligible.length<180)return null;
  const X=eligible.map(r=>stateFeatures(r.state.home,r.state.away,family));
  return {
    n:eligible.length,
    home:ridgeFit(X,eligible.map(r=>r.actualHomeGoals-r.projHome)),
    away:ridgeFit(X,eligible.map(r=>r.actualAwayGoals-r.projAway))
  };
}
function applyFamily(row,family,model){
  if(!model||!gate(row,family))return {h:row.projHome,a:row.projAway,p:row.homeWinProb,gate:false,adjustment:{home:0,away:0}};
  const x=stateFeatures(row.state.home,row.state.away,family);
  const ah=clamp(predict(model.home,x),-0.40,0.40),aa=clamp(predict(model.away,x),-0.40,0.40);
  const h=clamp(row.projHome+ah,1.2,5.6),a=clamp(row.projAway+aa,1.2,5.6);
  return {h,a,p:probability(row,h,a),gate:true,adjustment:{home:ah,away:aa}};
}
const goalieCandidates=[
  {id:"FULL",scale:()=>1},
  {id:"ZERO",scale:()=>0},
  {id:"SHRINK_25",scale:()=>0.25},
  {id:"SHRINK_50",scale:()=>0.50},
  {id:"SHRINK_75",scale:()=>0.75},
  {id:"EXPECTED_START_PROB",scale:r=>clamp(mean([r.state.home.expectedStartProbability,r.state.away.expectedStartProbability])??0.5,0,1)},
  {id:"HALF_PLUS_EXPECTED",scale:r=>0.5+0.5*clamp(mean([r.state.home.expectedStartProbability,r.state.away.expectedStartProbability])??0.5,0,1)},
];
function goalieProb(row,cand){
  const s=cand.scale(row),gh=Number(row.goalieVsHome||0),ga=Number(row.goalieVsAway||0);
  const h=row.projHome-gh+s*gh,a=row.projAway-ga+s*ga;
  return probability(row,h,a);
}
function chooseGoalieCandidate(train){
  if(train.length<250)return goalieCandidates[0];
  let best=goalieCandidates[0],bestLoss=Infinity;
  for(const c of goalieCandidates){
    let loss=0,n=0;
    for(const r of train){const y=r.actualHomeGoals>r.actualAwayGoals?1:0,p=goalieProb(r,c);loss+=(p-y)**2;n++;}
    loss/=Math.max(1,n);if(loss<bestLoss){bestLoss=loss;best=c;}
  }
  return best;
}

function metrics(sample,key){
  let margin=0,total=0,home=0,away=0,winner=0,brier=0,ll=0;
  const probs=[];
  for(const r of sample){
    const q=r[key],h=q.h,a=q.a,p=clamp(q.p,1e-6,1-1e-6),y=r.actualHomeGoals>r.actualAwayGoals?1:0;
    margin+=Math.abs((h-a)-(r.actualHomeGoals-r.actualAwayGoals));
    total+=Math.abs((h+a)-(r.actualHomeGoals+r.actualAwayGoals));
    home+=Math.abs(h-r.actualHomeGoals);away+=Math.abs(a-r.actualAwayGoals);
    winner+=(p>=0.5)===Boolean(y)?1:0;brier+=(p-y)**2;ll+=-(y*Math.log(p)+(1-y)*Math.log(1-p));probs.push({p,y});
  }
  const bins=10,parts=Array.from({length:bins},()=>[]);
  for(const x of probs)parts[Math.min(bins-1,Math.floor(x.p*bins))].push(x);
  let ece=0;for(const b of parts)if(b.length){const pp=mean(b.map(x=>x.p)),yy=mean(b.map(x=>x.y));ece+=b.length/probs.length*Math.abs(pp-yy);}
  const n=sample.length;
  return {n,marginMae:round(margin/n),totalMae:round(total/n),homeGoalsMae:round(home/n),awayGoalsMae:round(away/n),winnerAccuracy:round(winner/n),brier:round(brier/n),logLoss:round(ll/n),ece:round(ece)};
}
function grouped(sample,keyFn,metricKey,minN=40){
  const m=new Map();for(const r of sample){const k=keyFn(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}
  return Object.fromEntries([...m].filter(([,v])=>v.length>=minN).map(([k,v])=>[k,metrics(v,metricKey)]));
}
function subsetMetrics(sample,filter,metricKey){
  const x=sample.filter(filter);return x.length?metrics(x,metricKey):{n:0,status:"NO_TIMESTAMP_VERIFIED_ROWS"};
}

console.log("Fetching historical NHL deployment state",rows.length,"games");
const fetched=await mapLimit(rows,concurrency,fetchHistoricalGame);
const fetchErrors=fetched.filter(x=>!x?.ok).map(x=>({gameId:x.gameId,error:x.error}));
const byGame=new Map(fetched.filter(x=>x?.ok).map(x=>[String(x.gameId),x]));
const history=new Map();
function hist(team){const t=product(team);if(!history.has(t))history.set(t,[]);return history.get(t);}

const enriched=[];
for(const r of rows){
  const hs=teamPitState(hist(r.home)),as=teamPitState(hist(r.away));
  enriched.push({...r,state:{home:hs,away:as}});
  const g=byGame.get(String(r.id));
  if(g?.ok){hist(r.home).push(g.home);hist(r.away).push(g.away);}
}

const families=["deployment","linemate","replacement","combined"];
let currentMonth=null,models={},goalieCandidate=goalieCandidates[0],train=[];
for(const r of enriched){
  const mk=monthKey(r);
  if(mk!==currentMonth){
    currentMonth=mk;
    models=Object.fromEntries(families.map(f=>[f,fitFamily(train,f)]));
    goalieCandidate=chooseGoalieCandidate(train);
  }
  r.incumbent={h:r.projHome,a:r.projAway,p:r.homeWinProb,gate:false};
  r.deployment=applyFamily(r,"deployment",models.deployment);
  r.linemate=applyFamily(r,"linemate",models.linemate);
  r.replacement=applyFamily(r,"replacement",models.replacement);
  r.combined=applyFamily(r,"combined",models.combined);
  r.goalie={
    h:r.projHome,a:r.projAway,p:goalieProb(r,goalieCandidate),gate:goalieCandidate.id!=="FULL",
    selected:goalieCandidate.id,scoreSignalPreserved:true,probabilityOnlyRecalibration:true
  };
  train.push(r);
}

const keys=["incumbent","deployment","linemate","replacement","goalie","combined"];
const aggregate=Object.fromEntries(keys.map(k=>[k,metrics(enriched,k)]));
const bySeason=Object.fromEntries(keys.map(k=>[k,grouped(enriched,r=>String(r.season),k,100)]));
const byMonth=Object.fromEntries(keys.map(k=>[k,grouped(enriched,r=>monthKey(r),k,40)]));
const coverage={
  games:enriched.length,
  fetchSuccess:round((enriched.length-fetchErrors.length)/enriched.length),
  deploymentKnown:round(enriched.filter(r=>r.state.home.known&&r.state.away.known&&Math.min(r.state.home.coverage,r.state.away.coverage)>=0.55).length/enriched.length),
  linemateKnown:round(enriched.filter(r=>r.state.home.linemateContinuity!=null&&r.state.away.linemateContinuity!=null).length/enriched.length),
  replacementCarryState:round(enriched.filter(r=>(r.state.home.absenceBurden??0)>=0.20||(r.state.away.absenceBurden??0)>=0.20).length/enriched.length),
  goalieExpectedState:round(enriched.filter(r=>r.state.home.expectedStartProbability!=null&&r.state.away.expectedStartProbability!=null).length/enriched.length),
  timestampVerifiedCurrentScratch:0,
  timestampVerifiedCurrentInjury:0,
  timestampVerifiedGoalieConfirmation:0,
  failClosedCurrentGameStates:true
};
const subsets={};
for(const k of keys){
  subsets[k]={
    confirmedGoalieChange:{n:0,status:"UNSUPPORTED_NO_TIMESTAMP_VERIFIED_PREGAME_CONFIRMATION_SOURCE"},
    starterUncertainty:subsetMetrics(enriched,r=>r.state.home.starterUncertainty||r.state.away.starterUncertainty,k),
    majorForwardAbsence:subsetMetrics(enriched,r=>r.state.home.majorForwardAbsence||r.state.away.majorForwardAbsence,k),
    topPairDefenseAbsence:subsetMetrics(enriched,r=>r.state.home.topPairDefenseAbsence||r.state.away.topPairDefenseAbsence,k),
    pp1PersonnelChange:subsetMetrics(enriched,r=>(r.state.home.pp1PersonnelChange??0)>=0.20||(r.state.away.pp1PersonnelChange??0)>=0.20,k),
    multipleScratches:{n:0,status:"UNSUPPORTED_NO_TIMESTAMP_VERIFIED_PREGAME_SCRATCH_SOURCE"},
    highDeploymentDisruption:subsetMetrics(enriched,r=>(r.state.home.roleChangeRate??0)>=0.25||(r.state.away.roleChangeRate??0)>=0.25,k),
    stableLineGames:subsetMetrics(enriched,r=>(r.state.home.linemateContinuity??0)>=0.72&&(r.state.away.linemateContinuity??0)>=0.72,k),
    highLinemateContinuity:subsetMetrics(enriched,r=>(r.state.home.linemateContinuity??0)>=0.72||(r.state.away.linemateContinuity??0)>=0.72,k),
    lowLinemateContinuity:subsetMetrics(enriched,r=>(r.state.home.linemateContinuity??1)<=0.42||(r.state.away.linemateContinuity??1)<=0.42,k),
    replacementRoleGames:subsetMetrics(enriched,r=>(r.state.home.absenceBurden??0)>=0.20||(r.state.away.absenceBurden??0)>=0.20,k)
  };
}
const incumbent=aggregate.incumbent;
function delta(m){return {marginMae:round(m.marginMae-incumbent.marginMae),totalMae:round(m.totalMae-incumbent.totalMae),homeGoalsMae:round(m.homeGoalsMae-incumbent.homeGoalsMae),awayGoalsMae:round(m.awayGoalsMae-incumbent.awayGoalsMae),winnerAccuracy:round(m.winnerAccuracy-incumbent.winnerAccuracy),brier:round(m.brier-incumbent.brier),logLoss:round(m.logLoss-incumbent.logLoss),ece:round(m.ece-incumbent.ece)};}
const ablation=Object.fromEntries(keys.filter(k=>k!=="incumbent").map(k=>[k,{...aggregate[k],deltaVsIncumbent:delta(aggregate[k])}]));

function historicalGate(k){
  const m=aggregate[k],d=delta(m),recent=bySeason[k]?.["20252026"];
  if(!m||!recent)return false;
  if(k==="goalie")return d.brier<0&&d.logLoss<=0&&recent.brier<=bySeason.incumbent["20252026"].brier;
  return d.marginMae<0&&d.totalMae<=0.005&&d.brier<=0.0005&&recent.marginMae<=bySeason.incumbent["20252026"].marginMae+0.01;
}
const gates={
  deployment:{id:"NHL_DEPLOYMENT_CHANGE_V1",fires:"roleChangeRate>=0.14 OR PP1 personnel change>=0.20; both teams role coverage>=0.55",historicallyValidated:historicalGate("deployment")},
  linemate:{id:"NHL_LINEMATE_CONTINUITY_EXTREME_V1",fires:"linemate continuity >=0.72 or <=0.42 with both teams known",historicallyValidated:historicalGate("linemate")},
  replacement:{id:"NHL_RECENT_REPLACEMENT_ROLE_V1",fires:"recent carry-forward absence burden >=0.20 team-hours",historicallyValidated:historicalGate("replacement")},
  goalie:{id:"NHL_GOALIE_PROBABILITY_RECAL_V1",fires:"monthly expanding PIT selector chooses a reduced/expected-start probability transform",historicallyValidated:historicalGate("goalie")},
  combined:{id:"NHL_PERSISTENT_STATE_COMBINED_V1",fires:"any validated component gate fires",historicallyValidated:historicalGate("combined")}
};
const shadowEligible=Object.entries(gates).filter(([,g])=>g.historicallyValidated).map(([k])=>k);

const report={
  modelId:"NHL-PERSISTENT-STATE-CHALLENGER-v1",
  version:"research-v1.0-pit-deployment-linemate-replacement-goalie",
  generatedAt:new Date().toISOString(),
  sourceModel:source.modelId,sourceVersion:source.version,sourceGeneratedAt:source.generatedAt,
  pointInTime:true,marketInformed:false,
  method:"monthly expanding walk-forward residual overlays using only completed prior-game official shift/boxscore state; unverifiable current-game states fail closed",
  population:{requested:(source.gamePredictions||[]).length,evaluated:enriched.length,samePopulation:maxGames===0&&enriched.length===(source.gamePredictions||[]).length},
  coverage,fetchErrors,
  aggregate,ablation,bySeason,byMonth,subsets,gates,
  goalieResearch:{
    candidates:goalieCandidates.map(x=>x.id),
    selectedByMonth:Object.fromEntries([...new Set(enriched.map(monthKey))].map(m=>[m,[...new Set(enriched.filter(r=>monthKey(r)===m).map(r=>r.goalie.selected))]])),
    scoringSignalPreserved:true,
    probabilityTranslationRecalibratedOnly:true,
    note:"Current-game confirmed starter state remains UNKNOWN without a timestamp-verifiable pregame archive; expected starter probability uses only prior starts."
  },
  provenance:{
    deployment:"NHL official shiftcharts from completed games strictly before each game cutoff",
    roles:"NHL official completed-game boxscore TOI + shift-derived EV line/D-pair inference",
    linemates:"shift overlap from completed prior games",
    replacements:"carry-forward absence and realized role inheritance from the most recent completed game relative to earlier rolling state",
    currentInjuryScratchGoalieConfirmation:"UNKNOWN unless timestamp-verifiable pregame evidence exists; no postgame backfill into pregame state"
  },
  governance:{
    policy:"FBIS-STATE-OVERLAY-v1",
    mode:shadowEligible.length?"SHADOW_CANDIDATE":"CONTEXT_ONLY",
    historicalGatePassed:shadowEligible,
    prospectiveValidationRequired:true,
    operatorApprovalRequired:true,
    productionChampion:"NHL-PRO-v2",
    productionChampionChanged:false,
    canQualify:false,
    canAuthorizeWager:false,
    stakingAuthorized:false
  },
  shadowPreparation:{
    eligibleFamilies:shadowEligible,
    freezeFields:["incumbent_projection","challenger_projection","persistent_state_snapshot","gate_status","goalie_state","ev_deployment","pp_deployment","scratches_availability","replacement_mapping","market_snapshot","model_version","code_sha"],
    enabled:false,
    reason:shadowEligible.length?"Historical pass only; separate prospective freezer required before live shadow grading.":"No challenger cleared historical gate."
  }
};
await mkdir(outPath.split("/").slice(0,-1).join("/")||".",{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2)+"\n","utf8");
console.log(JSON.stringify({coverage,aggregate,ablation,gates,shadowEligible,fetchErrors:fetchErrors.length},null,2));
if(fetchErrors.length>Math.max(20,enriched.length*0.02))process.exitCode=2;
