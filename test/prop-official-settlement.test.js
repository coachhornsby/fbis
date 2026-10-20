import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeOfficialProp} from '../functions/lib/propOfficialSettlement.js';
const frozen={canonicalEventId:'n-1',canonicalPlayerId:'n:1',canonical_market:'shots',period:'full_game',modelVersion:'m1',frozenAt:'2026-10-20T10:00:00Z'};
const contract={...frozen,provider:'Kalshi',contractId:'K-1',identityVerified:true,settlementVerified:true,settlementTerms:'numeric full game incl OT',settlementRuleVersion:'numeric-v1',voidOnDnp:true,pushOnTie:true,overtimeIncluded:true,line:3,statSide:'over',eventStart:'2026-10-20T20:00:00Z'};
const result={canonicalEventId:'n-1',canonicalPlayerId:'n:1',canonical_market:'shots',period:'full_game',actual:4,official:true,source:'league',sourceRecordId:'game-1',status:'FINAL',playerStatus:'PLAYED',overtimeIncluded:true,finalizedAt:'2026-10-21T00:00:00Z'};
const grade=(p=frozen,c=contract,r=result)=>gradeOfficialProp({prediction:p,contract:c,result:r});
test('grades final official numeric stat while withholding wagering authority',()=>{const x=grade();assert.equal(x.grade,'WIN');assert.equal(x.supported,true);assert.equal(x.canAuthorizeWager,false);assert.equal(x.recordedWager,false)});
test('loss and push respect exact side and threshold',()=>{assert.equal(grade(frozen,{...contract,statSide:'under'}).grade,'LOSS');assert.equal(grade(frozen,contract,{...result,actual:3}).grade,'PUSH')});
test('official provenance, frozen time, identity and precise settlement semantics are mandatory',()=>{
 for(const [p,c,r] of [
 [frozen,contract,{...result,official:false}],[frozen,contract,{...result,sourceRecordId:null}],
 [frozen,contract,{...result,status:'PROVISIONAL'}],[frozen,contract,{...result,playerStatus:'DNP'}],
 [frozen,{...contract,canonicalPlayerId:'other'},result],[{...frozen,frozenAt:'2026-10-20T21:00:00Z'},contract,result],
 [frozen,{...contract,overtimeIncluded:false},result],[frozen,{...contract,settlementRuleVersion:null},result],
 [frozen,contract,{...result,actual:null}],[frozen,contract,{...result,correctionPending:true}]
 ]){const x=grade(p,c,r);assert.equal(x.supported,false);assert.equal(x.grade,null);assert.equal(x.canAuthorizeWager,false);}
});
