#!/usr/bin/env node
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {join} from "node:path";

const dir=process.argv[2]||"artifacts/nhl-deployment";
const out=process.argv[3]||"artifacts/nhl-deployment-v1-validation.json";
const years=String(process.argv[4]||"2024,2025,2026").split(",").map(Number).filter(Number.isFinite);
if(years.length<3)throw new Error("Need discovery, validation, confirmation seasons");
const round=(v,n=4)=>{const p=10**n;return Math.round(Number(v)*p)/p};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const sd=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};

function csv(text){
  const rows=[];let row=[],s="",q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(ch==='"'){if(q&&text[i+1]==='"'){s+='"';i++;}else q=!q;}
    else if(ch===","&&!q){row.push(s);s="";}
    else if((ch==="\n"||ch==="\r")&&!q){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(s);s="";if(row.some(x=>x!==""))rows.push(row);row=[];}
    else s+=ch;
  }
  if(s||row.length){row.push(s);rows.push(row);}
  if(!rows.length)return[];const h=rows[0].map(x=>String(x||"").trim());
  return rows.slice(1).map(a=>Object.fromEntries(h.map((k,i)=>[k,a[i]??""])));
}
const pick=(r,names)=>{for(const k of names)if(r?.[k]!=null&&r[k]!=="")return r[k];
  const lower=Object.fromEntries(Object.keys(r||{}).map(k=>[k.toLowerCase(),k]));
  for(const n of names){const k=lower[String(n).toLowerCase()];if(k&&r[k]!=="")return r[k];}return null;};
const num=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const id=(r,names)=>{const v=pick(r,names);return v==null?"":String(v).replace(/\.0$/,"")};
const gameId=r=>id(r,["game_id","gameId","id_game"]);
const playerId=r=>id(r,["player_id","playerId","id_player","nhl_id","id"]);
const teamId=r=>id(r,["team_id","teamId","id_team"]);
const team=r=>String(r?.team_abbrev??r?.teamAbbrev??r?.team_abbreviation??r?.teamAbbreviation??r?.team_tri_code??r?.teamTriCode??"").toUpperCase();
const position=r=>String(r?.position??r?.position_code??r?.positionCode??r?.pos??"").toUpperCase();
const shots=r=>num(r?.shots_on_goal??r?.shotsOnGoal??r?.sog??r?.shots);
const goals=r=>num(r?.goals);
const gameDate=r=>{const v=pick(r,["game_date","gameDate","date","game_date_time","start_time_utc"]);const t=Date.parse(v||"");return Number.isFinite(t)?t:null};
function seconds(v){if(v==null||v==="")return null;const n=Number(v);if(Number.isFinite(n))return n;const m=String(v).match(/^(?:(\d+):)?(\d+):(\d+)$/);if(m)return Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]);const z=String(v).match(/^(\d+):(\d+)$/);return z?Number(z[1])*60+Number(z[2]):null;}
const toi=r=>seconds(pick(r,["toi","time_on_ice","timeOnIce","toi_seconds"]));
const idsList=v=>String(v??"").split(",").map(x=>x.trim().replace(/\.0$/,"")).filter(x=>x&&x!=="0"&&x.toLowerCase()!=="none");
const pairKey=(a,b)=>a<b?a+"|"+b:b+"|"+a;
const push=(a,v,n=8)=>{a.push(v);while(a.length>n)a.shift();};

