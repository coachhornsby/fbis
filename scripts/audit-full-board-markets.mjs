import {mkdir,writeFile,readFile} from 'node:fs/promises';
const base=process.env.BASE||'https://fbis-myz.pages.dev';
const headers={'content-type':'application/json','x-harvest-secret':process.env.HARVEST_SECRET};
if(!process.env.HARVEST_SECRET)throw Error('OPERATOR_AUTH_REQUIRED');
await mkdir('artifacts',{recursive:true});
const get=async p=>{const r=await fetch(base+p,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error(p+':'+r.status);return r.json()};
const status=await get('/api/pinnodds-status');
// Apply verified name fixes to the immutable captures that originally missed
// those fixtures. Keep their original price and collection clocks.
let before=status;try{before=JSON.parse(await readFile('artifacts/pinnodds-before-capture.json','utf8'))}catch{}
const archives=new Map();
for(const source of (before.results||[]).filter(x=>x.kind==='board'&&x.feed==='prematch'&&[1,2].includes(x.sportId)&&x.snapshotId)){
 archives.set(source.snapshotId,source);
 const slot=source.snapshotId.match(/^pinnodds-(\d{8})-(\d{2})-full-board-(\d+)-prematch$/);
 if(slot&&Number(slot[2])>=6){const snapshotId=`pinnodds-${slot[1]}-${String(Number(slot[2])-6).padStart(2,'0')}-full-board-${slot[3]}-prematch`;archives.set(snapshotId,{...source,snapshotId,optional:true});}
}
for(const source of archives.values()){
 const call=async body=>{const r=await fetch(base+'/api/pinnodds-ingest',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});const x=await r.json();if(!r.ok||!x.ok)throw Error('ARCHIVE_REMATCH_FAILED:'+JSON.stringify(x));return x};
 let prepared;try{prepared=await call({operation:'rematch',phase:'prepare',snapshotId:source.snapshotId,postCaptureFixtures:true})}catch(error){if(source.optional&&String(error).includes('PROVIDER_RECEIPT_NOT_FOUND')){console.log(JSON.stringify({unavailableArchive:source.snapshotId}));continue;}throw error;}
 for(let batchIndex=0;batchIndex<prepared.batches;batchIndex++)await call({operation:'rematch',phase:'consume',snapshotId:source.snapshotId,batchIndex});
 const result=await call({operation:'rematch',phase:'finalize',snapshotId:source.snapshotId});
 console.log(JSON.stringify({rematched:source.snapshotId,matchedRows:result.matchedRows,paidProviderCalls:0}));
}
for(const source of status.results.filter(x=>x.kind==='board'&&x.feed==='prematch'&&[1,2,5].includes(x.sportId)&&x.snapshotId)){
 const r=await fetch(base+'/api/pinnodds-ingest',{method:'POST',headers,body:JSON.stringify({operation:'inspect',sportScope:'all',snapshotId:source.snapshotId}),signal:AbortSignal.timeout(180000)});
 const x=await r.json();if(!r.ok||!x.ok)throw Error('ARCHIVE_INSPECTION_FAILED');
 await writeFile('artifacts/pinnodds-inventory-'+source.sportId+'.json',JSON.stringify(x,null,2));
 console.log(JSON.stringify({sportId:source.sportId,events:x.events.length,collectedAt:x.collectedAt,paidProviderCalls:0}));
 console.log(JSON.stringify({sportId:source.sportId,coverageTargets:x.events.filter(e=>/havre|auxer|rennais|paris|reign|chicago|joint|preston|stoiana|ishii|tagger|samsonova|kayla|jones|mcnally|kraus/i.test(JSON.stringify(e))).slice(0,60)}));
}
const board=await get('/api/today');
const coverage=board.games.map(g=>({id:g.id,sport:g.sport,start:g.start,away:g.away?.name,home:g.home?.name,pinnodds:g.pinnoddsResearch?.pairedMarkets||[],polymarket:(g.market?.venueOffers||[]).filter(o=>o.source?.startsWith('Polymarket')).map(o=>({family:o.marketFamily,side:o.side,period:o.period,collectedAt:o.collectedAt}))}));
await writeFile('artifacts/full-board-coverage.json',JSON.stringify({at:board.generatedAt,coverage,polymarket:board.polymarketResearch},null,2));
console.log(JSON.stringify({games:coverage.length,pinnoddsGames:coverage.filter(g=>g.pinnodds.length).length,polymarketGames:coverage.filter(g=>g.polymarket.length).length,paidProviderCalls:0}));
