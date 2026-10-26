#!/usr/bin/env node
/** Phase 4B research diagnostics. Consumes immutable, PRE-GAME FBIS receipts and recovered game evidence.
 * No authority to modify champion, frozen forecasts, or wagers.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.CFB_EVIDENCE_OUT||'artifacts/cfb-2026-weeks05-08';
const receipts=JSON.parse(readFileSync(join(root,'complete-secondary-grading.json'),'utf8'));
if(receipts.rows?.length!==226)throw Error('226_GAME_EVIDENCE_REQUIRED');
const models=receipts.rows;
const group=(key)=>{const m=new Map();for(const r of models){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return [...m].map(([cohort,rows])=>({cohort,n:rows.length,margin_mae:rows.reduce((x,y)=>x+Math.abs(y.margin_error),0)/rows.length,total_mae:rows.reduce((x,y)=>x+Math.abs(y.total_error),0)/rows.length,winner_accuracy:rows.filter(x=>x.correct_winner).length/rows.length}));};
const abs=x=>Math.abs(x);
const output={schema:'fbis.cfb.phase4.diagnostics.v1',authority:'RESEARCH_ONLY',
score_verification:'ESPN_SECONDARY_NOT_OFFICIAL',
overall:{games:models.length,margin_mae:models.reduce((x,r)=>x+abs(r.margin_error),0)/models.length,total_mae:models.reduce((x,r)=>x+abs(r.total_error),0)/models.length},
cohorts:{week:group(r=>r.week),projected_favorite:group(r=>r.pregame_home>=r.pregame_away?'home_favorite':'away_favorite'),
margin_magnitude:group(r=>{const a=abs(r.pregame_home-r.pregame_away);return a<3?'0-3':a<7?'3-7':a<14?'7-14':'14+';}),
total_magnitude:group(r=>{const t=r.pregame_home+r.pregame_away;return t<45?'under45':t<55?'45-55':t<65?'55-65':'65+';})},
scoring_bias:models.reduce((x,r)=>x+r.total_error,0)/models.length,
missing_drive_data:models.filter(x=>!x.retrieved_drive_count).map(x=>x.game_id),
no_automatic_promotion:true,can_authorize_wager:false};
mkdirSync(root,{recursive:true});
writeFileSync(join(root,'phase4-model-diagnostics.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({games:output.overall.games,cohorts:Object.keys(output.cohorts),missing_drives:output.missing_drive_data.length}));
