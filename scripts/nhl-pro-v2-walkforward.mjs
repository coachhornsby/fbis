#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";

const API = "https://api-web.nhle.com/v1";
const DEFAULT_SEASONS = ["20232024","20242025","20252026"];
const SHOT_TYPES = ["wrist","snap","slap","backhand","tip","other"];
const FEATURE_NAMES = [
  "distance","angle","rebound","seconds_since_prev","movement","lateral_movement",
  "rush","same_team_prev","special_teams","empty_net",
  "shot_wrist","shot_snap","shot_slap","shot_backhand","shot_tip","shot_other",
  "prev_shot","prev_miss","prev_block","prev_turnover","is_home",
  "distance_sq","angle_sq"
];
const CANDIDATES = [
  [0.18,0.30,0.45,0.65,0.90,1.25],
  [0.12,0.25,0.40,0.60,0.80],
  [0.5],
  [0.05,0.15,0.30,0.55,0.85],
  [0.10,0.25,0.45,0.70,1.00],
  [0.08,0.20,0.40,0.65],
  [0.5],[0.5],[0.5],[0.5],
  [0.5],[0.5],[0.5],[0.5],[0.5],[0.5],
  [0.5],[0.5],[0.5],[0.5],[0.5],
  [0.08,0.18,0.35,0.65,1.10],
  [0.05,0.18,0.40,0.70]
];

function arg(name,fallback=null){
  const p=process.argv.find(x=>x.startsWith(`--${name}=`));
  return p?p.split("=").slice(1).join("="):fallback;
}
const seasons=String(arg("seasons",DEFAULT_SEASONS.join(","))).split(",").map(s=>s.trim()).filter(Boolean);
const outPath=arg("out","data/models/nhl-pro-v2-validation.json");
const concurrency=Math.max(2,Math.min(24,Number(arg("concurrency","12"))||12));
const maxGamesPerSeason=Math.max(0,Number(arg("max-games-per-season","0"))||0);
const cacheDir=arg("cache-dir",".cache/nhl-pro-v2");

