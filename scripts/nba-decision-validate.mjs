#!/usr/bin/env node
import fs from "node:fs";
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const input=args.input||"artifacts/all-decisions.json";
const confidenceFile=args.confidence||"artifacts/nba-confidence-calibration.json";
const out=args.out||"artifacts/nba-decision-validation.json";
const sqlOut=args.sql||"artifacts/nba-decision-validation.sql";
const createdAt=new Date().toISOString();
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
function read(path){
 if(!fs.existsSync(path)||!fs.statSync(path).size)return[];
 const x=JSON.parse(fs.readFileSync(path,"utf8"));
 if(Array.isArray(x)){
   if(x.every(r=>Array.isArray(r?.results)))return x.flatMap(r=>r.results);
   if(x.length===1&&Array.isArray(x[0]?.results))return x[0].results;
   return x;
 }
 if(Array.isArray(x?.results))return x.results;
 if(Array.isArray(x?.result))return x.result.flatMap(r=>r?.results||[]);
 return[];
}
const rows=read(input).filter(r=>String(r.decision||"")==="BET");
const graded=rows.filter(r=>["WIN","LOSS","PUSH"].includes(String(r.result||"")));
let running=0,peak=0,maxDd=0;
for(const r of [...graded].sort((a,b)=>Date.parse(a.decision_timestamp||0)-Date.parse(b.decision_timestamp||0))){
 running+=finite(r.profit_units)||0; peak=Math.max(peak,running); maxDd=Math.max(maxDd,peak-running);
}
const units=graded.reduce((s,r)=>s+(finite(r.profit_units)||0),0);
const clv=graded.map(r=>finite(r.clv_line)).filter(v=>v!=null);
const positiveClvRate=clv.length?clv.filter(v=>v>0).length/clv.length:null;
const probs=graded.map(r=>({p:finite(r.model_probability),y:r.result==="WIN"?1:r.result==="LOSS"?0:null})).filter(x=>x.p!=null&&x.y!=null);
const brier=probs.length?probs.reduce((s,x)=>s+(x.p-x.y)**2,0)/probs.length:null;
const logLoss=probs.length?probs.reduce((s,x)=>{const p=Math.max(.001,Math.min(.999,x.p));return s-(x.y*Math.log(p)+(1-x.y)*Math.log(1-p));},0)/probs.length:null;
const byMonth={};
for(const r of graded){
 const m=String(r.decision_timestamp||"").slice(0,7)||"unknown";
 if(!byMonth[m])byMonth[m]={n:0,units:0};
 byMonth[m].n++;byMonth[m].units+=finite(r.profit_units)||0;
}
for(const v of Object.values(byMonth))v.roiPct=v.n?v.units/v.n:null;
let confidence={sampleN:0,monotonicityPass:false};
try{confidence=JSON.parse(fs.readFileSync(confidenceFile,"utf8"))}catch{}
const report={
 id:`nba-decision-validation:${createdAt}`,modelId:"NBA-FBIS-v1",modelVersion:null,
 windowStart:graded.length?[...graded].sort((a,b)=>Date.parse(a.decision_timestamp)-Date.parse(b.decision_timestamp))[0].decision_timestamp:null,
 windowEnd:graded.length?[...graded].sort((a,b)=>Date.parse(a.decision_timestamp)-Date.parse(b.decision_timestamp)).at(-1).decision_timestamp:null,
 prospectiveN:rows.length,gradedN:graded.length,betN:rows.length,units,roiPct:graded.length?units/graded.length:null,
 maxDrawdownUnits:maxDd,positiveClvRate,calibration:{n:probs.length,brier,logLoss},
 confidenceMonotonicity:{sampleN:confidence.sampleN||0,pass:Boolean(confidence.monotonicityPass),details:confidence.details||null},
 seasonStability:byMonth,
 status:graded.length<50?"ACCUMULATING":(positiveClvRate??0)>=.52&&(graded.length?units/graded.length:0)>0&&confidence.monotonicityPass?"EVIDENCE_PASS":"EVIDENCE_FAIL",
 createdAt
};
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=finite(v);return n==null?"NULL":String(n)};
const sql=`INSERT OR REPLACE INTO nba_decision_validation_runs (id,model_id,model_version,window_start,window_end,prospective_n,graded_n,bet_n,units,roi_pct,max_drawdown_units,positive_clv_rate,calibration_json,confidence_monotonicity_json,season_stability_json,status,created_at) VALUES (${q(report.id)},'NBA-FBIS-v1',NULL,${q(report.windowStart)},${q(report.windowEnd)},${report.prospectiveN},${report.gradedN},${report.betN},${num(report.units)},${num(report.roiPct)},${num(report.maxDrawdownUnits)},${num(report.positiveClvRate)},${q(JSON.stringify(report.calibration))},${q(JSON.stringify(report.confidenceMonotonicity))},${q(JSON.stringify(report.seasonStability))},${q(report.status)},${q(createdAt)});`;
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
fs.writeFileSync(sqlOut,sql+"\n");
console.log(JSON.stringify(report,null,2));
