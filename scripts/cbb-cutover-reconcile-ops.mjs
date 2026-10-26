#!/usr/bin/env node
/** Shadow only. Stops on record mismatch; never approves activation or wagering. */
import {retryCbbMigration} from './lib/cbbMigrationRetry.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createTopologyClient} from './lib/topologyFetch.mjs';
import {SPORT_PREFIX_TABLES} from '../functions/lib/sportWorkingCopy.js';
import {CBB_SHARED_TABLES} from '../functions/lib/cbbExactMigration.js';
const dir='artifacts/cbb-cutover-reconciliation';await mkdir(dir,{recursive:true});
const {postTopology}=createTopologyClient({base:process.env.FBIS_BASE_URL||'https://fbis-myz.pages.dev',secret:process.env.HARVEST_SECRET,timeoutMs:300000,retries:3});
const receipt={retries:[],startedAt:new Date().toISOString(),deployment:process.env.GITHUB_SHA||null,tables:[],phaseCertification:false,canAuthorizeWager:false};
const save=()=>writeFile(`${dir}/receipt.json`,JSON.stringify(receipt,null,2)+'\n');
const call=(op,body)=>retryCbbMigration(()=>postTopology(op,body),{onRetry:async retry=>{receipt.retries.push({at:new Date().toISOString(),op,table:body.table||body.tables?.[0],...retry});await save();}});
try{
 const authority=await call('sport-authority-state',{sport:'cbb'});
 if(authority.mode!=='shadow')throw Error('CBB_RECONCILIATION_REQUIRES_SHADOW');
 for(const table of [...CBB_SHARED_TABLES,...SPORT_PREFIX_TABLES.cbb]){
  const item={table,copyPasses:[],parityPages:[],status:'RUNNING'};receipt.tables.push(item);await save();
  // The working-set endpoint copies all seven shared tables in one call.
  if(CBB_SHARED_TABLES.includes(table)&&table!=='games')continue;
  let complete=false;
  for(let round=0;round<300;round++){
   const pass=await call(CBB_SHARED_TABLES.includes(table)?'sport-copy':'sport-prefix-copy',{
    sport:'cbb',tables:[table],pageSize:100,maxPages:50,resume:true,skipCaughtUp:false});
   if(!pass.ok)throw Error('CBB_COPY_FAILED:'+table+':'+JSON.stringify(pass));
   item.copyPasses.push({at:new Date().toISOString(),results:pass.results});await save();
   if(!pass.moreRemaining){complete=true;break;}
  }
  if(!complete)throw Error('CBB_COPY_BUDGET_EXHAUSTED:'+table);
 }
 for(const item of receipt.tables){
  let after=null,complete=false;
  for(let page=0;page<2000;page++){
   const parity=await call('cbb-exact-parity-page',{table:item.table,after,pageSize:1000});
   item.parityPages.push(parity);await save();
   if(!parity.ok)throw Error('CBB_FIELD_PARITY_FAILED:'+item.table);
   if(parity.exhausted){complete=true;break;}
   if(!parity.nextAfter)throw Error('CBB_PARITY_CURSOR_MISSING');
   after=parity.nextAfter;
  }
  if(!complete)throw Error('CBB_PARITY_BUDGET_EXHAUSTED');item.status='EXHAUSTIVE_FIELDS_MATCH';await save();
 }
 receipt.status='DATA_RECONCILIATION_COMPLETE_NOT_CUTOVER_CERTIFICATION';
}catch(error){receipt.status='FAILED';receipt.error=String(error?.message||error);process.exitCode=1;}
receipt.completedAt=new Date().toISOString();await save();console.log(JSON.stringify(receipt));
