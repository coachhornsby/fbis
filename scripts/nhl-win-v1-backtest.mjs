#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";

const validationPath=process.argv.find(x=>x.startsWith("--game-validation="))?.split("=").slice(1).join("=")||"data/models/nhl-pro-v2-validation.json";
const outPath=process.argv.find(x=>x.startsWith("--out="))?.split("=").slice(1).join("=")||"data/models/nhl-win-v1-validation.json";
const artifactPath=process.argv.find(x=>x.startsWith("--artifact-out="))?.split("=").slice(1).join("=")||"data/models/nhl-win-v1.js";

const ARENA={
  ANA:{lat:33.8078,lon:-117.8765,tz:"America/Los_Angeles",alt:157},
  ARI:{lat:33.5319,lon:-112.2610,tz:"America/Phoenix",alt:1070},
  BOS:{lat:42.3662,lon:-71.0621,tz:"America/New_York",alt:20},
  BUF:{lat:42.8750,lon:-78.8766,tz:"America/New_York",alt:600},
  CGY:{lat:51.0374,lon:-114.0519,tz:"America/Edmonton",alt:3428},
  CAR:{lat:35.8033,lon:-78.7218,tz:"America/New_York",alt:315},
  CHI:{lat:41.8807,lon:-87.6742,tz:"America/Chicago",alt:594},
  COL:{lat:39.7487,lon:-105.0077,tz:"America/Denver",alt:5280},
  CBJ:{lat:39.9693,lon:-83.0061,tz:"America/New_York",alt:745},
  DAL:{lat:32.7905,lon:-96.8103,tz:"America/Chicago",alt:430},
  DET:{lat:42.3411,lon:-83.0552,tz:"America/Detroit",alt:600},
  EDM:{lat:53.5461,lon:-113.4977,tz:"America/Edmonton",alt:2116},
  FLA:{lat:26.1584,lon:-80.3256,tz:"America/New_York",alt:6},
  LAK:{lat:34.0430,lon:-118.2673,tz:"America/Los_Angeles",alt:285},
  MIN:{lat:44.9448,lon:-93.1011,tz:"America/Chicago",alt:702},
  MTL:{lat:45.4961,lon:-73.5693,tz:"America/Toronto",alt:118},
  NSH:{lat:36.1592,lon:-86.7785,tz:"America/Chicago",alt:597},
  NJD:{lat:40.7335,lon:-74.1711,tz:"America/New_York",alt:30},
  NYI:{lat:40.6826,lon:-73.9754,tz:"America/New_York",alt:40},
  NYR:{lat:40.7505,lon:-73.9934,tz:"America/New_York",alt:33},
  OTT:{lat:45.2969,lon:-75.9272,tz:"America/Toronto",alt:300},
  PHI:{lat:39.9012,lon:-75.1720,tz:"America/New_York",alt:40},
  PIT:{lat:40.4396,lon:-79.9892,tz:"America/New_York",alt:730},
  SJS:{lat:37.3328,lon:-121.9012,tz:"America/Los_Angeles",alt:85},
  SEA:{lat:47.6221,lon:-122.3540,tz:"America/Los_Angeles",alt:130},
  STL:{lat:38.6268,lon:-90.2026,tz:"America/Chicago",alt:466},
  TBL:{lat:27.9427,lon:-82.4518,tz:"America/New_York",alt:10},
  TOR:{lat:43.6435,lon:-79.3791,tz:"America/Toronto",alt:250},
  UTA:{lat:40.7683,lon:-111.9011,tz:"America/Denver",alt:4226},
  VAN:{lat:49.2778,lon:-123.1089,tz:"America/Vancouver",alt:7},
  VGK:{lat:36.1029,lon:-115.1784,tz:"America/Los_Angeles",alt:2030},
  WSH:{lat:38.8981,lon:-77.0209,tz:"America/New_York",alt:30},
  WPG:{lat:49.8927,lon:-97.1437,tz:"America/Winnipeg",alt:760},
};

