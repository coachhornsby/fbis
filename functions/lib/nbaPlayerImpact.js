export const NBA_PLAYER_IMPACT_MODEL_ID="NBA-FBIS-PLAYER-IMPACT-v1";
export const NBA_PLAYER_IMPACT_VERSION="research-v1";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const sd=xs=>{if(xs.length<2)return null;const m=mean(xs);return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1))};
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};
const safeDiv=(a,b)=>{const x=finite(a),y=finite(b);return x==null||y==null||y===0?null:x/y};

export const DYNAMIC_SKILL_HALF_LIVES=Object.freeze({
  minutes:12,usage:16,pointsPer36:18,reboundsPer36:24,assistsPer36:20,
  threesPer36:28,turnoversPer36:20,stealsPer36:36,blocksPer36:36,
  trueShooting:36,offensiveReboundRate:40,
});

function weighted(rows,getter,halfLife=20,asOf=null){
  let num=0,den=0;
  const t0=asOf?Date.parse(asOf):Math.max(...rows.map(r=>Date.parse(r.date||r.start||0)).filter(Number.isFinite),0);
  for(const r of rows){
    const v=finite(getter(r));if(v==null)continue;
    const t=Date.parse(r.date||r.start||0);
    const ageDays=Number.isFinite(t)&&t0?Math.max(0,(t0-t)/86400000):0;
    const w=Math.pow(.5,ageDays/Math.max(1,halfLife));
    num+=v*w;den+=w;
  }
  return den?num/den:null;
}
function per36(r,key){
  const m=finite(r.minutes),v=finite(r[key]);return m&&m>0&&v!=null?36*v/m:null;
}
function usageProxy(r){
  const m=finite(r.minutes),fga=finite(r.fga),fta=finite(r.fta),tov=finite(r.turnovers);
  if(!m||m<=0||fga==null||fta==null||tov==null)return null;
  return (fga+.44*fta+tov)*36/m;
}
function ts(r){
  const pts=finite(r.points),fga=finite(r.fga),fta=finite(r.fta);
  if(pts==null||fga==null||fta==null)return null;
  const den=2*(fga+.44*fta);return den>0?pts/den:null;
}

export function buildDynamicSkillProfile(history=[],{asOf=null}={}){
  const rows=(history||[]).filter(r=>finite(r.minutes)>0&&(!asOf||Date.parse(r.date||r.start)<Date.parse(asOf)));
  if(!rows.length)return null;
  const skill={
    games:rows.length,
    minutes:weighted(rows,r=>r.minutes,DYNAMIC_SKILL_HALF_LIVES.minutes,asOf),
    usage:weighted(rows,usageProxy,DYNAMIC_SKILL_HALF_LIVES.usage,asOf),
    pointsPer36:weighted(rows,r=>per36(r,"points"),DYNAMIC_SKILL_HALF_LIVES.pointsPer36,asOf),
    reboundsPer36:weighted(rows,r=>per36(r,"rebounds"),DYNAMIC_SKILL_HALF_LIVES.reboundsPer36,asOf),
    assistsPer36:weighted(rows,r=>per36(r,"assists"),DYNAMIC_SKILL_HALF_LIVES.assistsPer36,asOf),
    threesPer36:weighted(rows,r=>per36(r,"threes"),DYNAMIC_SKILL_HALF_LIVES.threesPer36,asOf),
    turnoversPer36:weighted(rows,r=>per36(r,"turnovers"),DYNAMIC_SKILL_HALF_LIVES.turnoversPer36,asOf),
    stealsPer36:weighted(rows,r=>per36(r,"steals"),DYNAMIC_SKILL_HALF_LIVES.stealsPer36,asOf),
    blocksPer36:weighted(rows,r=>per36(r,"blocks"),DYNAMIC_SKILL_HALF_LIVES.blocksPer36,asOf),
    trueShooting:weighted(rows,ts,DYNAMIC_SKILL_HALF_LIVES.trueShooting,asOf),
    offensiveReboundsPer36:weighted(rows,r=>per36(r,"offensiveRebounds"),DYNAMIC_SKILL_HALF_LIVES.offensiveReboundRate,asOf),
  };
  return Object.fromEntries(Object.entries(skill).map(([k,v])=>[k,k==="games"?v:round(v)]));
}

