#!/usr/bin/env node
import fs from "node:fs";
import { projectSoccerV2 } from "../functions/lib/soccerFbisV2.js";
import { projectSoccerV3, SOCCER_FBIS_V3_VERSION } from "../functions/lib/soccerFbisV3.js";
import { pitchApiHistoryToGames } from "../functions/lib/soccerPitchApiStore.js";

const input=process.argv[2]||"artifacts/soccer-competition-history.json";
const output=process.argv[3]||"artifacts/soccer-competition-validation.json";
const payload=JSON.parse(fs.readFileSync(input,"utf8"));
const allRows=(payload.rows||[]).sort((a,b)=>String(a.match_date).localeCompare(String(b.match_date))||String(a.pitch_match_id).localeCompare(String(b.pitch_match_id)));
const rows=allRows.slice(-1400),league=String(payload.league||payload.heritageKey||rows[0]?.league_key||"");
const warmup=Math.min(200,Math.max(80,Math.floor(rows.length*.2))),seen=[],scored=[];
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
const outcome=(h,a)=>h>a?"H":h<a?"A":"D";
const probs=p=>({H:Number(p.pHomeWin),D:Number(p.pDraw),A:Number(p.pAwayWin)});
const argmax=p=>["H","D","A"].sort((a,b)=>p[b]-p[a])[0];
const brier=(p,o)=>(["H","D","A"].reduce((s,k)=>s+(p[k]-(k===o?1:0))**2,0))/3;
const gameRows=pitchApiHistoryToGames(rows);
for(let i=0;i<rows.length;i++){
  const r=rows[i],g=gameRows[i],hs=n(r.home_score),as=n(r.away_score);
  if(i>=warmup&&hs!=null&&as!=null){
    const target={id:g.id,start:g.start,date:g.date,soccerLeague:league,league,home:g.home,away:g.away};
    const v2=projectSoccerV2(target,seen);
    const v3=projectSoccerV3(target,v2,rows);
    if(v2?.ok&&v3?.ok){
      const o=outcome(hs,as),p2=probs(v2),p3=probs(v3);
      scored.push({
        v2Correct:argmax(p2)===o,v3Correct:argmax(p3)===o,
        v2Brier:brier(p2,o),v3Brier:brier(p3,o),
        v2LogLoss:-Math.log(Math.max(1e-12,p2[o])),v3LogLoss:-Math.log(Math.max(1e-12,p3[o])),
        coverage:Number(v3.pitchapi?.coverage||0)
      });
    }
  }
  seen.push(g);
  if(seen.length>1100)seen.shift();
}
const report={
  heritageName:payload.heritageName||null,heritageKey:league,modelVersion:SOCCER_FBIS_V3_VERSION,
  sourceRows:rows.length,warmup,sampleN:scored.length,
  v2Accuracy:mean(scored.map(x=>x.v2Correct?1:0)),v2Brier:mean(scored.map(x=>x.v2Brier)),v2LogLoss:mean(scored.map(x=>x.v2LogLoss)),
  v3Accuracy:mean(scored.map(x=>x.v3Correct?1:0)),v3Brier:mean(scored.map(x=>x.v3Brier)),v3LogLoss:mean(scored.map(x=>x.v3LogLoss)),
  advancedCoverage:mean(scored.map(x=>x.coverage)),generatedAt:new Date().toISOString(),marketUsed:false
};
report.deltaAccuracy=report.sampleN?report.v3Accuracy-report.v2Accuracy:null;
report.deltaBrier=report.sampleN?report.v3Brier-report.v2Brier:null;
report.deltaLogLoss=report.sampleN?report.v3LogLoss-report.v2LogLoss:null;
report.meta={boundedRows:1400,scoredAfterWarmup:true,pointInTime:true,marketUsed:false};
fs.mkdirSync(output.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
