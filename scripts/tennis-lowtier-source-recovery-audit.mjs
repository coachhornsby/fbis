#!/usr/bin/env node
// Evidence-only low-tier source recovery audit. No D1 writes or profile updates.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {makeCandidateIndex,parseCsv,scanSource,sources,summarize} from './lib/tennis-lowtier-source-audit.mjs';

const BASE=process.env.BASE||'https://fbis-myz.pages.dev';
const SECRET=process.env.HARVEST_SECRET;
const MIRROR='https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main/';
if(!SECRET)throw Error('HARVEST_SECRET_REQUIRED');
const cutoff=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',
 year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
const targets=[];let lastCohort=null,expectedIncomplete=null;
for(let offset=0;offset<1400;offset+=200){
 const url=new URL('/api/tennis-profile-reconciliation',BASE);
 url.searchParams.set('limit','200');url.searchParams.set('offset',String(offset));
 const response=await fetch(url,{headers:{'x-harvest-secret':SECRET},signal:AbortSignal.timeout(90000)});
 assert.equal(response.status,200,'COHORT_RECONCILIATION_UNAVAILABLE_'+response.status);
 const doc=await response.json();
 assert.equal(doc.ok,true);
 assert.equal(doc.cohortId,'tennis-elo-private-20261019-1074');
 assert.equal(doc.canAuthorizeWager,false);
 assert.equal(doc.identityUpdatesPerformed,0);
 assert.equal(doc.profilesManufactured,0);
 const totals=doc.byTour||[];
 assert.equal(Number(totals.find(x=>x.tour==='atp')?.roster),559);
 assert.equal(Number(totals.find(x=>x.tour==='wta')?.roster),515);
 const incomplete=totals.reduce((s,x)=>s+Number(x.incomplete),0);
 if(expectedIncomplete!=null&&incomplete!==expectedIncomplete)throw Error('COHORT_CHANGED_DURING_PAGINATION');
 expectedIncomplete=incomplete;
 if(lastCohort!=null&&lastCohort!==doc.cohortId)throw Error('COHORT_CHANGED');
 lastCohort=doc.cohortId;
 targets.push(...doc.missingPlayers);
 if(doc.missingPlayers.length<200)break;
 if(offset===1200)throw Error('COHORT_PAGINATION_EXCEEDED');
}
const unique=new Map();
for(const p of targets){
 const key=p.tour+'|'+p.playerKey;
 if(unique.has(key))throw Error('DUPLICATE_COHORT_PLAYER_'+key);
 unique.set(key,p);
}
const index=makeCandidateIndex([...unique.values()]);
assert.equal(index.size,expectedIncomplete,'MISSING_PROFILE_TARGET_COUNT_DRIFT');
if(index.size===0)throw Error('NO_MISSING_PROFILES_REQUIRES_DIFFERENT_AUDIT');
const receipts=[];
for(const meta of sources){
 const url=MIRROR+meta.path;
 const response=await fetch(url,{headers:{'user-agent':'FBIS private tennis source verification research'},signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('SOURCE_FETCH_UNAVAILABLE_'+meta.path+'_'+response.status);
 const body=await response.text();
 const rows=parseCsv(body);
 if(rows.length<100)throw Error('INSUFFICIENT_SOURCE_ROWS_'+meta.path);
 const stat=scanSource(index,meta,rows,cutoff);
 receipts.push({...meta,rows:rows.length,...stat,cutoffExclusive:cutoff});
 console.log(JSON.stringify({source:meta.path,rows:rows.length,...stat}));
}
assert.equal(receipts.length,sources.length,'SOURCE_RECEIPTS_INCOMPLETE');
const report=summarize(index,receipts);
assert.equal(report.targets,expectedIncomplete);
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/tennis-lowtier-source-recovery.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({targets:report.targets,summary:report.summary,sourceReceipts:receipts.length,
 productionWrites:report.productionWrites,canAuthorizeWager:report.canAuthorizeWager}));
