import {readFileSync,writeFileSync,mkdirSync} from "node:fs";

const rows=JSON.parse(readFileSync(process.argv[2]||"artifacts/cbb-fbis-native-v2-predictions.json","utf8"));
const fit=JSON.parse(readFileSync(process.argv[3]||"artifacts/cbb-fbis-v2-fit.json","utf8"));
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const get=(o,p)=>p.split(".").reduce((a,k)=>a==null?null:a[k],o);
const round=(v,d=4)=>v==null?null:Number(Number(v).toFixed(d));
const DISCOVERY_SEASONS=[2018,2019,2020,2021,2022];
const LAMBDAS=[.1,1,10,100,1000,10000];
const THRESHOLDS=[1,1.5,2,2.5,3,4,5,6,8,10];

function solve(A,b){
  const m=A.map((r,i)=>[...r,b[i]]),N=m.length;
  for(let i=0;i<N;i++){
    let p=i;for(let j=i+1;j<N;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;
    [m[i],m[p]]=[m[p],m[i]];
    const d=m[i][i]||1e-12;for(let k=i;k<=N;k++)m[i][k]/=d;
    for(let j=0;j<N;j++){if(j===i)continue;const q=m[j][i];for(let k=i;k<=N;k++)m[j][k]-=q*m[i][k]}
  }
  return m.map(r=>r[N]);
}

function predictFrozen(m,r){
  if(!m)return null;
  const vals=m.features.map(p=>n(get(r,p))??0);
  let y=m.intercept;
  for(let j=0;j<vals.length;j++)y+=m.beta[j]*(vals[j]-m.means[j])/m.sds[j];
  return y;
}
const correctionCache=new WeakMap();
function corrected(r,kind){
  let c=correctionCache.get(r);
  if(!c){c={};correctionCache.set(r,c)}
  if(c[kind]!=null)return c[kind];
  c.side=r.fbis.margin+predictFrozen(fit.margin.model,r);
  c.total=r.fbis.total+predictFrozen(fit.total.model,r);
  return c[kind];
}

const features=[
  "derived.corrected","derived.rawFbis","derived.kenpom","derived.market","derived.fbisMarket","derived.kenpomMarket",
  "derived.fbisKenpom","derived.absFbisKenpom","derived.lineMove","derived.absLineMove","derived.sosGap","derived.confGap",
  "fbis.reliability","fbis.hca","fbis.possessions","fbis.paceAdjustment",
  "fbis.matchup.home.efg","fbis.matchup.away.efg","fbis.matchup.home.twoPt","fbis.matchup.away.twoPt",
  "fbis.matchup.home.threePt","fbis.matchup.away.threePt","fbis.matchup.home.orebVsDrb","fbis.matchup.away.orebVsDrb",
  "fbis.matchup.home.turnover","fbis.matchup.away.turnover","fbis.matchup.home.ftr","fbis.matchup.away.ftr",
  "fbis.schedule.home.sos","fbis.schedule.away.sos","fbis.schedule.home.conferenceStrength","fbis.schedule.away.conferenceStrength"
];

function vectorFor(r,kind){
  const isSide=kind==="side";
  const market=isSide?n(r.market?.spread):n(r.market?.overUnder);
  const open=isSide?n(r.market?.openingSpread):n(r.market?.openingOverUnder);
  const corr=corrected(r,kind);
  const raw=isSide?n(r.fbis?.margin):n(r.fbis?.total);
  const kp=isSide?n(r.kenpom?.margin):n(r.kenpom?.total);
  const marketProjection=isSide?(market==null?null:-market):market;
  const hs=n(r.fbis?.schedule?.home?.sos)??0,as=n(r.fbis?.schedule?.away?.sos)??0;
  const hc=n(r.fbis?.schedule?.home?.conferenceStrength)??0,ac=n(r.fbis?.schedule?.away?.conferenceStrength)??0;
  const derived={
    "derived.corrected":corr??0,
    "derived.rawFbis":raw??0,
    "derived.kenpom":kp??0,
    "derived.market":marketProjection??0,
    "derived.fbisMarket":corr!=null&&marketProjection!=null?corr-marketProjection:0,
    "derived.kenpomMarket":kp!=null&&marketProjection!=null?kp-marketProjection:0,
    "derived.fbisKenpom":corr!=null&&kp!=null?corr-kp:0,
    "derived.absFbisKenpom":corr!=null&&kp!=null?Math.abs(corr-kp):0,
    "derived.lineMove":market!=null&&open!=null?market-open:0,
    "derived.absLineMove":market!=null&&open!=null?Math.abs(market-open):0,
    "derived.sosGap":hs-as,
    "derived.confGap":hc-ac,
  };
  return features.map(p=>Object.prototype.hasOwnProperty.call(derived,p)?derived[p]:(n(get(r,p))??0));
}
function target(r,kind){
  return kind==="side"
    ? (r.actualHome-r.actualAway)+n(r.market?.spread)
    : (r.actualHome+r.actualAway)-n(r.market?.overUnder);
}
function eligible(rs,kind){
  return rs.filter(r=>kind==="side"?n(r.market?.spread)!=null:n(r.market?.overUnder)!=null);
}
function prepare(rs,kind){
  const rr=eligible(rs,kind),X=new Array(rr.length),y=new Float64Array(rr.length),season=new Int32Array(rr.length);
  for(let i=0;i<rr.length;i++){X[i]=vectorFor(rr[i],kind);y[i]=target(rr[i],kind);season[i]=rr[i].season}
  return {rows:rr,X,y,season,kind};
}

function blankStats(p){
  return {n:0,sumY:0,sumX:new Float64Array(p),xy:new Float64Array(p),xx:Array.from({length:p},()=>new Float64Array(p))};
}
function addObservation(st,x,y){
  st.n++;st.sumY+=y;
  const p=x.length;
  for(let a=0;a<p;a++){
    const xa=x[a];st.sumX[a]+=xa;st.xy[a]+=xa*y;
    for(let b=0;b<=a;b++)st.xx[a][b]+=xa*x[b];
  }
}
function addStats(a,b,sign=1){
  const p=a.sumX.length,out=blankStats(p);out.n=a.n+sign*b.n;out.sumY=a.sumY+sign*b.sumY;
  for(let i=0;i<p;i++){
    out.sumX[i]=a.sumX[i]+sign*b.sumX[i];
    out.xy[i]=a.xy[i]+sign*b.xy[i];
    for(let j=0;j<=i;j++)out.xx[i][j]=a.xx[i][j]+sign*b.xx[i][j];
  }
  return out;
}
function discoveryStats(design){
  const p=features.length,total=blankStats(p),bySeason=new Map(DISCOVERY_SEASONS.map(s=>[s,blankStats(p)]));
  for(let i=0;i<design.rows.length;i++){
    const s=design.season[i],st=bySeason.get(s);if(!st)continue;
    addObservation(total,design.X[i],design.y[i]);addObservation(st,design.X[i],design.y[i]);
  }
  return {total,bySeason};
}
function modelFromStats(st,lambda){
  const p=features.length,N=st.n,means=Array(p),sds=Array(p),ym=st.sumY/N;
  for(let j=0;j<p;j++){
    means[j]=st.sumX[j]/N;
    const ss=st.xx[j][j]-N*means[j]*means[j];
    sds[j]=Math.sqrt(Math.max(0,ss)/Math.max(1,N-1))||1;
  }
  const A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);
  for(let a=0;a<p;a++){
    b[a]=(st.xy[a]-N*means[a]*ym)/sds[a];
    for(let q=0;q<p;q++){
      const hi=Math.max(a,q),lo=Math.min(a,q);
      const raw=st.xx[hi][lo];
      A[a][q]=(raw-N*means[a]*means[q])/(sds[a]*sds[q]);
    }
    A[a][a]+=lambda;
  }
  return {features,means,sds,beta:solve(A,b),intercept:ym,lambda};
}
function predictX(m,x){
  let y=m.intercept;
  for(let j=0;j<x.length;j++)y+=m.beta[j]*(x[j]-m.means[j])/m.sds[j];
  return y;
}
function predictDesign(m,d){
  const out=new Float64Array(d.rows.length);for(let i=0;i<out.length;i++)out[i]=predictX(m,d.X[i]);return out;
}
function selectLambda(design,stats){
  let best=null;
  for(const lambda of LAMBDAS){
    let se=0,count=0;
    for(const s of DISCOVERY_SEASONS){
      const hold=stats.bySeason.get(s);if(!hold?.n)continue;
      const train=addStats(stats.total,hold,-1),m=modelFromStats(train,lambda);
      for(let i=0;i<design.rows.length;i++)if(design.season[i]===s){const e=design.y[i]-predictX(m,design.X[i]);se+=e*e;count++}
    }
    const rmse=Math.sqrt(se/Math.max(1,count));
    if(!best||rmse<best.rmse)best={lambda,rmse};
  }
  return best;
}
function oofPredictions(design,stats,lambda){
  const pred=new Float64Array(design.rows.length);
  for(const s of DISCOVERY_SEASONS){
    const hold=stats.bySeason.get(s);if(!hold?.n)continue;
    const m=modelFromStats(addStats(stats.total,hold,-1),lambda);
    for(let i=0;i<design.rows.length;i++)if(design.season[i]===s)pred[i]=predictX(m,design.X[i]);
  }
  return pred;
}
function betEvalPrepared(design,pred,threshold,withMovement=true){
  let bets=0,w=0,l=0,push=0,u=0,move=0,moveN=0;
  for(let i=0;i<design.rows.length;i++){
    const p=pred[i];if(Math.abs(p)<threshold)continue;
    const r=design.rows[i],actual=design.y[i],dir=Math.sign(p);bets++;
    if(withMovement){
      if(design.kind==="side"){
        const sp=n(r.market?.spread),op=n(r.market?.openingSpread);if(sp!=null&&op!=null){move+=dir*(op-sp);moveN++}
      }else{
        const ln=n(r.market?.overUnder),op=n(r.market?.openingOverUnder);if(ln!=null&&op!=null){move+=dir*(ln-op);moveN++}
      }
    }
    if(actual===0){push++;continue}
    if(Math.sign(actual)===dir){w++;u+=100/110}else{l++;u-=1}
  }
  return {n:bets,w,l,push,winPct:w+l?round(100*w/(w+l),2):null,units:round(u,3),roi:bets?round(100*u/bets,2):null,
    ...(withMovement?{moveTowardBet:moveN?round(move/moveN,3):null,moveN}:{})};
}
function chooseThreshold(design,oof){
  let best=null;
  for(const threshold of THRESHOLDS){
    const e=betEvalPrepared(design,oof,threshold,false);if(e.n<300)continue;
    const score=(e.roi??-999)-Math.max(0,400-e.n)*0.01;
    if(!best||score>best.score)best={threshold,score,...e,selection:"2018-22 leave-one-season-out"};
  }
  if(!best)best={threshold:10,score:null,...betEvalPrepared(design,oof,10,false),selection:"fallback-10"};
  return best;
}
function clean(m){
  return {features:m.features,means:m.means.map(x=>round(x,8)),sds:m.sds.map(x=>round(x,8)),beta:m.beta.map(x=>round(x,8)),intercept:round(m.intercept,8),lambda:m.lambda};
}
function monotonic(design,pred){return [1,2,3,4,5,6,8,10].map(threshold=>({threshold,...betEvalPrepared(design,pred,threshold)}))}

