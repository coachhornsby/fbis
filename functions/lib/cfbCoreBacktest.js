/**
 * Read-only, rolling-origin CORE challenger evaluation.
 * Input rows must carry actual final results and independently frozen
 * pregame CORE + champion baseline, never recomputed postgame season ratings.
 */
import {fitRidge,predictRidge,mae} from "./cfbFbisV2Fit.js";
import {buildCfbCoreMatchupVector,CFB_CORE_FEATURE_KEYS,CFB_CORE_SHADOW_ID} from "./cfbCoreChallenger.js";

const n = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const ROUND = x => Number.isFinite(x) ? Number(x.toFixed(4)) : null;
const vectors = rows => {
  const dedupe = new Set(),safe=[];
  const reject = {};
  for(const row of rows||[]){
    const id=String(row?.gameId||"");
    const season=n(row?.season),week=n(row?.week);
    const actualHome=n(row?.actualHome),actualAway=n(row?.actualAway);
    const kickoff=Date.parse(String(row?.kickoff||""));
    const finalAt=Date.parse(String(row?.finalAt||""));
    if(!id || dedupe.has(id) || !Number.isFinite(kickoff) ||
      !Number.isFinite(finalAt) || finalAt<=kickoff ||
      row?.finalVerified!==true || actualHome==null || actualAway==null){
      reject.finalOrDuplicate=(reject.finalOrDuplicate||0)+1;continue;
    }
    dedupe.add(id);
    const v=buildCfbCoreMatchupVector({...row,season,week});
    if(!v.ok){reject[v.reason]=(reject[v.reason]||0)+1;continue}
    safe.push({id,season,week,vector:v,
      x:CFB_CORE_FEATURE_KEYS.map(k=>v.features[k]),
      actualMargin:actualHome-actualAway,actualTotal:actualHome+actualAway,
      baselineMargin:v.features.baselineMargin,
      baselineTotal:v.features.baselineTotal});
  }
  return {safe,rejected:reject};
};

export function evaluateCoreWalkForward(rows = [], {
  minTrain=100,minTest=50,minFolds=2,lambda=30,
}={}) {
  const {safe,rejected}=vectors(rows);
  const seasons=[...new Set(safe.map(r=>r.season))].sort((a,b)=>a-b);
  const folds=[],pooled=[];
  for(const season of seasons.slice(1)){
    const train=safe.filter(r=>r.season<season);
    const test=safe.filter(r=>r.season===season);
    if(train.length<minTrain || test.length<minTest)continue;
    // Comparison is fair: both baseline-only and CORE challengers are
    // ridge-fitted using the IDENTICAL older-season train population.
    const trainX=train.map(r=>r.x),testX=test.map(r=>r.x);
    const baseX=trainX.map(x=>x.slice(0,2)),baseTest=testX.map(x=>x.slice(0,2));
    const mTarget=train.map(r=>r.actualMargin),tTarget=train.map(r=>r.actualTotal);
    const bm=fitRidge(baseX,mTarget,{lambda}),bt=fitRidge(baseX,tTarget,{lambda});
    const cm=fitRidge(trainX,mTarget,{lambda,featureNames:CFB_CORE_FEATURE_KEYS});
    const ct=fitRidge(trainX,tTarget,{lambda,featureNames:CFB_CORE_FEATURE_KEYS});
    if(!bm.ok || !bt.ok || !cm.ok || !ct.ok)continue;
    const oldM=predictRidge(bm,baseTest),oldT=predictRidge(bt,baseTest);
    const newM=predictRidge(cm,testX),newT=predictRidge(ct,testX);
    const yM=test.map(r=>r.actualMargin),yT=test.map(r=>r.actualTotal);
    const fold={
      testSeason:season,trainSeasons:[...new Set(train.map(r=>r.season))],
      nTrain:train.length,nTest:test.length,
      baseline:{marginMae:ROUND(mae(yM,oldM)),totalMae:ROUND(mae(yT,oldT))},
      core:{marginMae:ROUND(mae(yM,newM)),totalMae:ROUND(mae(yT,newT))},
    };
    fold.delta={
      marginMae:ROUND(fold.core.marginMae-fold.baseline.marginMae),
      totalMae:ROUND(fold.core.totalMae-fold.baseline.totalMae),
    };
    folds.push(fold);
    for(let i=0;i<test.length;i++)pooled.push({
      season,gameId:test[i].id,
      oldMarginErr:Math.abs(oldM[i]-yM[i]),newMarginErr:Math.abs(newM[i]-yM[i]),
      oldTotalErr:Math.abs(oldT[i]-yT[i]),newTotalErr:Math.abs(newT[i]-yT[i]),
    });
  }
  const average = key => pooled.length?ROUND(pooled.reduce((s,r)=>s+r[key],0)/pooled.length):null;
  const comparison={
    n:pooled.length,
    margin:{baselineMae:average("oldMarginErr"),coreMae:average("newMarginErr")},
    total:{baselineMae:average("oldTotalErr"),coreMae:average("newTotalErr")},
  };
  comparison.margin.delta=pooled.length?ROUND(comparison.margin.coreMae-comparison.margin.baselineMae):null;
  comparison.total.delta=pooled.length?ROUND(comparison.total.coreMae-comparison.total.baselineMae):null;
  const allSeasonsPass=folds.every(f=>f.delta.marginMae<0 && f.delta.totalMae<0);
  const verifiedOos=folds.length>=minFolds && pooled.length>=minTest*minFolds &&
    allSeasonsPass && comparison.margin.delta<0 && comparison.total.delta<0;
  const artifact = verifiedOos ? (() => {
    const X=safe.map(r=>r.x);
    const margin=fitRidge(X,safe.map(r=>r.actualMargin),{lambda,featureNames:CFB_CORE_FEATURE_KEYS});
    const total=fitRidge(X,safe.map(r=>r.actualTotal),{lambda,featureNames:CFB_CORE_FEATURE_KEYS});
    if(!margin.ok||!total.ok)return null;
    return {modelId:CFB_CORE_SHADOW_ID,version:"research-v1",authority:"research_only",
      verifiedOos:true,lastTrainingSeason:Math.max(...seasons),
      features:[...CFB_CORE_FEATURE_KEYS],margin,total,
      canInfluenceProduction:false,canAuthorizeWager:false};
  })() : null;
  return {
    modelId:CFB_CORE_SHADOW_ID,authority:"research_only",
    canInfluenceProduction:false,canQualify:false,canAuthorizeWager:false,
    inputRows:rows.length,eligibleRows:safe.length,excluded:rejected,
    seasons,folds,comparison,verifiedOos:Boolean(artifact),
    artifact,
    decision: artifact?"OOS_CORE_INCREMENT_RESEARCH_ONLY":"INSUFFICIENT_OR_NO_INCREMENTAL_OOS_EDGE",
    noProviderCalls:true,
  };
}
