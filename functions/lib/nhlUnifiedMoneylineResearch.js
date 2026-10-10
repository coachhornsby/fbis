/**
 * Point-in-time historical three-head moneyline research.
 * Offline only: never fits from live events or mutates a production artifact.
 */
const finite = v => typeof v==="number"&&Number.isFinite(v);
const sigmoid = z => z>=0 ? 1/(1+Math.exp(-z)) : Math.exp(z)/(1+Math.exp(z));
const logit = p => Math.log(Math.max(1e-6,Math.min(1-1e-6,p))/(1-Math.max(1e-6,Math.min(1-1e-6,p))));
const mean = xs => xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const rounded = n => n==null?null:Number(n.toFixed(6));

export const NHL_UNIFIED_RESEARCH_CANDIDATES=Object.freeze({
  incumbent:[],
  scoreOnly:["score"],
  incumbentCal:["incumbent"],
  winOnly:["win"],
  goalieOnly:["goalie"],
  incumbentWin:["incumbent","win"],
  incumbentGoalie:["incumbent","goalie"],
  winGoalie:["win","goalie"],
  allThree:["incumbent","win","goalie"],
});

export function qualifyNhlPITHistoricalRow(r){
  const errors=[];
  const start=Date.parse(r?.gameStart||""),cutoff=Date.parse(r?.featureCutoffTimestamp||""),
    frozen=Date.parse(r?.frozenAt||"");
  if(!r?.eventId||!r?.season||!r?.home||!r?.away||r.home===r.away)
    errors.push("EVENT_IDENTITY_INCOMPLETE");
  if(!r?.snapshotId||r?.immutableSnapshot!==true||r?.sourcePITVerified!==true)
    errors.push("IMMUTABLE_PIT_SNAPSHOT_REQUIRED");
  if(!Number.isFinite(start)||!Number.isFinite(cutoff)||!Number.isFinite(frozen)||
     cutoff>frozen||frozen>=start) errors.push("FEATURE_OR_FROZEN_CUTOFF_INVALID");
  if(r?.marketInformed!==false||r?.marketScope!=="FULL_GAME_INCLUDING_OT_SHOOTOUT")
    errors.push("MARKET_SCOPE_OR_PREDICTION_INDEPENDENCE_INVALID");
  if(r?.outcomeHomeWin!==0&&r?.outcomeHomeWin!==1)
    errors.push("OUTCOME_NOT_BINARY");
  const probs=r?.components||{};
  for(const key of ["incumbent","win","goalie","score"]){
    if(!finite(probs[key])||probs[key]<=0||probs[key]>=1)
      errors.push("INVALID_COMPONENT_"+key.toUpperCase());
  }
  if(r?.modelVersions?.proV2==null||r?.modelVersions?.winV1==null||r?.modelVersions?.goalieShadow==null)
    errors.push("COMPONENT_MODEL_VERSIONS_MISSING");
  return {ok:errors.length===0,errors};
}

function design(r,names){
  return [1,...names.map(n=>logit(r.components[n]))];
}
export function fitNhlResearchLogistic(rows,names,{ridge=.08,iterations=1600,step=.15}={}){
  if(!rows.length||!names.length)throw Error("TRAINING_ROWS_AND_COMPONENTS_REQUIRED");
  if(!Number.isFinite(ridge)||ridge<0||ridge>10)throw Error("RIDGE_INVALID");
  const coefficients=Array(names.length+1).fill(0);
  const xs=rows.map(r=>design(r,names));
  for(let stepN=0;stepN<iterations;stepN++){
    const grad=coefficients.map(()=>0);
    for(let i=0;i<rows.length;i++){
      const z=xs[i].reduce((sum,v,j)=>sum+v*coefficients[j],0);
      const residual=sigmoid(z)-rows[i].outcomeHomeWin;
      for(let j=0;j<grad.length;j++)grad[j]+=residual*xs[i][j]/rows.length;
    }
    for(let j=0;j<grad.length;j++){
      if(j>0)grad[j]+=ridge*coefficients[j];
      coefficients[j]-=step*grad[j];
    }
  }
  return coefficients;
}
export function scoreNhlResearchModel(r,names,coef){
  if(!names.length)return r.components.incumbent;
  const v=design(r,names);
  return sigmoid(v.reduce((sum,x,i)=>sum+x*coef[i],0));
}
function metrics(rows,preds){
  const n=rows.length;
  if(!n)return {n:0,brier:null,logLoss:null,accuracy:null,ece:null,calibrationIntercept:null,calibrationSlope:null};
  const scored=rows.map((r,i)=>{
    const p=Math.max(1e-6,Math.min(1-1e-6,preds[i])),y=r.outcomeHomeWin;
    return {p,y,brier:(p-y)**2,loss:-(y*Math.log(p)+(1-y)*Math.log(1-p)),correct:Number((p>=.5)===Boolean(y))};
  });
  const groups=new Map();
  for(const x of scored){
    const band=Math.min(9,Math.floor(x.p*10));
    const arr=groups.get(band)||[];arr.push(x);groups.set(band,arr);
  }
  const ece=[...groups.values()].reduce((sum,arr)=>sum+arr.length/n*Math.abs(mean(arr.map(x=>x.p))-mean(arr.map(x=>x.y))),0);
  // Logistic calibration slope/intercept fitted on evaluation set for diagnosis,
  // never reused for prediction or test-set model selection.
  const diagnostics=fitNhlResearchLogistic(
    rows.map((r,i)=>({...r,components:{...r.components,incumbent:scored[i].p}})),["incumbent"],
    {ridge:0,iterations:2200,step:.1});
  return {n,brier:rounded(mean(scored.map(x=>x.brier))),logLoss:rounded(mean(scored.map(x=>x.loss))),
    accuracy:rounded(mean(scored.map(x=>x.correct))),ece:rounded(ece),
    calibrationIntercept:rounded(diagnostics[0]),calibrationSlope:rounded(diagnostics[1])};
}
function bucketMetrics(rows,preds){
  const values=[
    ["homeFavorite",(r,p)=>p>=.5],["homeUnderdog",(r,p)=>p<.5],
    ["home",(r)=>Boolean(r.home)],["confirmedGoalies",(r)=>r.goalieStatus==="CONFIRMED_BOTH"],
    ["projectedOrUnknownGoalies",(r)=>r.goalieStatus!=="CONFIRMED_BOTH"]
  ];
  const grouped={};
  for(const [name,fn] of values){
    const indices=rows.map((r,i)=>fn(r,preds[i])?i:-1).filter(i=>i>=0);
    grouped[name]=metrics(indices.map(i=>rows[i]),indices.map(i=>preds[i]));
  }
  return grouped;
}
function bootstrapPairedBrier(rows,cand,base,reps=300){
  if(rows.length<10)return {delta:null,ci95:null};
  const deltas=rows.map((r,i)=>(cand[i]-r.outcomeHomeWin)**2-(base[i]-r.outcomeHomeWin)**2);
  const m=mean(deltas);
  let seed=104729;
  const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const sims=[];
  for(let j=0;j<reps;j++){
    let sum=0;
    for(let i=0;i<deltas.length;i++)sum+=deltas[Math.floor(rnd()*deltas.length)];
    sims.push(sum/deltas.length);
  }
  sims.sort((a,b)=>a-b);
  return {delta:rounded(m),ci95:[rounded(sims[Math.floor(.025*reps)]),rounded(sims[Math.floor(.975*reps)])]};
}

