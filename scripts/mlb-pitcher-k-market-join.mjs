#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const REPLAY_DIR=process.env.REPLAY_DIR||"artifacts/replay";
const MARKET_FILE=process.env.MARKET_FILE||"artifacts/market.json";
const CALIBRATION_ARTIFACT=process.env.CALIBRATION_ARTIFACT||"artifacts/original/pitch-zone-validation.json";
const OUT=process.env.OUT||"artifacts/pitcher-k-market-join.json";
const MODEL_ID="MLB-FBIS-v2";
const MODEL_VERSION="research-v2.5-postseason-context";
const ENTRY_CHECKPOINT="LINEUP_CONFIRMED";
const REFERENCE_BOOKS=["DraftKings","FanDuel","BetMGM","bet365","Caesars","Fanatics"];
const EXCLUDED_BOOKS=new Set(["Sleeper","Sleeper Fantasy","Pick6 (DraftKings)","Underdog Fantasy","ProphetX"]);

const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const round=(v,d=4)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null};
const median=xs=>{const a=xs.filter(Number.isFinite).slice().sort((a,b)=>a-b);if(!a.length)return null;const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2};
const sd=xs=>{const a=xs.filter(Number.isFinite);if(a.length<2)return null;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1))};
const mae=xs=>mean(xs.map(Math.abs));
const rmse=xs=>{const a=xs.filter(Number.isFinite);return a.length?Math.sqrt(mean(a.map(x=>x*x))):null};
function fold(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[.'’]/g,"").replace(/\s+/g," ").trim()}
function normName(s){let x=String(s||"").trim().replace(/\s*\([A-Z0-9]{2,5}\)\s*$/,"");return fold(x)}
function looseName(s){return normName(s).replace(/\b(ii|iii|iv|jr|sr)\b/g,"").replace(/\s+/g," ").trim()}
function americanProb(o){const n=finite(o);if(n==null||n===0)return null;return n<0?(-n)/((-n)+100):100/(n+100)}
function noVigOver(r){const a=americanProb(r.book_over_price),b=americanProb(r.book_under_price);return a!=null&&b!=null&&a+b>0?a/(a+b):null}
function payout(o){const n=finite(o);if(n==null||n===0)return null;return n>0?n/100:100/Math.abs(n)}
function unitsFor(actual,line,side,odds){if(!Number.isFinite(actual)||!Number.isFinite(line))return null;const p=payout(odds);if(p==null)return null;if(actual===line)return 0;const win=side==="OVER"?actual>line:actual<line;return win?p:-1}
function primaryRow(rows){
 const xs=rows.filter(r=>finite(r.book_line)!=null&&noVigOver(r)!=null);
 if(!xs.length)return null;
 return xs.slice().sort((a,b)=>{const da=Math.abs(noVigOver(a)-.5),db=Math.abs(noVigOver(b)-.5);if(da!==db)return da-db;return Date.parse(b.source_as_of||0)-Date.parse(a.source_as_of||0)})[0];
}
function corr(xs,ys){
 const p=xs.map((x,i)=>[x,ys[i]]).filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y));if(p.length<2)return null;
 const ax=p.map(x=>x[0]),ay=p.map(x=>x[1]),mx=mean(ax),my=mean(ay);
 const num=p.reduce((s,[x,y])=>s+(x-mx)*(y-my),0);
 const den=Math.sqrt(p.reduce((s,[x])=>s+(x-mx)**2,0)*p.reduce((s,[,y])=>s+(y-my)**2,0));
 return den?num/den:null;
}
async function walk(dir){const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p)}return out}

const replayFiles=(await walk(REPLAY_DIR)).filter(x=>/pitcher-k-market-replay-.*\.json$/.test(x)&&!path.basename(x).startsWith("summary-"));
const replay=[];
let replayLeakageFailures=0;
for(const f of replayFiles){
 const j=JSON.parse(await fs.readFile(f,"utf8"));if(j?.temporalIntegrity?.leakageOk!==true)replayLeakageFailures++;
 for(const g of j.games||[])for(const p of g.pitcherRows||[]){
   if([p.actual,p.baseline,p.pitchZone].some(x=>finite(x)==null))continue;
   replay.push({game_id:String(g.gamePk),replay_date:g.date,player_id:String(p.id),player_name:p.name,actual:Number(p.actual),
     baseline:Number(p.baseline),pitchZone:Number(p.pitchZone),
     projection:round(clamp(.04*Number(p.baseline)+.96*Number(p.pitchZone)-.7936,1,12.5),1),
     state_cutoff:g?.leakage?.profileEnd||null,coverage:finite(p.coverage)});
 }
}
const starters=new Map(replay.map(r=>[`${r.game_id}|${r.player_id}`,r]));
const byGame=new Map();
for(const r of starters.values()){if(!byGame.has(r.game_id))byGame.set(r.game_id,[]);byGame.get(r.game_id).push(r)}

