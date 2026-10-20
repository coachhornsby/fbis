import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const finite=x=>x!=null&&x!==''&&Number.isFinite(Number(x));
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
export function projectionAudit(rows){
 const xs=rows.filter(r=>['projHome','projAway','actualHomeGoals','actualAwayGoals'].every(k=>finite(r[k])));
 const ps=xs.filter(r=>finite(r.homeWinProb)&&r.homeWinProb>=0&&r.homeWinProb<=1&&r.actualHomeGoals!==r.actualAwayGoals);
 const bins=Array.from({length:10},(_,i)=>{const rs=ps.filter(r=>Math.min(9,Math.floor(r.homeWinProb*10))===i);return {min:i/10,max:(i+1)/10,n:rs.length,predicted:mean(rs.map(r=>r.homeWinProb)),observed:mean(rs.map(r=>Number(r.actualHomeGoals>r.actualAwayGoals)))};});
 return {n:xs.length,probabilityN:ps.length,scoreMae:mean(xs.map(r=>(Math.abs(r.projHome-r.actualHomeGoals)+Math.abs(r.projAway-r.actualAwayGoals))/2)),totalMae:mean(xs.map(r=>Math.abs(r.projHome+r.projAway-r.actualHomeGoals-r.actualAwayGoals))),marginMae:mean(xs.map(r=>Math.abs(r.projHome-r.projAway-r.actualHomeGoals+r.actualAwayGoals))),brier:mean(ps.map(r=>(r.homeWinProb-Number(r.actualHomeGoals>r.actualAwayGoals))**2)),logLoss:mean(ps.map(r=>{const p=Math.max(1e-9,Math.min(1-1e-9,r.homeWinProb));return -(r.actualHomeGoals>r.actualAwayGoals?Math.log(p):Math.log(1-p));})),ece:ps.length?bins.reduce((s,b)=>s+b.n/ps.length*Math.abs((b.predicted??0)-(b.observed??0)),0):null,probabilityBuckets:bins};
}
export function fiveStarCohort(rows=[]){
 // Exact observed canonical stars only. Never reconstruct stars from old quality scores.
 const xs=rows.filter(r=>r.canonicalStars===5&&r.priceEvidenceVerified===true&&r.pitVerified===true&&['WIN','LOSS','PUSH'].includes(r.result)&&finite(r.profitUnits)&&finite(r.riskUnits)&&r.riskUnits>0).sort((a,b)=>String(a.settledAt).localeCompare(String(b.settledAt)));
 const cohorts=scope=>{const rs=xs.filter(r=>r.scope===scope);let equity=0,peak=0,dd=0;for(const r of rs){equity+=r.profitUnits;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}const decisive=rs.filter(r=>r.result!=='PUSH'),risk=rs.reduce((s,r)=>s+r.riskUnits,0),clv=rs.filter(r=>finite(r.clv));return {scope,n:rs.length,winRate:decisive.length?decisive.filter(r=>r.result==='WIN').length/decisive.length:null,roi:risk?equity/risk:null,maxDrawdown:rs.length?dd:null,clvN:clv.length,meanClv:mean(clv.map(r=>r.clv))};};
 return {status:xs.length?'DESCRIPTIVE_ONLY_NOT_PROMOTED':'NO_ELIGIBLE_SETTLED_PRICE_EVIDENCE',cohorts:['GAME','PROP'].map(cohorts),profitabilityClaimPermitted:false};
}
async function main(){
 const artifact=JSON.parse(await readFile('data/models/nhl-pro-v2-validation.json','utf8'));
 const prospective=JSON.parse(await readFile('artifacts/nhl-production-qualification/prospective-snapshots.json','utf8'));
 const reasons={};const usable=[];
 for(const r of prospective){let reason=null;
  if(!(Date.parse(r.frozen_at)<Date.parse(r.game_start)))reason='NOT_FROZEN_BEFORE_START';
  else if(!(Date.parse(r.graded_at)>Date.parse(r.game_start)))reason='GRADE_BEFORE_START_OR_MISSING';
  else if(r.engine!=='NHL-PRO-v2')reason='OTHER_OR_UNKNOWN_MODEL';
  else reason='FINAL_STATUS_AND_SOURCE_LINEAGE_NOT_VERIFIED';
  reasons[reason]=(reasons[reason]||0)+1;
 }
 const report={generatedAt:new Date().toISOString(),qualificationStatus:'SHADOW_ONLY_NOT_PRODUCTION_QUALIFIED',historical:{source:'data/models/nhl-pro-v2-validation.json',generatedAt:artifact.generatedAt,pointInTimeClaim:artifact.pointInTime,metrics:projectionAudit(artifact.gamePredictions||[]),limitations:['Existing walk-forward artifact, not a rerun of the changed production kernel.','No independently verified market prices or canonical historical stars.','Heuristic probability shrink is not empirical calibration.']},prospective:{source:'live primary D1 prediction_snapshots joined games',rawRows:prospective.length,eligibleRows:usable.length,excluded:reasons,metrics:projectionAudit(usable)},wagerLedger:{decisions:0,settlements:0,observedAt:'2026-10-20',backfilled:false},fiveStar:fiveStarCohort([]),authority:false};
 await mkdir('artifacts/nhl-production-qualification',{recursive:true});await writeFile('artifacts/nhl-production-qualification/audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({historical:report.historical.metrics,prospective:report.prospective,fiveStar:report.fiveStar},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
