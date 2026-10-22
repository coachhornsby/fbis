/**
 * CFB D1 shadow simulator v1: paired historical score-error bootstrap.
 *
 * This is a *score-distribution challenger*, not a drive/play or player-prop
 * simulator. It uses the existing CFB-FBIS-v2 pregame score baseline and
 * deduplicated, truly known-at-cutoff graded historical observations.
 *
 * No market inputs, same-game future outcomes, data provider calls, champion
 * overrides, bet sizing, D1 schema creation or automatic promotion.
 */
import { runSportSimulationResearch } from "./sportSimulationResearch.js";

export const CFB_SIM_ID = "CFB-SIM-EMPIRICAL-JOINT-v1";
export const CFB_SIM_CHAMPION_SOURCE = "CFB-FBIS-v2";
export const CFB_SIM_MIN_TRAINING_EVENTS = 60;
export const CFB_SIM_MAX_TRAINING_EVENTS = 600;
const number = n => typeof n === "number" && Number.isFinite(n);
const millis = x => typeof x === "string" && x.trim() ? Date.parse(x) : NaN;
function stableSeed(text) {
  let h=2166136261;
  for (const ch of String(text)) { h^=ch.charCodeAt(0);h=Math.imul(h,16777619); }
  return (h>>>0)||1;
}
function scoreRow(r) {
  return [r?.projectedHome,r?.projectedAway,r?.actualHome,r?.actualAway].every(number)
    && r.projectedHome>=0 && r.projectedAway>=0 && r.actualHome>=0 && r.actualAway>=0;
}
/**
 * Cross-cutoff protection is not optional: publication AND settlement time for
 * every training event must precede the *target's* frozen forecast time.
 */