let calibrationGames=new Set();
try{const j=JSON.parse(await fs.readFile(CALIBRATION_ARTIFACT,"utf8"));calibrationGames=new Set((j.games||[]).map(g=>String(g.gamePk)))}catch{}

const raw=JSON.parse(await fs.readFile(MARKET_FILE,"utf8"));
const marketRows=Array.isArray(raw)?(raw[0]?.results||[]):(raw?.result?.[0]?.results||raw?.results||[]);
const reject={NON_STARTER_OR_UNRESOLVED:0,AMBIGUOUS_STARTER_MATCH:0,MISSING_TIMESTAMP:0,MISSING_START_TIME:0,LATE_MARKET_OBSERVATION:0};
const matched=[];
for(const m of marketRows){
 const ps=byGame.get(String(m.game_id))||[];
 let hit=ps.filter(p=>normName(p.player_name)===normName(m.subject_name));
 if(!hit.length)hit=ps.filter(p=>looseName(p.player_name)===looseName(m.subject_name));
 if(!hit.length){reject.NON_STARTER_OR_UNRESOLVED++;continue}
 if(hit.length!==1){reject.AMBIGUOUS_STARTER_MATCH++;continue}
 if(!m.source_as_of){reject.MISSING_TIMESTAMP++;continue}
 if(!m.start_time){reject.MISSING_START_TIME++;continue}
 if(Date.parse(m.source_as_of)>=Date.parse(m.start_time)){reject.LATE_MARKET_OBSERVATION++;continue}
 matched.push({...m,...hit[0]});
}
const unitBase=new Map([...starters.values()].map(p=>[`${p.game_id}|${p.player_id}`,{...p,rows:[]}]));
for(const m of matched)unitBase.get(`${m.game_id}|${m.player_id}`)?.rows.push(m);

