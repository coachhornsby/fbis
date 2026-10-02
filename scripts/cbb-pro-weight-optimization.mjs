import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const path=process.argv[2]||"artifacts/source/cbb-data-stack-predictions.json";
const rows=JSON.parse(readFileSync(path,"utf8"));
const round=(n,d=3)=>Number(Number(n).toFixed(d));
const actual=r=>({margin:r.actualHome-r.actualAway,total:r.actualHome+r.actualAway});
const pred=(r,w)=>{
  const sources=[["cbbd",w.cbbd],["torvik",w.torvik],["kenpom",w.kenpom]].filter(([k,x])=>x>0&&r[k]);
  if(!sources.length) return null;
  const sw=sources.reduce((s,[,x])=>s+x,0);
  const home=sources.reduce((s,[k,x])=>s+r[k].home*x,0)/sw;
  const away=sources.reduce((s,[k,x])=>s+r[k].away*x,0)/sw;
  return {home,away,margin:home-away,total:home+away};
};
function metrics(rs,fn){
  let n=0,me=0,te=0,wins=0;
  for(const r of rs){const p=fn(r);if(!p)continue;const a=actual(r);n++;me+=Math.abs(p.margin-a.margin);te+=Math.abs(p.total-a.total);if((p.margin>0)===(a.margin>0))wins++;}
  return n?{n,marginMae:round(me/n,3),totalMae:round(te/n,3),winnerAccuracy:round(100*wins/n,2)}:{n:0,marginMae:null,totalMae:null,winnerAccuracy:null};
}
const grid=[];
for(let c=0;c<=20;c++)for(let t=0;t<=20-c;t++){const k=20-c-t;grid.push({cbbd:c/20,torvik:t/20,kenpom:k/20});}
function score(m){return m.marginMae + 0.35*m.totalMae - 0.03*m.winnerAccuracy;}
function select(train){
  let best=null;
  for(const w of grid){
    const required=train.filter(r=>(w.torvik===0||r.torvik)&&(w.kenpom===0||r.kenpom));
    if(required.length<1000)continue;
    const m=metrics(required,r=>pred(r,w));
    const objective=score(m);
    if(!best||objective<best.objective)best={w,m,objective};
  }
  return best;
}
const seasons=[...new Set(rows.map(r=>r.season))].sort((a,b)=>a-b);
const folds=[];
const out=[];
for(let i=1;i<seasons.length;i++){
  const testSeason=seasons[i], trainSeasons=seasons.slice(0,i);
  const train=rows.filter(r=>trainSeasons.includes(r.season));
  const test=rows.filter(r=>r.season===testSeason);
  const best=select(train); if(!best)continue;
  const common=test.filter(r=>r.kenpom);
  const opt=metrics(common,r=>pred(r,best.w));
  const baseline=metrics(common,r=>pred(r,{cbbd:1,torvik:0,kenpom:0}));
  const kpEqual=metrics(common,r=>pred(r,{cbbd:.5,torvik:0,kenpom:.5}));
  const fullEqual=metrics(common.filter(r=>r.torvik),r=>pred(r,{cbbd:1/3,torvik:1/3,kenpom:1/3}));
  folds.push({testSeason,trainSeasons,weights:Object.fromEntries(Object.entries(best.w).map(([k,v])=>[k,round(v,2)])),trainMetrics:best.m,trainObjective:round(best.objective,4),test:{optimized:opt,cbbd:baseline,cbbdKenpomEqual:kpEqual,fullEqual}});
  for(const r of common) out.push({...r,_fold:testSeason,_weights:best.w});
}
function agg(kind){
  if(kind==="optimized")return metrics(out,r=>pred(r,r._weights));
  if(kind==="cbbd")return metrics(out,r=>pred(r,{cbbd:1,torvik:0,kenpom:0}));
  if(kind==="cbbdKenpomEqual")return metrics(out,r=>pred(r,{cbbd:.5,torvik:0,kenpom:.5}));
  if(kind==="fullEqual")return metrics(out.filter(r=>r.torvik),r=>pred(r,{cbbd:1/3,torvik:1/3,kenpom:1/3}));
}
const report={ok:true,generatedAt:new Date().toISOString(),methodology:{split:"expanding-window by season; each test season uses weights selected only from earlier seasons",grid:"5 percentage-point simplex over CBBD/Torvik/KenPom",objective:"margin MAE + 0.35*total MAE - 0.03*winner accuracy percentage",note:"research-only; no production promotion"},sourceRows:rows.length,seasons,folds,holdout:{rows:out.length,folds:folds.length,metrics:{optimized:agg("optimized"),cbbd:agg("cbbd"),cbbdKenpomEqual:agg("cbbdKenpomEqual"),fullEqual:agg("fullEqual")}}};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-pro-weight-optimization.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