function z(v,center,scale){const n=finite(v);return n==null?0:(n-center)/scale;}
export function boxImpactPrior(skill={}){
  if(!skill)return null;
  // SPM-style prior. Coefficients are research priors, not proprietary EPM/DARKO formulas.
  const off=
    1.10*z(skill.pointsPer36,18,7)+
    0.75*z(skill.assistsPer36,4,3)+
    0.55*z(skill.trueShooting,.575,.06)+
    0.28*z(skill.threesPer36,1.8,1.4)+
    0.22*z(skill.offensiveReboundsPer36,1.8,1.5)-
    0.48*z(skill.turnoversPer36,2.2,1.2);
  const def=
    0.55*z(skill.stealsPer36,1.2,.7)+
    0.52*z(skill.blocksPer36,.8,.8)+
    0.24*z(skill.reboundsPer36,7,3.5);
  const rolePenalty=skill.minutes==null?0:clamp((18-skill.minutes)/18,0,1)*.35;
  return {
    offense:round(clamp(off-rolePenalty,-6,8)),
    defense:round(clamp(def-rolePenalty*.5,-5,6)),
    net:round(clamp(off+def-rolePenalty*1.5,-9,12)),
    source:"FBIS_SPM_STYLE_PRIOR",
    proprietaryMetricUsed:false,
  };
}

export function boxHistoricalDiagnostics(skill={},replacementLevel=-2){
  const prior=boxImpactPrior(skill);if(!prior)return null;
  const minutes=finite(skill.minutes)||0;
  const bpmStyle=prior.net;
  const replacementValuePer48=(bpmStyle-replacementLevel)*minutes/48;
  const efficiencyComponent=
    0.45*z(skill.trueShooting,.575,.06)+
    0.18*z(skill.reboundsPer36,7,3.5)+
    0.22*z(skill.assistsPer36,4,3)-
    0.18*z(skill.turnoversPer36,2.2,1.2);
  const ws48Style=clamp(.100+.035*efficiencyComponent,0,.35);
  return {
    bpmStyle:round(bpmStyle),
    vorpStylePerGame:round(replacementValuePer48),
    ws48Style:round(ws48Style),
    note:"FBIS diagnostics inspired by BPM/VORP/WS concepts; not Basketball-Reference proprietary published values.",
  };
}

export function rawOnOffFromStints(stints=[],playerId){
  const id=String(playerId);
  let onPoss=0,onDiff=0,offPoss=0,offDiff=0;
  for(const s of stints||[]){
    const poss=finite(s.possessions),diff=finite(s.pointDifferential);
    if(!poss||poss<=0||diff==null)continue;
    const home=(s.homePlayers||[]).map(String),away=(s.awayPlayers||[]).map(String);
    const team=String(s.playerTeamById?.[id]||"");
    const isHome=home.includes(id),isAway=away.includes(id),on=isHome||isAway;
    let signed=diff;
    if(isAway)signed=-diff;
    if(!on&&team){
      const teamHome=String(s.homeTeamId||"")===team;
      signed=teamHome?diff:-diff;
    }
    if(on){onPoss+=poss;onDiff+=signed;}
    else if(team){offPoss+=poss;offDiff+=signed;}
  }
  const on100=onPoss?100*onDiff/onPoss:null,off100=offPoss?100*offDiff/offPoss:null;
  return {onPossessions:onPoss,offPossessions:offPoss,onNet100:round(on100),offNet100:round(off100),onOff100:on100!=null&&off100!=null?round(on100-off100):null};
}

