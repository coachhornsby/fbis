#!/usr/bin/env node
import fs from "node:fs";
import { buildNbaWagerDecision } from "../functions/lib/nbaWagerDecision.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const projectionFile=args.projections||"artifacts/game-projections.json";
const oddsFile=args.odds||"artifacts/nba-odds.json";
const actionFile=args.action||"artifacts/nba-action.json";
const canonicalFile=args.canonical||"artifacts/current/nba-canonical.jsonl";
const priorDecisionsFile=args.priorDecisions||"artifacts/prior-decisions.json";
const confidenceFile=args.confidence||"artifacts/confidence-calibration.json";
const out=args.out||"artifacts/nba-game-decisions.json";
const sqlOut=args.sql||"artifacts/nba-game-decisions.sql";
const now=new Date().toISOString();

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=finite(v);return n==null?"NULL":String(n)};
function readJson(path){
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
function readJsonl(path){
  if(!fs.existsSync(path)||!fs.statSync(path).size)return[];
  return fs.readFileSync(path,"utf8").split("\n").filter(Boolean).map(JSON.parse);
}
function parseJson(v){if(v&&typeof v==="object")return v;try{return JSON.parse(v||"{}")}catch{return{}}}
function pairedAt(rows,market){
  const by=new Map();
  for(const r of rows.filter(x=>String(x.market||"").toLowerCase()===market)){
    const at=String(r.captured_at||"");if(!at)continue;
    if(!by.has(at))by.set(at,[]);
    by.get(at).push(r);
  }
  return [...by.entries()].map(([at,rs])=>({at,rows:rs})).filter(s=>{
    const sides=new Set(s.rows.map(r=>String(r.side||"").toUpperCase()));
    return market==="total"?(sides.has("OVER")&&sides.has("UNDER")):(sides.has("HOME")&&sides.has("AWAY"));
  }).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
function entryAtOrBefore(snaps,cutoff){
  const t=Date.parse(cutoff||"");
  if(!Number.isFinite(t))return null;
  const xs=snaps.filter(s=>Date.parse(s.at)<=t);
  return xs.length?xs.at(-1):null;
}
function closeBefore(snaps,tipoff){
  const t=Date.parse(tipoff||"");
  if(!Number.isFinite(t))return null;
  const xs=snaps.filter(s=>Date.parse(s.at)<t);
  return xs.length?xs.at(-1):null;
}
function sideRow(snap,side){return snap?.rows?.find(r=>String(r.side||"").toUpperCase()===side)||null}
function priceProfit(price){
  const p=finite(price);if(p==null||p===0)return null;
  return p>0?p/100:100/Math.abs(p);
}
function settle({market,side,line,actualHome,actualAway,price}){
  if(actualHome==null||actualAway==null)return{result:null,profitUnits:null};
  let d=null;
  if(market==="ml")d=side==="HOME"?actualHome-actualAway:actualAway-actualHome;
  if(market==="spread")d=(side==="HOME"?actualHome-actualAway:actualAway-actualHome)+(finite(line)||0);
  if(market==="total")d=side==="OVER"?(actualHome+actualAway)-(finite(line)||0):(finite(line)||0)-(actualHome+actualAway);
  if(d==null)return{result:null,profitUnits:null};
  const result=d>0?"WIN":d<0?"LOSS":"PUSH",win=priceProfit(price);
  return{result,profitUnits:result==="WIN"?win:result==="LOSS"?-1:0};
}
function clvLine(market,side,entry,close){
  const e=finite(entry),c=finite(close);if(e==null||c==null)return null;
  if(market==="spread")return side==="HOME"?e-c:c-e;
  if(market==="total")return side==="OVER"?c-e:e-c;
  return null;
}
function historicalContext(rows,{marketType,sigma,matchupReliability,dataQuality,decisionAt}){
  const t=Date.parse(decisionAt||"");
  const candidates=(rows||[]).filter(r=>{
    if(String(r.market_type||r.marketType||"")!==marketType)return false;
    const at=Date.parse(r.graded_at||r.decision_timestamp||"");
    if(Number.isFinite(t)&&Number.isFinite(at)&&at>=t)return false;
    if(!["WIN","LOSS","PUSH"].includes(String(r.result||"")))return false;
    const s=finite(r.projection_uncertainty),mr=finite(r.matchup_reliability),dq=finite(r.data_quality);
    if(s!=null&&sigma!=null&&Math.abs(s-sigma)>3)return false;
    if(mr!=null&&Math.abs(mr-matchupReliability)>.18)return false;
    if(dq!=null&&Math.abs(dq-dataQuality)>.18)return false;
    return true;
  });
  const n=candidates.length;
  if(!n)return{n:0,reliability:.5,winRate:null,roiPct:null,positiveClvRate:null};
  const wins=candidates.filter(r=>r.result==="WIN").length;
  const losses=candidates.filter(r=>r.result==="LOSS").length;
  const roiUnits=candidates.reduce((s,r)=>s+(finite(r.profit_units)||0),0);
  const clv=candidates.map(r=>finite(r.clv_line)).filter(v=>v!=null);
  const positive=clv.length?clv.filter(v=>v>0).length/clv.length:null;
  const winRate=wins+losses?wins/(wins+losses):.5;
  const roiPct=n?roiUnits/n:0;
  const raw=.5+(winRate-.5)*.45+clamp(roiPct,-.15,.15)*.5+((positive??.5)-.5)*.2;
  const shrink=n/(n+40);
  const reliability=.5+(raw-.5)*shrink;
  return{n,reliability:clamp(reliability,.35,.75),winRate,roiPct,positiveClvRate:positive};
}
function loadConfidence(rows){
  const r=(rows||[]).sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0))[0];
  if(!r)return null;
  return{sampleN:Number(r.sample_n||0),monotonicityPass:Number(r.monotonicity_pass||0)===1,bins:parseJson(r.bins_json),createdAt:r.created_at||null};
}

