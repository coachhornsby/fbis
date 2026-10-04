import {readFileSync,writeFileSync,mkdirSync} from "node:fs";

const rows=JSON.parse(readFileSync(process.argv[2]||"artifacts/cbb-fbis-native-v2-predictions.json","utf8"));
const fit=JSON.parse(readFileSync(process.argv[3]||"artifacts/cbb-fbis-v2-fit.json","utf8"));
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const get=(o,p)=>p.split(".").reduce((a,k)=>a==null?null:a[k],o);
const round=(v,d=4)=>v==null?null:Number(Number(v).toFixed(d));

function predictFrozen(m,r){
  if(!m)return null;
  const vals=m.features.map(p=>featureValue(r,p));
  let y=m.intercept;
  for(let j=0;j<vals.length;j++)y+=m.beta[j]*(vals[j]-m.means[j])/m.sds[j];
  return y;
}
function corrected(r,kind){
  if(kind==="side") return r.fbis.margin + predictFrozen(fit.margin.model,r);
  return r.fbis.total + predictFrozen(fit.total.model,r);
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

let activeKind="side";
function featureValue(r,p){
  const isSide=activeKind==="side";
  const market=isSide?n(r.market?.spread):n(r.market?.overUnder);
  const open=isSide?n(r.market?.openingSpread):n(r.market?.openingOverUnder);
  const corr=corrected(r,activeKind);
  const raw=isSide?n(r.fbis?.margin):n(r.fbis?.total);
  const kp=isSide?n(r.kenpom?.margin):n(r.kenpom?.total);
  const marketProjection=isSide?(market==null?null:-market):market;
  const hs=n(r.fbis?.schedule?.home?.sos)??0,as=n(r.fbis?.schedule?.away?.sos)??0;
  const hc=n(r.fbis?.schedule?.home?.conferenceStrength)??0,ac=n(r.fbis?.schedule?.away?.conferenceStrength)??0;
  switch(p){
    case "derived.corrected": return corr??0;
    case "derived.rawFbis": return raw??0;
    case "derived.kenpom": return kp??0;
    case "derived.market": return marketProjection??0;
    case "derived.fbisMarket": return corr!=null&&marketProjection!=null?corr-marketProjection:0;
    case "derived.kenpomMarket": return kp!=null&&marketProjection!=null?kp-marketProjection:0;
    case "derived.fbisKenpom": return corr!=null&&kp!=null?corr-kp:0;
    case "derived.absFbisKenpom": return corr!=null&&kp!=null?Math.abs(corr-kp):0;
    case "derived.lineMove": return market!=null&&open!=null?market-open:0;
    case "derived.absLineMove": return market!=null&&open!=null?Math.abs(market-open):0;
    case "derived.sosGap": return hs-as;
    case "derived.confGap": return hc-ac;
    default:return n(get(r,p))??0;
  }
}
function vec(r){return features.map(p=>featureValue(r,p))}
function solve(A,b){const m=A.map((r,i)=>[...r,b[i]]),N=m.length;for(let i=0;i<N;i++){let p=i;for(let j=i+1;j<N;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;[m[i],m[p]]=[m[p],m[i]];const d=m[i][i]||1e-12;for(let k=i;k<=N;k++)m[i][k]/=d;for(let j=0;j<N;j++){if(j===i)continue;const q=m[j][i];for(let k=i;k<=N;k++)m[j][k]-=q*m[i][k]}}return m.map(r=>r[N])}
function fitRidge(rs,target,lambda){
  const X=rs.map(vec),y=rs.map(target),p=features.length,means=Array(p).fill(0),sds=Array(p).fill(1);
  for(let j=0;j<p;j++){means[j]=X.reduce((s,x)=>s+x[j],0)/X.length;const v=X.reduce((s,x)=>s+(x[j]-means[j])**2,0)/Math.max(1,X.length-1);sds[j]=Math.sqrt(v)||1}
  const ym=y.reduce((s,x)=>s+x,0)/y.length,A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);
  for(let i=0;i<X.length;i++){const z=X[i].map((x,j)=>(x-means[j])/sds[j]),yy=y[i]-ym;for(let a=0;a<p;a++){b[a]+=z[a]*yy;for(let q=0;q<p;q++)A[a][q]+=z[a]*z[q]}}
  for(let j=0;j<p;j++)A[j][j]+=lambda;return{features,means,sds,beta:solve(A,b),intercept:ym,lambda};
}
function predict(m,r){const x=vec(r);let y=m.intercept;for(let j=0;j<x.length;j++)y+=m.beta[j]*(x[j]-m.means[j])/m.sds[j];return y}
function target(r,kind){
  return kind==="side"?(r.actualHome-r.actualAway)+n(r.market?.spread):(r.actualHome+r.actualAway)-n(r.market?.overUnder);
}
function eligible(rs,kind){return rs.filter(r=>kind==="side"?n(r.market?.spread)!=null:n(r.market?.overUnder)!=null)}
function selectLambda(train,kind){
  activeKind=kind;const lambdas=[.1,1,10,100,1000,10000],seasons=[2018,2019,2020,2021,2022];let best=null;
  for(const lambda of lambdas){let se=0,c=0;for(const s of seasons){const tr=train.filter(r=>r.season!==s),te=train.filter(r=>r.season===s);if(!tr.length||!te.length)continue;const m=fitRidge(tr,r=>target(r,kind),lambda);for(const r of te){const e=target(r,kind)-predict(m,r);se+=e*e;c++}}const rmse=Math.sqrt(se/Math.max(1,c));if(!best||rmse<best.rmse)best={lambda,rmse}}
  return best;
}
function betEval(rs,kind,m,threshold){
  activeKind=kind;let bets=0,w=0,l=0,push=0,u=0,move=0,moveN=0;
  for(const r of eligible(rs,kind)){
    const pred=predict(m,r);if(Math.abs(pred)<threshold)continue;
    const actual=target(r,kind),dir=Math.sign(pred);bets++;
    if(kind==="side"){const sp=n(r.market?.spread),op=n(r.market?.openingSpread);if(sp!=null&&op!=null){move+=dir*(-sp-(-op));moveN++}}
    else {const ln=n(r.market?.overUnder),op=n(r.market?.openingOverUnder);if(ln!=null&&op!=null){move+=dir*(ln-op);moveN++}}
    if(actual===0){push++;continue}if(Math.sign(actual)===dir){w++;u+=100/110}else{l++;u-=1}
  }
  return{n:bets,w,l,push,winPct:w+l?round(100*w/(w+l),2):null,units:round(u,3),roi:bets?round(100*u/bets,2):null,moveTowardBet:moveN?round(move/moveN,3):null,moveN};
}
function chooseThreshold(train,kind,m){
  const candidates=[1,1.5,2,2.5,3,4,5,6,8,10];let best=null;
  for(const t of candidates){const e=betEval(train,kind,m,t);if(e.n<300)continue;const score=(e.roi??-999)-Math.max(0,400-e.n)*0.01;if(!best||score>best.score)best={threshold:t,score,...e}}
  return best;
}
function monotonic(rs,kind,m){
  const ts=[1,2,3,4,5,6,8,10];return ts.map(t=>({threshold:t,...betEval(rs,kind,m,t)}));
}
const discovery=rows.filter(r=>r.season<=2022),validation=rows.filter(r=>r.season===2023||r.season===2024),secondary=rows.filter(r=>r.season===2025);
const out={id:"CBB-MONEY-SELECTOR-v1",generatedAt:new Date().toISOString(),training:"2018-22 only",validation:"2023-24",secondary:"2025 (not untouched; previously inspected)",automaticWagerAuthorization:false,models:{}};
for(const kind of ["side","total"]){
  activeKind=kind;const tr=eligible(discovery,kind),best=selectLambda(tr,kind),m=fitRidge(tr,r=>target(r,kind),best.lambda),th=chooseThreshold(tr,kind,m);
  out.models[kind]={lambdaSelection:best,thresholdSelection:th,model:{features:m.features,means:m.means.map(x=>round(x,8)),sds:m.sds.map(x=>round(x,8)),beta:m.beta.map(x=>round(x,8)),intercept:round(m.intercept,8),lambda:m.lambda},
    discovery:betEval(discovery,kind,m,th.threshold),validation:betEval(validation,kind,m,th.threshold),secondary2025:betEval(secondary,kind,m,th.threshold),
    monotonic:{discovery:monotonic(discovery,kind,m),validation:monotonic(validation,kind,m),secondary2025:monotonic(secondary,kind,m)}};
}
activeKind="side";
const sideDislocation={threshold:10,rule:"abs(corrected FBIS margin - market-implied home margin) >= 10",discovery:null,validation:null,secondary2025:null};
function dislocationEval(rs){
 let nBet=0,w=0,l=0,push=0,u=0;
 for(const r of eligible(rs,"side")){const marketMargin=-n(r.market.spread),corr=corrected(r,"side"),edge=corr-marketMargin;if(Math.abs(edge)<10)continue;const actual=target(r,"side"),dir=Math.sign(edge);nBet++;if(actual===0){push++;continue}if(Math.sign(actual)===dir){w++;u+=100/110}else{l++;u-=1}}
 return{n:nBet,w,l,push,winPct:w+l?round(100*w/(w+l),2):null,units:round(u,3),roi:nBet?round(100*u/nBet,2):null};
}
sideDislocation.discovery=dislocationEval(discovery);sideDislocation.validation=dislocationEval(validation);sideDislocation.secondary2025=dislocationEval(secondary);
out.sideDislocation=sideDislocation;
out.governance={sideDislocationStatus:"prospective-challenger",thresholdFrozenNow:true,thresholdSelectedPostHocPreviously:true,requires2026_27ProspectiveConfirmation:true,trueClvRequired:true,positiveClvAndRoiRequiredForPromotion:true};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-money-selector-v1.json",JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));