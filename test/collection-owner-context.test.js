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