export function evaluateNhlUnifiedWalkforward(rows=[],{trainSeasons=[],validationSeasons=[],testSeasons=[],minimumTestGames=200}={}){
  const groups=[trainSeasons,validationSeasons,testSeasons];
  if(groups.some(a=>!Array.isArray(a)||!a.length))throw Error("EXPLICIT_NONEMPTY_SEASON_SPLITS_REQUIRED");
  const flat=groups.flat();
  if(new Set(flat).size!==flat.length)throw Error("OVERLAPPING_SPLITS");
  const last=a=>a.at(-1);
  if(!(String(last(trainSeasons))<String(validationSeasons[0])&&
      String(last(validationSeasons))<String(testSeasons[0])))throw Error("SPLITS_NOT_CHRONOLOGICAL");
  const rejected=[],accepted=[],seen=new Set();
  for(const row of rows){
    const v=qualifyNhlPITHistoricalRow(row);
    const key=String(row?.eventId||"");
    if(seen.has(key))v.errors.push("DUPLICATE_EVENT");
    seen.add(key);
    if(v.errors.length)rejected.push({eventId:key,reasons:v.errors});
    else accepted.push(row);
  }
  if(rejected.length)throw Error("PIT_VALIDATION_FAILED "+JSON.stringify(rejected.slice(0,10)));
  const of=seasons=>accepted.filter(r=>seasons.includes(String(r.season)));
  const train=of(trainSeasons),val=of(validationSeasons),test=of(testSeasons);
  if(train.length<50||val.length<50||test.length<minimumTestGames)
    throw Error("SAMPLE_INSUFFICIENT train="+train.length+" validation="+val.length+" test="+test.length);
  const fitted={};
  const predicted=(which,split)=>{
    const names=NHL_UNIFIED_RESEARCH_CANDIDATES[which];
    const coef=fitted[which];
    return split.map(r=>scoreNhlResearchModel(r,names,coef));
  };
  const validation={};
  for(const [name,features] of Object.entries(NHL_UNIFIED_RESEARCH_CANDIDATES)){
    fitted[name]=features.length?fitNhlResearchLogistic(train,features):null;
    validation[name]=metrics(val,predicted(name,val));
  }
  const selected=Object.keys(validation).sort((a,b)=>
    validation[a].brier-validation[b].brier||
    validation[a].logLoss-validation[b].logLoss||
    a.localeCompare(b))[0];
  const out={};
  const baseline=predicted("incumbent",test);
  for(const name of Object.keys(NHL_UNIFIED_RESEARCH_CANDIDATES)){
    const preds=predicted(name,test);
    out[name]={
      metrics:metrics(test,preds),
      pairedBrier:bootstrapPairedBrier(test,preds,baseline),
      bySeason:Object.fromEntries(testSeasons.map(s=>{
        const indices=test.map((r,i)=>String(r.season)===s?i:-1).filter(i=>i>=0);
        return [s,metrics(indices.map(i=>test[i]),indices.map(i=>preds[i]))];
      })),
      segments:bucketMetrics(test,preds),
      coefficients:fitted[name],
    };
  }
  return {
    modelId:"NHL-UNIFIED-ML-SHADOW-v1",status:"UNQUALIFIED_SHADOW_RESEARCH",
    pointInTime:true,marketInformed:false,marketScope:"FULL_GAME_INCLUDING_OT_SHOOTOUT",
    split:{trainSeasons,validationSeasons,testSeasons,trainN:train.length,validationN:val.length,testN:test.length},
    validation,selectedByValidation:selected,test:out,
    selectedOnUntouchedTest:false,
    allThreeIncrementalBrierVsIncumbent:out.allThree.pairedBrier,
    promotionEligible:false,canQualify:false,canAuthorizeWager:false,
    limitations:["Retrospective replay is not prospective CLV/economics","No market prices inferred",
      "Split-test requires independent confirmation of PIT feature construction",
      "Do not promote solely from positive retrospective outcomes"]
  };
}
