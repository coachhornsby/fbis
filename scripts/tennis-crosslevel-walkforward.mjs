#!/usr/bin/env node
// Research-only out-of-time assessment of lower-tier Tennis to main-tour
// point-stat transfer. Never updates primary D1 or authorizes any wager.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {parseCsv} from './lib/tennis-lowtier-source-audit.mjs';
import {sourceFiles,ingestCrossLevelRows,runCrossLevelEvaluation} from './lib/tennis-crosslevel-walkforward.mjs';

const MIRROR='https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main/';
const date=new Date(Date.now()-21*86400000);
const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',
 year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
const cutoff=parts.year+parts.month+parts.day;
assert.match(cutoff,/^[0-9]{8}$/,'INVALID_TOURNAMENT_EMBARGO_DATE');
const store={groups:new Map(),seen:new Set()},sourceReceipts=[];
for(const meta of sourceFiles){
 const res=await fetch(MIRROR+meta.path,{
  headers:{'user-agent':'FBIS noncommercial Tennis prospective tier calibration research'},
  signal:AbortSignal.timeout(120000)
 });
 assert.equal(res.status,200,'CROSSLEVEL_SOURCE_FETCH_FAILED_'+meta.path);
 const txt=await res.text();
 const rows=parseCsv(txt);
 assert.ok(rows.length>200,'CROSSLEVEL_SOURCE_INCOMPLETE_'+meta.path);
 const stat=ingestCrossLevelRows(store,meta,rows,{cutoffExclusive:cutoff});
 assert.ok(stat.accepted>0,'CROSSLEVEL_VALID_SOURCE_EMPTY_'+meta.path);
 const receipt={...stat,sha256:createHash('sha256').update(txt).digest('hex'),cutoffExclusive:cutoff};
 sourceReceipts.push(receipt);
 console.log(JSON.stringify(receipt));
}
assert.equal(sourceReceipts.length,15,'CROSSLEVEL_REQUIRED_SOURCES_INCOMPLETE');
const report=runCrossLevelEvaluation(store);
report.sourceReceipts=sourceReceipts;
report.sourceFiles=sourceFiles.length;
report.cohortIdentityApplication='NONE';
report.wagerModelApplication='NONE';
report.surfaceAndCompetitionLevelPooling='NONE';
report.rightsReviewRequired=true;
report.productionWrites=0;
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/tennis-crosslevel-walkforward.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({
 sources:sourceReceipts.length,combinations:report.combinations,
 foldsTotal:report.foldsTotal,foldsStatisticallyEvaluable:report.foldsStatisticallyEvaluable,
 foldsImproved:report.foldsImproved,
 productionWrites:0,canAuthorizeWager:false,
 report:'artifacts/tennis-crosslevel-walkforward.json'
}));
