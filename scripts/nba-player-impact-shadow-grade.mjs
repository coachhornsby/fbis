#!/usr/bin/env node
import fs from "node:fs";
import { pGreater } from "../functions/lib/metrics.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const shadowFile=args.shadow||"artifacts/nba-impact-shadow.json";
const linesFile=args.lines||"artifacts/nba-prizepicks.json";
const canonicalFile=args.canonical||"artifacts/current/nba-canonical.jsonl";
const out=args.out||"artifacts/nba-impact-shadow-grade.json";
const sqlOut=args.sql||"artifacts/nba-impact-shadow-grade.sql";
const createdAt=new Date().toISOString();

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const norm=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=finite(v);return n==null?"NULL":String(n)};
function readJson(path){
  if(!fs.existsSync(path)||!fs.statSync(path).size)return[];
  const x=JSON.parse(fs.readFileSync(path,"utf8"));
  if(Array.isArray(x)){
    if(x.every(r=>Array.isArray(r?.results)))return x.flatMap(r=>r.results||[]);
    if(x.length===1&&Array.isArray(x[0]?.results))return x[0].results;
    return x;
  }
  if(Array.isArray(x?.results))return x.results;
  if(Array.isArray(x?.result))return x.result.flatMap(r=>r?.results||[]);
  return[];
}
function readJsonl(path){
  if(!fs.existsSync(path)||!fs.statSync(path).size)return[];
  return fs.readFileSync(path,"utf8").split("\n").filter(Boolean).map(JSON.parse);
}
function marketKey(v){
  const s=String(v||"").toLowerCase();
  if(s.includes("three")||s==="3pm"||s==="3_pointers_made")return"three_pointers_made";
  if(s.includes("point")&&s.includes("rebound")&&s.includes("assist"))return"pra";
  if(s.includes("point"))return"points";
  if(s.includes("rebound"))return"rebounds";
  if(s.includes("assist"))return"assists";
  return s.replace(/[^a-z0-9]+/g,"_");
}
function actualValue(player,market){
  if(!player)return null;
  if(market==="points")return finite(player.points);
  if(market==="rebounds")return finite(player.rebounds);
  if(market==="assists")return finite(player.assists);
  if(market==="three_pointers_made")return finite(player.threes);
  if(market==="pra"){
    const xs=[player.points,player.rebounds,player.assists].map(finite);
    return xs.every(v=>v!=null)?xs.reduce((a,b)=>a+b,0):null;
  }
  return null;
}
function pickEntry(lines,cutoff){
  const t=Date.parse(cutoff||"");
  const xs=lines.filter(x=>Date.parse(x.observed_at||x.collected_at||0)<=t)
    .sort((a,b)=>Date.parse(a.observed_at||a.collected_at)-Date.parse(b.observed_at||b.collected_at));
  return xs.length?xs.at(-1):null;
}
function pickClose(lines,tipoff){
  const t=Date.parse(tipoff||"");
  const xs=lines.filter(x=>Date.parse(x.observed_at||x.collected_at||0)<t)
    .sort((a,b)=>Date.parse(a.observed_at||a.collected_at)-Date.parse(b.observed_at||b.collected_at));
  return xs.length?xs.at(-1):null;
}
function side(projection,line){if(projection==null||line==null)return null;return projection>=line?"MORE":"LESS"}
function lineClv(candidate,entry,close){
  const e=finite(entry),c=finite(close);if(e==null||c==null||!candidate)return null;
  return candidate==="MORE"?c-e:e-c;
}
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null}

const shadow=readJson(shadowFile);
const lines=readJson(linesFile).filter(r=>String(r.sport||"").toLowerCase()==="nba");
const games=readJsonl(canonicalFile);
const gamesById=new Map(games.map(g=>[String(g.id),g]));
const playersByGame=new Map();
for(const g of games){
  const byId=new Map(),byName=new Map();
  for(const p of g.players||[]){
    byId.set(String(p.id||""),p);byName.set(norm(p.name),p);
  }
  playersByGame.set(String(g.id),{byId,byName});
}

const byKey=new Map();
for(const l of lines){
  const key=[String(l.fbis_event_id||l.game_id||""),norm(l.player_name),marketKey(l.canonical_market||l.stat_type)].join("|");
  if(!byKey.has(key))byKey.set(key,[]);
  byKey.get(key).push(l);
}

