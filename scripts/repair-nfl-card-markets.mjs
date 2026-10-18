import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.BASE||'https://fbis-myz.pages.dev';
const headers={'content-type':'application/json','x-harvest-secret':process.env.HARVEST_SECRET};
if(!process.env.HARVEST_SECRET)throw Error('OPERATOR_AUTH_REQUIRED');
await mkdir('artifacts',{recursive:true});
async function call(body){const r=await fetch(base+'/api/pinnodds-ingest',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(150000)});const x=await r.json();if(!r.ok||!x.ok)throw Error(JSON.stringify(x));return x;}
for(const sport of ['nfl','cfb'])for(let dayOffset=0;dayOffset<=8;dayOffset++){
 const r=await fetch(base+'/api/football-fixtures',{method:'POST',headers,body:JSON.stringify({sport,dayOffset}),signal:AbortSignal.timeout(60000)});
 const x=await r.json();console.log(JSON.stringify(x));if(!r.ok||!x.ok)throw Error('FOOTBALL_SCHEDULE_INCOMPLETE');
}
const status=await(await fetch(base+'/api/pinnodds-status')).json();
const sources=status.results.filter(x=>x.kind==='board'&&x.feed==='prematch'&&x.snapshotId&&[5].includes(x.sportId));
for(const source of sources){
 const inspection=await call({operation:'inspect',snapshotId:source.snapshotId});
 await writeFile('artifacts/pinnodds-football-inventory.json',JSON.stringify(inspection,null,2));
 const prepared=await call({operation:'rematch',phase:'prepare',snapshotId:source.snapshotId,postCaptureFixtures:true});
 for(let batchIndex=0;batchIndex<prepared.batches;batchIndex++)await call({operation:'rematch',phase:'consume',snapshotId:source.snapshotId,batchIndex});
 const result=await call({operation:'rematch',phase:'finalize',snapshotId:source.snapshotId});
 console.log(JSON.stringify({snapshot:source.snapshotId,matchedRows:result.matchedRows,reconciled:result.reconciled,paidProviderCalls:0}));
}
const response=await fetch(base+'/api/today?sport=nfl',{signal:AbortSignal.timeout(180000)});const board=await response.json();
const games=board.games||[];const summary={http:response.status,date:board.date,games:games.map(g=>({id:g.id,away:g.away?.name,home:g.home?.name,
 pairedMarkets:g.pinnoddsResearch?.pairedMarkets||[],pinnodds:g.pinnoddsEvidenceState,
 projection:!!g.projection,nflMatchup:g.nflGameMatchup?.coverage||null,nflProfile:g.nflPersistentProfile?.configured||false,
 venueQuotes:g.market?.venueOffers?.length||0}))};
await writeFile('artifacts/nfl-card-readiness.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
if(!response.ok||!games.length||games.some(g=>!g.pinnoddsResearch?.pairedMarkets?.includes('spread')||!g.pinnoddsResearch?.pairedMarkets?.includes('total')))process.exitCode=1;
