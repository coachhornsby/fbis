#!/usr/bin/env node
// Historical match-winner research evaluation; no market price or production writes.
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {parseCsv} from './lib/tennis-lowtier-source-audit.mjs';
import {sourceFiles,ingestCrossLevelRows} from './lib/tennis-crosslevel-walkforward.mjs';
import {sanitizeMainTourHoldout,evaluateMatchWinnerTransfer} from './lib/tennis-matchwinner-transfer.mjs';

const mirror='https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main/';
const cutoffDate=new Date(Date.now()-21*86400000);
const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',
 year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(cutoffDate).map(x=>[x.type,x.value]));
const cutoff=parts.year+parts.month+parts.day;
assert.match(cutoff,/^[0-9]{8}$/);
const store={groups:new Map(),seen:new Set()},events=[],receipts=[];
for(const source of sourceFiles){
 const res=await fetch(mirror+source.path,{
  headers:{'user-agent':'FBIS noncommercial tennis historical matchwinner validation'},
  signal:AbortSignal.timeout(120000)
 });
 assert.equal(res.status,200,'MATCHWINNER_SOURCE_UNAVAILABLE_'+source.path);
 const body=await res.text();
 const rows=parseCsv(body);
 assert.ok(rows.length>200,'MATCHWINNER_SOURCE_INCOMPLETE_'+source.path);
 const ingest=ingestCrossLevelRows(store,source,rows,{cutoffExclusive:cutoff});
 if(source.sourceTier==='MAIN_TOUR'&&ingest.accepted<=0)
  throw Error('MATCHWINNER_MAIN_TOUR_SOURCE_HAS_NO_VALID_STATS_'+source.path);
 if(source.sourceTier==='MAIN_TOUR'){
  const candidates=sanitizeMainTourHoldout(source,rows,{cutoffExclusive:cutoff});
  events.push(...candidates);
 }
 receipts.push({...ingest,sha256:createHash('sha256').update(body).digest('hex'),cutoffExclusive:cutoff});
 console.log(JSON.stringify({source:source.path,accepted:ingest.accepted,rows:rows.length}));
}
assert.equal(receipts.length,15,'MATCHWINNER_SOURCE_RECEIPTS_INCOMPLETE');
const unique=new Map();
for(const e of events){
 if(unique.has(e.key))throw Error('DUPLICATE_HELDOUT_MAIN_TOUR_MATCH_'+e.key);
 unique.set(e.key,e);
}
const result=evaluateMatchWinnerTransfer(store,[...unique.values()],{simulations:300});
result.sourceReceipts=receipts;
result.heldoutDistinctMainTourEvents=unique.size;
result.cutoffExclusive=cutoff;
result.missingPlayerProfilesAdded=0;
result.sourceSnapshotsRetrospectivelyRetrieved=true;
result.productionWrites=0;
result.canQualify=false;result.canAuthorizeWager=false;
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/tennis-matchwinner-crosslevel-holdout.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({sources:receipts.length,holdoutCandidates:result.holdoutMatchCandidates,
 pairedMatches:result.pairedMatches,unscored:result.unscoredReasonCounts,
 direction:result.effectDirection,overallBrier:result.overall,
 partitionSummary:result.partitions.map(p=>({tour:p.tour,year:p.holdoutYear,n:p.matches,
  raw:p.raw?.brier,adjusted:p.adjusted?.brier,eligible:p.statisticallyEvaluable})),
 productionWrites:0,canAuthorizeWager:false}));
