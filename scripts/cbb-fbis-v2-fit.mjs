import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
const rows=JSON.parse(readFileSync(process.argv[2]||"artifacts/cbb-fbis-native-v2-predictions.json","utf8"));
const round=(v,d=4)=>v==null?null:Number(v.toFixed(d));
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const get=(o,p)=>p.split(".").reduce((a,k)=>a==null?null:a[k],o);
const totalFeatures=["fbis.possessions","fbis.paceAdjustment","fbis.homeEff","fbis.awayEff","fbis.reliability","fbis.hca",
"fbis.matchup.home.efg","fbis.matchup.away.efg","fbis.matchup.home.twoPt","fbis.matchup.away.twoPt","fbis.matchup.home.threePt","fbis.matchup.away.threePt",
"fbis.matchup.home.orebVsDrb","fbis.matchup.away.orebVsDrb","fbis.matchup.home.drbRate","fbis.matchup.away.drbRate",
"fbis.matchup.home.turnover","fbis.matchup.away.turnover","fbis.matchup.home.ftr","fbis.matchup.away.ftr",
"fbis.schedule.home.sos","fbis.schedule.away.sos","fbis.schedule.home.conferenceStrength","fbis.schedule.away.conferenceStrength"];
const marginFeatures=["fbis.possessions","fbis.paceAdjustment","fbis.reliability","fbis.hca",
"fbis.matchup.home.efg","fbis.matchup.away.efg","fbis.matchup.home.twoPt","fbis.matchup.away.twoPt","fbis.matchup.home.threePt","fbis.matchup.away.threePt",
"fbis.matchup.home.orebVsDrb","fbis.matchup.away.orebVsDrb","fbis.matchup.home.drbRate","fbis.matchup.away.drbRate",
"fbis.matchup.home.turnover","fbis.matchup.away.turnover","fbis.matchup.home.ftr","fbis.matchup.away.ftr",
"fbis.schedule.home.sos","fbis.schedule.away.sos","fbis.schedule.home.conferenceStrength","fbis.schedule.away.conferenceStrength"];
const confidenceFeatures=["market.overUnder","market.openingOverUnder","market.sourceBooks","fbis.total","kenpom.total","fbis.reliability","fbis.hca","fbis.possessions","fbis.paceAdjustment",
"fbis.schedule.home.sos","fbis.schedule.away.sos","fbis.schedule.home.conferenceStrength","fbis.schedule.away.conferenceStrength",
"fbis.matchup.home.efg","fbis.matchup.away.efg","fbis.matchup.home.orebVsDrb","fbis.matchup.away.orebVsDrb",
"derived.fbisMarketEdge","derived.kenpomMarketEdge","derived.fbisKenpomGap","derived.absFbisKenpomGap","derived.lineMove","derived.absLineMove","derived.sosGap","derived.confStrengthGap"];