async function loadYear(y){
  const [box,shifts,scratches,rosters]=await Promise.all([
    readFile(join(dir,`skater_box_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`shifts_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`scratches_${y}.csv`),"utf8").then(csv),
    readFile(join(dir,`game_rosters_${y}.csv`),"utf8").then(csv),
  ]);return{y,box,shifts,scratches,rosters};
}
const datasets=await Promise.all(years.map(loadYear));
const actual=new Map(),rosters=new Map(),scratches=new Map(),meta=new Map(),abbrByTid=new Map(),shiftGame=new Map(),pairGame=new Map();
for(const d of datasets)for(const r of d.box){
  const g=gameId(r),p=playerId(r),tm=team(r),tid=teamId(r),s=shots(r);if(!g||!p||!tm||s==null)continue;
  if(tid)abbrByTid.set(g+"|"+tid,tm);
  actual.set(g+"|"+p,{p,team:tm,pos:position(r),shots:s,goals:goals(r)||0,toi:toi(r),season:d.y});
  if(!meta.has(g))meta.set(g,{g,t:gameDate(r)??Number(g),season:d.y});
}
for(const d of datasets){
  for(const r of d.scratches){const g=gameId(r),p=playerId(r);if(!g||!p)continue;if(!scratches.has(g))scratches.set(g,new Set());scratches.get(g).add(p);}
  for(const r of d.rosters){const g=gameId(r),p=playerId(r),tid=teamId(r),tm=team(r)||abbrByTid.get(g+"|"+tid)||"";if(!g||!p||!tm)continue;
    if(!rosters.has(g))rosters.set(g,[]);rosters.get(g).push({p,team:tm,pos:position(r)});if(!meta.has(g))meta.set(g,{g,t:gameDate(r)??Number(g),season:d.y});}
}
for(const d of datasets){
  const groups=new Map();
  for(const r of d.shifts){
    const g=gameId(r),tm=String(r?.event_team??r?.event_team_abbr??r?.team_abbrev??r?.teamAbbrev??"").toUpperCase();
    const sec=num(pick(r,["game_seconds","gameSeconds","start_game_seconds"]));if(!g||!tm||sec==null)continue;
    const k=g+"|"+tm;if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push({sec,on:idsList(pick(r,["ids_on","idsOn"])),off:idsList(pick(r,["ids_off","idsOff"]))});
  }
  for(const [k,events] of groups){
    events.sort((a,b)=>a.sec-b.sec);const g=k.split("|")[0],active=new Set(),tot=new Map(),pairs=new Map();let last=0;
    const accrue=(to)=>{const dt=Math.max(0,to-last);if(!dt)return;const ids=[...active];for(const p of ids)tot.set(p,(tot.get(p)||0)+dt);for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const key=pairKey(ids[i],ids[j]);pairs.set(key,(pairs.get(key)||0)+dt);}last=to;};
    for(const e of events){accrue(e.sec);for(const p of e.off)active.delete(p);for(const p of e.on)active.add(p);}
    accrue(Math.max(3600,last));
    for(const [p,sec] of tot)shiftGame.set(g+"|"+p,sec);
    const gp=pairGame.get(g)||new Map();for(const [pk,pv] of pairs)gp.set(pk,(gp.get(pk)||0)+pv);pairGame.set(g,gp);
  }
}
const games=[...meta.values()].sort((a,b)=>a.t-b.t||a.g.localeCompare(b.g));

function blank(){return{gp:0,toi:0,shots:0,team:null,pos:null,recentToi:[],recentShots:[]};}
function baseToi(p){if(!p||p.gp<3||p.toi<=0)return null;const season=p.toi/p.gp,recent=mean(p.recentToi)||season;return clamp(.55*recent+.45*season,240,1900);}
function baseSog(p){if(!p||p.gp<3)return null;const season=p.shots/p.gp,recent=mean(p.recentShots)||season;return .68*season+.32*recent;}
function rate60(p){return p?.toi>0?p.shots/(p.toi/3600):null;}

