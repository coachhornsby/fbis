#!/usr/bin/env node
/** Research-only FULL cohort grading, using saved pre-kickoff FBIS-v2 and ESPN SECONDARY finals.
 * Only independent official results can lift status to official-verified in a separate step.
 */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.CFB_EVIDENCE_OUT||'artifacts/cfb-2026-weeks05-08';
const roster=JSON.parse(readFileSync('data/cfb/2026/weeks05-08-game-roster.json','utf8'));
const frozen=JSON.parse(readFileSync('data/cfb/2026/weeks05-08-frozen-a-a-receipts.json','utf8'));
const map=new Map(frozen.map(x=>[String(x.game_id),x]));
if(roster.length!==226||map.size!==226)throw Error('ROSTER_SNAPSHOT_MISMATCH');
const rows=[],byWeek={};
for(const g of roster){
 const p=map.get(String(g.game_id));if(!p)throw Error('MISSING_SNAPSHOT:'+g.game_id);
 const dir=join(root,'week'+String(g.week).padStart(2,'0'),String(g.game_id));
 const path=join(dir,'evidence-receipt.json');
 if(!existsSync(path))throw Error('MISSING_GAME_ARCHIVE:'+g.game_id);
 const receipt=JSON.parse(readFileSync(path,'utf8'));
 if(!receipt.reported_final||!Number.isFinite(receipt.secondary_home_score)||!Number.isFinite(receipt.secondary_away_score))throw Error('MISSING_FINAL:'+g.game_id);
 const summary=JSON.parse(readFileSync(join(dir,'raw-espn-summary.json'),'utf8'));
 const competitors=summary.header?.competitions?.[0]?.competitors||[];
 const h=competitors.find(x=>x.homeAway==='home'),a=competitors.find(x=>x.homeAway==='away');
 if(!h||!a)throw Error('ORIENTATION_MISSING:'+g.game_id);
 const sh=Number(receipt.secondary_home_score),sa=Number(receipt.secondary_away_score),ph=Number(p.proj_home),pa=Number(p.proj_away);
 const scoreAgreement=p.existing_grade==null?null:Number(p.existing_grade.actual_home)===sh&&Number(p.existing_grade.actual_away)===sa;
 const r={game_id:String(g.game_id),week:g.week,source_home:g.home_team_source,source_away:g.away_team_source,
  espn_home:h.team?.displayName,espn_away:a.team?.displayName,model_version:p.model_version,original_frozen_at:p.frozen_at,
  pregame_home:ph,pregame_away:pa,reported_home:sh,reported_away:sa,
  score_source:'ESPN_SECONDARY',official_score_verified:false,
  margin_error:(ph-pa)-(sh-sa),total_error:(ph+pa)-(sh+sa),
  home_error:ph-sh,away_error:pa-sa,correct_winner:Math.sign(ph-pa)===Math.sign(sh-sa),
  prior_snapshot_graded:p.existing_grade!=null,prior_score_agreement:scoreAgreement,
  retrieved_play_count:receipt.retrieved_play_count, retrieved_drive_count:receipt.retrieved_drive_count,
  pbp_complete_verified:false,possessions_complete_verified:false,
  original_projection_unmodified:true,promotion_authorized:false,wager_authorized:false};
 rows.push(r);writeFileSync(join(dir,'model-vs-reported-final.json'),JSON.stringify(r,null,2)+'\n');
}
const summarize=x=>({games:x.length,marginMAE:x.reduce((s,g)=>s+Math.abs(g.margin_error),0)/x.length,
 totalMAE:x.reduce((s,g)=>s+Math.abs(g.total_error),0)/x.length,
 homeMAE:x.reduce((s,g)=>s+Math.abs(g.home_error),0)/x.length,
 awayMAE:x.reduce((s,g)=>s+Math.abs(g.away_error),0)/x.length,
 winnerAccuracy:x.filter(g=>g.correct_winner).length/x.length,
 previouslyUngraded:x.filter(g=>!g.prior_snapshot_graded).length,
 priorScoreDisagreements:x.filter(g=>g.prior_score_agreement===false).length});
const report={schema:'fbis.cfb.weeks05-08_full_secondary_grade.v1',authority:'RESEARCH_ONLY_SECONDARY_SCORE',
 officialScoreVerified:0,promotionAuthorized:false,wagerAuthority:false,
 cohort:summarize(rows),weeks:[5,6,7,8].map(w=>({week:w,...summarize(rows.filter(x=>x.week===w))})),
 disagreements:rows.filter(x=>x.prior_score_agreement===false).map(x=>x.game_id),
 rows};
writeFileSync(join(root,'complete-secondary-grading.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync(join(root,'SUMMARY.md'),[
 '# FBIS 2026 CFB Weeks 5–8 — 226 games','',
 'All scores here are ESPN SECONDARY and do not yet constitute independent official NCAA verification.',
 'Full play and drive payloads are collected, but completeness is not yet independently certified.',
 'No model or betting authority is changed.','',
 '| Week | Games | Margin MAE | Total MAE | Winner Accuracy | Existing grades missing |','|---|---:|---:|---:|---:|---:|',
 ...report.weeks.map(w=>`| ${w.week} | ${w.games} | ${w.marginMAE.toFixed(2)} | ${w.totalMAE.toFixed(2)} | ${(100*w.winnerAccuracy).toFixed(1)}% | ${w.previouslyUngraded} |`),
 `| TOTAL | 226 | ${report.cohort.marginMAE.toFixed(2)} | ${report.cohort.totalMAE.toFixed(2)} | ${(100*report.cohort.winnerAccuracy).toFixed(1)}% | ${report.cohort.previouslyUngraded} |`,
 '',`Prior saved-score discrepancies against ESPN: ${report.disagreements.length}`,''].join('\n'));
console.log(JSON.stringify({games:rows.length,cohort:report.cohort,disagreements:report.disagreements}));