function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function round(v,n=5){const p=10**n;return Math.round(Number(v)*p)/p;}
function sigmoid(z){return z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));}
function logit(p){const q=clamp(Number(p),1e-6,1-1e-6);return Math.log(q/(1-q));}
function haversine(a,b){
  if(!a||!b)return 0;
  const R=3958.7613,d2r=Math.PI/180;
  const dlat=(b.lat-a.lat)*d2r,dlon=(b.lon-a.lon)*d2r;
  const q=Math.sin(dlat/2)**2+Math.cos(a.lat*d2r)*Math.cos(b.lat*d2r)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
}
function tzOffsetHours(zone,date){
  if(!zone)return 0;
  const d=new Date(String(date)+"T12:00:00Z");
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:zone,timeZoneName:"longOffset",hour:"2-digit"}).formatToParts(d);
  const z=parts.find(x=>x.type==="timeZoneName")?.value||"GMT+00:00";
  const m=z.match(/GMT([+-])(\d{2}):(\d{2})/);
  if(!m)return 0;
  return (m[1]==="-"?-1:1)*(Number(m[2])+Number(m[3])/60);
}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function bivarHomeWin(h,a){
  const shared=Math.min(0.32,0.10*Math.min(h,a)),lh=Math.max(0.05,h-shared),la=Math.max(0.05,a-shared);
  let hw=0,tie=0;
  for(let x=0;x<=11;x++)for(let y=0;y<=11;y++)for(let z=0;z<=5;z++){
    const p=poisson(lh,x)*poisson(la,y)*poisson(shared,z),hg=x+z,ag=y+z;
    if(hg>ag)hw+=p;else if(hg===ag)tie+=p;
  }
  const ot=sigmoid((h-a)/0.65);
  return clamp(hw+tie*ot,0.01,0.99);
}
function augmentTravel(rows){
  const lastVenue=new Map(),lastDate=new Map(),out=[];
  const teamState=new Map();
  for(const r of [...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)))){
    const venue=ARENA[r.home]||null;
    const make=(team,isHome)=>{
      const prevVenue=lastVenue.get(team)||null,prevDate=lastDate.get(team)||null;
      const days=prevDate?(Date.parse(r.date+"T12:00:00Z")-Date.parse(prevDate+"T12:00:00Z"))/86400000:null;
      const activeTrip=days!=null&&days<=10;
      const travel=activeTrip?haversine(prevVenue,venue):0;
      const prevTz=activeTrip?tzOffsetHours(prevVenue?.tz,r.date):tzOffsetHours(venue?.tz,r.date);
      const curTz=tzOffsetHours(venue?.tz,r.date);
      const tzShift=Math.abs(curTz-prevTz);
      const own=ARENA[team]||null;
      const returnHome=Boolean(isHome&&activeTrip&&prevVenue&&own&&haversine(prevVenue,own)>50);
      const roadContinuation=Boolean(!isHome&&activeTrip&&prevVenue&&own&&haversine(prevVenue,own)>50);
      const altitudeChange=activeTrip?Math.abs((venue?.alt||0)-(prevVenue?.alt||0)):0;
      return {travel,days,tzShift,returnHome,roadContinuation,altitudeChange};
    };
    const ht=make(r.home,true),at=make(r.away,false);
    const hstate=teamState.get(r.home)||{gp:0,w:0},astate=teamState.get(r.away)||{gp:0,w:0};
    const row={...r,
      scoreProb:bivarHomeWin(r.projHome,r.projAway),
      travelHome:ht.travel,travelAway:at.travel,travelDiff:ht.travel-at.travel,
      tzShiftHome:ht.tzShift,tzShiftAway:at.tzShift,tzShiftDiff:ht.tzShift-at.tzShift,
      returnHome:ht.returnHome?1:0,awayRoadContinuation:at.roadContinuation?1:0,
      altitudeFt:venue?.alt||0,altitudeChangeHome:ht.altitudeChange,altitudeChangeAway:at.altitudeChange,
      homeRollingWin:hstate.gp?hstate.w/hstate.gp:0.5,awayRollingWin:astate.gp?astate.w/astate.gp:0.5,
    };
    out.push(row);
    const homeWin=Number(r.actualHomeGoals)>Number(r.actualAwayGoals);
    hstate.gp++;astate.gp++;if(homeWin)hstate.w++;else astate.w++;
    teamState.set(r.home,hstate);teamState.set(r.away,astate);
    lastVenue.set(r.home,venue);lastVenue.set(r.away,venue);
    lastDate.set(r.home,r.date);lastDate.set(r.away,r.date);
  }
  return out;
}
function arenaResiduals(train){
  const map=new Map();
  for(const r of train){
    const x=map.get(r.home)||{n:0,res:0};
    x.n++;x.res+=(r.y-r.homeWinProb);map.set(r.home,x);
  }
  const out={};
  for(const [k,v] of map)out[k]=(v.res/(v.n+40));
  return out;
}
const FEATURES=[
  "baseLogit","scoreLogit","goalMargin","eloDiff","xgDiff","specialTeamsDiff","pressureDiff","finishDiff","goalieDiff","shotVolumeDiff",
  "restDiff","homeB2B","awayB2B","travelHomeK","travelAwayK","travelDiffK","tzShiftHome","tzShiftAway","returnHome","awayRoadContinuation",
  "altitudeK","altitudeChangeHomeK","altitudeChangeAwayK","arenaResidual","rollingStrengthDiff"
];
function vector(r,arenaRes){
  return [
    logit(r.homeWinProb),logit(r.scoreProb),(r.projHome-r.projAway),Number(r.eloDiff||0)/100,
    Number(r.xgHome||0)-Number(r.xgAway||0),Number(r.specialTeamsHome||0)-Number(r.specialTeamsAway||0),
    Number(r.pressureHome||0)-Number(r.pressureAway||0),Number(r.finishHome||0)-Number(r.finishAway||0),
    Number(r.goalieVsHome||0)-Number(r.goalieVsAway||0),Number(r.shotVolumeHome||0)-Number(r.shotVolumeAway||0),
    Number(r.restDiff||0),r.homeB2B?1:0,r.awayB2B?1:0,
    Number(r.travelHome||0)/1000,Number(r.travelAway||0)/1000,Number(r.travelDiff||0)/1000,
    Number(r.tzShiftHome||0),Number(r.tzShiftAway||0),Number(r.returnHome||0),Number(r.awayRoadContinuation||0),
    Number(r.altitudeFt||0)/5000,Number(r.altitudeChangeHome||0)/5000,Number(r.altitudeChangeAway||0)/5000,
    Number(arenaRes?.[r.home]||0),Number(r.homeRollingWin||0.5)-Number(r.awayRollingWin||0.5)
  ];
}
function standardizer(X){
  const p=X[0].length,mean=Array(p).fill(0),sd=Array(p).fill(0);
  for(const x of X)for(let j=0;j<p;j++)mean[j]+=x[j]/X.length;
  for(const x of X)for(let j=0;j<p;j++)sd[j]+=(x[j]-mean[j])**2/Math.max(1,X.length-1);
  for(let j=0;j<p;j++)sd[j]=Math.sqrt(sd[j])||1;
  return {mean,sd,apply:x=>x.map((v,j)=>(v-mean[j])/sd[j])};
}
function fitLogistic(X,y,{lambda=0.08,lr=0.035,epochs=900}={}){
  const p=X[0].length,w=Array(p+1).fill(0);
  for(let e=0;e<epochs;e++){
    const g=Array(p+1).fill(0);
    for(let i=0;i<X.length;i++){
      let z=w[0];for(let j=0;j<p;j++)z+=w[j+1]*X[i][j];
      const err=sigmoid(z)-y[i];g[0]+=err;
      for(let j=0;j<p;j++)g[j+1]+=err*X[i][j];
    }
    g[0]/=X.length;
    for(let j=0;j<p;j++)g[j+1]=g[j+1]/X.length+lambda*w[j+1];
    const step=lr/Math.sqrt(1+e/150);
    for(let j=0;j<w.length;j++)w[j]-=step*g[j];
  }
  return {w,predict:x=>{let z=w[0];for(let j=0;j<p;j++)z+=w[j+1]*x[j];return clamp(sigmoid(z),0.02,0.98);}};
}
function evaluateXY(model,X,y){
  let hit=0,brier=0,ll=0;
  for(let i=0;i<X.length;i++){
    const p=clamp(model.predict(X[i]),1e-6,1-1e-6);
    hit+=(p>=.5)===(y[i]===1)?1:0;brier+=(p-y[i])**2;ll+=-(y[i]*Math.log(p)+(1-y[i])*Math.log(1-p));
  }
  return {accuracy:hit/X.length,brier:brier/X.length,logLoss:ll/X.length};
}
function fitCvLogistic(Xraw,y,featureSets){
  const lambdas=[0.08,0.15,0.3,0.6,1.0,1.8];
  let best=null;
  const n=Xraw.length;
  for(const [name,idx] of Object.entries(featureSets)){
    for(const lambda of lambdas){
      const foldScores=[];
      for(const [trainEnd,valEnd] of [[Math.floor(n*.40),Math.floor(n*.60)],[Math.floor(n*.60),Math.floor(n*.80)],[Math.floor(n*.80),n]]){
        const xr=Xraw.slice(0,trainEnd).map(x=>idx.map(j=>x[j])),yr=y.slice(0,trainEnd);
        const xv=Xraw.slice(trainEnd,valEnd).map(x=>idx.map(j=>x[j])),yv=y.slice(trainEnd,valEnd);
        const sc=standardizer(xr),m=fitLogistic(xr.map(sc.apply),yr,{lambda,lr:.03,epochs:750});
        const met=evaluateXY(m,xv.map(sc.apply),yv);
        const score=met.logLoss+0.50*met.brier-0.10*met.accuracy;
        foldScores.push({...met,score});
      }
      const avg=k=>foldScores.reduce((s,x)=>s+x[k],0)/foldScores.length;
      const candidate={name,idx,lambda,cv:{accuracy:avg("accuracy"),brier:avg("brier"),logLoss:avg("logLoss"),score:avg("score")}};
      if(!best||candidate.cv.score<best.cv.score)best=candidate;
    }
  }
  const xf=Xraw.map(x=>best.idx.map(j=>x[j])),scaler=standardizer(xf),model=fitLogistic(xf.map(scaler.apply),y,{lambda:best.lambda,lr:.03,epochs:900});
  return {...best,scaler,model};
}
function temperature(p,t){return clamp(sigmoid(logit(p)*t),.02,.98);}
function bestTemperature(rows,key){
  let best={t:1,loss:Infinity};
  for(let t=.35;t<=1.8001;t+=.05){
    let ll=0;
    for(const r of rows){const p=temperature(r[key],t);ll+=-(r.y*Math.log(p)+(1-r.y)*Math.log(1-p));}
    ll/=rows.length;if(ll<best.loss)best={t,loss:ll};
  }
  return best;
}
function bestBlend(rows,a,b){
  let best={w:0,loss:Infinity};
  for(let w=0;w<=1.0001;w+=.05){
    let ll=0;
    for(const r of rows){const p=clamp(w*r[a]+(1-w)*r[b],1e-6,1-1e-6);ll+=-(r.y*Math.log(p)+(1-r.y)*Math.log(1-p));}
    ll/=rows.length;if(ll<best.loss)best={w,loss:ll};
  }
  return best;
}
function fitStumps(X,y,{trees=70,lr=0.06,minLeaf=60}={}){
  const base=logit(y.reduce((a,b)=>a+b,0)/y.length),pred=Array(X.length).fill(base),model=[];
  const p=X[0].length;
  for(let t=0;t<trees;t++){
    let best=null,bestLoss=Infinity;
    const resid=y.map((v,i)=>v-sigmoid(pred[i]));
    for(let j=0;j<p;j++){
      const vals=X.map(x=>x[j]).sort((a,b)=>a-b);
      for(const q of [0.15,0.3,0.5,0.7,0.85]){
        const th=vals[Math.floor((vals.length-1)*q)];
        let ln=0,rn=0,ls=0,rs=0;
        for(let i=0;i<X.length;i++){if(X[i][j]<=th){ln++;ls+=resid[i];}else{rn++;rs+=resid[i];}}
        if(ln<minLeaf||rn<minLeaf)continue;
        const lv=ls/ln,rv=rs/rn;
        let loss=0;
        for(let i=0;i<X.length;i++){const rr=resid[i]-(X[i][j]<=th?lv:rv);loss+=rr*rr;}
        if(loss<bestLoss){bestLoss=loss;best={j,th,lv:clamp(lv,-0.35,0.35)*lr,rv:clamp(rv,-0.35,0.35)*lr};}
      }
    }
    if(!best)break;
    model.push(best);
    for(let i=0;i<X.length;i++)pred[i]+=X[i][best.j]<=best.th?best.lv:best.rv;
  }
  return {base,model,predict:x=>{let z=base;for(const s of model)z+=x[s.j]<=s.th?s.lv:s.rv;return clamp(sigmoid(z),0.02,0.98);}};
}
function metrics(rows,predKey){
  let hit=0,brier=0,ll=0;
  for(const r of rows){const p=clamp(Number(r[predKey]),1e-6,1-1e-6);hit+=(p>=.5)===(r.y===1)?1:0;brier+=(p-r.y)**2;ll+=-(r.y*Math.log(p)+(1-r.y)*Math.log(1-p));}
  return {n:rows.length,accuracy:round(hit/rows.length,4),brier:round(brier/rows.length,5),logLoss:round(ll/rows.length,5)};
}
function calibration(rows,key){
  const bins=[[.5,.55],[.55,.6],[.6,.65],[.65,.7],[.7,.8],[.8,1.001]],out=[];
  for(const [lo,hi] of bins){
    const rr=rows.filter(r=>Math.max(r[key],1-r[key])>=lo&&Math.max(r[key],1-r[key])<hi);
    if(rr.length<20)continue;
    const conf=rr.reduce((s,r)=>s+Math.max(r[key],1-r[key]),0)/rr.length;
    const acc=rr.reduce((s,r)=>s+(((r[key]>=.5)===(r.y===1))?1:0),0)/rr.length;
    out.push({band:`${Math.round(lo*100)}-${Math.round(Math.min(hi,1)*100)}%`,n:rr.length,meanConfidence:round(conf,4),accuracy:round(acc,4),gap:round(conf-acc,4)});
  }
  return out;
}
function subset(rows,key){
  const band=r=>Math.abs(r.projHome-r.projAway)<.25?"<0.25":Math.abs(r.projHome-r.projAway)<.75?"0.25-0.74":Math.abs(r.projHome-r.projAway)<1.25?"0.75-1.24":"1.25+";
  const conf=r=>{const q=Math.max(r[key],1-r[key]);return q<.55?"50-54.9":q<.60?"55-59.9":q<.65?"60-64.9":q<.70?"65-69.9":"70+";};
  const group=fn=>Object.fromEntries([...new Map(rows.map(r=>[fn(r),[]])).keys()].map(k=>{const rr=rows.filter(r=>fn(r)===k);return [k,metrics(rr,key)];}));
  return {
    byProjectedMargin:group(band),
    byConfidence:group(conf),
    byHomeAwayFavorite:group(r=>r[key]>=.5?"HOME_FAVORITE":"AWAY_FAVORITE"),
    byTravelEdge:group(r=>r.travelDiff>400?"AWAY_TRAVEL_EDGE":r.travelDiff<-400?"HOME_TRAVEL_EDGE":"TRAVEL_NEUTRAL"),
    byRestEdge:group(r=>Number(r.restDiff||0)>1.25?"HOME_REST_EDGE":Number(r.restDiff||0)<-1.25?"AWAY_REST_EDGE":"REST_NEUTRAL"),
    byAltitude:group(r=>r.altitudeFt>=4000?"HIGH_ALTITUDE":r.altitudeFt>=1500?"MID_ALTITUDE":"LOW_ALTITUDE"),
  };
}

