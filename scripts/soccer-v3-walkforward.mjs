#!/usr/bin/env node
import fs from "node:fs";
import { projectSoccerV2 } from "../functions/lib/soccerFbisV2.js";
import { projectSoccerV3, SOCCER_FBIS_V3_ID, SOCCER_FBIS_V3_VERSION } from "../functions/lib/soccerFbisV3.js";

const leagues=["eng.1","eng.2","ger.1","esp.1","ita.1","fra.1","uefa.champions","uefa.europa","usa.1","mex.1"];
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;};
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
const outcome=(h,a)=>h>a?"H":h<a?"A":"D";
const probs=p=>({H:Number(p.pHomeWin),D:Number(p.pDraw),A:Number(p.pAwayWin)});
const argmax=p=>["H","D","A"].sort((a,b)=>p[b]-p[a])[0];
const brier=(p,o)=>(["H","D","A"].reduce((s,k)=>s+(p[k]-(k===o?1:0))**2,0))/3;
const binBrier=(p,y)=>(Number(p)-Number(y))**2;

function ece(rows,prefix,bins=10){
  if(!rows.length)return null;let total=0;
  for(let b=0;b<bins;b++){
    const lo=b/bins,hi=(b+1)/bins;
    const bucket=rows.filter(r=>{
      const p=Math.max(r[prefix+"Home"],r[prefix+"Draw"],r[prefix+"Away"]);
      return p>=lo&&(b===bins-1?p<=hi:p<hi);
    });
    if(!bucket.length)continue;
    const conf=mean(bucket.map(r=>Math.max(r[prefix+"Home"],r[prefix+"Draw"],r[prefix+"Away"])));
    const acc=mean(bucket.map(r=>r[prefix+"Pick"]===r.outcome?1:0));
    total+=bucket.length/rows.length*Math.abs(acc-conf);
  }
  return total;
}
function asianOutcome(margin,line){const z=margin+line;return z>0?"W":z<0?"L":"P";}
function asianBrier(bucket,actual){
  if(!bucket)return null;
  const p={W:Number(bucket.win)||0,P:Number(bucket.push)||0,L:Number(bucket.loss)||0};
  return(["W","P","L"].reduce((s,k)=>s+(p[k]-(k===actual?1:0))**2,0))/3;
}
function asianAvg(model,margin){
  return mean([-0.5,0,0.5].map(line=>asianBrier(model?.homeAsian?.[String(line)],asianOutcome(margin,line))));
}
function metric(rows,prefix){
  return{
    n:rows.length,
    accuracy:rows.length?mean(rows.map(r=>r[prefix+"Pick"]===r.outcome?1:0)):null,
    brier:mean(rows.map(r=>r[prefix+"Brier"])),
    logLoss:mean(rows.map(r=>r[prefix+"LogLoss"])),
    ece:ece(rows,prefix)
  };
}
function derivativeMetric(rows,prefix){
  return{
    n:rows.length,
    goalMae:mean(rows.map(r=>r[prefix+"GoalMae"])),
    totalGoalMae:mean(rows.map(r=>r[prefix+"TotalMae"])),
    bttsBrier:mean(rows.map(r=>r[prefix+"BttsBrier"])),
    total25Brier:mean(rows.map(r=>r[prefix+"O25Brier"])),
    asianBrier:mean(rows.map(r=>r[prefix+"AsianBrier"]))
  };
}
function canonical(r){
  return{
    id:r.pitch_match_id,date:r.match_date,start:r.start_time||r.match_date,
    home:{name:r.home_team_name},away:{name:r.away_team_name},
    homeScore:n(r.home_score),awayScore:n(r.away_score)
  };
}