const FEATURE_NAMES=["baseToi","recentToi","seasonToi","toiStability","roleRank","samePosScratchToi","allScratchToi","samePosScratchCount","scratchCount","scratchOverlapShare","shotRate60","defense","base_x_samePosScratch","rank_x_scratchCount","playerScratchDeltaAvg","teamPosScratchDeltaAvg","specificReplacementAffinity","multiScratchDeltaAvg"];
function rowFeatures(r,p,teamPlayers,scratchSet,state,pairState,responseState){
  const bt=baseToi(p);if(bt==null)return null;
  const season=p.toi/p.gp,recent=mean(p.recentToi)||season,stab=sd(p.recentToi);
  const ranked=teamPlayers.map(x=>({p:x.p,v:baseToi(state.get(x.p))??0})).sort((a,b)=>b.v-a.v);
  const rank=Math.max(0,ranked.findIndex(x=>x.p===r.p));const roleRank=ranked.length>1?rank/(ranked.length-1):0;
  let samePosScratchToi=0,allScratchToi=0,samePosScratchCount=0,scratchCount=0,overlap=0;
  for(const sid of scratchSet){
    const sp=state.get(sid);if(!sp||sp.team!==r.team)continue;const st=baseToi(sp);if(st==null)continue;
    scratchCount++;allScratchToi+=st;if((sp.pos==="D")===(r.pos==="D")){samePosScratchCount++;samePosScratchToi+=st;}
    const sec=pairState.get(pairKey(r.p,sid))||0;overlap+=sec;
  }
  const sr=rate60(p)??0,defense=r.pos==="D"?1:0,overlapShare=clamp(overlap/Math.max(1,p.toi),0,1);
  const pResp=responseState.player.get(r.p)||{n:0,sum:0};
  const tpResp=responseState.teamPos.get(r.team+"|"+(defense?"D":"F"))||{n:0,sum:0};
  const multiResp=responseState.multi.get(r.team+"|"+(defense?"D":"F"))||{n:0,sum:0};
  let affinityN=0,affinitySum=0;
  for(const sid of scratchSet){
    const a=responseState.specific.get(r.p+"|"+sid);
    if(a?.n){affinityN+=a.n;affinitySum+=a.sum;}
  }
  const playerScratchDeltaAvg=pResp.n?pResp.sum/pResp.n:0;
  const teamPosScratchDeltaAvg=tpResp.n?tpResp.sum/tpResp.n:0;
  const specificReplacementAffinity=affinityN?affinitySum/affinityN:0;
  const multiScratchDeltaAvg=multiResp.n?multiResp.sum/multiResp.n:0;
  return [bt,recent,season,stab,roleRank,samePosScratchToi,allScratchToi,samePosScratchCount,scratchCount,overlapShare,sr,defense,bt*samePosScratchToi/1000,roleRank*scratchCount,playerScratchDeltaAvg,teamPosScratchDeltaAvg,specificReplacementAffinity,multiScratchDeltaAvg];
}
function makeRows(){
  const state=new Map(),pairState=new Map(),responseState={player:new Map(),teamPos:new Map(),specific:new Map(),multi:new Map()},rows=[];
  for(const gm of games){
    const roster=rosters.get(gm.g)||[],scratch=scratches.get(gm.g)||new Set(),eligible=roster.filter(x=>!scratch.has(x.p)&&x.pos!=="G");
    const byTeam=new Map();for(const r of eligible){if(!byTeam.has(r.team))byTeam.set(r.team,[]);byTeam.get(r.team).push(r);}
    for(const r of eligible){
      const p=state.get(r.p),a=actual.get(gm.g+"|"+r.p);if(!p||!a)continue;
      const f=rowFeatures(r,p,byTeam.get(r.team)||[],scratch,state,pairState,responseState);if(!f)continue;
      const actualToi=shiftGame.get(gm.g+"|"+r.p)??a.toi;if(actualToi==null||actualToi<120)continue;
      rows.push({season:gm.season,gameId:gm.g,player:r.p,team:r.team,pos:r.pos,x:f,y:actualToi,actualSog:a.shots,baseToi:baseToi(p),baseSog:baseSog(p),shotRate60:rate60(p)});
    }
    // Learn who historically absorbs workload when teammates are scratched.
    // Update only after this game's prediction is frozen.
    const scratchedByTeam=new Map();
    for(const sid of scratch){
      const sp=state.get(sid);if(!sp?.team)continue;
      if(!scratchedByTeam.has(sp.team))scratchedByTeam.set(sp.team,[]);
      scratchedByTeam.get(sp.team).push({sid,pos:sp.pos==="D"?"D":"F"});
    }
    for(const r of eligible){
      const a=actual.get(gm.g+"|"+r.p),p=state.get(r.p);if(!a||!p)continue;
      const actualToi=shiftGame.get(gm.g+"|"+r.p)??a.toi,bt=baseToi(p);
      if(actualToi==null||bt==null)continue;
      const delta=actualToi-bt,scr=(scratchedByTeam.get(r.team)||[]);
      if(!scr.length)continue;
      const add=(map,key)=>{const v=map.get(key)||{n:0,sum:0};v.n++;v.sum+=delta;map.set(key,v);};
      add(responseState.player,r.p);
      const posGroup=r.pos==="D"?"D":"F";
      add(responseState.teamPos,r.team+"|"+posGroup);
      if(scr.length>=2)add(responseState.multi,r.team+"|"+posGroup);
      for(const s of scr)if(s.pos===posGroup)add(responseState.specific,r.p+"|"+s.sid);
    }

    for(const r of roster){const a=actual.get(gm.g+"|"+r.p);if(!a)continue;let p=state.get(r.p);if(!p){p=blank();state.set(r.p,p);}
      const sec=shiftGame.get(gm.g+"|"+r.p)??a.toi;p.gp++;p.team=r.team;p.pos=r.pos||a.pos||p.pos;p.shots+=a.shots;if(sec!=null&&sec>0){p.toi+=sec;push(p.recentToi,sec);}push(p.recentShots,a.shots);}
    const pairs=pairGame.get(gm.g);if(pairs)for(const [k,v] of pairs)pairState.set(k,(pairState.get(k)||0)+v);
  }
  return rows;
}
const rows=makeRows(),discovery=years[0],validation=years[1],confirmation=years[2];