const graded=[];
for(const r of shadow){
  const market=marketKey(r.market_type),gameId=String(r.game_id||"");
  const game=gamesById.get(gameId);
  const key=[gameId,norm(r.player_name),market].join("|");
  const ls=byKey.get(key)||[];
  const entry=pickEntry(ls,r.feature_cutoff_timestamp);
  const close=pickClose(ls,game?.start||entry?.start_time);
  const baseline=finite(r.baseline_projection),impact=finite(r.impact_projection),sigma=finite(r.sigma);
  const line=finite(entry?.line);
  const baselineSide=side(baseline,line),impactSide=side(impact,line);
  let impactProb=null;
  if(impact!=null&&line!=null&&sigma!=null&&sigma>0){
    const pOver=pGreater(impact,line,sigma);
    impactProb=impactSide==="MORE"?pOver:1-pOver;
  }
  const pg=playersByGame.get(gameId);
  const player=pg?.byId.get(String(r.player_id||""))||pg?.byName.get(norm(r.player_name))||null;
  const actual=actualValue(player,market);
  const row={
    ...r,
    market,
    entryLine:line,
    entryObservedAt:entry?.observed_at||entry?.collected_at||null,
    closeLine:finite(close?.line),
    closeObservedAt:close?.observed_at||close?.collected_at||null,
    actualValue:actual,
    baselineAbsError:actual!=null&&baseline!=null?Math.abs(baseline-actual):null,
    impactAbsError:actual!=null&&impact!=null?Math.abs(impact-actual):null,
    baselineSide,
    impactSide,
    impactProbability:impactProb,
    lineClv:lineClv(impactSide,line,close?.line),
    gradedAt:actual!=null?createdAt:null,
  };
  graded.push(row);
}

const markets={};
for(const market of ["points","rebounds","assists","three_pointers_made","pra"]){
  const rs=graded.filter(r=>r.market===market&&r.actualValue!=null&&r.baselineAbsError!=null&&r.impactAbsError!=null);
  const base=mean(rs.map(r=>r.baselineAbsError)),imp=mean(rs.map(r=>r.impactAbsError));
  const lineRows=rs.filter(r=>r.entryLine!=null&&r.baselineSide&&r.impactSide);
  const baseCorrect=lineRows.filter(r=>(r.actualValue>r.entryLine?"MORE":r.actualValue<r.entryLine?"LESS":"PUSH")===r.baselineSide).length;
  const impactCorrect=lineRows.filter(r=>(r.actualValue>r.entryLine?"MORE":r.actualValue<r.entryLine?"LESS":"PUSH")===r.impactSide).length;
  const nonPush=lineRows.filter(r=>r.actualValue!==r.entryLine).length;
  markets[market]={
    n:rs.length,
    lineN:lineRows.length,
    baselineMae:base,
    impactMae:imp,
    maeDelta:imp==null||base==null?null:imp-base,
    baselineSideAccuracy:nonPush?baseCorrect/nonPush:null,
    impactSideAccuracy:nonPush?impactCorrect/nonPush:null,
    sideAccuracyDelta:nonPush?(impactCorrect-baseCorrect)/nonPush:null,
    impactPositiveClvRate:(()=>{
      const xs=lineRows.map(r=>r.lineClv).filter(v=>v!=null);
      return xs.length?xs.filter(v=>v>0).length/xs.length:null;
    })()
  };
}
const core=["points","rebounds","assists","three_pointers_made"].map(k=>markets[k]);
const enough=core.every(x=>x.n>=500&&x.lineN>=200);
const improved=core.filter(x=>x.maeDelta!=null&&x.maeDelta<0&&x.sideAccuracyDelta!=null&&x.sideAccuracyDelta>=0).length;
const regressedMaterially=core.some(x=>x.maeDelta!=null&&x.maeDelta>0.03);
const decision=enough&&improved>=3&&!regressedMaterially?"PROMOTE_ROLE_LINEUP_CHALLENGER":"ACCUMULATING_OR_REJECT";

const sql=[];
for(const r of graded){
  sql.push(`UPDATE nba_player_prop_impact_shadow SET entry_line=${num(r.entryLine)},entry_observed_at=${q(r.entryObservedAt)},close_line=${num(r.closeLine)},close_observed_at=${q(r.closeObservedAt)},actual_value=${num(r.actualValue)},baseline_abs_error=${num(r.baselineAbsError)},impact_abs_error=${num(r.impactAbsError)},baseline_side=${q(r.baselineSide)},impact_side=${q(r.impactSide)},impact_probability=${num(r.impactProbability)},line_clv=${num(r.lineClv)},graded_at=${q(r.gradedAt)} WHERE id=${q(r.id)};`);
}
for(const [market,m] of Object.entries(markets)){
  sql.push(`INSERT OR REPLACE INTO nba_player_impact_validation (id,model_id,model_version,training_window,holdout_window,market_type,n,baseline_mae,impact_mae,mae_delta,baseline_bias,impact_bias,passed,details_json,created_at) VALUES (${q("NBA-PLAYER-PROP-IMPACT-v1:"+market+":"+createdAt)},'NBA-PLAYER-PROP-IMPACT-v1','research-v1-shadow','prospective','prospective',${q(market)},${Number(m.n||0)},${num(m.baselineMae)},${num(m.impactMae)},${num(m.maeDelta)},NULL,NULL,${decision==="PROMOTE_ROLE_LINEUP_CHALLENGER"&&m.maeDelta<0?1:0},${q(JSON.stringify(m))},${q(createdAt)});`);
}
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
const report={generatedAt:createdAt,modelId:"NBA-PLAYER-PROP-IMPACT-v1",decision,enough,improvedCoreMarkets:improved,regressedMaterially,markets,
  governance:{canQualify:false,canAuthorize:false,newPrizePicksPaidCalls:0,baselineRemainsQualifyingModel:true}};
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
fs.writeFileSync(sqlOut,sql.join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