export function selectCfbSimulationTraining(rows=[],{
  modelVersion=CFB_SIM_CHAMPION_SOURCE, targetFrozenAt,targetGameId,
}={}) {
  const cutoff=millis(targetFrozenAt);
  if (!Number.isFinite(cutoff) || !String(targetGameId||"").trim()) throw new Error("INVALID_TARGET_CUTOFF");
  const events=new Map();
  const excluded={};
  for(const r of rows){
    let reason=null;
    if(String(r?.gameId||"")===String(targetGameId)) reason="SAME_EVENT";
    else if(r?.modelVersion!==modelVersion || r?.projectionKind!=="FBIS")reason="MODEL_MISMATCH";
    else if(!scoreRow(r))reason="MISSING_GRADED_SCORE";
    else if(!String(r?.snapshotId||"").trim()||!String(r?.gameId||"").trim())reason="MISSING_IDENTITY";
    else {
      const frozen=millis(r.frozenAt), kickoff=millis(r.kickoff), graded=millis(r.gradedAt);
      if (![frozen,kickoff,graded].every(Number.isFinite))reason="MISSING_TEMPORAL_EVIDENCE";
      else if(!(frozen<kickoff && kickoff<=graded && graded<cutoff)) reason="FUTURE_OR_POST_START_EVIDENCE";
    }
    if(reason){excluded[reason]=(excluded[reason]||0)+1;continue;}
    const old=events.get(String(r.gameId));
    if(!old||millis(old.frozenAt)<millis(r.frozenAt))events.set(String(r.gameId),r);
  }
  const selected=[...events.values()]
    .sort((a,b)=>millis(b.kickoff)-millis(a.kickoff))
    .slice(0,CFB_SIM_MAX_TRAINING_EVENTS);
  return {rows:selected, excluded, targetFrozenAt, modelVersion,
    games:selected.length, minRequired:CFB_SIM_MIN_TRAINING_EVENTS,
    eligible:selected.length>=CFB_SIM_MIN_TRAINING_EVENTS};
}
function chooseWeighted(pool,baseline,random){
  // Measured residual pairs are sampled *together*.
  // Target's spread/total only affect empirical neighbor weights.
  const targetTotal=baseline.home+baseline.away;
  const targetMargin=baseline.home-baseline.away;
  let weightSum=0;
  const weights=pool.map(r=>{
    const refTotal=r.projectedHome+r.projectedAway, refMargin=r.projectedHome-r.projectedAway;
    const similarity=Math.exp(-Math.abs(refTotal-targetTotal)/24-Math.abs(refMargin-targetMargin)/21);
    const w=0.3+0.7*similarity;
    weightSum+=w;
    return w;
  });
  const threshold=random()*weightSum;
  let cumulative=0;
  for(let i=0;i<pool.length;i++){cumulative+=weights[i];if(cumulative>=threshold)return pool[i];}
  return pool[pool.length-1];
}
function hashEvidence(rows){
  // Fingerprint is for reproducibility, not cryptographic integrity.
  return stableSeed(rows.map(r=>[r.snapshotId,r.frozenAt,r.gradedAt].join("|")).sort().join(";")).toString(16).padStart(8,"0");
}
export function simulateCfbShadowV1({
  gameId,snapshotId,modelVersion=CFB_SIM_CHAMPION_SOURCE,
  frozenAt,kickoff,projectedHome,projectedAway,
  historicalRows=[],iterations=5000,
}={}){
  if(modelVersion!==CFB_SIM_CHAMPION_SOURCE)throw new Error("UNSUPPORTED_CFB_CHAMPION");
  if(!String(gameId||"").trim()||!String(snapshotId||"").trim())throw new Error("MISSING_SNAPSHOT_IDENTITY");
  const f=millis(frozenAt),k=millis(kickoff);
  if(!Number.isFinite(f)||!Number.isFinite(k)||f>=k)throw new Error("NOT_FROZEN_PREGAME");
  if(![projectedHome,projectedAway].every(number)||projectedHome<0||projectedAway<0)throw new Error("INVALID_CHAMPION_SCORES");
  const training=selectCfbSimulationTraining(historicalRows,{modelVersion,targetFrozenAt:frozenAt,targetGameId:gameId});
  if(!training.eligible)throw new Error("INSUFFICIENT_POINT_IN_TIME_CFB_TRAINING");
  const evidenceHash=hashEvidence(training.rows);
  const seed=stableSeed([gameId,snapshotId,modelVersion,CFB_SIM_ID,evidenceHash].join("|"));
  // Precalculate selection weights once. Do not run O(N) allocations per draw.
  const margin=projectedHome-projectedAway,total=projectedHome+projectedAway;
  let weightSum=0;
  const pool=training.rows.map(r=>{
    const refTotal=r.projectedHome+r.projectedAway,refMargin=r.projectedHome-r.projectedAway;
    const weight=0.3+0.7*Math.exp(-Math.abs(refTotal-total)/24-Math.abs(refMargin-margin)/21);
    weightSum+=weight;
    return {threshold:weightSum,homeError:r.actualHome-r.projectedHome,awayError:r.actualAway-r.projectedAway};
  });
  const output=runSportSimulationResearch({
    sport:"cfb",eventId:String(gameId),modelId:CFB_SIM_ID,modelVersion:"1.0.0",
    publishedAt:frozenAt,eventStart:kickoff,iterations,seed,
    simulate:({random})=>{
      const draw=random()*weightSum;
      let left=0,right=pool.length-1;
      while(left<right){const mid=(left+right)>>1;if(pool[mid].threshold<draw)left=mid+1;else right=mid;}
      const e=pool[left];
      const home=Math.max(0,Math.round(projectedHome+e.homeError));
      const away=Math.max(0,Math.round(projectedAway+e.awayError));
      return {metrics:{home_score:home,away_score:away,total:home+away,margin:home-away,
        home_ahead:Number(home>away),tie:Number(home===away)}};
    }
  });
  return {
    ...output,snapshotId,championModelVersion:modelVersion,sourceDb:"CFB_DB",
    trainingCount:training.games,trainingLatestKickoff:training.rows[0]?.kickoff||null,
    trainingEvidenceFingerprint:evidenceHash,trainingCutoff:frozenAt,
    baseline:{home:projectedHome,away:projectedAway,total,margin},
    homeAheadFrequency:output.distributions.home_ahead.mean,
    tieFrequency:output.distributions.tie.mean,
    expectedHomeScore:output.distributions.home_score.mean,
    expectedAwayScore:output.distributions.away_score.mean,
    outputAuthority:"RESEARCH_SHADOW_ONLY",
    semantics:"CORRELATED_SCORE_RESIDUALS_NOT_PLAY_BY_PLAY_OR_MONEYLINE",
    canAuthorizeWager:false,canQualify:false,changesProductionChampion:false,
  };
}
