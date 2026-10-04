#!/usr/bin/env node
import fs from "node:fs";
import { pGreater } from "../functions/lib/metrics.js";
import { NBA_QUALIFICATION_POLICY, qualificationDecision } from "../functions/lib/nbaQualification.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gameProjFile=args.gameProjections||"artifacts/game-projections.json";
const propProjFile=args.propProjections||"artifacts/prop-projections.json";
const oddsFile=args.odds||"artifacts/nba-odds.json";
const ppFile=args.props||"artifacts/nba-prizepicks.json";
const canonicalFile=args.canonical||"artifacts/current/nba-canonical.jsonl";
const out=args.out||"artifacts/nba-market-evaluation.json";
const sqlOut=args.sql||"artifacts/nba-market-evaluation.sql";
const evaluatedAt=new Date().toISOString();

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=finite(v);return n==null?"NULL":String(n)};
function readJson(path){
  if(!fs.existsSync(path)||!fs.statSync(path).size)return[];
  const x=JSON.parse(fs.readFileSync(path,"utf8"));
  if(Array.isArray(x)){
    if(x.length===1&&Array.isArray(x[0]?.results))return x[0].results;
    if(x.every(r=>Array.isArray(r?.results)))return x.flatMap(r=>r.results);
    return x;
  }
  if(Array.isArray(x?.result))return x.result.flatMap(r=>r?.results||[]);
  if(Array.isArray(x?.results))return x.results;
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
function actualPlayerValue(player,market){
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
function pairedSnapshots(rows,market){
  const wanted=rows.filter(r=>String(r.market||"").toLowerCase()===market);
  const by=new Map();
  for(const r of wanted){
    const at=String(r.captured_at||r.capturedAt||"");if(!at)continue;
    if(!by.has(at))by.set(at,[]);
    by.get(at).push(r);
  }
  return [...by.entries()].map(([at,rs])=>({at,rows:rs})).filter(s=>{
    const sides=new Set(s.rows.map(r=>String(r.side||"").toUpperCase()));
    if(market==="total")return sides.has("OVER")&&sides.has("UNDER");
    return sides.has("HOME")&&sides.has("AWAY");
  }).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
function chooseEntry(snaps,cutoff){
  const t=Date.parse(cutoff||"");
  const before=snaps.filter(s=>Date.parse(s.at)<=t);
  if(before.length)return {...before.at(-1),basis:"AT_OR_BEFORE"};
  const after=snaps.find(s=>Date.parse(s.at)>t&&Date.parse(s.at)-t<=30*60000);
  return after?{...after,basis:"AFTER_WITHIN_30M"}:null;
}
function chooseClose(snaps,tipoff){
  const t=Date.parse(tipoff||"");
  const before=snaps.filter(s=>Date.parse(s.at)<t);
  return before.length?before.at(-1):null;
}
function rowSide(snap,side){return snap?.rows?.find(r=>String(r.side||"").toUpperCase()===side)||null}
function priceProfit(price){
  const p=finite(price);if(p==null||p===0)return null;
  return p>0?p/100:100/Math.abs(p);
}
function settleGame(market,side,line,ah,aa,price){
  if(ah==null||aa==null)return{result:null,profit:null};
  let diff;
  if(market==="ml")diff=side==="HOME"?ah-aa:aa-ah;
  else if(market==="spread")diff=(side==="HOME"?ah-aa:aa-ah)+Number(line||0);
  else diff=side==="OVER"?(ah+aa)-Number(line):(Number(line)-(ah+aa));
  const result=diff>0?"WIN":diff<0?"LOSS":"PUSH";
  const win=priceProfit(price);
  const profit=result==="WIN"?win:result==="LOSS"?-1:result==="PUSH"?0:null;
  return{result,profit};
}
function lineClv(market,side,entry,close){
  const e=finite(entry),c=finite(close);if(e==null||c==null)return null;
  if(market==="spread")return e-c;
  if(market==="total")return side==="OVER"?c-e:e-c;
  return null;
}
function propClv(side,entry,close){
  const e=finite(entry),c=finite(close);if(e==null||c==null)return null;
  return side==="MORE"?c-e:e-c;
}

const gameProjections=readJson(gameProjFile);
const propProjections=readJson(propProjFile);
const odds=readJson(oddsFile).filter(r=>String(r.sport||"").toLowerCase()==="nba");
const pp=readJson(ppFile).filter(r=>String(r.sport||"").toLowerCase()==="nba");
const canonical=readJsonl(canonicalFile);
const gamesById=new Map(canonical.map(g=>[String(g.id),g]));
const playersByGame=new Map();
for(const g of canonical){
  const byId=new Map(),byName=new Map();
  for(const p of g.players||[]){byId.set(String(p.id||""),p);byName.set(norm(p.name),p);}
  playersByGame.set(String(g.id),{byId,byName});
}
const oddsByGame=new Map();
for(const r of odds){const k=String(r.game_id||r.gameId||"");if(!oddsByGame.has(k))oddsByGame.set(k,[]);oddsByGame.get(k).push(r);}
const ppByPlayerMarket=new Map();
for(const r of pp){
  const key=norm(r.player_name||r.playerName)+"|"+marketKey(r.canonical_market||r.stat_type||r.stat);
  if(!ppByPlayerMarket.has(key))ppByPlayerMarket.set(key,[]);
  ppByPlayerMarket.get(key).push(r);
}

const gameEvaluations=[];
for(const p of gameProjections){
  const gameId=String(p.game_id||p.gameId||""),tipoff=p.tipoff_timestamp||p.tipoff,cutoff=p.feature_cutoff_timestamp||p.featureCutoff;
  const actual=gamesById.get(gameId);
  const actualHome=finite(actual?.homeScore),actualAway=finite(actual?.awayScore);
  const modelMargin=finite(p.projected_margin),modelTotal=finite(p.projected_total),sigmaM=finite(p.sigma_margin),sigmaT=finite(p.sigma_total);
  const rows=oddsByGame.get(gameId)||[];
  for(const market of ["spread","total","ml"]){
    const snaps=pairedSnapshots(rows,market),entry=chooseEntry(snaps,cutoff),close=chooseClose(snaps,tipoff);
    if(!entry)continue;
    const sides=market==="total"?["OVER","UNDER"]:["HOME","AWAY"];
    for(const side of sides){
      const er=rowSide(entry,side),cr=rowSide(close,side);
      if(!er)continue;
      const line=finite(er.line),marketProb=finite(er.no_vig);
      let probability=null;
      if(market==="spread"&&sigmaM!=null&&line!=null){
        probability=side==="HOME"?pGreater(modelMargin,-line,sigmaM):1-pGreater(modelMargin,line,sigmaM);
      }else if(market==="total"&&sigmaT!=null&&line!=null){
        probability=side==="OVER"?pGreater(modelTotal,line,sigmaT):1-pGreater(modelTotal,line,sigmaT);
      }else if(market==="ml"){
        const ph=finite(p.p_home_win);
        probability=side==="HOME"?ph:(ph==null?null:1-ph);
      }
      const ageMinutes=Math.max(0,(Date.parse(cutoff)-Date.parse(entry.at))/60000);
      const decision=qualificationDecision({probability,marketProbability:marketProb,price:er.price,paired:true,preTip:Date.parse(entry.at)<Date.parse(tipoff),ageMinutes});
      const settled=settleGame(market,side,line,actualHome,actualAway,er.price);
      const closeProb=finite(cr?.no_vig);
      const e={
        id:[p.id,market,side].join(":"),
        projectionId:p.id,gameId,modelId:p.model_id||"NBA-FBIS-v1",modelVersion:p.model_version||null,
        checkpoint:(()=>{try{return JSON.parse(p.provenance_json||"{}").checkpoint||null}catch{return null}})(),
        marketType:market,side,entryLine:line,entryPrice:finite(er.price),entryNoVig:marketProb,entryCapturedAt:entry.at,
        closeLine:finite(cr?.line),closePrice:finite(cr?.price),closeNoVig:closeProb,closeCapturedAt:close?.at||null,
        modelProbability:probability,edgeProbability:decision.edge,expectedValue:decision.ev,
        lineClv:lineClv(market,side,line,cr?.line),probabilityClv:closeProb==null||marketProb==null?null:closeProb-marketProb,
        actualHome,actualAway,result:settled.result,profitUnits:settled.profit,
        qualified:decision.qualified,qualificationReason:decision.reason,canAuthorize:false
      };
      gameEvaluations.push(e);
    }
  }
}

const propEvaluations=[];
for(const p of propProjections){
  const market=marketKey(p.market_type),key=norm(p.player_name)+"|"+market;
  const lines=(ppByPlayerMarket.get(key)||[]).filter(r=>{
    const start=Date.parse(r.start_time||"");const tip=Date.parse((gamesById.get(String(p.game_id))||{}).start||"");
    return !Number.isFinite(tip)||!Number.isFinite(start)||Math.abs(start-tip)<12*3600000;
  }).sort((a,b)=>Date.parse(a.observed_at||a.collected_at)-Date.parse(b.observed_at||b.collected_at));
  if(!lines.length)continue;
  const cutoff=Date.parse(p.feature_cutoff_timestamp),before=lines.filter(r=>Date.parse(r.observed_at||r.collected_at)<=cutoff);
  const entry=before.length?before.at(-1):lines.find(r=>Date.parse(r.observed_at||r.collected_at)-cutoff<=30*60000);
  if(!entry)continue;
  const game=gamesById.get(String(p.game_id)),tipoff=Date.parse(game?.start||entry.start_time||"");
  const close=lines.filter(r=>!Number.isFinite(tipoff)||Date.parse(r.observed_at||r.collected_at)<tipoff).at(-1)||null;
  const projection=finite(p.projection),sigma=finite(p.sigma),line=finite(entry.line);
  if(projection==null||sigma==null||line==null||sigma<=0)continue;
  const pMore=pGreater(projection,line,sigma),pLess=1-pMore,candidate=pMore>=pLess?"MORE":"LESS",prob=Math.max(pMore,pLess);
  const standardized=Math.abs(projection-line)/sigma;
  const verified=Number(p.availability_verified||0)===1;
  let qualified=true,reason="QUALIFIED";
  const cfg=NBA_QUALIFICATION_POLICY.prop;
  if(prob<cfg.minProbability){qualified=false;reason="probability_below_threshold";}
  else if(standardized<cfg.minStandardizedEdge){qualified=false;reason="standardized_edge_below_threshold";}
  else if(cfg.requireAvailabilityVerified&&!verified){qualified=false;reason="availability_unverified";}
  else if(Number.isFinite(tipoff)&&Date.parse(entry.observed_at||entry.collected_at)>=tipoff){qualified=false;reason="post_tip_line_rejected";}
  const pg=playersByGame.get(String(p.game_id));
  const player=pg?.byId.get(String(p.player_id||""))||pg?.byName.get(norm(p.player_name))||null;
  const actualValue=actualPlayerValue(player,market);
  let result=null;
  if(actualValue!=null)result=actualValue>line?(candidate==="MORE"?"WIN":"LOSS"):actualValue<line?(candidate==="LESS"?"WIN":"LOSS"):"PUSH";
  propEvaluations.push({
    id:[p.id,"pp"].join(":"),projectionId:p.id,gameId:p.game_id,playerId:p.player_id,playerName:p.player_name,marketType:market,
    candidateSide:candidate,projection,sigma,entryLine:line,entryObservedAt:entry.observed_at||entry.collected_at,
    closeLine:finite(close?.line),closeObservedAt:close?.observed_at||close?.collected_at||null,lineEdge:projection-line,
    standardizedEdge:standardized,modelProbability:prob,actualValue,result,lineClv:propClv(candidate,line,close?.line),
    qualified,qualificationReason:reason,canAuthorize:false
  });
}

function esc(x){return q(x)}
function gameSql(r){return `INSERT OR REPLACE INTO nba_game_market_evaluations (id,projection_id,game_id,model_id,model_version,checkpoint,market_type,side,entry_line,entry_price,entry_no_vig,entry_captured_at,close_line,close_price,close_no_vig,close_captured_at,model_probability,edge_probability,expected_value,line_clv,probability_clv,actual_home,actual_away,result,profit_units,qualified,qualification_reason,can_authorize,evaluated_at) VALUES (${esc(r.id)},${esc(r.projectionId)},${esc(r.gameId)},${esc(r.modelId)},${esc(r.modelVersion)},${esc(r.checkpoint)},${esc(r.marketType)},${esc(r.side)},${num(r.entryLine)},${num(r.entryPrice)},${num(r.entryNoVig)},${esc(r.entryCapturedAt)},${num(r.closeLine)},${num(r.closePrice)},${num(r.closeNoVig)},${esc(r.closeCapturedAt)},${num(r.modelProbability)},${num(r.edgeProbability)},${num(r.expectedValue)},${num(r.lineClv)},${num(r.probabilityClv)},${num(r.actualHome)},${num(r.actualAway)},${esc(r.result)},${num(r.profitUnits)},${r.qualified?1:0},${esc(r.qualificationReason)},0,${esc(evaluatedAt)});`}
function propSql(r){return `INSERT OR REPLACE INTO nba_prop_market_evaluations (id,projection_id,game_id,player_id,player_name,market_type,candidate_side,projection,sigma,entry_line,entry_observed_at,close_line,close_observed_at,line_edge,standardized_edge,model_probability,actual_value,result,line_clv,qualified,qualification_reason,can_authorize,evaluated_at) VALUES (${esc(r.id)},${esc(r.projectionId)},${esc(r.gameId)},${esc(r.playerId)},${esc(r.playerName)},${esc(r.marketType)},${esc(r.candidateSide)},${num(r.projection)},${num(r.sigma)},${num(r.entryLine)},${esc(r.entryObservedAt)},${num(r.closeLine)},${esc(r.closeObservedAt)},${num(r.lineEdge)},${num(r.standardizedEdge)},${num(r.modelProbability)},${num(r.actualValue)},${esc(r.result)},${num(r.lineClv)},${r.qualified?1:0},${esc(r.qualificationReason)},0,${esc(evaluatedAt)});`}

const qg=gameEvaluations.filter(r=>r.qualified),graded=qg.filter(r=>r.result),roiUnits=graded.reduce((s,r)=>s+(finite(r.profitUnits)||0),0);
const clvRows=graded.filter(r=>r.lineClv!=null||r.probabilityClv!=null);
const posClv=clvRows.length?clvRows.filter(r=>(finite(r.lineClv)||0)>0||(finite(r.probabilityClv)||0)>0).length/clvRows.length:null;
const roiPct=graded.length?roiUnits/graded.length:null;
const promo=NBA_QUALIFICATION_POLICY.modelPromotion;
const evidencePass=graded.length>=promo.minGradedGameCandidates&&(posClv??0)>=promo.minPositiveClvRate&&(roiPct??-1)>promo.minRoiPct;
const state={modelId:"NBA-FBIS-v1",canQualify:true,canAuthorize:false,prospectiveN:gameEvaluations.length,gradedN:graded.length,qualifiedN:qg.length,positiveClvRate:posClv,roiUnits,roiPct,status:evidencePass?"QUALIFIED_EVIDENCE_PASS":"QUALIFICATION_ENABLED",gates:promo};
const stateSql=`INSERT OR REPLACE INTO nba_qualification_state (model_id,can_qualify,can_authorize,prospective_n,graded_n,qualified_n,positive_clv_rate,roi_units,roi_pct,status,gates_json,evaluated_at) VALUES ('NBA-FBIS-v1',1,0,${state.prospectiveN},${state.gradedN},${state.qualifiedN},${num(state.positiveClvRate)},${num(state.roiUnits)},${num(state.roiPct)},${esc(state.status)},${esc(JSON.stringify(state.gates))},${esc(evaluatedAt)});`;

const report={evaluatedAt,policy:NBA_QUALIFICATION_POLICY,game:{n:gameEvaluations.length,qualified:qg.length,graded:graded.length,positiveClvRate:posClv,roiUnits,roiPct,rows:gameEvaluations},props:{n:propEvaluations.length,qualified:propEvaluations.filter(r=>r.qualified).length,graded:propEvaluations.filter(r=>r.result).length,rows:propEvaluations},qualificationState:state};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
fs.writeFileSync(sqlOut,[...gameEvaluations.map(gameSql),...propEvaluations.map(propSql),stateSql].join("\n")+"\n");
console.log(JSON.stringify({ok:true,gameN:gameEvaluations.length,gameQualified:qg.length,gameGraded:graded.length,propN:propEvaluations.length,propQualified:propEvaluations.filter(r=>r.qualified).length,propGraded:propEvaluations.filter(r=>r.result).length,state},null,2));