const units=[];
for(const u of unitBase.values()){
 const entryRows=u.rows.filter(r=>r.checkpoint===ENTRY_CHECKPOINT&&!EXCLUDED_BOOKS.has(String(r.book||"")));
 if(!entryRows.length)continue;
 const byBookEntry=new Map();
 for(const r of entryRows){const k=String(r.book||"");if(!byBookEntry.has(k))byBookEntry.set(k,[]);byBookEntry.get(k).push(r)}
 const entryPrimary=[...byBookEntry.entries()].map(([book,rows])=>({book,row:primaryRow(rows)})).filter(x=>x.row);
 if(!entryPrimary.length)continue;
 const entryLine=median(entryPrimary.map(x=>finite(x.row.book_line))),entryProbOver=median(entryPrimary.map(x=>noVigOver(x.row)));
 if(entryLine==null)continue;
 const side=u.projection>entryLine?"OVER":u.projection<entryLine?"UNDER":"NO_EDGE";
 const entryAt=Math.min(...entryPrimary.map(x=>Date.parse(x.row.source_as_of)).filter(Number.isFinite));
 const byBookAll=new Map();
 for(const r of u.rows){if(EXCLUDED_BOOKS.has(String(r.book||""))||Date.parse(r.source_as_of)<entryAt)continue;const k=String(r.book||"");if(!byBookAll.has(k))byBookAll.set(k,[]);byBookAll.get(k).push(r)}
 const closePrimary=[];
 for(const [book,rows] of byBookAll){
   const byCp=new Map();for(const r of rows){const k=String(r.checkpoint||"");if(!byCp.has(k))byCp.set(k,[]);byCp.get(k).push(r)}
   const candidates=[...byCp.values()].map(primaryRow).filter(Boolean).sort((a,b)=>Date.parse(b.source_as_of)-Date.parse(a.source_as_of));
   if(candidates[0])closePrimary.push({book,row:candidates[0]});
 }
 const closeLine=median(closePrimary.map(x=>finite(x.row.book_line))),closeProbOver=median(closePrimary.map(x=>noVigOver(x.row)));
 const lineClv=side==="OVER"&&closeLine!=null?closeLine-entryLine:side==="UNDER"&&closeLine!=null?entryLine-closeLine:null;
 const probClv=side==="OVER"&&entryProbOver!=null&&closeProbOver!=null?closeProbOver-entryProbOver:side==="UNDER"&&entryProbOver!=null&&closeProbOver!=null?entryProbOver-closeProbOver:null;
 let ref=null;for(const b of REFERENCE_BOOKS){const x=entryPrimary.find(y=>y.book===b);if(x){ref=x;break}}
 let refUnits=null,refResult=null;
 if(ref){
   const line=finite(ref.row.book_line),refSide=u.projection>line?"OVER":u.projection<line?"UNDER":"NO_EDGE";
   if(refSide!=="NO_EDGE"){const odds=refSide==="OVER"?finite(ref.row.book_over_price):finite(ref.row.book_under_price);refUnits=unitsFor(u.actual,line,refSide,odds);refResult=refUnits==null?null:refUnits>0?"WIN":refUnits<0?"LOSS":"PUSH"}
 }
 const result=side==="NO_EDGE"?"NO_EDGE":u.actual===entryLine?"PUSH":((side==="OVER"&&u.actual>entryLine)||(side==="UNDER"&&u.actual<entryLine)?"WIN":"LOSS");
 units.push({evidence_class:"HISTORICAL_PIT_RECONSTRUCTED",event_id:u.game_id,player_id:u.player_id,player_name:u.player_name,market:"pitcher_strikeouts",
   model_id:MODEL_ID,model_version:MODEL_VERSION,checkpoint:ENTRY_CHECKPOINT,projection:u.projection,baseline_projection:round(u.baseline,4),actual_value:u.actual,
   state_cutoff:u.state_cutoff,event_date:entryRows[0].date,entry_line:entryLine,entry_no_vig_over:entryProbOver,close_line:closeLine,close_no_vig_over:closeProbOver,
   side,result,line_clv:lineClv,probability_clv:probClv,edge:side==="NO_EDGE"?0:Math.abs(u.projection-entryLine),entry_books:entryPrimary.length,close_books:closePrimary.length,
   reference_book:ref?.book||null,reference_result:refResult,reference_profit_units:refUnits,calibration_overlap:calibrationGames.has(u.game_id),temporal_integrity:true,
   projection_unit_key:[u.game_id,u.player_id,"pitcher_strikeouts",MODEL_VERSION,ENTRY_CHECKPOINT].join("|")});
}

