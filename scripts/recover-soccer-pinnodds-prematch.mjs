import {ingestPinnArchiveStep} from "./lib/soccerPinnArchiveRetry.mjs";
/** Reuse one already-paid soccer capture. No provider capture/reservation calls. */
const base=process.env.BASE||'https://fbis-myz.pages.dev',secret=process.env.HARVEST_SECRET;
if(!secret)throw Error('HARVEST_SECRET_REQUIRED');
const now=new Date(),day=now.toISOString().slice(0,10).replaceAll('-',''),hour=String(Math.floor(now.getUTCHours()/6)*6).padStart(2,'0');
const snapshotId=process.env.SOCCER_PINN_SNAPSHOT_ID||`pinnodds-${day}-${hour}-full-board-1-prematch`;
const call=body=>ingestPinnArchiveStep({base,secret,body});
const prepared=await call({operation:'prepare',snapshotId,force:true,postCaptureFixtures:true});
console.log(JSON.stringify({snapshotId,phase:'prepare',normalizedRows:prepared.normalizedRows,matchedRows:prepared.matchedRows,batches:prepared.batches,ingestionScope:prepared.ingestionScope,selectedParentEvents:prepared.selectedParentEvents,excludedUnmatchedProviderEvents:prepared.excludedUnmatchedProviderEvents}));
if(!(prepared.normalizedRows>0&&prepared.matchedRows>0))throw Error("SOCCER_NO_MATCHED_PREMATCH_FIXTURES");
let inserted=0;
for(let i=0;i<prepared.batches;i+=4){
 const rs=await Promise.all(Array.from({length:Math.min(4,prepared.batches-i)},(_,j)=>call({operation:'consume',snapshotId,batchIndex:i+j})));
 inserted+=rs.reduce((n,r)=>n+r.inserted,0);console.log(JSON.stringify({snapshotId,completedBatches:Math.min(i+4,prepared.batches),batches:prepared.batches,inserted}));
}
const result=await call({operation:'reconcile',snapshotId});
console.log(JSON.stringify({ok:result.ok,snapshotId,normalizedRows:result.normalizedRows,matchedRows:result.matchedRows,persistedRows:result.persistedRows,reconciled:result.reconciled,collectedAt:result.collectedAt,paidProviderCalls:0,ingestionScope:result.ingestionScope}));
