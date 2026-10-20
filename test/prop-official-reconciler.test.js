import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {persistPropEvidence,readPropEvidence} from '../functions/lib/propEvidenceStore.js';
import {reconcileOfficialProp} from '../functions/lib/propOfficialReconciler.js';
function bucket(){const data=new Map();return {data,async get(k){if(!data.has(k))return null;return {text:async()=>data.get(k),json:async()=>JSON.parse(data.get(k))};},async put(k,v){data.set(k,v);}};}
const base={schemaVersion:1,canonicalEventId:'e1',canonicalPlayerId:'p1'};
const prediction={...base,kind:'FROZEN_PROJECTION',observedAt:'2026-10-20T10:00:00Z',sourceId:'model:m1',prediction:{canonicalEventId:'e1',canonicalPlayerId:'p1',canonical_market:'shots',period:'full_game',modelVersion:'m1',frozenAt:'2026-10-20T10:00:00Z'}};
const contract={...base,kind:'MARKET_SNAPSHOT',observedAt:'2026-10-20T11:00:00Z',sourceId:'market:k1',settlementPolicyVerified:true,settlementPolicySourceId:'rule:cert1',contract:{canonicalEventId:'e1',canonicalPlayerId:'p1',canonical_market:'shots',period:'full_game',provider:'Kalshi',contractId:'k1',identityVerified:true,settlementVerified:true,settlementTerms:'numeric sample contract',settlementRuleVersion:'numeric-v1',voidOnDnp:true,pushOnTie:true,overtimeIncluded:true,line:2,statSide:'over',eventStart:'2026-10-20T20:00:00Z'}};
const result={...base,kind:'OFFICIAL_RESULT',observedAt:'2026-10-21T01:00:00Z',sourceId:'league:r1',result:{canonicalEventId:'e1',canonicalPlayerId:'p1',canonical_market:'shots',period:'full_game',actual:3,official:true,source:'official-league',sourceRecordId:'r1',finalizedAt:'2026-10-21T00:00:00Z',status:'FINAL',playerStatus:'PLAYED',overtimeIncluded:true}};
async function setup(c=contract){const b=bucket(),ids=[];for(const x of [prediction,c,result]){const r=await persistPropEvidence({ARCHIVE:b},x,{webCrypto:webcrypto});assert.equal(r.ok,true);ids.push(r.id);}return {b,ids};}
test('linked frozen evidence grades reproducibly with no wager authority',async()=>{
 const {b,ids}=await setup();const options={projectionId:ids[0],marketId:ids[1],resultId:ids[2],observedAt:'2026-10-21T02:00:00Z',webCrypto:webcrypto};
 const a=await reconcileOfficialProp({ARCHIVE:b},options);assert.equal(a.ok,true);assert.equal(a.grade,'WIN');assert.equal(a.canAuthorizeWager,false);
 const other=await reconcileOfficialProp({ARCHIVE:b},options);assert.equal(other.gradeEvidenceId,a.gradeEvidenceId);assert.equal(other.alreadyPersisted,true);
 const grade=await readPropEvidence({ARCHIVE:b},'SETTLEMENT_GRADE',a.gradeEvidenceId,{webCrypto:webcrypto});assert.equal(grade.ok,true);
});
test('unknown settlement policy, mismatched IDs and post-event market capture fail closed',async()=>{
 const cases=[{...contract,settlementPolicyVerified:false},{...contract,canonicalPlayerId:'other'},{...contract,observedAt:'2026-10-20T21:00:00Z'}];
 for(const c of cases){const {b,ids}=await setup(c);const r=await reconcileOfficialProp({ARCHIVE:b},{projectionId:ids[0],marketId:ids[1],resultId:ids[2],observedAt:'2026-10-21T02:00:00Z',webCrypto:webcrypto});assert.equal(r.ok,false);assert.equal(r.canAuthorizeWager,false);}
});