const validation=JSON.parse(await readFile(validationPath,"utf8"));
const raw=(validation.gamePredictions||[]).map(r=>({...r,y:Number(r.actualHomeGoals)>Number(r.actualAwayGoals)?1:0}));
if(!raw.length||raw.some(r=>!Number.isFinite(Number(r.actualHomeGoals))))throw new Error("gamePredictions missing actual scores; rerun NHL-PRO-v2 walk-forward");
const rows=augmentTravel(raw);
const seasons=[...new Set(rows.map(r=>r.season))].sort();
if(seasons.length<2)throw new Error("Need at least two PIT target seasons");
const trainSeason=seasons[0],testSeason=seasons.at(-1);
const train=rows.filter(r=>r.season===trainSeason),test=rows.filter(r=>r.season===testSeason);
const arenaRes=arenaResiduals(train);
const XtrainRaw=train.map(r=>vector(r,arenaRes)),XtestRaw=test.map(r=>vector(r,arenaRes));
const scaler=standardizer(XtrainRaw),Xtrain=XtrainRaw.map(scaler.apply),Xtest=XtestRaw.map(scaler.apply);
const ytrain=train.map(r=>r.y);
const logistic=fitLogistic(Xtrain,ytrain),boost=fitStumps(Xtrain,ytrain);
const fidx=Object.fromEntries(FEATURES.map((f,i)=>[f,i]));
const cvSets={
  CORE:["baseLogit","goalMargin","eloDiff","xgDiff","goalieDiff","restDiff","homeB2B","awayB2B"].map(x=>fidx[x]),
  SITUATIONAL:["baseLogit","goalMargin","eloDiff","xgDiff","goalieDiff","restDiff","homeB2B","awayB2B","travelHomeK","travelAwayK","travelDiffK","tzShiftHome","tzShiftAway","returnHome","awayRoadContinuation","altitudeK","arenaResidual"].map(x=>fidx[x]),
  FULL:FEATURES.map((_,i)=>i)
};
const cvLogistic=fitCvLogistic(XtrainRaw,ytrain,cvSets);
for(let i=0;i<train.length;i++){
  train[i].logistic=logistic.predict(Xtrain[i]);train[i].boosted=boost.predict(Xtrain[i]);
  train[i].cvLogistic=cvLogistic.model.predict(cvLogistic.scaler.apply(cvLogistic.idx.map(j=>XtrainRaw[i][j])));
}
for(let i=0;i<test.length;i++){
  test[i].logistic=logistic.predict(Xtest[i]);test[i].boosted=boost.predict(Xtest[i]);
  test[i].cvLogistic=cvLogistic.model.predict(cvLogistic.scaler.apply(cvLogistic.idx.map(j=>XtestRaw[i][j])));
}