const errors=units.map(u=>u.projection-u.actual_value),baseErrors=units.map(u=>u.baseline_projection-u.actual_value);
const directional=units.filter(u=>u.side!=="NO_EDGE"&&u.result!=="PUSH"),wins=directional.filter(u=>u.result==="WIN").length;
const wf=units.filter(u=>!u.calibration_overlap),wfDir=wf.filter(u=>u.side!=="NO_EDGE"&&u.result!=="PUSH");
const buckets=[["0.0-0.49",0,.5],["0.5-0.99",.5,1],["1.0-1.49",1,1.5],["1.5+",1.5,Infinity]].map(([name,lo,hi],i)=>{const xs=directional.filter(u=>u.edge>=lo&&u.edge<hi);return{bucket:name,n:xs.length,hit_rate:xs.length?xs.filter(u=>u.result==="WIN").length/xs.length:null,rank:i+1}});
const populated=buckets.filter(b=>b.n>0&&b.hit_rate!=null);
const monotonic=populated.every((b,i)=>i===0||b.hit_rate>=populated[i-1].hit_rate),rankCorr=corr(populated.map(b=>b.rank),populated.map(b=>b.hit_rate));
const refUnits=units.filter(u=>Number.isFinite(u.reference_profit_units)).sort((a,b)=>String(a.event_date).localeCompare(String(b.event_date))||a.event_id.localeCompare(b.event_id));
let cum=0,peak=0,maxDd=0;for(const u of refUnits){cum+=u.reference_profit_units;peak=Math.max(peak,cum);maxDd=Math.max(maxDd,peak-cum)}
const dates=[...new Set(units.map(u=>u.event_date))].sort(),wfDates=[...new Set(wf.map(u=>u.event_date))].sort();
const overN=wf.filter(u=>u.side==="OVER").length,underN=wf.filter(u=>u.side==="UNDER").length,errorSd=sd(errors);
const report={
 generated_at:new Date().toISOString(),
 contract:{entry_checkpoint:ENTRY_CHECKPOINT,no_refit:true,frozen_calibration:{baselineWeight:.04,pitchZoneWeight:.96,offset:-.7936},
 temporal_rule:"Actual starting lineups are used by the replay; only LINEUP_CONFIRMED market observations qualify as entry evidence. Earlier checkpoints are excluded from PIT N.",
 primary_line_rule:"Within each book/checkpoint, use the two-sided priced line whose no-vig OVER probability is closest to 0.50; tie-break by latest source timestamp.",
 market_consensus:"Median across eligible books; fantasy pick'em platforms and ProphetX excluded.",
 reference_unit_policy:"First available fixed book in DraftKings, FanDuel, BetMGM, bet365, Caesars, Fanatics. Historical simulation only; not a claim a wager was placed."},
 source:{replay_files:replayFiles.length,replay_pitcher_starts:starters.size,replay_games:byGame.size,raw_market_rows:marketRows.length,matched_starting_pitcher_rows:matched.length,rejections:reject,calibration_overlap_games:calibrationGames.size,replay_leakage_failures:replayLeakageFailures},
 validation:{independent_pit_n:units.length,distinct_dates:dates.length,dates,walk_forward_n:wf.length,walk_forward_dates:wfDates.length,over_n:overN,under_n:underN,
 bias:round(mean(errors)),mae:round(mae(errors)),rmse:round(rmse(errors)),baseline_mae:round(mae(baseErrors)),relative_mae_improvement:round(mae(baseErrors)>0?(mae(baseErrors)-mae(errors))/mae(baseErrors):null),
 absolute_bias_sd_share:round(errorSd?Math.abs(mean(errors))/errorSd:null),directional_n:directional.length,directional_hit_rate:round(directional.length?wins/directional.length:null),
 distance_buckets:buckets,edge_hit_monotonic:monotonic,bucket_rank_correlation:round(rankCorr),brier:null,ece:null,probability_metrics_reason:"No market-line-specific calibrated outcome probability is reconstructed.",
 temporal_failures:replayLeakageFailures+reject.LATE_MARKET_OBSERVATION,
 classification:(units.length>=250&&wf.length>=150&&dates.length>=17)?"RESEARCH_CONTINUE":"INSUFFICIENT_DATA",
 deficits:{insufficient:{settled_n:Math.max(0,250-units.length),walk_forward_n:Math.max(0,150-wf.length),dates:Math.max(0,17-dates.length)},
 calibration_candidate:{settled_n:Math.max(0,500-units.length),walk_forward_n:Math.max(0,300-wf.length),dates:Math.max(0,30-dates.length),over_n:Math.max(0,100-overN),under_n:Math.max(0,100-underN)},
 promotion_ready:{settled_n:Math.max(0,1000-units.length),walk_forward_n:Math.max(0,600-wf.length),dates:Math.max(0,45-dates.length),over_n:Math.max(0,200-overN),under_n:Math.max(0,200-underN)}}},
 economics:{entry_line_ready_n:units.filter(u=>Number.isFinite(u.entry_line)).length,close_line_ready_n:units.filter(u=>Number.isFinite(u.close_line)).length,probability_clv_ready_n:units.filter(u=>Number.isFinite(u.probability_clv)).length,
 reference_roi_ready_n:refUnits.length,mean_line_clv:round(mean(units.map(u=>u.line_clv))),mean_probability_clv:round(mean(units.map(u=>u.probability_clv))),
 reference_profit_units:round(refUnits.reduce((s,u)=>s+u.reference_profit_units,0)),reference_roi:round(refUnits.length?refUnits.reduce((s,u)=>s+u.reference_profit_units,0)/refUnits.length:null),max_drawdown_units:round(maxDd),
 caveat:"Historical reconstructed/reference-book simulation; not wagers actually issued by FBIS."},
 units};
await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.writeFile(OUT,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({source:report.source,validation:report.validation,economics:report.economics},null,2));
