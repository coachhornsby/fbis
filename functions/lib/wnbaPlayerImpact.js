export const WNBA_PLAYER_IMPACT_MODEL_ID="WNBA-FBIS-PLAYER-IMPACT-v1";
export const WNBA_PLAYER_IMPACT_VERSION="research-v1";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};

export const WNBA_DYNAMIC_HALF_LIVES=Object.freeze({
  minutes:10,usage:14,pointsPer40:16,reboundsPer40:20,assistsPer40:18,
  threesPer40:22,turnoversPer40:18,stealsPer40:28,blocksPer40:28,trueShooting:30,
});

function weighted(rows,getter,halfLife=18,asOf=null){
  let num=0,den=0;
  const t0=asOf?Date.parse(asOf):Math.max(...rows.map(r=>Date.parse(r.date||r.start||0)).filter(Number.isFinite),0);
  for(const r of rows){
    const v=finite(getter(r));if(v==null)continue;
    const t=Date.parse(r.date||r.start||0);
    const age=Number.isFinite(t)&&t0?Math.max(0,(t0-t)/86400000):0;
    const w=Math.pow(.5,age/Math.max(1,halfLife));
    num+=v*w;den+=w;
  }
  return den?num/den:null;
}
const per40=(r,key)=>{const m=finite(r.minutes),v=finite(r[key]);return m&&m>0&&v!=null?40*v/m:null};
const usageProxy=r=>{
  const m=finite(r.minutes),fga=finite(r.fga),fta=finite(r.fta),tov=finite(r.turnovers);
  return !m||fga==null||fta==null||tov==null?null:(fga+.44*fta+tov)*40/m;
};
const ts=r=>{
  const pts=finite(r.points),fga=finite(r.fga),fta=finite(r.fta);
  if(pts==null||fga==null||fta==null)return null;
  const den=2*(fga+.44*fta);return den>0?pts/den:null;
};

export function buildWnbaDynamicSkill(history=[],{asOf=null}={}){
  const rows=(history||[]).filter(r=>finite(r.minutes)>0&&(!asOf||Date.parse(r.date||r.start)<Date.parse(asOf)));
  if(!rows.length)return null;
  return {
    games:rows.length,
    minutes:round(weighted(rows,r=>r.minutes,WNBA_DYNAMIC_HALF_LIVES.minutes,asOf)),
    usage:round(weighted(rows,usageProxy,WNBA_DYNAMIC_HALF_LIVES.usage,asOf)),
    pointsPer40:round(weighted(rows,r=>per40(r,"points"),WNBA_DYNAMIC_HALF_LIVES.pointsPer40,asOf)),
    reboundsPer40:round(weighted(rows,r=>per40(r,"rebounds"),WNBA_DYNAMIC_HALF_LIVES.reboundsPer40,asOf)),
    assistsPer40:round(weighted(rows,r=>per40(r,"assists"),WNBA_DYNAMIC_HALF_LIVES.assistsPer40,asOf)),
    threesPer40:round(weighted(rows,r=>per40(r,"threes"),WNBA_DYNAMIC_HALF_LIVES.threesPer40,asOf)),
    turnoversPer40:round(weighted(rows,r=>per40(r,"turnovers"),WNBA_DYNAMIC_HALF_LIVES.turnoversPer40,asOf)),
    stealsPer40:round(weighted(rows,r=>per40(r,"steals"),WNBA_DYNAMIC_HALF_LIVES.stealsPer40,asOf)),
    blocksPer40:round(weighted(rows,r=>per40(r,"blocks"),WNBA_DYNAMIC_HALF_LIVES.blocksPer40,asOf)),
    trueShooting:round(weighted(rows,ts,WNBA_DYNAMIC_HALF_LIVES.trueShooting,asOf)),
  };
}
const z=(v,c,s)=>{const n=finite(v);return n==null?0:(n-c)/s};
export function wnbaBoxImpactPrior(skill={}){
  if(!skill)return null;
  // WNBA-specific SPM-style research prior. No proprietary EPM/DARKO formula is copied.
  const off=
    1.00*z(skill.pointsPer40,17.5,7)+
    .74*z(skill.assistsPer40,4.0,3)+
    .56*z(skill.trueShooting,.555,.065)+
    .25*z(skill.threesPer40,1.5,1.3)-
    .46*z(skill.turnoversPer40,2.5,1.3);
  const def=
    .60*z(skill.stealsPer40,1.5,.8)+
    .55*z(skill.blocksPer40,.8,.8)+
    .26*z(skill.reboundsPer40,7.5,3.6);
  const rolePenalty=skill.minutes==null?0:clamp((16-skill.minutes)/16,0,1)*.30;
  return {
    offense:round(clamp(off-rolePenalty,-6,8)),
    defense:round(clamp(def-rolePenalty*.5,-5,6)),
    net:round(clamp(off+def-rolePenalty*1.5,-9,12)),
    source:"FBIS_WNBA_SPM_STYLE_PRIOR",
    proprietaryMetricUsed:false,
  };
}
export function wnbaBoxDiagnostics(skill={}){
  const prior=wnbaBoxImpactPrior(skill);if(!prior)return null;
  const minutes=finite(skill.minutes)||0;
  const replacement=-2;
  const bpmStyle=prior.net;
  const vorpStyle=(bpmStyle-replacement)*minutes/40;
  const ws48Style=clamp(.100+.032*(.45*z(skill.trueShooting,.555,.065)+.20*z(skill.reboundsPer40,7.5,3.6)+.22*z(skill.assistsPer40,4,3)-.18*z(skill.turnoversPer40,2.5,1.3)),0,.35);
  return {bpmStyle:round(bpmStyle),vorpStylePerGame:round(vorpStyle),ws48Style:round(ws48Style)};
}