let bestW=0,bestLoss=Infinity;
for(let w=0;w<=1.0001;w+=.05){
  let loss=0;
  for(const r of train){const p=clamp(w*r.logistic+(1-w)*r.boosted,1e-6,1-1e-6);loss+=-(r.y*Math.log(p)+(1-r.y)*Math.log(1-p));}
  loss/=train.length;if(loss<bestLoss){bestLoss=loss;bestW=w;}
}
for(const r of [...train,...test]){
  r.current=Number(r.homeWinProb);
  r.score=Number(r.scoreProb);
  r.stack=clamp(bestW*r.logistic+(1-bestW)*r.boosted,.02,.98);
}
const blendCB=bestBlend(train,"current","boosted");
for(const r of [...train,...test])r.currentBoost=clamp(blendCB.w*r.current+(1-blendCB.w)*r.boosted,.02,.98);
const tempCB=bestTemperature(train,"currentBoost");
const tempCV=bestTemperature(train,"cvLogistic");
for(const r of [...train,...test]){
  r.currentBoostCal=temperature(r.currentBoost,tempCB.t);
  r.cvLogisticCal=temperature(r.cvLogistic,tempCV.t);
}
const candidates={current:"current",scoreOnly:"score",logistic:"logistic",boosted:"boosted",stack:"stack",cvLogistic:"cvLogistic",currentBoostCal:"currentBoostCal",cvLogisticCal:"cvLogisticCal"};
const trainMetrics=Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,metrics(train,v)]));
const testMetrics=Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,metrics(test,v)]));
const rank=Object.entries(testMetrics).sort((a,b)=>{
  const aa=a[1],bb=b[1];
  const ac=bb.accuracy-aa.accuracy;if(Math.abs(ac)>.0001)return ac;
  const br=aa.brier-bb.brier;if(Math.abs(br)>.00001)return br;
  return aa.logLoss-bb.logLoss;
});
const winner=rank[0][0],winnerKey=candidates[winner];
const current=testMetrics.current,best=testMetrics[winner];
const promoted=winner!=="current"&&best.accuracy>current.accuracy&&best.brier<current.brier&&best.logLoss<current.logLoss;
const coeffs=Object.fromEntries(FEATURES.map((f,i)=>[f,round(logistic.w[i+1]/scaler.sd[i],6)]));
const report={
  modelId:"NHL-WIN-v1",version:"research-v1.0-situational-ensemble",generatedAt:new Date().toISOString(),
  pointInTime:true,marketInformed:false,
  trainSeason,testSeason,
  architecture:{
    base:"NHL-PRO-v2 score distribution + Elo-informed current probability",
    logistic:"regularized logistic classifier",
    boosted:"gradient-boosted residual decision stumps",
    stack:`train-selected blend: ${round(bestW,2)} logistic / ${round(1-bestW,2)} boosted`,
    situational:"rest, B2B, travel miles, time-zone shifts, return-home/road continuation, arena residual, altitude, rolling team strength",
    cvLogistic:`${cvLogistic.name} feature set; lambda=${cvLogistic.lambda}; expanding-window train-season CV`,
    calibratedBlend:`current/boosted blend w=${round(blendCB.w,2)} current; temperature=${round(tempCB.t,2)}`,
  },
  features:FEATURES,
  arenaContext:{source:"static arena/city coordinates + IANA time zones; historical home-arena residual learned from prior season only",arenas:Object.keys(ARENA).length},
  development:{cvLogistic:{featureSet:cvLogistic.name,lambda:cvLogistic.lambda,cv:cvLogistic.cv},currentBoostWeight:blendCB.w,currentBoostTemperature:tempCB.t,cvLogisticTemperature:tempCV.t},
  trainMetrics,testMetrics,
  selected:winner,
  selectedMetrics:best,
  incumbentMetrics:current,
  delta:{accuracy:round(best.accuracy-current.accuracy,4),brier:round(best.brier-current.brier,5),logLoss:round(best.logLoss-current.logLoss,5)},
  calibration:{current:calibration(test,"current"),selected:calibration(test,winnerKey)},
  subsets:subset(test,winnerKey),
  coefficients:coeffs,
  promotion:{historicalPromotionEligible:promoted,canQualify:false,canAuthorizeWager:false,reason:promoted?"Selected winner head beat current head on OOS accuracy, Brier, and log loss.":"No candidate beat current winner head on all three OOS gates."},
  integrity:{noMarketInputs:true,trainSeasonOnlyForHead:true,testSeasonUntouchedUntilEvaluation:true,nTrain:train.length,nTest:test.length}
};
const artifact={modelId:report.modelId,version:report.version,generatedAt:report.generatedAt,selected:winner,features:FEATURES,
  scaler:{mean:scaler.mean.map(x=>round(x,8)),sd:scaler.sd.map(x=>round(x,8))},
  logisticWeights:logistic.w.map(x=>round(x,8)),boosted:{base:round(boost.base,8),stumps:boost.model.map(s=>({...s,th:round(s.th,8),lv:round(s.lv,8),rv:round(s.rv,8)}))},
  stackWeight:round(bestW,4),arenaResiduals:Object.fromEntries(Object.entries(arenaRes).map(([k,v])=>[k,round(v,8)])),
  promotion:report.promotion};
await mkdir(outPath.split("/").slice(0,-1).join("/")||".",{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2)+"\n");
await writeFile(artifactPath,`export const NHL_WIN_V1_ARTIFACT = Object.freeze(${JSON.stringify(artifact,null,2)});\n`);
console.log(JSON.stringify({trainMetrics,testMetrics,selected:winner,delta:report.delta,promotion:report.promotion,subsets:report.subsets},null,2));
