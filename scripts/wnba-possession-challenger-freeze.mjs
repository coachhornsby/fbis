#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  WNBA_GAMESTATE_CHALLENGER_ID,
  WNBA_LINEUP_CHALLENGER_ID,
  WNBA_PACE_CHALLENGER_ID,
  WNBA_POSSESSION_CHALLENGER_VERSION
} from "../functions/lib/wnbaProspectiveChallenger.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const rowsFile=args.rows||"artifacts/wnba-possession-ablation-rows.jsonl";
const reportFile=args.report||"artifacts/wnba-possession-ablation.json";
const out=args.out||"artifacts/wnba-possession-challenger-coefficients.json";
const sqlOut=args.sql||"artifacts/wnba-possession-challenger-coefficients.sql";
const source=args.source||"research/wnba/possession-shot/v1/run-37464927545/merged-linear";
const lambda=Number(args.lambda||25);
const read=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const rows=read(rowsFile).filter(r=>r.kind==="game");
const report=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile,"utf8")):{};

function fit(family,target){
  const sk=family+(target==="MARGIN"?"MarginSignal":"TotalSignal");
  const rk=family+(target==="MARGIN"?"MarginResidual":"TotalResidual");
  const xs=rows.map(r=>({x:finite(r[sk]),y:finite(r[rk])})).filter(r=>r.x!=null&&r.y!=null);
  if(!xs.length)return null;
  const mx=xs.reduce((s,r)=>s+r.x,0)/xs.length,my=xs.reduce((s,r)=>s+r.y,0)/xs.length;
  let num=0,den=lambda;for(const r of xs){num+=(r.x-mx)*(r.y-my);den+=(r.x-mx)**2}
  const slope=den?num/den:0,intercept=my-slope*mx;
  return {target,n:xs.length,intercept,slope,signalMean:mx,residualMean:my,lambda};
}
const specs=[
  {id:WNBA_GAMESTATE_CHALLENGER_ID,family:"game_state",targets:["MARGIN"]},
  {id:WNBA_LINEUP_CHALLENGER_ID,family:"lineup_strength",targets:["MARGIN","TOTAL"]},
  {id:WNBA_PACE_CHALLENGER_ID,family:"pace",targets:["MARGIN","TOTAL"]},
];
const frozenAt=new Date().toISOString(),coefficients=[];
for(const s of specs)for(const target of s.targets){
  const f=fit(s.family,target);if(!f)continue;
  coefficients.push({modelId:s.id,modelVersion:WNBA_POSSESSION_CHALLENGER_VERSION,family:s.family,...f,sourceCheckpoint:source,sourceGeneratedAt:report.generatedAt||null,frozenAt});
}
const sql=coefficients.map(c=>`INSERT OR REPLACE INTO wnba_possession_challenger_coefficients (model_id,model_version,target,intercept,slope,train_n,source_checkpoint,source_generated_at,frozen_at,details_json,production_eligible) VALUES (${q(c.modelId)},${q(c.modelVersion)},${q(c.target)},${c.intercept},${c.slope},${c.n},${q(c.sourceCheckpoint)},${q(c.sourceGeneratedAt)},${q(c.frozenAt)},${q(JSON.stringify({family:c.family,signalMean:c.signalMean,residualMean:c.residualMean,lambda:c.lambda}))},0);`);
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify({frozenAt,sourceCheckpoint:source,coefficients},null,2)+"\n");
fs.writeFileSync(sqlOut,sql.join("\n")+"\n");
console.log(JSON.stringify({ok:true,rows:rows.length,coefficients},null,2));
