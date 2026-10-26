#!/usr/bin/env node
/** CFB v0.1 possession Monte Carlo research. Chronological prior-week training only.
 * Grades are retrospective research, NOT qualifying prospective pre-kickoff receipts.
 * Frozen CFB-FBIS-v2 means are consumed as inputs; no modification of the champion.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.CFB_EVIDENCE_OUT||'artifacts/cfb-2026-weeks05-08';
const report=JSON.parse(readFileSync(join(root,'complete-secondary-grading.json'),'utf8'));
const official=JSON.parse(readFileSync(join(root,'ncaa-official-reconciliation-summary.json'),'utf8'));
if(report.rows?.length!==226||official.ncaaVerified!==226)throw Error('OFFICIAL_226_REQUIRED');
const rngFor=id=>{let s=[...String(id)].reduce((a,c)=>((a*33+c.charCodeAt(0))>>>0),5381);return ()=>((s=(s*1664525+1013904223)>>>0)/4294967296);};
const loadDrives=g=>JSON.parse(readFileSync(join(root,'week'+String(g.week).padStart(2,'0'),String(g.game_id),'drives-espn.json'),'utf8')).previous||[];
const chance=(n,mean,tdMix,rand)=>{
 const nPoss=Math.max(4,Math.round(n + (rand()+rand()+rand()-1.5)*3.2));
 const p=Math.min(.95,Math.max(0,mean/(nPoss*(3+4*tdMix))));
 let points=0;
 for(let k=0;k<nPoss;k++)if(rand()<p)points+=rand()<tdMix?7:3;
 return points;
};
const results=[];
for(const week of [6,7,8]){
 const history=report.rows.filter(g=>g.week<week),games=report.rows.filter(g=>g.week===week);
 const drives=history.flatMap(loadDrives),td=drives.filter(d=>d.result==='TD').length,fg=drives.filter(d=>d.result==='FG').length;
 if(!history.length||td+fg<20)throw Error('INSUFFICIENT_PAST_DRIVES:'+week);
 const meanDrives=drives.length/(2*history.length),tdMix=td/(td+fg);
 for(const g of games){
  const rand=rngFor(g.game_id), trials=2000;let wins=0,ties=0,sumH=0,sumA=0;
  for(let i=0;i<trials;i++){
   const h=chance(meanDrives,g.pregame_home,tdMix,rand),a=chance(meanDrives,g.pregame_away,tdMix,rand);
   sumH+=h;sumA+=a;if(h>a)wins++;else if(h===a)ties++;
  }
  const probability=(wins+ties*.5)/trials;
  const actualWin=g.reported_home>g.reported_away?1:g.reported_home<g.reported_away?0:.5;
  const item={game_id:g.game_id,week,training_through_week:week-1,simulation_trials:trials,
   prior_training_games:history.length,prior_observed_drives:drives.length,
   estimated_possessions_per_team:meanDrives,td_mix_scoring_drive:tdMix,
   baseline_home:g.pregame_home,baseline_away:g.pregame_away,
   sim_expected_home:sumH/trials,sim_expected_away:sumA/trials,
   sim_p_home:probability,actual_home:g.reported_home,actual_away:g.reported_away,
   brier:(probability-actualWin)**2,
   winner_correct:(probability>=.5)===(actualWin>=.5),
   original_champion_unchanged:true,qualification:'RETROSPECTIVE_SHADOW_NOT_PROSPECTIVE',
   wager_authority:false,model_promotion:false};
  results.push(item);
  writeFileSync(join(root,'week'+String(week).padStart(2,'0'),String(g.game_id),'possession-sim-research-v01.json'),JSON.stringify(item,null,2));
 }
}
const mean=k=>results.reduce((x,r)=>x+r[k],0)/results.length;
const out={schema:'fbis.cfb.possession_challenger.v0.1',model_name:'Pace-Drives-Retrospective-Research',
 games:results.length,training_week:5,holdout_weeks:[6,7,8],
 brier:mean('brier'),winner_accuracy:results.filter(x=>x.winner_correct).length/results.length,
 official_finals_reconciled:true,source_pbp_complete_verified:false,
 champion_model_changed:false,automatically_promotable:false,wager_authority:false,rows:results};
writeFileSync(join(root,'phase4-possession-challenger-v01.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify({games:out.games,brier:out.brier,winner_accuracy:out.winner_accuracy,retro_only:true}));