function featureValue(r,p){
 if(!p.startsWith("derived.")) return n(get(r,p))??0;
 const market=n(r.market?.overUnder),open=n(r.market?.openingOverUnder),fbis=n(r.fbis?.total),kp=n(r.kenpom?.total);
 const hs=n(r.fbis?.schedule?.home?.sos)??0,as=n(r.fbis?.schedule?.away?.sos)??0;
 const hc=n(r.fbis?.schedule?.home?.conferenceStrength)??0,ac=n(r.fbis?.schedule?.away?.conferenceStrength)??0;
 switch(p){
  case "derived.fbisMarketEdge": return market!=null&&fbis!=null?fbis-market:0;
  case "derived.kenpomMarketEdge": return market!=null&&kp!=null?kp-market:0;
  case "derived.fbisKenpomGap": return fbis!=null&&kp!=null?fbis-kp:0;
  case "derived.absFbisKenpomGap": return fbis!=null&&kp!=null?Math.abs(fbis-kp):0;
  case "derived.lineMove": return market!=null&&open!=null?market-open:0;
  case "derived.absLineMove": return market!=null&&open!=null?Math.abs(market-open):0;
  case "derived.sosGap": return hs-as;
  case "derived.confStrengthGap": return hc-ac;
  default:return 0;
 }
}
function vec(r,features){return features.map(p=>featureValue(r,p))}
function solve(A,b){const m=A.map((r,i)=>[...r,b[i]]),N=m.length;for(let i=0;i<N;i++){let p=i;for(let j=i+1;j<N;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;[m[i],m[p]]=[m[p],m[i]];const d=m[i][i]||1e-12;for(let k=i;k<=N;k++)m[i][k]/=d;for(let j=0;j<N;j++){if(j===i)continue;const q=m[j][i];for(let k=i;k<=N;k++)m[j][k]-=q*m[i][k]}}return m.map(r=>r[N])}
function fitRidge(rs,features,target,lambda){
 const X=rs.map(r=>vec(r,features)),y=rs.map(target),p=features.length;
 const means=Array(p).fill(0),sds=Array(p).fill(1);
 for(let j=0;j<p;j++){means[j]=X.reduce((s,x)=>s+x[j],0)/X.length;const v=X.reduce((s,x)=>s+(x[j]-means[j])**2,0)/Math.max(1,X.length-1);sds[j]=Math.sqrt(v)||1}
 const ym=y.reduce((s,x)=>s+x,0)/y.length;
 const A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);
 for(let i=0;i<X.length;i++){const z=X[i].map((x,j)=>(x-means[j])/sds[j]),yy=y[i]-ym;for(let a=0;a<p;a++){b[a]+=z[a]*yy;for(let q=0;q<p;q++)A[a][q]+=z[a]*z[q]}}
 for(let j=0;j<p;j++)A[j][j]+=lambda;
 const beta=solve(A,b);
 return {features,means,sds,beta,intercept:ym,lambda};
}
function predict(m,r){const x=vec(r,m.features);let y=m.intercept;for(let j=0;j<x.length;j++)y+=m.beta[j]*(x[j]-m.means[j])/m.sds[j];return y}
function mae(rs,fn){return rs.length?rs.reduce((s,r)=>s+Math.abs(fn(r)),0)/rs.length:null}
function selectModel(train,features,targetFn,baseErrFn){
 const lambdas=[.1,1,10,100,1000,10000],seasons=[2018,2019,2020,2021,2022];let best=null;
 for(const lambda of lambdas){let base=0,corr=0,count=0;for(const s of seasons){const tr=train.filter(r=>r.season!==s),te=train.filter(r=>r.season===s);if(!te.length)continue;const m=fitRidge(tr,features,targetFn,lambda);for(const r of te){base+=Math.abs(baseErrFn(r));corr+=Math.abs(baseErrFn(r)-predict(m,r));count++}}const gain=(base-corr)/count;if(!best||gain>best.gain)best={lambda,gain}}
 return fitRidge(train,features,targetFn,best.lambda);
}
const discovery=rows.filter(r=>r.season<=2022),validation=rows.filter(r=>r.season===2023||r.season===2024),confirmation=rows.filter(r=>r.season===2025);
const totalTarget=r=>(r.actualHome+r.actualAway)-r.fbis.total;
const marginTarget=r=>(r.actualHome-r.actualAway)-r.fbis.margin;
const totalModel=selectModel(discovery,totalFeatures,totalTarget,totalTarget);
const marginModel=selectModel(discovery,marginFeatures,marginTarget,marginTarget);
function evalResidual(rs,model,targetFn,kpFn){
 const base=mae(rs,r=>targetFn(r)),corr=mae(rs,r=>targetFn(r)-predict(model,r)),kp=mae(rs,r=>kpFn(r));
 return {n:rs.length,baseMae:round(base),correctedMae:round(corr),gain:round(base-corr),kenpomMae:round(kp),vsKenpom:round(kp-corr)};
}
const totalEval={discovery:evalResidual(discovery,totalModel,totalTarget,r=>(r.actualHome+r.actualAway)-r.kenpom.total),
 validation:evalResidual(validation,totalModel,totalTarget,r=>(r.actualHome+r.actualAway)-r.kenpom.total),
 confirmation:evalResidual(confirmation,totalModel,totalTarget,r=>(r.actualHome+r.actualAway)-r.kenpom.total)};