function collectPlayers(stints=[]){
  const s=new Set();
  for(const x of stints)for(const p of [...(x.homePlayers||[]),...(x.awayPlayers||[])])s.add(String(p));
  return [...s].sort();
}
export function fitWnbaRapm(stints=[],{priorByPlayer={},lambda=720,priorStrength=.40,iterations=70,tolerance=1e-5}={}){
  const valid=(stints||[]).filter(s=>finite(s.possessions)>0&&finite(s.pointDifferential)!=null&&(s.homePlayers||[]).length===5&&(s.awayPlayers||[]).length===5);
  const players=collectPlayers(valid),idx=new Map(players.map((p,i)=>[p,i]));
  const beta=players.map(p=>(finite(priorByPlayer?.[p]?.net)||0)*priorStrength),prior=beta.slice();
  if(!valid.length||!players.length)return {players:{},stints:0,lambda,iterations:0};
  const rows=valid.map(s=>{
    const x=[];
    for(const p of s.homePlayers)if(idx.has(String(p)))x.push([idx.get(String(p)),1]);
    for(const p of s.awayPlayers)if(idx.has(String(p)))x.push([idx.get(String(p)),-1]);
    return{x,y:100*Number(s.pointDifferential)/Number(s.possessions),w:Number(s.possessions)};
  });
  const by=players.map(()=>[]),pred=rows.map(()=>0);
  rows.forEach((r,ri)=>{for(const [k,x] of r.x){by[k].push([ri,x]);pred[ri]+=x*beta[k]}});
  let used=0;
  for(let it=0;it<iterations;it++){
    let max=0;
    for(let j=0;j<players.length;j++){
      let num=lambda*prior[j],den=lambda;
      for(const [ri,xj] of by[j]){
        const r=rows[ri],partial=r.y-(pred[ri]-xj*beta[j]);
        num+=r.w*xj*partial;den+=r.w*xj*xj;
      }
      const next=den?num/den:beta[j],delta=next-beta[j];
      if(delta)for(const [ri,xj] of by[j])pred[ri]+=xj*delta;
      beta[j]=next;max=Math.max(max,Math.abs(delta));
    }
    used=it+1;if(max<tolerance)break;
  }
  const out={};
  for(const [p,i] of idx){
    const p0=priorByPlayer?.[p]||{},net=clamp(beta[i],-12,15);
    const po=finite(p0.offense)||0,pd=finite(p0.defense)||0;
    const share=clamp(Math.abs(po)/(Math.abs(po)+Math.abs(pd)||1),.2,.8);
    const resid=net-(finite(p0.net)||0);
    out[p]={net:round(net),offense:round(clamp(po+resid*share,-8,12)),defense:round(clamp(pd+resid*(1-share),-7,9)),priorNet:round(p0.net||0)};
  }
  return {players:out,stints:valid.length,lambda,iterations:used};
}

export function combineWnbaPlayerImpact({playerId,history=[],rapm=null,asOf=null}={}){
  const skill=buildWnbaDynamicSkill(history,{asOf});
  if(!skill)return {ok:false,reason:"history_missing",playerId:String(playerId||"")};
  const prior=wnbaBoxImpactPrior(skill),r=rapm?.players?.[String(playerId)]||null;
  const w=clamp((rapm?.stints||0)/((rapm?.stints||0)+900),0,.62);
  const blend=(a,b)=>r?round(a*(1-w)+b*w):round(a);
  return {
    ok:true,modelId:WNBA_PLAYER_IMPACT_MODEL_ID,version:WNBA_PLAYER_IMPACT_VERSION,playerId:String(playerId),
    offense:blend(prior.offense,r?.offense),defense:blend(prior.defense,r?.defense),net:blend(prior.net,r?.net),
    skill,prior,rapm:r?{...r,weight:round(w)}:null,diagnostics:wnbaBoxDiagnostics(skill),
    governance:{marketUsed:false,proprietaryMetricRequired:false,externalBenchmarksResearchOnly:true}
  };
}
