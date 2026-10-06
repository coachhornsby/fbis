#!/usr/bin/env node
import fs from "node:fs";
import { pGreater } from "../functions/lib/metrics.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const propFile=args.props||"artifacts/wnba-impact-props.json";
const gameFile=args.games||"artifacts/wnba-impact-games.json";
const linesFile=args.lines||"artifacts/wnba-prizepicks.json";
const canonicalFile=args.canonical||"artifacts/current/wnba-canonical.jsonl";
const out=args.out||"artifacts/wnba-impact-grade.json";
const sqlOut=args.sql||"artifacts/wnba-impact-grade.sql";
const now=new Date().toISOString();
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const norm=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=finite(v);return n==null?"NULL":String(n)};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
function readJson(path){
 if(!fs.existsSync(path)||!fs.statSync(path).size)return[];
 const x=JSON.parse(fs.readFileSync(path,"utf8"));
 if(Array.isArray(x)){if(x.every(r=>Array.isArray(r?.results)))return x.flatMap(r=>r.results||[]);if(x.length===1&&Array.isArray(x[0]?.results))return x[0].results;return x}
 if(Array.isArray(x?.results))return x.results;if(Array.isArray(x?.result))return x.result.flatMap(r=>r?.results||[]);return[];
}
function readJsonl(path){return fs.existsSync(path)&&fs.statSync(path).size?fs.readFileSync(path,"utf8").split("\n").filter(Boolean).map(JSON.parse):[]}
function marketKey(v){
 const s=String(v||"").toLowerCase();
 if(s.includes("three")||s==="3pm")return"three_pointers_made";
 if(s.includes("point")&&s.includes("rebound")&&s.includes("assist"))return"points_rebounds_assists";
 if(s.includes("point")&&s.includes("rebound"))return"points_rebounds";
 if(s.includes("point")&&s.includes("assist"))return"points_assists";
 if(s.includes("rebound")&&s.includes("assist"))return"rebounds_assists";
 if(s.includes("point"))return"points";if(s.includes("rebound"))return"rebounds";if(s.includes("assist"))return"assists";
 return s.replace(/[^a-z0-9]+/g,"_");
}
function actualFor(p,m){
 if(!p)return null;
 const vals={points:finite(p.points),rebounds:finite(p.rebounds),assists:finite(p.assists),three_pointers_made:finite(p.threes)};
 if(vals[m]!=null)return vals[m];
 const parts={points_rebounds:["points","rebounds"],points_assists:["points","assists"],rebounds_assists:["rebounds","assists"],points_rebounds_assists:["points","rebounds","assists"]}[m];
 if(!parts)return null;const xs=parts.map(x=>vals[x]);return xs.every(x=>x!=null)?xs.reduce((a,b)=>a+b,0):null;
}
const canonical=readJsonl(canonicalFile),gamesBy=new Map(canonical.map(g=>[String(g.id),g]));
const playersBy=new Map();
for(const g of canonical){const id=new Map(),name=new Map();for(const p of g.players||[]){id.set(String(p.id||""),p);name.set(norm(p.name),p)}playersBy.set(String(g.id),{id,name})}
const lines=readJson(linesFile),byLine=new Map();
for(const l of lines){
 const key=[String(l.fbis_event_id||l.game_id||""),norm(l.player_name),marketKey(l.canonical_market||l.stat_type)].join("|");
 if(!byLine.has(key))byLine.set(key,[]);byLine.get(key).push(l);
}
const entry=(rows,cutoff)=>rows.filter(x=>Date.parse(x.observed_at||x.collected_at||0)<=Date.parse(cutoff)).sort((a,b)=>Date.parse(a.observed_at||a.collected_at)-Date.parse(b.observed_at||b.collected_at)).at(-1)||null;
const close=(rows,tip)=>rows.filter(x=>Date.parse(x.observed_at||x.collected_at||0)<Date.parse(tip||0)).sort((a,b)=>Date.parse(a.observed_at||a.collected_at)-Date.parse(b.observed_at||b.collected_at)).at(-1)||null;
const side=(p,l)=>p==null||l==null?null:p>=l?"MORE":"LESS";
const propRows=[];
for(const r of readJson(propFile)){
 const gameId=String(r.event_id||""),market=marketKey(r.market_type),game=gamesBy.get(gameId),pg=playersBy.get(gameId);
 const ls=byLine.get([gameId,norm(r.player_name),market].join("|"))||[],e=entry(ls,r.feature_cutoff_timestamp),cl=close(ls,game?.start||e?.start_time);
 const line=finite(e?.line),base=finite(r.baseline_projection),impact=finite(r.impact_projection),sigma=finite(r.sigma);
 const player=pg?.id.get(String(r.player_id||""))||pg?.name.get(norm(r.player_name))||null,actual=actualFor(player,market);
 const bs=side(base,line),is=side(impact,line);
 const pOver=impact!=null&&line!=null&&sigma>0?pGreater(impact,line,sigma):null,prob=is==="MORE"?pOver:is==="LESS"&&pOver!=null?1-pOver:null;
 const lc=line!=null&&finite(cl?.line)!=null?(is==="MORE"?finite(cl.line)-line:line-finite(cl.line)):null;
 propRows.push({...r,market,entryLine:line,entryAt:e?.observed_at||e?.collected_at||null,closeLine:finite(cl?.line),closeAt:cl?.observed_at||cl?.collected_at||null,
  actual,baseErr:actual!=null&&base!=null?Math.abs(base-actual):null,impactErr:actual!=null&&impact!=null?Math.abs(impact-actual):null,baseSide:bs,impactSide:is,impactProb:prob,lineClv:lc});
}
const propMetrics={};
for(const m of ["points","rebounds","assists","three_pointers_made"]){
 const rs=propRows.filter(r=>r.market===m&&r.actual!=null&&r.baseErr!=null&&r.impactErr!=null);
 const lr=rs.filter(r=>r.entryLine!=null&&r.actual!==r.entryLine);
 const correct=(r,s)=>((r.actual>r.entryLine?"MORE":"LESS")===s);
 const bm=mean(rs.map(r=>r.baseErr)),im=mean(rs.map(r=>r.impactErr));
 const ba=lr.length?lr.filter(r=>correct(r,r.baseSide)).length/lr.length:null,ia=lr.length?lr.filter(r=>correct(r,r.impactSide)).length/lr.length:null;
 const clv=lr.map(r=>r.lineClv).filter(v=>v!=null);
 propMetrics[m]={n:rs.length,lineN:lr.length,baselineMae:bm,impactMae:im,maeDelta:im==null||bm==null?null:im-bm,
  baselineSideAccuracy:ba,impactSideAccuracy:ia,sideAccuracyDelta:ia==null||ba==null?null:ia-ba,positiveClvRate:clv.length?clv.filter(v=>v>0).length/clv.length:null};
}
const gameRows=[];
for(const r of readJson(gameFile)){
 const g=gamesBy.get(String(r.event_id||""));if(!g)continue;
 const am=finite(g.homeScore)-finite(g.awayScore),at=finite(g.homeScore)+finite(g.awayScore);
 gameRows.push({...r,actualHome:finite(g.homeScore),actualAway:finite(g.awayScore),
  baseMarginErr:Math.abs(finite(r.baseline_margin)-am),impactMarginErr:Math.abs(finite(r.impact_margin)-am),
  baseTotalErr:Math.abs(finite(r.baseline_total)-at),impactTotalErr:Math.abs(finite(r.impact_total)-at)});
}
const gm={n:gameRows.length,baselineMae:mean(gameRows.map(r=>r.baseMarginErr)),impactMae:mean(gameRows.map(r=>r.impactMarginErr))};
gm.maeDelta=gm.impactMae==null||gm.baselineMae==null?null:gm.impactMae-gm.baselineMae;
const gt={n:gameRows.length,baselineMae:mean(gameRows.map(r=>r.baseTotalErr)),impactMae:mean(gameRows.map(r=>r.impactTotalErr))};
gt.maeDelta=gt.impactMae==null||gt.baselineMae==null?null:gt.impactMae-gt.baselineMae;
const core=Object.values(propMetrics),enough=core.every(x=>x.n>=200&&x.lineN>=75),improved=core.filter(x=>x.maeDelta<0&&(x.sideAccuracyDelta??0)>=0).length;
const propDecision=enough&&improved>=3&&!core.some(x=>x.maeDelta>0.04)?"PROMOTE_PROP_IMPACT_CHALLENGER":"ACCUMULATING_OR_REJECT";
const gameDecision=gm.n>=100&&gm.maeDelta<0&&gt.maeDelta<=0?"PROMOTE_GAME_IMPACT_CHALLENGER":"ACCUMULATING_OR_REJECT";
const sql=[];
for(const r of propRows)if(r.actual!=null)sql.push(`UPDATE wnba_player_prop_impact_shadow SET entry_line=${num(r.entryLine)},entry_observed_at=${q(r.entryAt)},close_line=${num(r.closeLine)},close_observed_at=${q(r.closeAt)},actual_value=${num(r.actual)},baseline_abs_error=${num(r.baseErr)},impact_abs_error=${num(r.impactErr)},baseline_side=${q(r.baseSide)},impact_side=${q(r.impactSide)},impact_probability=${num(r.impactProb)},line_clv=${num(r.lineClv)},graded_at=${q(now)} WHERE id=${q(r.id)};`);
for(const r of gameRows)sql.push(`UPDATE wnba_game_impact_shadow SET actual_home=${num(r.actualHome)},actual_away=${num(r.actualAway)},baseline_margin_abs_error=${num(r.baseMarginErr)},impact_margin_abs_error=${num(r.impactMarginErr)},baseline_total_abs_error=${num(r.baseTotalErr)},impact_total_abs_error=${num(r.impactTotalErr)},graded_at=${q(now)} WHERE id=${q(r.id)};`);
for(const [m,x] of Object.entries({...propMetrics,GAME_MARGIN:gm,GAME_TOTAL:gt})){
 const type=m.startsWith("GAME_")?"PROSPECTIVE_GAME":"PROSPECTIVE_PROP",passed=type==="PROSPECTIVE_GAME"?(gameDecision.startsWith("PROMOTE")&&x.maeDelta<=0):(propDecision.startsWith("PROMOTE")&&x.maeDelta<0);
 sql.push(`INSERT OR REPLACE INTO wnba_player_impact_validation (id,model_id,model_version,validation_type,market_type,n,baseline_mae,impact_mae,mae_delta,baseline_side_accuracy,impact_side_accuracy,side_accuracy_delta,positive_clv_rate,passed,details_json,created_at) VALUES (${q("WNBA-IMPACT:"+m+":"+now)},${q(type==="PROSPECTIVE_GAME"?"WNBA-FBIS-IMPACT-v1":"WNBA-PLAYER-PROP-IMPACT-v1")},'research-v1-shadow',${q(type)},${q(m)},${Number(x.n||0)},${num(x.baselineMae)},${num(x.impactMae)},${num(x.maeDelta)},${num(x.baselineSideAccuracy)},${num(x.impactSideAccuracy)},${num(x.sideAccuracyDelta)},${num(x.positiveClvRate)},${passed?1:0},${q(JSON.stringify(x))},${q(now)});`);
}
const report={generatedAt:now,prop:{decision:propDecision,enough,improvedCoreMarkets:improved,markets:propMetrics},game:{decision:gameDecision,margin:gm,total:gt},
 governance:{propCanQualify:false,gameCanQualify:false,canAuthorize:false,newPrizePicksPaidCalls:0,incumbentsRemainAuthoritative:true}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");fs.writeFileSync(sqlOut,sql.join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
