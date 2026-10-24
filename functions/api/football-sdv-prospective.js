/**
 * Operator-only prospective lifecycle. Creates immutable pregame shadow receipts,
 * grades against regulation-only SDV outcomes after kickoff; never bets/promotes.
 */
import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
import {sha256Hex} from "../lib/sha256Hex.js";
import {querySdvMatchupFromSportDb} from "./football-sdv-matchup-research.js";
import {gradeRegulationSimulations} from "../lib/footballSimulationValidationResearch.js";
import {compareNflProspectiveShadowReceipts,NFL_STANDARD_SHADOW,NFL_VERIFIED_TRANSITION_SHADOW} from "../lib/nflSdvProspectivePairedEvaluation.js";
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{
 "content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"}});
const sportOk=s=>["nfl","cfb"].includes(s);
const idOk=s=>typeof s==="string"&&/^[a-zA-Z0-9:._-]{1,120}$/.test(s);
const time=s=>typeof s==="string"?Date.parse(s):NaN;
const d1=(env,sport)=>{
 const db=sport==="nfl"?env?.NFL_DB:env?.CFB_DB;
 if(!db?.prepare)throw Error("SPORT_DB_UNBOUND");
 return db;
};
export function prepareProspectiveFootballReceipt(result,{now}){
 if(result?.ok!==true||!sportOk(result.sport)||!idOk(String(result.gameId))||
  !idOk(String(result.homeTeamId))||!idOk(String(result.awayTeamId))||
  !idOk(String(result.sourceSnapshotId))||!idOk(String(result.modelId))||
  typeof result.modelVersion!=="string"||
  !/^[a-f0-9]{64}$/i.test(result.evidenceFingerprint||"")||
  !(Number.isFinite(time(now))&&time(now)+10*60000<time(result.kickoff))||
  !(time(result.baselineFrozenAt)<time(now))||
  result.calibrationStatus!=="NOT_VALIDATED"||
  result.canAuthorizeWager!==false||result.canQualify!==false||
  !Number.isInteger(result.trainingGames)||result.trainingGames<20||
  !Number.isInteger(result.trainingDrives)||result.trainingDrives<300)
  throw Error("PROSPECTIVE_RESEARCH_EVIDENCE_NOT_READY");
 const d=result.distributions||{},get=k=>d[k]?.mean;
 const probs=["home_regulation_lead","away_regulation_lead","regulation_tie",
  "home_blowout_14","away_blowout_14"].map(get);
 const score=["home_score","away_score"].map(get);
 if([...probs,...score].some(x=>typeof x!=="number"||!Number.isFinite(x))||
   probs.some(p=>p<0||p>1)||Math.abs(probs[0]+probs[1]+probs[2]-1)>.005||
   score.some(x=>x<0||x>100))throw Error("PROSPECTIVE_DISTRIBUTION_INVALID");
 const receiptId=sha256Hex(["SDV-PROSP-v1",result.sport,result.gameId,result.modelId,
  result.sourceSnapshotId,result.evidenceFingerprint].join("|"));
 return {receiptId,sport:result.sport,gameId:result.gameId,
  modelId:result.modelId,modelVersion:result.modelVersion,
  snapshotId:result.sourceSnapshotId,baselineFrozenAt:result.baselineFrozenAt,
  capturedAt:now,kickoff:result.kickoff,homeTeamId:result.homeTeamId,
  awayTeamId:result.awayTeamId,trainingGames:result.trainingGames,
  trainingDrives:result.trainingDrives,homeLead:probs[0],awayLead:probs[1],
  tie:probs[2],homeBlowout:probs[3],awayBlowout:probs[4],
  projectedHome:score[0],projectedAway:score[1],
  evidence:JSON.stringify({evidenceFingerprint:result.evidenceFingerprint,
    mode:result.mode,sourceDb:result.sourceDb,asOf:result.researchAsOf,
    sourceSnapshotId:result.sourceSnapshotId,
    variant:result.variant||"standard",timeEvidence:result.timeEvidence||null,
    fieldTransitionMode:result.fieldTransitionMode||null,
    officialDurationDrives:result.officialDurationDrives||null,
    linkedNextFieldDrives:result.linkedNextFieldDrives||null,
    canAuthorizeWager:false})};
}
export async function captureFootballProspective(env,{sport,gameId,now=new Date().toISOString(),variant="standard"}){
 if(!sportOk(sport)||!idOk(gameId)||!["standard","nfl-sdv-v031"].includes(variant)||
  (variant==="nfl-sdv-v031"&&sport!=="nfl"))throw Error("PROSPECTIVE_INVALID_SCOPE");
 const result=await querySdvMatchupFromSportDb(env,{sport,gameId,now,variant});
 if(!result.ok)return {ok:false,reason:result.reason,sport,gameId,canAuthorizeWager:false};
 const row=prepareProspectiveFootballReceipt(result,{now}),db=d1(env,sport);
 const write=await db.prepare(
  "INSERT OR IGNORE INTO football_sdv_prospective_receipts "+
  "(receipt_id,sport,game_id,model_id,model_version,baseline_snapshot_id,"+
  "baseline_frozen_at,captured_at,kickoff,home_team_id,away_team_id,"+
  "training_games,training_drives,home_reg_lead,away_reg_lead,reg_tie,"+
  "home_blowout14,away_blowout14,projected_home,projected_away,evidence_json) "+
  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
 ).bind(row.receiptId,sport,gameId,row.modelId,row.modelVersion,
  row.snapshotId,row.baselineFrozenAt,row.capturedAt,row.kickoff,
  row.homeTeamId,row.awayTeamId,row.trainingGames,row.trainingDrives,
  row.homeLead,row.awayLead,row.tie,row.homeBlowout,row.awayBlowout,
  row.projectedHome,row.projectedAway,row.evidence).run();
 const stored=await db.prepare("SELECT receipt_id receiptId,captured_at capturedAt,game_id gameId FROM football_sdv_prospective_receipts WHERE sport=? AND game_id=? AND model_id=?")
  .bind(sport,gameId,row.modelId).first();
 if(!stored)throw Error("PROSPECTIVE_RECEIPT_READBACK_MISSING");
 return {ok:true,sport,gameId,modelId:row.modelId,variant,receiptId:stored.receiptId,
  capturedAt:stored.capturedAt,status:Number(write?.meta?.changes)===1?"NEW":"EXISTING",
  canQualify:false,canAuthorizeWager:false};
}
export async function gradeFootballProspective(env,{sport,now=new Date().toISOString(),limit=35}={}){
 if(!sportOk(sport)||!Number.isFinite(time(now))||!Number.isInteger(limit)||limit<1||limit>35)
  throw Error("INVALID_GRADING_SCOPE");
 const db=d1(env,sport);
 const pending=await db.prepare(
  "SELECT r.receipt_id receiptId,r.game_id gameId,r.kickoff,"+
  "r.captured_at capturedAt,r.home_team_id homeTeamId,r.away_team_id awayTeamId "+
  "FROM football_sdv_prospective_receipts r "+
  "LEFT JOIN football_sdv_prospective_grades o ON o.receipt_id=r.receipt_id "+
  "WHERE r.sport=? AND r.kickoff<? AND o.receipt_id IS NULL "+
  "ORDER BY r.kickoff LIMIT ?"
 ).bind(sport,new Date(time(now)-3*3600000).toISOString(),limit).all();
 if(!Array.isArray(pending?.results))throw Error("PROSPECTIVE_PENDING_UNAVAILABLE");
 let graded=0,unavailable=0;
 for(const r of pending.results){
  const result=await db.prepare(
   "SELECT game_id sourceGameId,score_home homeScore,score_away awayScore,"+
   "source_fingerprint sourceFingerprint,source_observed_at observedAt "+
   "FROM football_sdv_verified_games WHERE sport=? "+
   "AND home_team_id=? AND away_team_id=? "+
   "AND substr(kickoff,1,16)=substr(?,1,16) "+
   "AND source_observed_at>? AND source_observed_at>? "+
   "AND evidence_class='POSTGAME_RECONSTRUCTED' AND prospective=0 "+
   "AND can_authorize_wager=0 ORDER BY source_observed_at DESC LIMIT 1"
  ).bind(sport,r.homeTeamId,r.awayTeamId,r.kickoff,r.capturedAt,r.kickoff).first();
  if(!result){unavailable++;continue}
  const w=await db.prepare(
   "INSERT OR IGNORE INTO football_sdv_prospective_grades "+
   "(receipt_id,sport,game_id,source_game_id,outcome_source_fingerprint,"+
   "graded_at,source_observed_at,regulation_only,actual_home,actual_away) "+
   "VALUES (?,?,?,?,?,?,?,1,?,?)"
  ).bind(r.receiptId,sport,r.gameId,result.sourceGameId,
   result.sourceFingerprint,now,result.observedAt,result.homeScore,
   result.awayScore).run();
  graded+=Number(w?.meta?.changes)||0;
 }
 return {ok:true,sport,checked:pending.results.length,graded,
  awaitingOfficialOutcome:unavailable,canQualify:false,canAuthorizeWager:false};
}
export async function prospectiveFootballPerformance(env,{sport,now=new Date().toISOString()}={}){
 if(!sportOk(sport)||!Number.isFinite(time(now)))throw Error("INVALID_PERFORMANCE_SCOPE");
 const db=d1(env,sport);
 const res=await db.prepare(
  "SELECT r.receipt_id prospectiveReceiptId,r.game_id gameId,r.model_id modelId,r.model_version modelVersion,"+
  "r.captured_at frozenAt,r.kickoff,r.home_team_id homeTeamId,r.away_team_id awayTeamId,"+
  "r.projected_home projectedHome,r.projected_away projectedAway,"+
  "r.home_reg_lead homeWinProb,r.away_reg_lead awayWinProb,r.reg_tie tieProb,"+
  "r.home_blowout14 homeBlowoutProb,r.away_blowout14 awayBlowoutProb,"+
  "o.graded_at gradedAt,o.source_observed_at observedAt,"+
  "o.actual_home homeScore,o.actual_away awayScore,o.outcome_source_fingerprint sourceFingerprint "+
  "FROM football_sdv_prospective_receipts r "+
  "JOIN football_sdv_prospective_grades o ON o.receipt_id=r.receipt_id "+
  "WHERE r.sport=? AND o.regulation_only=1 AND r.captured_at<r.kickoff "+
  "ORDER BY r.kickoff DESC LIMIT 2000"
 ).bind(sport).all();
 if(!Array.isArray(res?.results))throw Error("PROSPECTIVE_PERFORMANCE_READ_FAILED");
 // A game may have ESPN and internal FBIS IDs. Grade one independent event,
 // keyed by actual kickoff and canonical participant identities.
 const dedup=new Map();
 for(const r of res.results){
  const key=[sport,r.modelId,r.homeTeamId,r.awayTeamId,
   new Date(time(r.kickoff)).toISOString()].join("|");
  const prior=dedup.get(key);
  if(!prior||time(r.frozenAt)<time(prior.frozenAt))dedup.set(key,r);
 }
 const byModel=new Map();
 for(const r of dedup.values()){
  if(!byModel.has(r.modelId))byModel.set(r.modelId,[]);
  byModel.get(r.modelId).push({...r,sport,regulationOnly:true});
 }
 const reports={};
 for(const [modelId,rows] of byModel)
  reports[modelId]=gradeRegulationSimulations(rows,{sport,asOf:now,minSample:30});
 if(sport==="nfl"){
  const old="NFL-SDV-VERIFIED-POSSESSION-TRANSITION-SHADOW-v0.3";
  if(reports[old])reports[old]={...reports[old],
   technicalStatus:"SUPERSEDED_KICKOFF_FIELD_START_ERROR",
   excludedFromQualification:true,canQualify:false,canAuthorizeWager:false};
 }
 const baselineId=sport==="nfl"?"NFL-VERIFIED-POSSESSION-MATCHUP-SHADOW-v0":
  "CFB-VERIFIED-DRIVE-MATCHUP-SHADOW-v0";
 const baseline=reports[baselineId]||gradeRegulationSimulations([],{sport,asOf:now,minSample:30});
 return {...baseline,cohorts:reports,gradedPerModel:Object.fromEntries(
  [...byModel].map(([id,rows])=>[id,rows.length])),totalModelReceipts:[...byModel.values()].reduce((n,r)=>n+r.length,0),
  calibrated:false,canQualify:false,canAuthorizeWager:false};
}
export async function prospectiveNflPairedPerformance(env,{now=new Date().toISOString()}={}){
 if(!Number.isFinite(time(now)))throw Error("INVALID_NFL_PROSPECTIVE_PAIRS_CLOCK");
 const db=d1(env,"nfl");
 const q=await db.prepare(
  "SELECT r.receipt_id receiptId,r.model_id modelId,r.game_id gameId,"+
  "r.home_team_id homeTeamId,r.away_team_id awayTeamId,r.kickoff,"+
  "r.captured_at capturedAt,r.projected_home projectedHome,r.projected_away projectedAway,"+
  "r.home_reg_lead homeLead,r.away_reg_lead awayLead,r.reg_tie tieProb,"+
  "g.graded_at gradedAt,g.source_observed_at observedAt,"+
  "g.outcome_source_fingerprint outcomeFingerprint,"+
  "g.actual_home actualHome,g.actual_away actualAway "+
  "FROM football_sdv_prospective_receipts r "+
  "JOIN football_sdv_prospective_grades g ON g.receipt_id=r.receipt_id "+
  "WHERE r.sport='nfl' AND r.model_id IN (?,?) "+
  "AND g.regulation_only=1 AND r.captured_at<r.kickoff "+
  "ORDER BY r.kickoff DESC LIMIT 1200"
 ).bind(NFL_STANDARD_SHADOW,NFL_VERIFIED_TRANSITION_SHADOW).all();
 if(!Array.isArray(q?.results))throw Error("NFL_PROSPECTIVE_PAIR_QUERY_FAILED");
 return compareNflProspectiveShadowReceipts(q.results,{asOf:now,minGames:30});
}