function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function round(v,n=5){const p=10**n;return Math.round(Number(v)*p)/p;}
function sigmoid(z){return z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));}
function logit(p){const q=clamp(p,1e-6,1-1e-6);return Math.log(q/(1-q));}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function isoAdd(date,days){const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function seasonRange(season){const y=Number(String(season).slice(0,4));return {start:`${y}-09-15`,end:`${y+1}-06-30`};}
function eventSeconds(play){
  const period=Number(play?.periodDescriptor?.number||0);
  const m=String(play?.timeInPeriod||"").match(/^(\d+):(\d+)$/);
  return period&&m?(period-1)*1200+Number(m[1])*60+Number(m[2]):null;
}
async function fetchJson(url,attempts=5){
  let last;
  for(let i=1;i<=attempts;i++){
    try{
      const res=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS-NHL-PRO-v2/1.0"},signal:AbortSignal.timeout(30000)});
      if(res.ok)return res.json();
      last=new Error(`HTTP_${res.status} ${url}`);
      if(res.status===404)throw last;
      if(res.status===429||res.status>=500)await sleep(i*650); else throw last;
    }catch(err){last=err;if(i<attempts)await sleep(i*650);}
  }
  throw last;
}
async function fetchGamePbp(gameId){
  const dir=`${cacheDir}/pbp`;
  const path=`${dir}/${gameId}.json`;
  try{
    return JSON.parse(await readFile(path,"utf8"));
  }catch{}
  const json=await fetchJson(`${API}/gamecenter/${gameId}/play-by-play`);
  await mkdir(dir,{recursive:true});
  await writeFile(path,JSON.stringify(json),"utf8");
  return json;
}
async function collectSchedule(season){
  const {start,end}=seasonRange(season);
  const games=new Map();
  for(let day=start;day<=end;day=isoAdd(day,7)){
    let json; try{json=await fetchJson(`${API}/schedule/${day}`);}catch{continue;}
    for(const block of json?.gameWeek||[])for(const g of block?.games||[]){
      if(Number(g?.gameType)!==2||String(g?.season||season)!==season)continue;
      const id=String(g?.id||""),hs=Number(g?.homeTeam?.score),as=Number(g?.awayTeam?.score);
      if(!id||!Number.isFinite(hs)||!Number.isFinite(as))continue;
      games.set(id,{id,season,start:g.startTimeUTC||null,
        home:String(g?.homeTeam?.abbrev||"").toUpperCase(),
        away:String(g?.awayTeam?.abbrev||"").toUpperCase(),
        homeGoals:hs,awayGoals:as});
    }
  }
  let rows=[...games.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.id.localeCompare(b.id));
  if(maxGamesPerSeason>0)rows=rows.slice(0,maxGamesPerSeason);
  return rows;
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let idx=0;
  async function worker(){while(true){const i=idx++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch(err){out[i]={error:String(err?.message||err),shots:[]};}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker())); return out;
}
function shotTypeKey(v){
  const s=String(v||"").toLowerCase().replace(/[^a-z]/g,"");
  if(s.includes("wrist"))return "wrist"; if(s.includes("snap"))return "snap";
  if(s.includes("slap"))return "slap"; if(s.includes("backhand"))return "backhand";
  if(s.includes("tip")||s.includes("deflect"))return "tip"; return "other";
}
function prevKind(type){
  const t=String(type||"").toLowerCase();
  if(t==="shot-on-goal"||t==="goal")return "shot";
  if(t==="missed-shot")return "miss";
  if(t==="blocked-shot")return "block";
  if(t.includes("giveaway")||t.includes("takeaway"))return "turnover";
  return "other";
}
function isFiveOnFive(play){return String(play?.situationCode||"").replace(/\D/g,"")==="1551";}
function featureVector(play,prev,owner,home){
  const x=Number(play?.details?.xCoord),y=Number(play?.details?.yCoord);
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  const sec=eventSeconds(play),psec=prev?.sec;
  const dt=sec!=null&&psec!=null?clamp(sec-psec,0,30):30;
  const px=Number(prev?.x),py=Number(prev?.y);
  const hasPrev=Number.isFinite(px)&&Number.isFinite(py);
  const move=hasPrev?Math.sqrt((x-px)**2+(y-py)**2):0;
  const lateral=hasPrev?Math.abs(y-py):0;
  const dx=Math.max(0,89-Math.abs(x));
  const dist=Math.sqrt(dx*dx+y*y);
  const angle=Math.atan2(Math.abs(y),Math.max(1,dx))*180/Math.PI;
  const same=Boolean(prev&&prev.owner===owner);
  const rebound=Boolean(same&&dt<=3&&["shot","miss","block"].includes(prev.kind));
  const rush=Boolean(same&&dt<=6&&move>=35);
  const type=shotTypeKey(play?.details?.shotType);
  const pk=prev?.kind||"other";
  const goalie=play?.details?.goalieInNetId;
  return [
    clamp(dist/50,0,2.5),clamp(angle/90,0,1),rebound?1:0,clamp(dt/10,0,1),
    clamp(move/100,0,1.5),clamp(lateral/85,0,1.2),rush?1:0,same?1:0,
    isFiveOnFive(play)?0:1,goalie?0:1,
    ...SHOT_TYPES.map(t=>type===t?1:0),
    pk==="shot"?1:0,pk==="miss"?1:0,pk==="block"?1:0,pk==="turnover"?1:0,
    owner===home?1:0,clamp((dist*dist)/2500,0,6.25),clamp((angle*angle)/8100,0,1)
  ];
}
function parsePbp(game,json){
  const homeId=String(json?.homeTeam?.id??""),awayId=String(json?.awayTeam?.id??"");
  const ids=new Map([[homeId,game.home],[awayId,game.away]]);
  const shots=[]; let prev=null;
  for(const play of json?.plays||[]){
    const type=String(play?.typeDescKey||"").toLowerCase();
    const owner=ids.get(String(play?.details?.eventOwnerTeamId??""))||null;
    const sec=eventSeconds(play),x=Number(play?.details?.xCoord),y=Number(play?.details?.yCoord);
    if(["goal","shot-on-goal","missed-shot"].includes(type)&&owner){
      const defender=owner===game.home?game.away:game.home;
      const fv=featureVector(play,prev,owner,game.home);
      if(fv){
        shots.push({
          gameId:game.id,season:game.season,owner,defender,
          shooterId:String(play?.details?.shootingPlayerId??play?.details?.scoringPlayerId??""),
          goalieId:String(play?.details?.goalieInNetId??""),
          x:fv,y:type==="goal"?1:0,five:isFiveOnFive(play),
          rush:Boolean(fv[6]),highDanger:Boolean(fv[0]<=0.55&&fv[1]<=0.55)
        });
      }
    }
    if(owner||["shot-on-goal","goal","missed-shot","blocked-shot","giveaway","takeaway"].includes(type)){
      prev={sec,x:Number.isFinite(x)?x:null,y:Number.isFinite(y)?y:null,owner,kind:prevKind(type)};
    }
  }
  return shots;
}

function fitBoostedXg(rows,{trees=28,learningRate=0.08,lambda=8,maxRows=45000}={}){
  const sampled=rows.length<=maxRows?rows:rows.filter((_,i)=>i%Math.ceil(rows.length/maxRows)===0).slice(0,maxRows);
  const baseRate=sampled.reduce((s,r)=>s+r.y,0)/Math.max(1,sampled.length);
  const base=logit(clamp(baseRate,0.02,0.2));
  const logits=new Float64Array(sampled.length); logits.fill(base);
  const ensemble=[];
  for(let iter=0;iter<trees;iter++){
    const grad=new Float64Array(sampled.length),hess=new Float64Array(sampled.length);
    let totalG=0,totalH=0;
    for(let i=0;i<sampled.length;i++){const p=sigmoid(logits[i]);grad[i]=sampled[i].y-p;hess[i]=Math.max(1e-4,p*(1-p));totalG+=grad[i];totalH+=hess[i];}
    let best=null,bestGain=-Infinity;
    for(let f=0;f<FEATURE_NAMES.length;f++){
      for(const th of CANDIDATES[f]){
        let gl=0,hl=0;
        for(let i=0;i<sampled.length;i++)if(sampled[i].x[f]<=th){gl+=grad[i];hl+=hess[i];}
        const gr=totalG-gl,hr=totalH-hl;
        if(hl<5||hr<5)continue;
        const gain=0.5*(gl*gl/(hl+lambda)+gr*gr/(hr+lambda)-totalG*totalG/(totalH+lambda));
        if(gain>bestGain){
          bestGain=gain;
          best={feature:f,threshold:th,left:clamp(gl/(hl+lambda),-2,2),right:clamp(gr/(hr+lambda),-2,2),gain};
        }
      }
    }
    if(!best||bestGain<=1e-6)break;
    ensemble.push({...best,left:best.left*learningRate,right:best.right*learningRate});
    for(let i=0;i<sampled.length;i++)logits[i]+=sampled[i].x[best.feature]<=best.threshold?best.left*learningRate:best.right*learningRate;
  }
  return {base,trees:ensemble,featureNames:FEATURE_NAMES};
}
function predictBoosted(model,x){
  let z=model.base;
  for(const t of model.trees)z+=x[t.feature]<=t.threshold?t.left:t.right;
  return clamp(sigmoid(z),0.002,0.85);
}
function fitTalent(rows,xgModel){
  const shooters=new Map(),goalies=new Map();
  const touch=(map,id)=>{if(!id)return null;if(!map.has(id))map.set(id,{n:0,goals:0,xg:0,teams:new Map()});return map.get(id);};
  for(const r of rows){
    const xg=predictBoosted(xgModel,r.x);
    const s=touch(shooters,r.shooterId); if(s){s.n++;s.goals+=r.y;s.xg+=xg;s.teams.set(r.owner,(s.teams.get(r.owner)||0)+1);}
    const g=touch(goalies,r.goalieId); if(g){g.n++;g.goals+=r.y;g.xg+=xg;g.teams.set(r.defender,(g.teams.get(r.defender)||0)+1);}
  }
  const outS={},outG={};
  for(const [id,s] of shooters){
    const shrink=s.n/(s.n+180),raw=(s.goals+8)/(s.xg+8),factor=1+(raw-1)*shrink;
    outS[id]={shots:s.n,goals:s.goals,xg:round(s.xg,3),factor:round(clamp(factor,0.82,1.20),5),team:[...s.teams].sort((a,b)=>b[1]-a[1])[0]?.[0]||null};
  }
  for(const [id,g] of goalies){
    const shrink=g.n/(g.n+450),gsax=g.xg-g.goals,impactPerShot=(gsax/Math.max(1,g.n))*shrink;
    outG[id]={shots:g.n,goals:g.goals,xg:round(g.xg,3),gsax:round(gsax,3),impactPerShot:round(clamp(impactPerShot,-0.025,0.025),6),team:[...g.teams].sort((a,b)=>b[1]-a[1])[0]?.[0]||null};
  }
  return {shooters:outS,goalies:outG};
}
function adjustedXg(r,model,talent){
  const p=predictBoosted(model,r.x),factor=talent?.shooters?.[r.shooterId]?.factor||1;
  return clamp(p*factor,0.001,0.9);
}
function emptyTeam(){return {gp:0,gf:0,ga:0,xgf:0,xga:0,stxgf:0,stxga:0,shotsFor:0,shotsAgainst:0,hdFor:0,hdAgainst:0,rushFor:0,rushAgainst:0,elo:1500,lastStart:null,recentGoalies:new Map(),players:new Map(),lastGameAt:null};}
function teamMapGet(map,t){if(!map.has(t))map.set(t,emptyTeam());return map.get(t);}
function gameShotStats(game,shots,model,talent){
  const out={
    [game.home]:{xgf:0,xga:0,stxgf:0,stxga:0,sf:0,sa:0,hd:0,hda:0,rush:0,rusha:0,goalies:new Map(),players:new Map()},
    [game.away]:{xgf:0,xga:0,stxgf:0,stxga:0,sf:0,sa:0,hd:0,hda:0,rush:0,rusha:0,goalies:new Map(),players:new Map()}
  };
  for(const s of shots){
    const xg=adjustedXg(s,model,talent),o=out[s.owner],d=out[s.defender]; if(!o||!d)continue;
    o.xgf+=xg;d.xga+=xg;o.sf++;d.sa++;
    if(!s.five){o.stxgf+=xg;d.stxga+=xg;}
    if(s.highDanger){o.hd++;d.hda++;}
    if(s.rush){o.rush++;d.rusha++;}
    if(s.shooterId)o.players.set(s.shooterId,(o.players.get(s.shooterId)||0)+1);
    if(s.goalieId)d.goalies.set(s.goalieId,(d.goalies.get(s.goalieId)||0)+1);
  }
  return out;
}
function aggregatePrior(games,shotsByGame,xgModel,talent){
  const map=new Map();
  for(const g of games){
    const hs=teamMapGet(map,g.home),as=teamMapGet(map,g.away);
    const stats=gameShotStats(g,shotsByGame.get(g.id)||[],xgModel,talent);
    applyGame(hs,as,g,stats[g.home],stats[g.away],true);
  }
  return map;
}
function rate(row,num,den="gp",fallback=0){return row&&row[den]?row[num]/row[den]:fallback;}
function playerFinishing(row,talent){
  if(!row?.players?.size)return 1;
  let sum=0,w=0;
  for(const [id,n] of row.players){sum+=(talent?.shooters?.[id]?.factor||1)*n;w+=n;}
  return w?sum/w:1;
}
function expectedGoalieImpact(row,talent){
  const candidates=[...row?.recentGoalies||[]].sort((a,b)=>b[1]-a[1]).slice(0,3);
  if(!candidates.length&&row?.lastStart)candidates.push([row.lastStart,1]);
  let sum=0,w=0;
  for(const [id,n] of candidates){const imp=talent?.goalies?.[id]?.impactPerShot;if(Number.isFinite(imp)){sum+=imp*n;w+=n;}}
  return w?sum/w:0;
}
function blendRate(prior,current,key,fallback,currentCap=0.84){
  const p=rate(prior,key,"gp",fallback),c=rate(current,key,"gp",p);
  const w=current?.gp?clamp(current.gp/24,0,currentCap):0; return p*(1-w)+c*w;
}
function forecastV2(game,prior,current,talent,league){
  const hp=prior.get(game.home)||emptyTeam(),ap=prior.get(game.away)||emptyTeam();
  const hc=teamMapGet(current,game.home),ac=teamMapGet(current,game.away);
  const lg=league.goals,lx=league.xg,lst=league.stxg,lshots=league.shots,lhd=league.hd,lrush=league.rush;
  const hgf=blendRate(hp,hc,"gf",lg),hga=blendRate(hp,hc,"ga",lg);
  const agf=blendRate(ap,ac,"gf",lg),aga=blendRate(ap,ac,"ga",lg);
  const hxgf=blendRate(hp,hc,"xgf",lx),hxga=blendRate(hp,hc,"xga",lx);
  const axgf=blendRate(ap,ac,"xgf",lx),axga=blendRate(ap,ac,"xga",lx);
  const hstf=blendRate(hp,hc,"stxgf",lst),hsta=blendRate(hp,hc,"stxga",lst);
  const astf=blendRate(ap,ac,"stxgf",lst),asta=blendRate(ap,ac,"stxga",lst);
  const hsf=blendRate(hp,hc,"shotsFor",lshots),hsa=blendRate(hp,hc,"shotsAgainst",lshots);
  const asf=blendRate(ap,ac,"shotsFor",lshots),asa=blendRate(ap,ac,"shotsAgainst",lshots);
  const hhd=blendRate(hp,hc,"hdFor",lhd),ahd=blendRate(ap,ac,"hdFor",lhd);
  const hrush=blendRate(hp,hc,"rushFor",lrush),arush=blendRate(ap,ac,"rushFor",lrush);

  const baseH=(hgf+aga)/2,baseA=(agf+hga)/2;
  const xgH=(hxgf+axga)/2,xgA=(axgf+hxga)/2;
  const stH=(hstf+asta)/2,stA=(astf+hsta)/2;
  const volumeH=((hsf+asa)/2-lshots)*0.018,volumeA=((asf+hsa)/2-lshots)*0.018;
  const pressureH=((hhd-lhd)*0.014+(hrush-lrush)*0.018),pressureA=((ahd-lhd)*0.014+(arush-lrush)*0.018);
  const finishH=(playerFinishing(hc.gp?hc:hp,talent)-1)*0.75;
  const finishA=(playerFinishing(ac.gp?ac:ap,talent)-1)*0.75;
  const goalieVsH=-expectedGoalieImpact(ac.gp?ac:ap,talent)*30;
  const goalieVsA=-expectedGoalieImpact(hc.gp?hc:hp,talent)*30;
  const eloH=hc.gp?(hc.elo||1500):(hp.elo||1500),eloA=ac.gp?(ac.elo||1500):(ap.elo||1500);
  const eloAdj=clamp((eloH-eloA)*0.0011,-0.28,0.28);

  let home=0.30*baseH+0.50*xgH+0.20*(xgH+(stH-lst))+volumeH+pressureH+finishH+goalieVsH+0.12+eloAdj/2;
  let away=0.30*baseA+0.50*xgA+0.20*(xgA+(stA-lst))+volumeA+pressureA+finishA+goalieVsA-eloAdj/2;

  const ht=Date.parse(game.start||""),hprev=hc.lastGameAt||hp.lastGameAt,aprev=ac.lastGameAt||ap.lastGameAt;
  const hdays=hprev&&Number.isFinite(ht)?(ht-hprev)/86400000:null,adays=aprev&&Number.isFinite(ht)?(ht-aprev)/86400000:null;
  if(hdays!=null&&hdays<1.6)home-=0.10;if(adays!=null&&adays<1.6)away-=0.10;
  if(hdays!=null&&adays!=null){const rd=clamp((hdays-adays)*0.018,-0.07,0.07);home+=rd;away-=rd;}

  const eloProb=1/(1+10**(-((eloH-eloA)+35)/400));
  return {home:clamp(home,1.45,5.25),away:clamp(away,1.45,5.25),eloProb:clamp(eloProb,0.05,0.95)};
}
function leagueRates(games,shotsByGame,model,talent){
  let goals=0,xg=0,stxg=0,shots=0,hd=0,rush=0;
  for(const g of games){
    goals+=g.homeGoals+g.awayGoals;
    for(const s of shotsByGame.get(g.id)||[]){const q=adjustedXg(s,model,talent);xg+=q;shots++;if(!s.five)stxg+=q;if(s.highDanger)hd++;if(s.rush)rush++;}
  }
  const teamGames=Math.max(1,games.length*2);
  return {goals:goals/teamGames,xg:xg/teamGames,stxg:stxg/teamGames,shots:shots/teamGames,hd:hd/teamGames,rush:rush/teamGames};
}
function applyGame(home,away,g,hs,as,updateElo=true){
  home.gp++;away.gp++;home.gf+=g.homeGoals;home.ga+=g.awayGoals;away.gf+=g.awayGoals;away.ga+=g.homeGoals;
  for(const [row,own,opp] of [[home,hs,as],[away,as,hs]]){
    row.xgf+=own.xgf;row.xga+=own.xga;row.stxgf+=own.stxgf;row.stxga+=own.stxga;
    row.shotsFor+=own.sf;row.shotsAgainst+=own.sa;row.hdFor+=own.hd;row.hdAgainst+=own.hda;row.rushFor+=own.rush;row.rushAgainst+=own.rusha;
    for(const [id,n] of own.players)row.players.set(id,(row.players.get(id)||0)+n);
    for(const [id,n] of own.goalies)row.recentGoalies.set(id,(row.recentGoalies.get(id)||0)*0.85+n);
    const starter=[...own.goalies].sort((a,b)=>b[1]-a[1])[0]?.[0]; if(starter)row.lastStart=starter;
    row.lastGameAt=Date.parse(g.start||"")||row.lastGameAt;
  }
  if(updateElo){
    const hpre=home.elo||1500,apre=away.elo||1500;
    const ph=1/(1+10**(-(hpre-apre+35)/400)),y=g.homeGoals>g.awayGoals?1:0;
    const margin=Math.max(1,Math.abs(g.homeGoals-g.awayGoals)),k=16*Math.log1p(margin);
    const delta=k*(y-ph);home.elo=hpre+delta;away.elo=apre-delta;
  }
}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function bivarHomeWin(h,a){
  const shared=Math.min(0.32,0.10*Math.min(h,a)),lh=Math.max(0.05,h-shared),la=Math.max(0.05,a-shared);
  let hw=0,tie=0;
  for(let x=0;x<=11;x++)for(let y=0;y<=11;y++)for(let z=0;z<=5;z++){
    const p=poisson(lh,x)*poisson(la,y)*poisson(shared,z),hg=x+z,ag=y+z;
    if(hg>ag)hw+=p;else if(hg===ag)tie+=p;
  }
  const ot=1/(1+Math.exp(-(h-a)/0.65));
  return clamp(hw+tie*ot,0.01,0.99);
}
function v1Forecast(game,prior,current,league){
  const hp=prior.get(game.home)||emptyTeam(),ap=prior.get(game.away)||emptyTeam(),hc=teamMapGet(current,game.home),ac=teamMapGet(current,game.away);
  const lg=league.goals,lx=league.xg;
  const hgf=blendRate(hp,hc,"gf",lg),hga=blendRate(hp,hc,"ga",lg),agf=blendRate(ap,ac,"gf",lg),aga=blendRate(ap,ac,"ga",lg);
  const hxgf=blendRate(hp,hc,"xgf",lx),hxga=blendRate(hp,hc,"xga",lx),axgf=blendRate(ap,ac,"xgf",lx),axga=blendRate(ap,ac,"xga",lx);
  const non5=Math.max(0.35,lg-lx);
  return {home:clamp(0.55*((hgf+aga)/2)+0.45*((hxgf+axga)/2+non5)+0.12,1.3,5.5),
          away:clamp(0.55*((agf+hga)/2)+0.45*((axgf+hxga)/2+non5),1.3,5.5)};
}
function metrics(rows,key){
  let margin=0,total=0,winner=0,brier=0,home=0,away=0;
  for(const r of rows){const p=r[key],am=r.ah-r.aa,at=r.ah+r.aa;
    margin+=Math.abs((p.h-p.a)-am);total+=Math.abs((p.h+p.a)-at);home+=Math.abs(p.h-r.ah);away+=Math.abs(p.a-r.aa);
    const y=r.ah>r.aa?1:0;winner+=(p.p>=0.5)===Boolean(y)?1:0;brier+=(p.p-y)**2;
  }
  const n=rows.length;return {n,marginMae:round(margin/n,4),totalMae:round(total/n,4),homeGoalsMae:round(home/n,4),awayGoalsMae:round(away/n,4),winnerAccuracy:round(winner/n,4),brier:round(brier/n,5)};
}
function comparison(v1,v2){
  const wins={margin:v2.marginMae<v1.marginMae,total:v2.totalMae<v1.totalMae,winner:v2.winnerAccuracy>v1.winnerAccuracy,brier:v2.brier<v1.brier};
  const winCount=Object.values(wins).filter(Boolean).length;
  return {wins,winCount,marginDelta:round(v2.marginMae-v1.marginMae,4),totalDelta:round(v2.totalMae-v1.totalMae,4),winnerDelta:round(v2.winnerAccuracy-v1.winnerAccuracy,4),brierDelta:round(v2.brier-v1.brier,5),
    beatsIncumbent:winCount>=3&&v2.marginMae<=v1.marginMae+0.02&&v2.totalMae<=v1.totalMae+0.02};
}

console.log("NHL-PRO-v2 walk-forward",seasons.join(","));
const gamesBySeason={},shotsBySeason={},shotsByGameBySeason={},fetchErrors=[];
for(const season of seasons){
  const games=await collectSchedule(season);gamesBySeason[season]=games;console.log("schedule",season,games.length);
  const parsed=await mapLimit(games,concurrency,async g=>{
    try{return {gameId:g.id,shots:parsePbp(g,await fetchGamePbp(g.id))};}
    catch(err){return {gameId:g.id,shots:[],error:String(err?.message||err)};}
  });
  const map=new Map();for(const p of parsed){map.set(p.gameId,p.shots||[]);if(p.error)fetchErrors.push({season,gameId:p.gameId,error:p.error});}
  shotsByGameBySeason[season]=map;shotsBySeason[season]=parsed.flatMap(p=>p.shots||[]);console.log("shots",season,shotsBySeason[season].length);
}

const folds=[];
for(let idx=1;idx<seasons.length;idx++){
  const target=seasons[idx],trainSeasons=seasons.slice(0,idx);
  const trainGames=trainSeasons.flatMap(s=>gamesBySeason[s]||[]),trainShots=trainSeasons.flatMap(s=>shotsBySeason[s]||[]);
  const trainMap=new Map();for(const s of trainSeasons)for(const [id,v] of shotsByGameBySeason[s])trainMap.set(id,v);
  const xgModel=fitBoostedXg(trainShots),talent=fitTalent(trainShots,xgModel),prior=aggregatePrior(trainGames,trainMap,xgModel,talent);
  const league=leagueRates(trainGames,trainMap,xgModel,talent),currentV2=new Map(),currentV1=new Map(),rows=[];
  const targetMap=shotsByGameBySeason[target];
  for(const g of gamesBySeason[target]){
    const v2f=forecastV2(g,prior,currentV2,talent,league),v1f=v1Forecast(g,prior,currentV1,league);
    const v1p=bivarHomeWin(v1f.home,v1f.away);
    const v2ScoreProb=bivarHomeWin(v2f.home,v2f.away);
    const v2Ensemble=0.78*v2ScoreProb+0.22*v2f.eloProb;
    const v2p=clamp(0.5+0.86*(v2Ensemble-0.5),0.04,0.96);
    rows.push({id:g.id,ah:g.homeGoals,aa:g.awayGoals,v2:{h:v2f.home,a:v2f.away,p:v2p},v1:{h:v1f.home,a:v1f.away,p:v1p}});
    const stats=gameShotStats(g,targetMap.get(g.id)||[],xgModel,talent);
    applyGame(teamMapGet(currentV2,g.home),teamMapGet(currentV2,g.away),g,stats[g.home],stats[g.away],true);
    applyGame(teamMapGet(currentV1,g.home),teamMapGet(currentV1,g.away),g,stats[g.home],stats[g.away],false);
  }
  const v1=metrics(rows,"v1"),v2=metrics(rows,"v2"),cmp=comparison(v1,v2);
  console.log("fold",target,{v1,v2,cmp});
  folds.push({targetSeason:target,trainSeasons,trainingGames:trainGames.length,trainingShots:trainShots.length,xgTrees:xgModel.trees.length,shooterPriors:Object.keys(talent.shooters).length,goaliePriors:Object.keys(talent.goalies).length,v1,v2,comparison:cmp,rows});
}
const all=folds.flatMap(f=>f.rows),aggregateV1=metrics(all,"v1"),aggregateV2=metrics(all,"v2"),aggregateComparison=comparison(aggregateV1,aggregateV2);
const recent=folds.at(-1)?.comparison||null;
const promote=Boolean(aggregateComparison.beatsIncumbent&&recent?.beatsIncumbent);
const report={
  modelId:"NHL-PRO-v2",version:"research-v2.0-event-chain-gbdt",generatedAt:new Date().toISOString(),
  pointInTime:true,marketInformed:false,seasons,featureNames:FEATURE_NAMES,
  architecture:{
    xg:"logistic-gradient-boosted decision stumps with event-chain features",
    shooterTalent:"empirical-Bayes finishing multiplier",
    goalieTalent:"empirical-Bayes GSAx per shot",
    lineup:"recent shooter participation weighted finishing talent",
    specialTeams:"non-5v5 expected-goal rate",
    trackingProxy:"high-danger/rush/shot-volume rolling features; official NHL Edge is live advisory only",
    teamState:"prior + point-in-time current-season blend with Elo residual",
    scoreDistribution:"bivariate Poisson with shared scoring component",
    winProbability:"78% score-distribution + 22% Elo head, reliability-shrunk 14% toward 0.5"
  },
  fetchErrors,
  folds:folds.map(({rows,...x})=>x),
  aggregate:{incumbent:aggregateV1,challenger:aggregateV2,comparison:aggregateComparison},
  promotion:{
    historicalPromotionEligible:promote,
    promotedToResearchBoard:promote,
    canQualify:false,canAuthorizeWager:false,
    reason:promote?"NHL-PRO-v2 beat NHL-FBIS-v1 on aggregate and most-recent PIT folds; research-board promotion only.":"Challenger did not clear strict incumbent-comparison gate."
  },
  integrity:{noMarketInputs:true,priorSeasonOnlyTraining:true,currentSeasonOnlyPastGames:true,fetchErrors:fetchErrors.length,sampleGames:all.length}
};
await mkdir(outPath.split("/").slice(0,-1).join("/")||".",{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2)+"\n","utf8");
console.log(JSON.stringify({aggregate:report.aggregate,promotion:report.promotion,integrity:report.integrity},null,2));
if(fetchErrors.length||all.length<1500)process.exitCode=2;