const all=[],coverage={};
for(const league of leagues){
  const path="artifacts/pitchapi/"+league+".json";
  if(!fs.existsSync(path)){coverage[league]={rows:0,error:"missing-export"};continue;}
  const payload=JSON.parse(fs.readFileSync(path,"utf8"));
  const rows=(payload.rows||[]).sort((a,b)=>String(a.match_date).localeCompare(String(b.match_date))||String(a.pitch_match_id).localeCompare(String(b.pitch_match_id)));
  coverage[league]={rows:rows.length,advanced:fieldCoverage(rows)};
  const seen=[];
  for(const r of rows){
    const hs=n(r.home_score),as=n(r.away_score);
    if(hs==null||as==null){seen.push(canonical(r));continue;}
    const game={id:r.pitch_match_id,start:r.start_time||r.match_date,soccerLeague:league,home:{name:r.home_team_name},away:{name:r.away_team_name}};
    const v2=projectSoccerV2(game,seen);
    const v3=projectSoccerV3(game,v2,rows);
    if(v2?.ok&&v3?.ok){
      const o=outcome(hs,as),p2=probs(v2),p3=probs(v3),actualTotal=hs+as,margin=hs-as,btts=hs>0&&as>0?1:0,o25=actualTotal>2.5?1:0;
      all.push({
        league,id:r.pitch_match_id,date:r.match_date,homeTeam:r.home_team_name,awayTeam:r.away_team_name,
        homeScore:hs,awayScore:as,outcome:o,
        v2Home:p2.H,v2Draw:p2.D,v2Away:p2.A,v3Home:p3.H,v3Draw:p3.D,v3Away:p3.A,
        v2Pick:argmax(p2),v3Pick:argmax(p3),
        v2Brier:brier(p2,o),v3Brier:brier(p3,o),
        v2LogLoss:-Math.log(Math.max(1e-12,p2[o])),v3LogLoss:-Math.log(Math.max(1e-12,p3[o])),
        pitchWeight:v3.ensemble?.pitchApiWeight??0,coverage:v3.pitchapi?.coverage??0,scoreLayerActive:v3.scoreLayer?.active===true,
        v2GoalMae:(Math.abs(Number(v2.home)-hs)+Math.abs(Number(v2.away)-as))/2,
        v3GoalMae:(Math.abs(Number(v3.home)-hs)+Math.abs(Number(v3.away)-as))/2,
        v2TotalMae:Math.abs(Number(v2.total)-actualTotal),v3TotalMae:Math.abs(Number(v3.total)-actualTotal),
        v2BttsBrier:binBrier(v2.pBttsYes,btts),v3BttsBrier:binBrier(v3.pBttsYes,btts),
        v2O25Brier:binBrier(v2.totals?.["2.5"]?.over,o25),v3O25Brier:binBrier(v3.totals?.["2.5"]?.over,o25),
        v2AsianBrier:asianAvg(v2,margin),v3AsianBrier:asianAvg(v3,margin)
      });
    }
    seen.push(canonical(r));
  }
}
const v2=metric(all,"v2"),v3=metric(all,"v3"),scoreRows=all.filter(r=>r.scoreLayerActive);
const v2Derivatives=derivativeMetric(scoreRows,"v2"),v3Derivatives=derivativeMetric(scoreRows,"v3");
const report={
  generatedAt:new Date().toISOString(),modelId:SOCCER_FBIS_V3_ID,modelVersion:SOCCER_FBIS_V3_VERSION,
  validation:"PITCHAPI_COVERED_TRUE_WALK_FORWARD",source:"PitchAPI canonical feature store",marketUsed:false,
  coverage,v2,v3,
  derivatives:{
    samplePolicy:"score-layer-active-only",v2:v2Derivatives,v3:v3Derivatives,
    deltas:scoreRows.length?{
      goalMae:v3Derivatives.goalMae-v2Derivatives.goalMae,
      totalGoalMae:v3Derivatives.totalGoalMae-v2Derivatives.totalGoalMae,
      bttsBrier:v3Derivatives.bttsBrier-v2Derivatives.bttsBrier,
      total25Brier:v3Derivatives.total25Brier-v2Derivatives.total25Brier,
      asianBrier:v3Derivatives.asianBrier-v2Derivatives.asianBrier
    }:null
  },
  deltas:all.length?{accuracy:v3.accuracy-v2.accuracy,brier:v3.brier-v2.brier,logLoss:v3.logLoss-v2.logLoss,ece:v3.ece-v2.ece}:null,
  leagues:Object.fromEntries(leagues.map(l=>{
    const x=all.filter(r=>r.league===l),d=x.filter(r=>r.scoreLayerActive);
    return[l,{v2:metric(x,"v2"),v3:metric(x,"v3"),v2Derivatives:derivativeMetric(d,"v2"),v3Derivatives:derivativeMetric(d,"v3")}];
  })),
  marketBenchmark:{status:"SEPARATE_FROZEN_REPLAY",availableHistoricalFamilies:["1X2"],missingHistoricalFamilies:["BTTS","totals","Asian handicap"],policy:"do not impute unavailable historical market prices"},
  promotion:{
    samplePass:all.length>=1000,
    beatsV2Brier:all.length?v3.brier<v2.brier:false,
    beatsV2LogLoss:all.length?v3.logLoss<v2.logLoss:false,
    nonDegradingAccuracy:all.length?v3.accuracy>=v2.accuracy-.0025:false,
    derivativeSamplePass:scoreRows.length>=500,
    derivativeImprovement:scoreRows.length>=500&&v3Derivatives.bttsBrier<=v2Derivatives.bttsBrier&&v3Derivatives.total25Brier<=v2Derivatives.total25Brier&&v3Derivatives.totalGoalMae<=v2Derivatives.totalGoalMae,
    decision:all.length>=1000&&v3.brier<v2.brier&&v3.logLoss<v2.logLoss&&v3.accuracy>=v2.accuracy-.0025?"HISTORICAL_EVIDENCE_PASS":"RESEARCH",
    canQualify:false,canAuthorize:false
  }
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/soccer-v3-walkforward-report.json",JSON.stringify(report,null,2));
fs.writeFileSync("artifacts/soccer-v3-walkforward-rows.jsonl",all.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));

function fieldCoverage(rows){
  const fields=["home_xg","home_xgot","home_ppda","home_field_tilt","home_box_entries","home_xt","home_vaep","home_progressive_passes","home_xag","home_possession","home_network_centralization"];
  return Object.fromEntries(fields.map(f=>[f,rows.length?rows.filter(r=>n(r[f])!=null).length/rows.length:0]));
}
