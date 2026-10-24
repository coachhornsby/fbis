/**
 * Prospective CFB CORE margin-hybrid audit.
 * One earliest pre-kickoff immutable freeze per game and frozen model artifact.
 * No historical 149-game holdout observations enter this evaluator.
 * Evaluation is read-only and never grants wagering authority.
 */
import {
  CFB_CORE_MARGIN_HYBRID_ID,
  evaluateMarginHybridPromotion,
} from "./cfbCoreMarginHybrid.js";

const numeric = (v) => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const mean = (xs) => xs.length ? xs.reduce((a,b) => a+b,0) / xs.length : null;
const round = (n) => n == null || !Number.isFinite(n) ? null : Number(n.toFixed(4));
const winner = (margin) => margin > 0 ? 1 : margin < 0 ? -1 : 0;

export function evaluateCfbProspectiveHybridRows(rows = [], { artifactId = null, historicalHoldoutN = 149, seed = 20261024, bootstrapN = 2000 } = {}) {
  const ordered = [...rows].sort((a,b) => String(a.generation_at).localeCompare(String(b.generation_at)) || String(a.id).localeCompare(String(b.id)));
  const unique = new Map();
  const skipped = {};
  const drop = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  for (const r of ordered) {
    const gid = String(r.game_id || "");
    if (!gid || String(r.core_model_id) !== CFB_CORE_MARGIN_HYBRID_ID || (artifactId && r.core_artifact_id !== artifactId)) { drop("wrong_model_or_artifact"); continue; }
    if (unique.has(gid)) { drop("repeat_freeze"); continue; }
    const generation = Date.parse(r.generation_at);
    const kickoff = Date.parse(r.kickoff);
    const sourceAt = r.feature_cutoff_at ? Date.parse(r.feature_cutoff_at) : NaN;
    const gameWeek = numeric(r.week), through = numeric(r.core_through_week);
    if (!(Number.isFinite(generation) && Number.isFinite(kickoff) && generation < kickoff)) { drop("not_pregame"); continue; }
    if (r.feature_cutoff_at && !(Number.isFinite(sourceAt) && sourceAt <= generation)) { drop("future_or_unverified_feature_cutoff"); continue; }
    if (gameWeek == null || through == null || !(through < gameWeek)) { drop("invalid_week_cutoff"); continue; }
    if (r.eligibility !== "eligible_projected") { drop("not_eligible"); continue; }
    const ah = numeric(r.champion_home), aa = numeric(r.champion_away), ch = numeric(r.core_home), ca = numeric(r.core_away);
    if ([ah,aa,ch,ca].some(x => x == null)) { drop("missing_prediction"); continue; }
    if (Math.abs((ah+aa)-(ch+ca)) > 0.000001) { drop("total_changed"); continue; }
    // Reserve the earliest valid pregame freeze for each game, even if it isn't settled.
    unique.set(gid,r);
  }
  const observed = [];
  for (const r of unique.values()) {
    if (!(r.final_verified === 1 || r.final_verified === true)) continue;
    const home = numeric(r.actual_home), away = numeric(r.actual_away);
    if (home == null || away == null) { drop("missing_verified_final"); continue; }
    const actualMargin = home - away, actualTotal = home + away;
    const aaMargin = Number(r.champion_home)-Number(r.champion_away);
    const hybridMargin = Number(r.core_home)-Number(r.core_away);
    const aaTotal = Number(r.champion_home)+Number(r.champion_away);
    const hybridTotal = Number(r.core_home)+Number(r.core_away);
    observed.push({
      gameId: String(r.game_id), season: Number(r.season), week: Number(r.week),
      aaErr: Math.abs(aaMargin-actualMargin), hybridErr: Math.abs(hybridMargin-actualMargin),
      aaTotalErr: Math.abs(aaTotal-actualTotal), hybridTotalErr: Math.abs(hybridTotal-actualTotal),
      aaWin: winner(aaMargin)===winner(actualMargin)?1:0,
      hybridWin: winner(hybridMargin)===winner(actualMargin)?1:0,
      hybridBias: hybridMargin-actualMargin
    });
  }
  const aaMarginMae=mean(observed.map(r=>r.aaErr)), hybridMarginMae=mean(observed.map(r=>r.hybridErr));
  const aaTotalMae=mean(observed.map(r=>r.aaTotalErr)), hybridTotalMae=mean(observed.map(r=>r.hybridTotalErr));
  const aaWin=mean(observed.map(r=>r.aaWin)), hybridWin=mean(observed.map(r=>r.hybridWin));
  const bias=mean(observed.map(r=>r.hybridBias));
  const groups = new Map();
  for (const r of observed) {
    const k=`${r.season}:${r.week}`;
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(r);
  }
  const weeks=[...groups.values()];
  let ci=null;
  // Few independent weeks cannot support reliable interval inference.
  if(weeks.length>=5 && observed.length>=30) {
    let state=seed>>>0;
    const rand=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
    const draws=[];
    for(let i=0;i<bootstrapN;i++) {
      let diffs=0,n=0;
      for(let j=0;j<weeks.length;j++) {
        const grp=weeks[Math.floor(rand()*weeks.length)];
        for(const row of grp){diffs+=row.hybridErr-row.aaErr;n++;}
      }
      if(n)draws.push(diffs/n);
    }
    draws.sort((a,b)=>a-b);
    ci={lower:round(draws[Math.floor((draws.length-1)*.025)]),upper:round(draws[Math.floor((draws.length-1)*.975)]),clusters:weeks.length,replicates:draws.length,excludesZero:draws.length>0 && draws[Math.floor((draws.length-1)*.975)]<0};
  }
  const gate=evaluateMarginHybridPromotion({
    historicalHoldoutN,prospectiveOosN:observed.length,
    marginMaeImprovement:aaMarginMae==null?null:aaMarginMae-hybridMarginMae,
    totalMaeRegression:aaTotalMae==null?null:hybridTotalMae-aaTotalMae,
    winnerAccuracyRegression:aaWin==null?null:aaWin-hybridWin,
    marginBiasAbs:bias==null?null:Math.abs(bias),
    marginMaeCiExcludesZero:ci?.excludesZero===true,
    weekClusteredBootstrap:ci!=null,
    prospectiveFrozenNoRetune:true,
    trainEvalBaselineMismatchDocumented:true,
    noHoldoutRetune:true,operatorApproved:false
  });
  return {
    authority:"research_only",modelId:CFB_CORE_MARGIN_HYBRID_ID,artifactId,
    frozenUniqueGames:unique.size,prospectiveSettledN:observed.length,weekClusters:weeks.length,
    excluded:skipped,
    metrics:{
      aaMarginMae:round(aaMarginMae),hybridMarginMae:round(hybridMarginMae),
      marginMaeDelta:aaMarginMae==null?null:round(hybridMarginMae-aaMarginMae),
      aaTotalMae:round(aaTotalMae),hybridTotalMae:round(hybridTotalMae),
      aaWinnerAccuracy:round(aaWin),hybridWinnerAccuracy:round(hybridWin),
      hybridMarginBias:round(bias),weekClustered95PctCi:ci
    },
    gate,
    classification:observed.length<200?"PROSPECTIVE_ACCUMULATING": "PROSPECTIVE_GATE_EVALUATED",
    caution:"Historical 149-game holdout excluded. Total parity is by construction. No auto-promotion or wagering authority."
  };
}