function collectPlayers(stints=[]){
  const set=new Set();
  for(const s of stints){for(const x of [...(s.homePlayers||[]),...(s.awayPlayers||[])])set.add(String(x))}
  return [...set].sort();
}
export function fitRegularizedRapm(stints=[],{
  priorByPlayer={},lambda=900,priorStrength=0.35,iterations=80,tolerance=1e-5
}={}){
  const valid=(stints||[]).filter(s=>finite(s.possessions)>0&&finite(s.pointDifferential)!=null&&(s.homePlayers||[]).length===5&&(s.awayPlayers||[]).length===5);
  const players=collectPlayers(valid),index=new Map(players.map((p,i)=>[p,i]));
  const beta=players.map(p=>(finite(priorByPlayer?.[p]?.net)||0)*priorStrength);
  const prior=beta.slice();
  if(!valid.length||!players.length)return {players:{},stints:valid.length,lambda,iterations:0};
  const rows=valid.map(s=>{
    const x=[];
    for(const p of s.homePlayers||[])if(index.has(String(p)))x.push([index.get(String(p)),1]);
    for(const p of s.awayPlayers||[])if(index.has(String(p)))x.push([index.get(String(p)),-1]);
    return {x,y:100*Number(s.pointDifferential)/Number(s.possessions),w:Number(s.possessions)};
  });
  let used=0;
  for(let iter=0;iter<iterations;iter++){
    let maxChange=0;
    for(let j=0;j<players.length;j++){
      let num=lambda*prior[j],den=lambda;
      for(const r of rows){
        const xj=r.x.find(([k])=>k===j)?.[1]||0;if(!xj)continue;
        let pred=0;for(const [k,x] of r.x)pred+=x*beta[k];
        const partial=r.y-(pred-xj*beta[j]);
        num+=r.w*xj*partial;den+=r.w*xj*xj;
      }
      const next=den?num/den:beta[j];
      maxChange=Math.max(maxChange,Math.abs(next-beta[j]));beta[j]=next;
    }
    used=iter+1;if(maxChange<tolerance)break;
  }
  const out={};
  for(const [p,i] of index){
    const p0=priorByPlayer?.[p]||{};
    const net=clamp(beta[i],-12,15);
    const priorOff=finite(p0.offense)||0,priorDef=finite(p0.defense)||0,priorNet=priorOff+priorDef;
    const share=priorNet===0?.65:clamp(priorOff/(Math.abs(priorOff)+Math.abs(priorDef)||1),.2,.8);
    const residual=net-(finite(p0.net)||0);
    out[p]={
      net:round(net),
      offense:round(clamp(priorOff+residual*share,-8,12)),
      defense:round(clamp(priorDef+residual*(1-share),-7,9)),
      priorNet:round(p0.net||0),
    };
  }
  return {players:out,stints:valid.length,lambda,iterations:used};
}

export function combinePlayerImpact({
  playerId,history=[],stints=[],rapm=null,asOf=null,externalBenchmarks=null
}={}){
  const skill=buildDynamicSkillProfile(history,{asOf});
  if(!skill)return {ok:false,reason:"history_missing",playerId:String(playerId||"")};
  const prior=boxImpactPrior(skill);
  const rapmRow=rapm?.players?.[String(playerId)]||null;
  const sample=rapm?.stints||0;
  const rapmWeight=clamp(sample/(sample+1200),0,.62);
  const net=rapmRow?prior.net*(1-rapmWeight)+rapmRow.net*rapmWeight:prior.net;
  const off=rapmRow?prior.offense*(1-rapmWeight)+rapmRow.offense*rapmWeight:prior.offense;
  const def=rapmRow?prior.defense*(1-rapmWeight)+rapmRow.defense*rapmWeight:prior.defense;
  const diagnostics=boxHistoricalDiagnostics(skill);
  const onOff=stints?.length?rawOnOffFromStints(stints,playerId):null;
  return {
    ok:true,modelId:NBA_PLAYER_IMPACT_MODEL_ID,version:NBA_PLAYER_IMPACT_VERSION,playerId:String(playerId),
    offense:round(off),defense:round(def),net:round(net),
    skill,prior,rapm:rapmRow?{...rapmRow,weight:round(rapmWeight)}:null,onOff,diagnostics,
    benchmarks:externalBenchmarks||null,
    governance:{
      marketUsed:false,proprietaryMetricRequired:false,
      externalBenchmarksResearchOnly:Boolean(externalBenchmarks),
      productionEligible:true,
    }
  };
}

export function impactAvailabilityPoints(impact,status="AVAILABLE"){
  const net=finite(impact?.net)||0;
  const minutes=finite(impact?.skill?.minutes)||28;
  const full=clamp(net*minutes/48,-7,7);
  const s=String(status||"AVAILABLE").toUpperCase();
  const miss=s==="OUT"?1:s==="DOUBTFUL"?.8:s==="QUESTIONABLE"?.45:s==="PROBABLE"?.12:0;
  return round(full*miss);
}
