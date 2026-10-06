#!/usr/bin/env node
import fs from "node:fs";
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const projectionsFile=args.projections||"artifacts/nba-prospective-projections.json";
const oddsFile=args.odds||"artifacts/nba-odds.json";
const out=args.out||"artifacts/nba-prospective-market-links.json";
const sqlOut=args.sql||"artifacts/nba-prospective-market-links.sql";
const flatten=x=>Array.isArray(x)?(x.every(r=>Array.isArray(r?.results))?x.flatMap(r=>r.results||[]):x):Array.isArray(x?.results)?x.results:[];
const projections=flatten(JSON.parse(fs.readFileSync(projectionsFile,"utf8")));
const odds=flatten(JSON.parse(fs.readFileSync(oddsFile,"utf8")));
const excluded=new Set(["00e02556d645d2d13352eaf9b644fc94603f23c1"]);
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>v==null||v===""||!Number.isFinite(Number(v))?"NULL":String(Number(v));
const valid=o=>{
 if(Number(o.rejected_post_start||0)!==0)return false;
 if(!["ml","spread","total"].includes(String(o.market||"").toLowerCase()))return false;
 if(!o.game_id||!o.captured_at||!o.game_start||!o.side)return false;
 const m=String(o.market).toLowerCase();
 if(m==="ml")return Number.isFinite(Number(o.price))&&Number.isFinite(Number(o.no_vig));
 return Number.isFinite(Number(o.line))&&Number.isFinite(Number(o.price))&&Number.isFinite(Number(o.no_vig));
};
const byGame=new Map();
for(const o of odds.filter(valid)){const k=String(o.game_id);if(!byGame.has(k))byGame.set(k,[]);byGame.get(k).push(o)}
const rows=[];
for(const p of projections){
 if(excluded.has(String(p.code_sha)))continue;
 const pred=Date.parse(p.prediction_timestamp),tip=Date.parse(p.tipoff_timestamp);
 const pool=(byGame.get(String(p.game_id))||[]).filter(o=>Date.parse(o.captured_at)<tip);
 const keys=[...new Set(pool.map(o=>String(o.market).toLowerCase()+"|"+String(o.side).toUpperCase()))];
 for(const key of keys){
   const [market,side]=key.split("|"),same=pool.filter(o=>String(o.market).toLowerCase()===market&&String(o.side).toUpperCase()===side).sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at));
   const entries=same.filter(o=>Date.parse(o.captured_at)<=pred);
   if(!entries.length)continue;
   const entry=entries.at(-1),close=same.at(-1);
   rows.push({id:[p.id,market,side].join(":"),projectionId:p.id,gameId:p.game_id,modelId:p.model_id,modelVersion:p.model_version,predictionTimestamp:p.prediction_timestamp,marketType:market,side,entry,close,gameStart:p.tipoff_timestamp});
 }
}
const sql=rows.map(r=>`INSERT OR REPLACE INTO nba_prospective_market_links (id,projection_id,game_id,model_id,model_version,prediction_timestamp,market_type,side,entry_snapshot_rowid,entry_line,entry_price,entry_no_vig,entry_captured_at,close_snapshot_rowid,close_line,close_price,close_no_vig,close_captured_at,game_start,market_used_as_feature,can_qualify,can_authorize,linked_at) VALUES (${q(r.id)},${q(r.projectionId)},${q(r.gameId)},${q(r.modelId)},${q(r.modelVersion)},${q(r.predictionTimestamp)},${q(r.marketType)},${q(r.side)},${num(r.entry.id)},${num(r.entry.line)},${num(r.entry.price)},${num(r.entry.no_vig)},${q(r.entry.captured_at)},${num(r.close.id)},${num(r.close.line)},${num(r.close.price)},${num(r.close.no_vig)},${q(r.close.captured_at)},${q(r.gameStart)},0,0,0,datetime('now'));`).join("\n");
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify({rows:rows.length,projectionCount:new Set(rows.map(r=>r.projectionId)).size,links:rows},null,2)+"\n");
fs.writeFileSync(sqlOut,sql+(sql?"\n":""));
console.log(JSON.stringify({ok:true,rows:rows.length,projectionCount:new Set(rows.map(r=>r.projectionId)).size}));