const projections=readJson(projectionFile);
const odds=readJson(oddsFile).filter(r=>String(r.sport||"").toLowerCase()==="nba");
const action=readJson(actionFile).filter(r=>String(r.sport||"").toLowerCase()==="nba");
const canonical=readJsonl(canonicalFile);
const prior=readJson(priorDecisionsFile);
const confidence=loadConfidence(readJson(confidenceFile));
const actualById=new Map(canonical.map(g=>[String(g.id),g]));
const oddsByGame=new Map();
for(const r of odds){const id=String(r.game_id||"");if(!oddsByGame.has(id))oddsByGame.set(id,[]);oddsByGame.get(id).push(r)}
const actionByGame=new Map();
for(const r of action){const id=String(r.canonical_event_id||"");if(!id)continue;if(!actionByGame.has(id))actionByGame.set(id,[]);actionByGame.get(id).push(r)}

const decisions=[];
for(const p of projections){
  const gameId=String(p.game_id||""),cutoff=p.feature_cutoff_timestamp,tipoff=p.tipoff_timestamp;
  if(!gameId||!cutoff||!tipoff)continue;
  const provenance=parseJson(p.provenance_json);
  const projection={
    ok:true,modelId:p.model_id||"NBA-FBIS-v1",modelVersion:p.model_version,
    home:finite(p.projected_home),away:finite(p.projected_away),margin:finite(p.projected_margin),total:finite(p.projected_total),
    expectedPossessions:finite(p.expected_possessions),pHomeWin:finite(p.p_home_win),sigmaMargin:finite(p.sigma_margin),sigmaTotal:finite(p.sigma_total),
    decomposition:provenance.decomposition||null
  };
  const histRows=provenance.historyRows||{};
  const baseDataQuality=clamp(Math.min(Number(histRows.home||0),Number(histRows.away||0))/20,0,1);
  const rows=oddsByGame.get(gameId)||[],actionRows=actionByGame.get(gameId)||[];
  const actual=actualById.get(gameId),actualHome=finite(actual?.homeScore),actualAway=finite(actual?.awayScore);
  for(const market of ["spread","total","ml"]){
    const snaps=pairedAt(rows,market),entry=entryAtOrBefore(snaps,cutoff);
    if(!entry)continue;
    const close=closeBefore(snaps,tipoff);
    const sides=market==="total"?["OVER","UNDER"]:["HOME","AWAY"];
    for(const side of sides){
      const offer=sideRow(entry,side),closeRow=sideRow(close,side);
      if(!offer)continue;
      const price=finite(offer.price);
      if(price==null)continue; // actual executable juice required
      const sigma=market==="total"?projection.sigmaTotal:projection.sigmaMargin;
      const matchupReliability=clamp(1-((finite(sigma)||17)-11)/10,.35,.9);
      const dataQuality=clamp(baseDataQuality*(price!=null?1:.8),0,1);
      const hist=historicalContext(prior,{marketType:market,sigma,matchupReliability,dataQuality,decisionAt:cutoff});
      const trajectoryRows=rows.map(r=>({marketType:r.market,side:r.side,line:r.line,price:r.price,observedAt:r.captured_at,snapshotType:null}));
      const decision=buildNbaWagerDecision({
        projection,
        offer:{marketType:market,side,line:finite(offer.line),price,preTip:Date.parse(entry.at)<Date.parse(tipoff),pairedMarket:true},
        trajectoryRows,
        actionRows,
        matchupReliability,
        dataQuality,
        historicalReliability:hist.reliability,
        confidenceCalibration:confidence,
        decisionAt:cutoff
      });
      if(!decision.ok)continue;
      const settled=settle({market,side,line:offer.line,actualHome,actualAway,price});
      const id=[p.id,market,side,entry.at].join(":");
      decisions.push({
        id,projectionId:p.id,gameId,modelId:p.model_id||"NBA-FBIS-v1",modelVersion:p.model_version,
        decisionTimestamp:cutoff,marketType:market,side,offeredLine:finite(offer.line),offeredPrice:price,
        modelProbability:decision.modelProbability,breakEvenProbability:decision.breakEvenProbability,probabilityEdge:decision.probabilityEdge,
        expectedValue:decision.expectedValue,projectionUncertainty:decision.projectionUncertainty,
        matchupReliability:decision.matchupReliability,dataQuality:decision.dataQuality,historicalFactorReliability:decision.historicalFactorReliability,
        marketConfirmation:decision.marketConfirmation,fbisConfidence:decision.confidence.score,confidenceStatus:decision.confidence.status,
        confidenceDecisionEligible:decision.confidence.decisionEligible,decision:decision.decision,qualificationEligible:decision.qualificationEligible,
        stakeUnits:decision.stakeUnits,stakeStatus:decision.stakeStatus,
        decomposition:decision.disagreement,marketTrajectory:decision.marketTrajectory,actionIntelligence:decision.actionIntelligence,
        historicalContext:hist,safeguards:decision.safeguards,reasons:decision.reasons,
        actualHome,actualAway,closeLine:finite(closeRow?.line),closePrice:finite(closeRow?.price),
        clvLine:clvLine(market,side,offer.line,closeRow?.line),clvProbability:null,
        result:settled.result,profitUnits:settled.profitUnits,gradedAt:settled.result?now:null,createdAt:now
      });
    }
  }
}