function standardizer(xs){
  const d=xs[0].length,mu=[],sig=[];for(let j=0;j<d;j++){const a=xs.map(x=>x[j]);mu[j]=mean(a);sig[j]=sd(a)||1;}
  return{x:(x)=>x.map((v,j)=>(v-mu[j])/sig[j]),mu,sig};
}
function solve(A,b){
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<n;i++){let p=i;for(let k=i+1;k<n;k++)if(Math.abs(M[k][i])>Math.abs(M[p][i]))p=k;[M[i],M[p]]=[M[p],M[i]];
    const div=M[i][i]||1e-9;for(let j=i;j<=n;j++)M[i][j]/=div;
    for(let k=0;k<n;k++)if(k!==i){const f=M[k][i];for(let j=i;j<=n;j++)M[k][j]-=f*M[i][j];}}
  return M.map(r=>r[n]);
}
function fit(train,lambda){
  const sc=standardizer(train.map(r=>r.x)),X=train.map(r=>[1,...sc.x(r.x)]),y=train.map(r=>r.y),d=X[0].length;
  const A=Array.from({length:d},()=>Array(d).fill(0)),b=Array(d).fill(0);
  for(let i=0;i<X.length;i++)for(let j=0;j<d;j++){b[j]+=X[i][j]*y[i];for(let k=0;k<d;k++)A[j][k]+=X[i][j]*X[i][k];}
  for(let j=1;j<d;j++)A[j][j]+=lambda;
  const w=solve(A,b);return{predict:r=>clamp(w[0]+sc.x(r.x).reduce((s,v,j)=>s+v*w[j+1],0),180,2100),w,sc,lambda};
}
function metrics(rs,model,sogBlend=1){
  if(!rs.length)return{n:0};let tae=0,btae=0,sae=0,bsae=0,se=0,bse=0;
  for(const r of rs){const pt=model.predict(r),bs=r.baseToi,base=r.baseSog??0,toiSog=(r.shotRate60??0)*(pt/3600),ps=base+sogBlend*(toiSog-base);
    tae+=Math.abs(pt-r.y);btae+=Math.abs(bs-r.y);sae+=Math.abs(ps-r.actualSog);bsae+=Math.abs(base-r.actualSog);se+=(pt-r.y)**2;bse+=(bs-r.y)**2;}
  return{n:rs.length,baselineToiMae:round(btae/rs.length),modelToiMae:round(tae/rs.length),toiMaeGain:round((btae-tae)/rs.length),
    baselineSogMae:round(bsae/rs.length),modelSogMae:round(sae/rs.length),sogMaeGain:round((bsae-sae)/rs.length),
    baselineToiRmse:round(Math.sqrt(bse/rs.length)),modelToiRmse:round(Math.sqrt(se/rs.length))};
}
const disc=rows.filter(r=>r.season===discovery),cut=Math.floor(disc.length*.7),fitRows=disc.slice(0,cut),tune=disc.slice(cut);
let best=null;for(const lambda of [0,.01,.1,1,10,100,500]){const m=fit(fitRows,lambda),met=metrics(tune,m);if(!best||met.modelToiMae<best.met.modelToiMae)best={lambda,met};}
const prelim=fit(fitRows,best.lambda);
let bestSog={weight:0,mae:Infinity};
for(const weight of [0,.05,.10,.15,.20,.25,.35,.50,.75,1]){
  const m=metrics(tune,prelim,weight);if(m.modelSogMae<bestSog.mae)bestSog={weight,mae:m.modelSogMae};
}
const model=fit(disc,best.lambda),sogBlend=bestSog.weight;
const bySeason=Object.fromEntries(years.map(y=>[y,metrics(rows.filter(r=>r.season===y),model,sogBlend)]));
const val=bySeason[validation],conf=bySeason[confirmation];
const eligible=val.toiMaeGain>0&&conf.toiMaeGain>0&&val.sogMaeGain>0&&conf.sogMaeGain>0;
const artifact={modelId:"NHL-DEPLOY-v1",version:"research-v1.2-replacement-hierarchy",featureNames:FEATURE_NAMES,lambda:best.lambda,sogBlend,
  mean:model.sc.mu.map(x=>round(x,8)),sd:model.sc.sig.map(x=>round(x,8)),weights:model.w.map(x=>round(x,8)),validated:eligible};
const report={modelId:"NHL-DEPLOY-v1",version:artifact.version,generatedAt:new Date().toISOString(),marketInformed:false,pointInTime:true,
  architecture:"Ridge deployment model using prior workload, recent workload/stability, role rank, position, same-position scratches, total scratch burden, historical co-shift overlap, player-specific historical scratch response, team/position replacement response, specific player-for-scratch affinity, multi-scratch interaction, shot-rate/60 and interactions; downstream SOG adjustment weight selected on discovery only.",
  seasonMap:{discovery,validation,confirmation},selection:{lambda:best.lambda,sogBlend,tuneMetrics:best.met},counts:{rows:rows.length,discovery:disc.length},
  bySeason,promotion:{historicalEligible:eligible,canAlterPlayerProjection:false,canAlterGameProjection:false,canQualify:false,canAuthorizeWager:false},
  integrity:{targetGameToiUsedAsOutcomeOnly:true,targetGameShotsUsedAsOutcomeOnly:true,targetGameScratchesPregame:true,priorShiftNetworkOnly:true,lambdaSelectedOnDiscoveryOnly:true,validationAndConfirmationUntouchedForSelection:true},
  artifact};
await mkdir(out.split("/").slice(0,-1).join("/")||".",{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
