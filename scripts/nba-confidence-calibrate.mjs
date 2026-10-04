#!/usr/bin/env node
import fs from "node:fs";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const input=args.input||"artifacts/nba-wager-decisions.json";
const out=args.out||"artifacts/nba-confidence-calibration.json";
const sqlOut=args.sql||"artifacts/nba-confidence-calibration.sql";
const minN=Number(args.minN||50);
const minBinN=Number(args.minBinN||10);
const createdAt=new Date().toISOString();

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
function readRows(path){
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
const rows=readRows(input).filter(r=>String(r.result||"").length>0&&finite(r.fbis_confidence)!=null);
const bins=[
  {label:"0-59",lo:0,hi:59},
  {label:"60-69",lo:60,hi:69},
  {label:"70-79",lo:70,hi:79},
  {label:"80-89",lo:80,hi:89},
  {label:"90-100",lo:90,hi:100},
];
const resultBins=bins.map(b=>{
  const rs=rows.filter(r=>Number(r.fbis_confidence)>=b.lo&&Number(r.fbis_confidence)<=b.hi);
  const graded=rs.filter(r=>["WIN","LOSS","PUSH"].includes(String(r.result)));
  const wins=graded.filter(r=>r.result==="WIN").length;
  const losses=graded.filter(r=>r.result==="LOSS").length;
  const profit=graded.reduce((s,r)=>s+(finite(r.profit_units)||0),0);
  const clv=graded.map(r=>finite(r.clv_line)).filter(v=>v!=null);
  return {
    ...b,n:graded.length,wins,losses,
    winRate:wins+losses?wins/(wins+losses):null,
    roiPct:graded.length?profit/graded.length:null,
    meanLineClv:clv.length?clv.reduce((a,b)=>a+b,0)/clv.length:null,
  };
});
const populated=resultBins.filter(b=>b.n>=minBinN);
function monotonic(metric,tolerance=0){
  const vals=populated.map(b=>finite(b[metric])).filter(v=>v!=null);
  if(vals.length<3)return false;
  for(let i=1;i<vals.length;i++)if(vals[i]+tolerance<vals[i-1])return false;
  return true;
}
const monotonicWin=monotonic("winRate",.015);
const monotonicRoi=monotonic("roiPct",.015);
const monotonicClv=monotonic("meanLineClv",.08);
const monotonicityPass=rows.length>=minN&&populated.length>=3&&[monotonicWin,monotonicRoi,monotonicClv].filter(Boolean).length>=2;
const calibration={
  id:`nba-confidence:${createdAt}`,
  modelId:"NBA-FBIS-v1",
  modelVersion:null,
  marketType:"all",
  sampleN:rows.length,
  bins:resultBins,
  monotonicityPass,
  details:{minN,minBinN,populatedBins:populated.length,monotonicWin,monotonicRoi,monotonicClv},
  createdAt
};
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const sql=`INSERT OR REPLACE INTO nba_confidence_calibration (id,model_id,model_version,market_type,sample_n,bins_json,brier_score,log_loss,roi_pct,positive_clv_rate,monotonicity_pass,monotonicity_details_json,training_cutoff,created_at) VALUES (${q(calibration.id)},'NBA-FBIS-v1',NULL,'all',${rows.length},${q(JSON.stringify(resultBins))},NULL,NULL,NULL,NULL,${monotonicityPass?1:0},${q(JSON.stringify(calibration.details))},${q(createdAt)},${q(createdAt)});`;
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(calibration,null,2)+"\n");
fs.writeFileSync(sqlOut,sql+"\n");
console.log(JSON.stringify(calibration,null,2));
