#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
const root=process.env.ROOT||"pit-artifacts",out=process.env.OUT||"pitcher-k-pit-full.json";
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const mae=a=>mean(a.map(Math.abs));
const rmse=a=>Math.sqrt(mean(a.map(x=>x*x)));
const corr=(a,b)=>{if(a.length!==b.length||a.length<2)return null;const ma=mean(a),mb=mean(b);let n=0,da=0,db=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;n+=x*y;da+=x*x;db+=y*y}return da>0&&db>0?n/Math.sqrt(da*db):null};
async function walk(dir){let out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else if(e.name.endsWith(".json"))out.push(p)}return out}
const files=await walk(root),shards=[],units=[];
for(const f of files){const j=JSON.parse(await fs.readFile(f,"utf8"));if(j.summary&&Array.isArray(j.units)){shards.push(j.summary);units.push(...j.units)}}
units.sort((a,b)=>String(a.entry_timestamp).localeCompare(String(b.entry_timestamp)));
const keys=new Set(),dupes=[];for(const u of units){if(keys.has(u.projection_unit_key))dupes.push(u.projection_unit_key);keys.add(u.projection_unit_key)}
const dates=[...new Set(units.map(u=>u.event_date))].sort(),errs=units.map(u=>u.projection-u.actual_value),base=units.map(u=>u.baseline_projection-u.actual_value);
const directional=units.filter(u=>u.selection!=="PUSH"),wins=directional.filter(u=>u.result==="WIN").length;
const n=units.length,trainEnd=Math.floor(n*.60),valEnd=Math.floor(n*.80);
const split={trainN:trainEnd,validationN:valEnd-trainEnd,testN:n-valEnd,walkForwardN:n-trainEnd};
const defs=[[0,.5],[.5,1],[1,1.5],[1.5,99]],buckets=defs.map(([lo,hi],i)=>{const xs=directional.filter(u=>Math.abs(u.projection-u.entry_line)>=lo&&Math.abs(u.projection-u.entry_line)<hi);return{order:i,label:hi===99?">=1.5":lo+"-"+hi,n:xs.length,hitRate:xs.length?xs.filter(u=>u.result==="WIN").length/xs.length:null}});
const populated=buckets.filter(x=>x.n>0&&x.hitRate!=null);
let cum=0,peak=0,maxDrawdown=0;for(const u of units){cum+=Number(u.profit_units||0);peak=Math.max(peak,cum);maxDrawdown=Math.max(maxDrawdown,peak-cum)}
const summary={
 generatedAt:new Date().toISOString(),shardCount:shards.length,rawMarketRows:shards.reduce((s,x)=>s+(x.rawMarketRows||0),0),
 independentUnits:n,duplicateProjectionUnitKeys:[...new Set(dupes)],dates:dates.length,dateList:dates,split,
 temporalIntegrity:units.every(u=>u.temporal_integrity===true&&u.entry_timestamp<u.event_start),
 projection:{mae:mae(errs),rmse:rmse(errs),bias:mean(errs),baselineMae:mae(base),relativeMaeImprovement:mae(base)?(mae(base)-mae(errs))/mae(base):null},
 directional:{n:directional.length,wins,hitRate:directional.length?wins/directional.length:null,over:directional.filter(u=>u.selection==="OVER").length,under:directional.filter(u=>u.selection==="UNDER").length,buckets,edgeHitMonotonic:populated.every((b,i)=>i===0||b.hitRate+0.03>=populated[i-1].hitRate),edgeHitRankCorrelation:corr(populated.map(b=>b.order),populated.map(b=>b.hitRate))},
 economics:{closeReady:units.filter(u=>u.close_timestamp).length,probabilityClvReady:units.filter(u=>u.probability_clv!=null).length,roiReady:units.filter(u=>Number.isFinite(u.profit_units)).length,profitUnits:units.reduce((s,u)=>s+Number(u.profit_units||0),0),roi:n?units.reduce((s,u)=>s+Number(u.profit_units||0),0)/n:null,maxDrawdown,meanLineClv:mean(units.map(u=>u.line_clv).filter(Number.isFinite)),meanProbabilityClv:mean(units.map(u=>u.probability_clv).filter(Number.isFinite))},
 eventIdentity:{originalGameIdMatched:shards.reduce((a,s)=>a+Number(s.eventIdentity?.originalGameIdMatched||0),0),originalGameIdRemapped:shards.reduce((a,s)=>a+Number(s.eventIdentity?.originalGameIdRemapped||0),0)},
 rejects:Object.fromEntries([...new Set(shards.flatMap(s=>Object.keys(s.rejects||{})))].map(k=>[k,shards.reduce((a,s)=>a+Number(s.rejects?.[k]||0),0)]))
};
const eid=summary.eventIdentity;eid.remapRate=(eid.originalGameIdMatched+eid.originalGameIdRemapped)?eid.originalGameIdRemapped/(eid.originalGameIdMatched+eid.originalGameIdRemapped):null;
summary.gates={
 insufficientData:{minN:250,minWF:150,minDates:17,passN:n>=250,passWF:split.walkForwardN>=150,passDates:dates.length>=17},
 calibrationCandidate:{minN:500,minWF:300,minDates:30,minDirectionalEach:100,nDeficit:Math.max(0,500-n),wfDeficit:Math.max(0,300-split.walkForwardN),dateDeficit:Math.max(0,30-dates.length),overDeficit:Math.max(0,100-summary.directional.over),underDeficit:Math.max(0,100-summary.directional.under)},
 promotionReady:{minN:1000,minWF:600,minDates:45,minDirectionalEach:200,nDeficit:Math.max(0,1000-n),wfDeficit:Math.max(0,600-split.walkForwardN),dateDeficit:Math.max(0,45-dates.length),overDeficit:Math.max(0,200-summary.directional.over),underDeficit:Math.max(0,200-summary.directional.under),prospectiveDaysRequired:14}
};
summary.gateClassification=summary.gates.insufficientData.passN&&summary.gates.insufficientData.passWF&&summary.gates.insufficientData.passDates?"RESEARCH_CONTINUE":"INSUFFICIENT_DATA";
await fs.writeFile(out,JSON.stringify({summary,units,shards},null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