function sqlRow(r){
  return `INSERT OR REPLACE INTO nba_wager_decisions (
    id,projection_id,game_id,model_id,model_version,decision_timestamp,market_type,side,offered_line,offered_price,
    model_probability,break_even_probability,probability_edge,expected_value,projection_uncertainty,matchup_reliability,data_quality,
    historical_factor_reliability,market_confirmation,fbis_confidence,confidence_status,confidence_decision_eligible,decision,
    qualification_eligible,stake_units,stake_status,decomposition_json,market_trajectory_json,action_intelligence_json,historical_context_json,
    safeguards_json,reasons_json,actual_home,actual_away,close_line,close_price,clv_line,clv_probability,result,profit_units,graded_at,created_at
  ) VALUES (
    ${q(r.id)},${q(r.projectionId)},${q(r.gameId)},${q(r.modelId)},${q(r.modelVersion)},${q(r.decisionTimestamp)},${q(r.marketType)},${q(r.side)},
    ${num(r.offeredLine)},${num(r.offeredPrice)},${num(r.modelProbability)},${num(r.breakEvenProbability)},${num(r.probabilityEdge)},${num(r.expectedValue)},
    ${num(r.projectionUncertainty)},${num(r.matchupReliability)},${num(r.dataQuality)},${num(r.historicalFactorReliability)},${q(r.marketConfirmation)},
    ${num(r.fbisConfidence)},${q(r.confidenceStatus)},${r.confidenceDecisionEligible?1:0},${q(r.decision)},${r.qualificationEligible?1:0},
    ${num(r.stakeUnits)},${q(r.stakeStatus)},${q(JSON.stringify(r.decomposition))},${q(JSON.stringify(r.marketTrajectory))},
    ${q(JSON.stringify(r.actionIntelligence))},${q(JSON.stringify(r.historicalContext))},${q(JSON.stringify(r.safeguards))},${q(JSON.stringify(r.reasons))},
    ${num(r.actualHome)},${num(r.actualAway)},${num(r.closeLine)},${num(r.closePrice)},${num(r.clvLine)},${num(r.clvProbability)},${q(r.result)},
    ${num(r.profitUnits)},${q(r.gradedAt)},${q(r.createdAt)}
  );`;
}
const bet=decisions.filter(r=>r.decision==="BET"),graded=bet.filter(r=>r.result);
const units=graded.reduce((s,r)=>s+(finite(r.profitUnits)||0),0);
const clvRows=graded.map(r=>finite(r.clvLine)).filter(v=>v!=null);
const positiveClvRate=clvRows.length?clvRows.filter(v=>v>0).length/clvRows.length:null;
const report={
  generatedAt:now,
  architecture:"NBA_GAME_LEVEL_DECISION_V1",
  independentProjectionMarketFree:true,
  actionPolicy:{newPaidCalls:0,directQualifier:false,authorizer:false},
  n:decisions.length,betN:bet.length,gradedN:graded.length,units,roiPct:graded.length?units/graded.length:null,positiveClvRate,
  confidenceCalibration:confidence||{sampleN:0,monotonicityPass:false},
  decisions
};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
fs.writeFileSync(sqlOut,["BEGIN;",...decisions.map(sqlRow),"COMMIT;"].join("\n")+"\n");
console.log(JSON.stringify({ok:true,n:decisions.length,betN:bet.length,gradedN:graded.length,units,roiPct:report.roiPct,positiveClvRate,confidence:report.confidenceCalibration},null,2));