const marginEval={discovery:evalResidual(discovery,marginModel,marginTarget,r=>(r.actualHome-r.actualAway)-r.kenpom.margin),
 validation:evalResidual(validation,marginModel,marginTarget,r=>(r.actualHome-r.actualAway)-r.kenpom.margin),
 confirmation:evalResidual(confirmation,marginModel,marginTarget,r=>(r.actualHome-r.actualAway)-r.kenpom.margin)};

const marketRows=discovery.filter(r=>n(r.market?.overUnder)!=null);
const confTarget=r=>Math.abs((r.actualHome+r.actualAway)-r.market.overUnder)-Math.abs((r.actualHome+r.actualAway)-r.fbis.total);
const confidenceModel=selectModel(marketRows,confidenceFeatures,confTarget,confTarget);
function betEval(rs){
 let nBet=0,w=0,l=0,push=0,u=0,lineMoveSum=0,lineMoveN=0;
 for(const r of rs){
  const line=n(r.market?.overUnder);if(line==null)continue;
  const score=predict(confidenceModel,r),edge=r.fbis.total-line;
  if(score<=0||Math.abs(edge)<2)continue;
  const direction=Math.sign(edge),result=(r.actualHome+r.actualAway)-line;nBet++;
  const open=n(r.market?.openingOverUnder);
  if(open!=null){lineMoveSum+=direction*(line-open);lineMoveN++}
  if(result===0){push++;continue}
  if(Math.sign(result)===direction){w++;u+=100/110}else{l++;u-=1}
 }
 return {n:nBet,w,l,push,winPct:w+l?round(100*w/(w+l),2):null,units:round(u,3),roi:nBet?round(100*u/nBet,2):null,
  openerToFinalMovementTowardBet:lineMoveN?round(lineMoveSum/lineMoveN,3):null,lineMoveN,
  clvCertified:false,clvNote:"Historical retained final/current line is not timestamp-certified close; movement metric is a directional opener-to-final proxy only."};
}
const confidenceEval={validation:betEval(validation),confirmation:betEval(confirmation)};
const totalEnabled=totalEval.validation.gain>0&&totalEval.confirmation.gain>0&&totalEval.validation.vsKenpom>0&&totalEval.confirmation.vsKenpom>0;
const marginEnabled=marginEval.validation.gain>0&&marginEval.confirmation.gain>0&&marginEval.validation.vsKenpom>0&&marginEval.confirmation.vsKenpom>0;
const confidenceEnabled=confidenceEval.validation.n>=100&&confidenceEval.confirmation.n>=100&&confidenceEval.validation.roi>0&&confidenceEval.confirmation.roi>0;
const clean=m=>({features:m.features,means:m.means.map(x=>round(x,8)),sds:m.sds.map(x=>round(x,8)),beta:m.beta.map(x=>round(x,8)),intercept:round(m.intercept,8),lambda:m.lambda});
const report={id:"FBIS-CBB-v2-FIT",generatedAt:new Date().toISOString(),training:"2018-22 only; LOSO lambda selection",total:{enabled:totalEnabled,model:clean(totalModel),evaluation:totalEval},margin:{enabled:marginEnabled,model:clean(marginModel),evaluation:marginEval},confidence:{enabled:confidenceEnabled,model:clean(confidenceModel),evaluation:confidenceEval},governance:{validation:"2023-24",confirmation:"2025",kenpomBenchmarkOnly:true,marketExcludedFromBaseProjection:true,automaticWagerAuthorization:false}};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-fbis-v2-fit.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
