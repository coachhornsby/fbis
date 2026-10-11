#!/usr/bin/env node
/** Bounded, read-only source/API reconciliation. No collect, freeze or write routes. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {loadCfbPublicWeek} from '../functions/lib/cfbPublicSchedule.js';
import {isFbsVsFbsGame} from '../functions/lib/cfbGameVisibility.js';
const hash=body=>crypto.createHash('sha256').update(body).digest('hex');
export function reconcileCfbWindow(source,published){
 const failures=[],expected=new Set(source.games.map(g=>String(g.id))),seen=new Set();
 const games=published.games||[];
 for(const game of games){
  const id=String(game.id||'');
  if(!id||seen.has(id))failures.push('DUPLICATE_OR_MISSING_ID:'+id);
  seen.add(id);
  if(!isFbsVsFbsGame(game))failures.push('NON_FBS_CARD:'+id);
  const canonical=source.games.find(g=>String(g.id)===id);
  if(!canonical){failures.push('EXTRA_CARD:'+id);continue;}
  if(game.home?.espnId!==canonical.home?.espnId||game.away?.espnId!==canonical.away?.espnId)failures.push('IDENTITY_MISMATCH:'+id);
  if(Date.parse(game.start)!==Date.parse(canonical.start))failures.push('KICKOFF_MISMATCH:'+id);
 }
 const missing=[...expected].filter(id=>!seen.has(id));
 failures.push(...missing.map(id=>'MISSING_CARD:'+id));
 if(source.coverage.successfulDays!==7)failures.push('SOURCE_PARTIAL');
 const projected=games.filter(g=>Number.isFinite(g.projHomeScore)&&Number.isFinite(g.projAwayScore));
 return {expected:expected.size,published:games.length,missing,failures,passed:failures.length===0,
  sourceCoverage:source.coverage,sourceObservedAt:source.observedAt,
  projectionDeclaredUnavailable:games.filter(g=>g.projectionUnavailable===true).length,
  projectionShapeRecognized:projected.length,
  provisionalForecasts:games.filter(g=>g.cfbFbisV2?.provisional===true).length,
  qualificationBlocked:games.filter(g=>g.cfbFbisV2?.blocked===true||g.cfbFbisV2?.canAuthorizeWager===false).length,
  modelVersions:[...new Set(projected.map(g=>g.modelVersion).filter(Boolean))],
  note:'Forecast/market qualification is evaluated separately; fixture parity does not establish bet eligibility'};
}
export async function auditCfbProduction({base='https://fbis-myz.pages.dev',day,fetchFn=fetch}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))throw Error('Explicit audit date required');
 if(!['https://fbis-myz.pages.dev','https://fbis.pages.dev'].includes(base))throw Error('Unapproved production origin');
 const report={observedAt:new Date().toISOString(),day,base,classification:'READ_ONLY_PRODUCTION_ACCEPTANCE',
  productionWrites:0,paidAcquisitionStarts:0,windows:[],http:[],failures:[]};
 async function get(path){
  const response=await fetchFn(base+path,{signal:AbortSignal.timeout(90000),headers:{'User-Agent':'FBIS-CFB-Production-Audit/1.0',Accept:'application/json'}});
  const bytes=await response.arrayBuffer();if(bytes.byteLength>16*1024*1024)throw Error('Response bound exceeded');
  report.http.push({path,status:response.status,bytes:bytes.byteLength,sha256:hash(Buffer.from(bytes)),observedAt:new Date().toISOString()});
  if(!response.ok)throw Error('HTTP '+response.status+' '+path);
  return JSON.parse(Buffer.from(bytes).toString());
 }
 try{const d=await get('/api/cfb-teams');report.directory={count:d.count,teams:d.teams?.length,uniqueIds:new Set(d.teams?.map(t=>t.teamId)).size};
  if(!d.ok||d.count!==138||report.directory.uniqueIds!==138)report.failures.push('DIRECTORY_NOT_138_UNIQUE_FBS');
 }catch(e){report.failures.push('DIRECTORY:'+e.message);}
 try{const d=await get('/api/cfb-intelligence');report.intelligence={coverage:d.coverage,version:d.version,
   conferences:d.conferences?.length,categories:d.rankingMetrics?.length||0,summaryLag:d.coverage?.summaryGameGaps,
   source:d.source,allStatsConsumed:d.model?.allStatsConsumed,canAuthorizeWager:d.model?.canAuthorizeWager};
  if(!d.ok||d.teams?.length!==138)report.failures.push('INTELLIGENCE_NOT_138_FBS');
 }catch(e){report.failures.push('INTELLIGENCE:'+e.message);}
 for(const shift of [0,1]){
  try{const source=await loadCfbPublicWeek(day,{},shift,fetchFn);
   const published=await get(`/api/slate?sport=cfb&date=${day}&weekShift=${shift}`);
   const reconciliation=reconcileCfbWindow(source,published);
   report.windows.push({shift,range:source.range,...reconciliation,apiHealth:published.cfbScheduleHealth||null});
   report.failures.push(...reconciliation.failures.map(e=>'WEEK'+shift+':'+e));
  }catch(e){report.failures.push('WEEK'+shift+':'+e.message);}
 }
 report.passed=report.failures.length===0;return report;
}
if(process.argv[1]?.endsWith('cfb-production-acceptance.mjs')){
 const day=process.argv[2],output=process.argv[3];
 const report=await auditCfbProduction({day});
 if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