export async function onRequest({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 const u=new URL(request.url),sport=u.searchParams.get("sport");
 if(!sportOk(sport))return json({ok:false,error:"INVALID_SPORT"},400);
 try{
  if(request.method==="GET"){
   if(u.searchParams.get("mode")==="paired"){
    if(sport!=="nfl")return json({ok:false,error:"NFL_ONLY"},400);
    return json(await prospectiveNflPairedPerformance(env));
   }
   if(u.searchParams.get("mode")==="performance")
    return json(await prospectiveFootballPerformance(env,{sport}));
   const db=d1(env,sport),now=Date.now(),until=new Date(now+8*86400000).toISOString();
   const upcoming=await db.prepare(
    "SELECT gameId,kickoff FROM ("+
    "SELECT g.id gameId,g.start kickoff,"+
    "ROW_NUMBER() OVER(PARTITION BY substr(g.start,1,16),g.home_abbr,g.away_abbr "+
    "ORDER BY CASE WHEN g.id GLOB '[0-9]*' THEN 0 ELSE 1 END,g.id) rn "+
    "FROM games g WHERE g.sport=? AND g.start>? AND g.start<=?"+
    ") WHERE rn=1 ORDER BY kickoff ASC,gameId ASC LIMIT 240"
   ).bind(sport,new Date(now+600000).toISOString(),until).all();
   if(!Array.isArray(upcoming?.results))throw Error("SLATE_QUERY_FAILED");
   return json({ok:true,sport,upcoming:upcoming.results,slateCapacity:240,
    supportedVariants:sport==="nfl"?["standard","nfl-sdv-v031"]:["standard"],
    canAuthorizeWager:false});
  }
  if(request.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const body=await request.json();
  if(body?.action==="grade")return json(await gradeFootballProspective(env,{sport}));
  if(body?.action!=="capture"||!idOk(body.gameId))
   return json({ok:false,error:"INVALID_CAPTURE"},400);
  const result=await captureFootballProspective(env,{sport,gameId:body.gameId,
   variant:body.variant||"standard"});
  return json(result,result.ok?200:422);
 }catch(e){return json({ok:false,error:String(e.message||e).slice(0,120),
  canAuthorizeWager:false},503)}
}
