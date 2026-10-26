#!/usr/bin/env node
/** CORE challenger original prospective readiness report, non-mutating and fail-closed.
 * Reads exported original shadow rows; never recovers missing original projections by refitting.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
const clock=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
const filled=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
export function evaluate(rows,{minimum=200}={}){
 if(!Array.isArray(rows))throw Error('ARRAY_REQUIRED');
 const unique=new Map();
 for(const row of rows){
  if(!row?.game_id)continue;
  const key=String(row.season)+':'+String(row.game_id);
  if(!unique.has(key))unique.set(key,[]);unique.get(key).push(row);
 }
 const decisions=[];
 for(const [key,list] of unique){
  const valid=list.filter(r=>
   r.can_qualify===1&&r.final_verified===1&&filled(r.actual_home)&&filled(r.actual_away)
   &&clock(r.generation_at)<clock(r.kickoff)&&clock(r.feature_cutoff_at)<=clock(r.generation_at)
   &&filled(r.champion_spread)&&filled(r.core_spread)&&filled(r.champion_p_home_win)&&filled(r.core_p_home_win)
   &&String(r.eligibility)==='eligible_projected'
   &&r.core_artifact_id&&r.core_model_version&&r.champion_model_version
  ).sort((a,b)=>clock(a.generation_at)-clock(b.generation_at));
  const r=valid[0];
  decisions.push({game_id:key,week:Number(list[0].week),qualified:!!r,
   reason:r?'ORIGINAL_CORE_PREGAME_AND_VERIFIED_FINAL':'MISSING_QUALIFIED_ORIGINAL_CORE_RECEIPT',
   champion_margin_error:r?Math.abs(Number(r.champion_spread)-(Number(r.actual_home)-Number(r.actual_away))):null,
   core_margin_error:r?Math.abs(Number(r.core_spread)-(Number(r.actual_home)-Number(r.actual_away))):null,
   champion_probability:r?Number(r.champion_p_home_win):null,core_probability:r?Number(r.core_p_home_win):null,
   actual_home_win:r?Number(r.actual_home)>Number(r.actual_away)?1:0:null});
 }
 const sample=decisions.filter(r=>r.qualified);
 const avg=f=>sample.length?sample.reduce((a,r)=>a+f(r),0)/sample.length:null;
 const current={qualified:sample.length,required:minimum,missing:Math.max(0,minimum-sample.length),
   groupedWeeks:[...new Set(sample.map(r=>r.week))].sort((a,b)=>a-b),
   champion_margin_mae:avg(r=>r.champion_margin_error),core_margin_mae:avg(r=>r.core_margin_error),
   champion_brier:avg(r=>(r.champion_probability-r.actual_home_win)**2),
   core_brier:avg(r=>(r.core_probability-r.actual_home_win)**2),
   insufficientHistory:sample.length<minimum,
   weekClusterEvaluationReady:sample.length>=minimum&&new Set(sample.map(r=>r.week)).size>=4,
   independentClvRoiEstablished:false,
   operatorApproval:false,productionAuthority:false,wagerAuthority:false};
 return {schema:'fbis.cfb.core_original_prospective_readiness.v1',source:'ORIGINAL_CORE_SHADOW_ROWS',
   evaluatedOriginalGameIds:decisions.length,...current,
   readyForHumanReview:current.weekClusterEvaluationReady&&!current.insufficientHistory&&current.independentClvRoiEstablished,
   automaticPromotion:false,rows:decisions};
}
if(process.argv[1]?.endsWith('cfb-core-live-readiness.mjs')){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Usage: exported-core-rows.json report.json');
 const content=JSON.parse(readFileSync(input,'utf8'));
 const rows=Array.isArray(content)&&Array.isArray(content[0]?.results)?content[0].results:Array.isArray(content)?content:null;
 if(!rows)throw Error('INVALID_CFB_CORE_DB_QUERY_FORMAT');
 const report=evaluate(rows);
 mkdirSync(dirname(output),{recursive:true});
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({qualified:report.qualified,required:report.required,weekClusters:report.groupedWeeks,ready:report.readyForHumanReview,autoPromote:false}));
}