const discovery=rows.filter(r=>r.season<=2022),validation=rows.filter(r=>r.season===2023||r.season===2024),secondary=rows.filter(r=>r.season===2025);
const out={id:"CBB-MONEY-SELECTOR-v1",generatedAt:new Date().toISOString(),training:"2018-22 only",validation:"2023-24",secondary:"2025 (not untouched; previously inspected)",automaticWagerAuthorization:false,models:{}};

for(const kind of ["side","total"]){
  const d=prepare(discovery,kind),stats=discoveryStats(d),best=selectLambda(d,stats),oof=oofPredictions(d,stats,best.lambda),th=chooseThreshold(d,oof);
  const m=modelFromStats(stats.total,best.lambda),v=prepare(validation,kind),s=prepare(secondary,kind);
  const dp=predictDesign(m,d),vp=predictDesign(m,v),sp=predictDesign(m,s);
  out.models[kind]={
    lambdaSelection:best,thresholdSelection:th,model:clean(m),
    discovery:betEvalPrepared(d,dp,th.threshold),
    validation:betEvalPrepared(v,vp,th.threshold),
    secondary2025:betEvalPrepared(s,sp,th.threshold),
    monotonic:{discovery:monotonic(d,dp),validation:monotonic(v,vp),secondary2025:monotonic(s,sp)}
  };
}

