#!/usr/bin/env node
import fs from "node:fs";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const impactFile=args.impact||"artifacts/nba-player-impact-v1.json";
const benchmarkFile=args.benchmarks||"artifacts/nba-impact-benchmarks.json";
const out=args.out||"artifacts/nba-impact-benchmark-evaluation.json";

const impact=JSON.parse(fs.readFileSync(impactFile,"utf8"));
const external=fs.existsSync(benchmarkFile)&&fs.statSync(benchmarkFile).size?JSON.parse(fs.readFileSync(benchmarkFile,"utf8")):{rows:[]};
const rows=Array.isArray(external)?external:(external.rows||[]);
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const rank=xs=>{const s=[...xs].sort((a,b)=>a.v-b.v);const m=new Map();s.forEach((x,i)=>m.set(x.k,i+1));return m};
const corr=(a,b)=>{
  if(a.length<3||a.length!==b.length)return null;
  const ma=a.reduce((x,y)=>x+y,0)/a.length,mb=b.reduce((x,y)=>x+y,0)/b.length;
  let n=0,da=0,db=0;for(let i=0;i<a.length;i++){const xa=a[i]-ma,xb=b[i]-mb;n+=xa*xb;da+=xa*xa;db+=xb*xb}
  return da&&db?n/Math.sqrt(da*db):null;
};
const metrics={};
for(const metric of ["EPM","DARKO","RAPM","VORP","WS48"]){
  const ext=rows.filter(r=>String(r.metric||"").toUpperCase()===metric&&finite(r.value)!=null);
  const pairs=[];
  for(const r of ext){
    const id=String(r.playerId||r.player_id||""),p=impact.players?.[id];if(!p)continue;
    const v=finite(r.value),f=finite(p.net);if(v==null||f==null)continue;
    pairs.push({id,fbis:f,ext:v});
  }
  const rf=rank(pairs.map(x=>({k:x.id,v:x.fbis}))),re=rank(pairs.map(x=>({k:x.id,v:x.ext})));
  metrics[metric]={
    n:pairs.length,
    pearson:corr(pairs.map(x=>x.fbis),pairs.map(x=>x.ext)),
    spearman:corr(pairs.map(x=>rf.get(x.id)),pairs.map(x=>re.get(x.id))),
    role:metric==="EPM"?"PRIMARY_RESEARCH_BENCHMARK":metric==="DARKO"?"SECONDARY_DYNAMIC_BENCHMARK":metric==="RAPM"?"STRUCTURAL_BENCHMARK":"HISTORICAL_DIAGNOSTIC"
  };
}
const report={generatedAt:new Date().toISOString(),modelId:"NBA-FBIS-PLAYER-IMPACT-v1",metrics,
  governance:{externalMetricsResearchOnly:true,productionDependency:false,missingExternalRowsAllowed:true}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
