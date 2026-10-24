import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionOwnerContext} from '../functions/lib/collectionOwnerContext.js';
import {sportLedgerEnv} from '../functions/lib/sportLedgerRouting.js';
const primary={prepare(){}},nhl={prepare(){}};
const scope=rows=>({DB:primary,NHL_DB:nhl,SPORT_DB_MODE_NHL:'sport',SPORT_DB_STRICT_NHL:'true',SPORT_DB_LEDGER_READY_NHL:'true',SPORT_CUTOVER_RECEIPT_NHL:'receipt',CORE_DB:{prepare(){return {all:async()=>({results:rows})};}}});
test('a cold collector loads an existing approved NHL receipt before ledger writes',async()=>{
 const env=scope([{sport:'nhl',receipt_id:'receipt',status:'APPROVED'}]);assert.equal(sportLedgerEnv(env,'nhl').DB,null);
 const hydrated=await collectionOwnerContext(env);assert.equal(sportLedgerEnv(hydrated,'nhl').DB,nhl);assert.equal(env.__fbisCutoverApprovals,undefined);
});
test('revoked/missing CORE approval cannot reuse an injected grant or fall back to PRIMARY',async()=>{
 const env=scope([]);env.__fbisCutoverApprovals=new Map([['nhl:receipt',{sport:'nhl',receipt_id:'receipt',status:'APPROVED'}]]);
 const hydrated=await collectionOwnerContext(env);assert.equal(sportLedgerEnv(hydrated,'nhl').DB,null);assert.equal(hydrated.DB,primary);
});
test('shadow-only collectors keep their current authority without a CORE query',async()=>{
 const env={DB:primary,SPORT_DB_MODE_NHL:'shadow',CORE_DB:{prepare(){throw Error('UNEXPECTED_CORE_QUERY');}}};assert.equal(await collectionOwnerContext(env),env);
});

test('nested snapshot readback preserves the original PRIMARY identity and revalidates approval',async()=>{
 const hydrated=await collectionOwnerContext(scope([{sport:'nhl',receipt_id:'receipt',status:'APPROVED'}])),first=sportLedgerEnv(hydrated,'nhl'),second=sportLedgerEnv(first,'nhl');assert.equal(second.DB,nhl);assert.equal(second.__sportLedgerPrimaryDb,primary);
 second.__fbisCutoverApprovals.clear();assert.equal(sportLedgerEnv(second,'nhl').DB,null);
 assert.equal(sportLedgerEnv({...first,DB:primary},'nhl').DB,null);
});

test('a scheduled snapshot can complete its nested no-final readback on the approved dedicated DB',async()=>{
 const {persistSnapshot}=await import('../functions/lib/store.js');let writes=0;
 const dedicated={prepare(){return {bind(){return this;},run:async()=>{writes++;return{meta:{changes:1}};}};}};
 const hydrated=await collectionOwnerContext({...scope([{sport:'nhl',receipt_id:'receipt',status:'APPROVED'}]),NHL_DB:dedicated});
 const result=await persistSnapshot(hydrated,{id:'s',gameId:'g',sport:'nhl',date:'2026-10-24',checkpoint:'FIRST_AVAILABLE',modelVersion:'v',frozenAt:'2026-10-24T12:00:00Z',gameStatus:'OPEN'});
 assert.equal(result.ok,true);assert.equal(writes,1);
});

test('cross-sport nesting returns shadow reads to PRIMARY and preserves separately approved NFL routing',async()=>{
 const nfl={prepare(){}},env=scope([{sport:'nhl',receipt_id:'receipt',status:'APPROVED'},{sport:'nfl',receipt_id:'nfl-receipt',status:'APPROVED'}]);Object.assign(env,{NFL_DB:nfl,SPORT_DB_MODE_NFL:'sport',SPORT_DB_STRICT_NFL:'true',SPORT_CUTOVER_RECEIPT_NFL:'nfl-receipt'});
 const first=sportLedgerEnv(await collectionOwnerContext(env),'nhl');assert.equal(sportLedgerEnv(first,'mlb').DB,primary);
 const routed=sportLedgerEnv(first,'nfl');assert.equal(routed.DB,nfl);assert.equal(sportLedgerEnv(routed,'nfl').DB,nfl);
});