function dislocationEval(rs){
  let nBet=0,w=0,l=0,push=0,u=0;
  for(const r of eligible(rs,"side")){
    const spread=n(r.market?.spread),marketMargin=spread==null?null:-spread,corr=corrected(r,"side");
    if(marketMargin==null||corr==null)continue;
    const edge=corr-marketMargin;if(Math.abs(edge)<10)continue;
    const actual=target(r,"side"),dir=Math.sign(edge);nBet++;
    if(actual===0){push++;continue}
    if(Math.sign(actual)===dir){w++;u+=100/110}else{l++;u-=1}
  }
  return {n:nBet,w,l,push,winPct:w+l?round(100*w/(w+l),2):null,units:round(u,3),roi:nBet?round(100*u/nBet,2):null};
}
out.sideDislocation={
  threshold:10,
  rule:"abs(corrected FBIS margin - market-implied home margin) >= 10",
  discovery:dislocationEval(discovery),
  validation:dislocationEval(validation),
  secondary2025:dislocationEval(secondary)
};
out.governance={
  sideDislocationStatus:"prospective-challenger",
  thresholdFrozenNow:true,
  thresholdSelectedPostHocPreviously:true,
  directSelectorThresholdsSelectedWith2018_22LOSO:true,
  requires2026_27ProspectiveConfirmation:true,
  trueClvRequired:true,
  positiveClvAndRoiRequiredForPromotion:true,
  no2025ClaimsAsUntouched:true
};
mkdirSync("artifacts",{recursive:true});
writeFileSync("artifacts/cbb-money-selector-v1.json",JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
