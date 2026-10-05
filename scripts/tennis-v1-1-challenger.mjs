#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROWS = process.env.TENNIS_V11_ROWS || "research/tennis/walkforward-rows.jsonl";
const OUT = process.env.TENNIS_V11_OUT || "research/tennis/v1-1-challenger-latest.json";
const TRAIN_END = Number(process.env.TENNIS_V11_TRAIN_END || 2023);
const TEST_START = Number(process.env.TENNIS_V11_TEST_START || 2024);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const logit=p=>Math.log(clamp(p,1e-6,1-1e-6)/(1-clamp(p,1e-6,1-1e-6)));
const logistic=z=>1/(1+Math.exp(-z));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=(v,d=5)=>v==null||!Number.isFinite(v)?null:Number(v.toFixed(d));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};

function rankFeature(r){
  const a=finite(r.p1Rank),b=finite(r.p2Rank);
  if(a==null||b==null||a<=0||b<=0)return 0;
  return Math.log((b+5)/(a+5));
}
function score(rows,fn){
  const ps=rows.map(fn),ys=rows.map(r=>r.actualP1Win);
  const brier=mean(ps.map((p,i)=>(p-ys[i])**2));
  const logLoss=mean(ps.map((p,i)=>-(ys[i]*Math.log(clamp(p,1e-9,1-1e-9))+(1-ys[i])*Math.log(clamp(1-p,1e-9,1-1e-9)))));
  const accuracy=mean(ps.map((p,i)=>(p>=.5?1:0)===ys[i]?1:0));
  const bins=Array.from({length:10},(_,i)=>({lo:i/10,hi:(i+1)/10,n:0,p:0,y:0}));
  for(let i=0;i<rows.length;i++){const k=Math.min(9,Math.floor(ps[i]*10));const b=bins[k];b.n++;b.p+=ps[i];b.y+=ys[i];}
  const calibration=bins.filter(b=>b.n).map(b=>({
    range:`${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`,
    n:b.n,meanProbability:round(b.p/b.n),observedWinRate:round(b.y/b.n)
  }));
  const maxCalibrationError=Math.max(...calibration.map(b=>Math.abs(b.meanProbability-b.observedWinRate)));
  return {n:rows.length,accuracy:round(accuracy),brier:round(brier),logLoss:round(logLoss),maxCalibrationError:round(maxCalibrationError),calibration};
}
function rankFavoriteProb(r){
  const f=rankFeature(r);
  return logistic(0.9*f);
}
function candidateProb(r,a,b){
  return logistic(a*logit(r.p1Win)+b*rankFeature(r));
}
const text=await fs.readFile(ROWS,"utf8");
const rows=text.trim().split("\n").filter(Boolean).map(JSON.parse);
const train=rows.filter(r=>r.year<=TRAIN_END);
const test=rows.filter(r=>r.year>=TEST_START);
if(train.length<5000||test.length<5000)throw new Error(`insufficient train/test rows ${train.length}/${test.length}`);

let best=null;
for(let a=.20;a<=.80+1e-9;a+=.025){
  for(let b=.10;b<=1.50+1e-9;b+=.05){
    const s=score(train,r=>candidateProb(r,a,b));
    if(!best||s.brier<best.train.brier||(s.brier===best.train.brier&&s.logLoss<best.train.logLoss)){
      best={a:round(a,3),b:round(b,3),train:s};
    }
  }
}
const v1Train=score(train,r=>r.p1Win);
const v1Test=score(test,r=>r.p1Win);
const v11Test=score(test,r=>candidateProb(r,best.a,best.b));
const rankTest=score(test,rankFavoriteProb);

const byTour=Object.fromEntries(["atp","wta"].map(t=>[
  t,{
    v1:score(test.filter(r=>r.tour===t),r=>r.p1Win),
    v11:score(test.filter(r=>r.tour===t),r=>candidateProb(r,best.a,best.b))
  }
]));
const bySurface=Object.fromEntries(["hard","clay","grass"].map(s=>[
  s,{
    v1:score(test.filter(r=>r.surface===s),r=>r.p1Win),
    v11:score(test.filter(r=>r.surface===s),r=>candidateProb(r,best.a,best.b))
  }
]));
const byYear=Object.fromEntries([...new Set(test.map(r=>r.year))].sort().map(y=>[
  y,{
    v1:score(test.filter(r=>r.year===y),r=>r.p1Win),
    v11:score(test.filter(r=>r.year===y),r=>candidateProb(r,best.a,best.b))
  }
]));

const improves={
  accuracy:v11Test.accuracy-v1Test.accuracy,
  brier:v1Test.brier-v11Test.brier,
  logLoss:v1Test.logLoss-v11Test.logLoss,
  calibration:v1Test.maxCalibrationError-v11Test.maxCalibrationError,
};
const pass=
  test.length>=5000 &&
  v11Test.brier<0.25 &&
  v11Test.brier<v1Test.brier &&
  v11Test.logLoss<v1Test.logLoss &&
  v11Test.accuracy>=v1Test.accuracy &&
  v11Test.maxCalibrationError<=0.08;

const report={
  generatedAt:new Date().toISOString(),
  challenger:"TENNIS-FBIS-v1.1",
  incumbent:"TENNIS-FBIS-v1",
  design:{
    trainYears:`2020-${TRAIN_END}`,
    holdoutYears:`${TEST_START}-2026`,
    frozenAfterTraining:true,
    formula:"logistic(a*logit(v1_probability) + b*log((rank2+5)/(rank1+5)))",
    fitted:{a:best.a,b:best.b},
    note:"v1.1 is a calibration/ranking challenger. Point/game/set/prop simulation is unchanged in this test.",
  },
  sample:{train:train.length,holdout:test.length,total:rows.length},
  training:{v1:v1Train,v11:best.train},
  holdout:{v1:v1Test,v11:v11Test,rankProbabilityBaseline:rankTest,improvement:improves},
  byTour,bySurface,byYear,
  verdict:{
    status:pass?"CHALLENGER_PASS":"CHALLENGER_FAIL",
    predictivePromotion:pass,
    wagerPromotion:false,
    requirements:{
      minimumHoldoutN:5000,
      maxBrier:0.25,
      improveBrierVsV1:true,
      improveLogLossVsV1:true,
      accuracyNotWorseThanV1:true,
      maxCalibrationError:0.08,
    },
    reasons:[
      ...(test.length<5000?["insufficient_holdout_sample"]:[]),
      ...(v11Test.brier>=0.25?[`holdout_brier_${v11Test.brier}_not_below_0.25`]:[]),
      ...(v11Test.brier>=v1Test.brier?["no_brier_improvement_vs_v1"]:[]),
      ...(v11Test.logLoss>=v1Test.logLoss?["no_logloss_improvement_vs_v1"]:[]),
      ...(v11Test.accuracy<v1Test.accuracy?["accuracy_regression_vs_v1"]:[]),
      ...(v11Test.maxCalibrationError>0.08?[`calibration_error_${v11Test.maxCalibrationError}_above_0.08`]:[]),
      "historical_market_roi_clv_not_validated",
      "research_source_not_a_production_dependency",
    ]
  }
};
await fs.mkdir(path.dirname(OUT),{recursive:true});
await fs.writeFile(OUT,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
