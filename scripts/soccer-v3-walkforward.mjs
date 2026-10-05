#!/usr/bin/env node
import fs from "node:fs";
import { projectSoccerV2 } from "../functions/lib/soccerFbisV2.js";
import { projectSoccerV3, SOCCER_FBIS_V3_ID, SOCCER_FBIS_V3_VERSION } from "../functions/lib/soccerFbisV3.js";

const leagues=["eng.1","esp.1","ger.1","ita.1","fra.1","usa.1","usa.nwsl"];
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function outcome(h,a){return h>a?"H":h<a?"A":"D";}
function probs(p){return{H:Number(p.pHomeWin),D:Number(p.pDraw),A:Number(p.pAwayWin)};}
function argmax(p){return["H","D","A"].sort((a,b)=>p[b]-p[a])[0];}
function brier(p,o){return(["H","D","A"].reduce((s,k)=>s+(p[k]-(k===o?1:0))**2,0))/3;}
function metric(rows,prefix){
  return{
    n:rows.length,
    accuracy:rows.length?mean(rows.map(r=>r[`${prefix}Pick`]===r.outcome?1:0)):null,
    brier:mean(rows.map(r=>r[`${prefix}Brier`])),
    logLoss:mean(rows.map(r=>r[`${prefix}LogLoss`])),
  };
}
function canonical(r){
  return{
    id:r.pitch_match_id,date:r.match_date,start:r.start_time||r.match_date,
    home:{name:r.home_team_name},away:{name:r.away_team_name},
    homeScore:n(r.home_score),awayScore:n(r.away_score),
  };
}
const all=[];
const coverage={};
for(const league of leagues){
  const path=`artifacts/pitchapi/${league}.json`;
  if(!fs.existsSync(path)){coverage[league]={rows:0,error:"missing-export"};continue;}
  const payload=JSON.parse(fs.readFileSync(path,"utf8")),rows=(payload.rows||[]).sort((a,b)=>String(a.match_date).localeCompare(String(b.match_date)));
  coverage[league]={rows:rows.length,advanced:fieldCoverage(rows)};
  const seen=[];
  for(const r of rows){
    const hs=n(r.home_score),as=n(r.away_score);if(hs==null||as==null){seen.push(canonical(r));continue;}
    const game={id:r.pitch_match_id,start:r.start_time||r.match_date,soccerLeague:league,home:{name:r.home_team_name},away:{name:r.away_team_name}};
    const v2=projectSoccerV2(game,seen);
    const v3=projectSoccerV3(game,v2,rows);
    if(v2?.ok&&v3?.ok){
      const o=outcome(hs,as),p2=probs(v2),p3=probs(v3);
      all.push({league,id:r.pitch_match_id,date:r.match_date,homeTeam:r.home_team_name,awayTeam:r.away_team_name,outcome:o,
        v2Home:p2.H,v2Draw:p2.D,v2Away:p2.A,v3Home:p3.H,v3Draw:p3.D,v3Away:p3.A,
        v2Pick:argmax(p2),v3Pick:argmax(p3),
        v2Brier:brier(p2,o),v3Brier:brier(p3,o),
        v2LogLoss:-Math.log(Math.max(1e-12,p2[o])),v3LogLoss:-Math.log(Math.max(1e-12,p3[o])),
        pitchWeight:v3.ensemble?.pitchApiWeight??0,coverage:v3.pitchapi?.coverage??0});
    }
    seen.push(canonical(r));
  }
}
const v2=metric(all,"v2"),v3=metric(all,"v3");
const report={
  generatedAt:new Date().toISOString(),modelId:SOCCER_FBIS_V3_ID,modelVersion:SOCCER_FBIS_V3_VERSION,
  validation:"PITCHAPI_COVERED_TRUE_WALK_FORWARD",source:"PitchAPI canonical feature store",marketUsed:false,
  coverage,v2,v3,
  deltas:all.length?{accuracy:v3.accuracy-v2.accuracy,brier:v3.brier-v2.brier,logLoss:v3.logLoss-v2.logLoss}:null,
  leagues:Object.fromEntries(leagues.map(l=>{const x=all.filter(r=>r.league===l);return[l,{v2:metric(x,"v2"),v3:metric(x,"v3")}];})),
  promotion:{
    samplePass:all.length>=1000,
    beatsV2Brier:all.length? v3.brier<v2.brier:false,
    beatsV2LogLoss:all.length? v3.logLoss<v2.logLoss:false,
    nonDegradingAccuracy:all.length? v3.accuracy>=v2.accuracy-.0025:false,
    decision:all.length>=1000&&v3.brier<v2.brier&&v3.logLoss<v2.logLoss&&v3.accuracy>=v2.accuracy-.0025?"HISTORICAL_EVIDENCE_PASS":"RESEARCH",
    canQualify:false,canAuthorize:false
  }
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/soccer-v3-walkforward-report.json",JSON.stringify(report,null,2));
fs.writeFileSync("artifacts/soccer-v3-walkforward-rows.jsonl",all.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));

function fieldCoverage(rows){
  const fields=["home_xg","home_xgot","home_ppda","home_field_tilt","home_box_entries","home_xt","home_vaep","home_progressive_passes","home_xag","home_possession"];
  return Object.fromEntries(fields.map(f=>[f,rows.length?rows.filter(r=>n(r[f])!=null).length/rows.length:0]));
}
