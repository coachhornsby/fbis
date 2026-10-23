import test from 'node:test';
import assert from 'node:assert/strict';
import {masterPlayerIndex,evaluateIdentityEvidence} from '../scripts/lib/tennis-lowtier-identity-evidence.mjs';
import {addSourceMatchEvidence,tierEvidence} from '../scripts/lib/tennis-tiered-research-evidence.mjs';
const master=masterPlayerIndex([{player_id:'123',name_first:'Jane',name_last:'Doe',
 dob:'20010405',ioc:'USA'}]);
const player={playerName:'Jane Doe',candidateSourceIds:['123']};
const canonical={canonicalDob:'2001-04-05',canonicalCountry:'USA'};
test('identity corroboration requires one master ID and matching name DOB country',()=>{
 const result=evaluateIdentityEvidence(player,canonical,master);
 assert.equal(result.identityEvidence,'SOURCE_ID_NAME_DOB_COUNTRY_CONCORDANT');
 assert.equal(result.canAutoLink,false);
 assert.equal(result.canQualify,false);
 assert.equal(result.canAuthorizeWager,false);
});
test('missing biography and ambiguous source IDs fail closed',()=>{
 assert.equal(evaluateIdentityEvidence(player,{...canonical,canonicalDob:null},master).reason,'CANONICAL_BIOGRAPHY_MISSING');
 assert.equal(evaluateIdentityEvidence({...player,candidateSourceIds:['123','456']},canonical,master).reason,'MULTIPLE_SOURCE_IDS');
 assert.equal(evaluateIdentityEvidence({...player,candidateSourceIds:['456']},canonical,master).reason,'SOURCE_MASTER_ID_MISSING');
 assert.equal(evaluateIdentityEvidence(player,{...canonical,canonicalDob:'2001-04-06'},master).reason,'BIRTHDATE_CONFLICT');
 assert.equal(evaluateIdentityEvidence(player,{...canonical,canonicalCountry:'CAN'},master).reason,'COUNTRY_CONFLICT');
 assert.equal(evaluateIdentityEvidence({...player,playerName:'Another Player'},canonical,master).reason,'MASTER_NAME_MISMATCH');
});
test('conflicting source-master identity ID cannot pass corroboration',()=>{
 const collision=masterPlayerIndex([{player_id:'123',name_first:'Jane',name_last:'Doe',dob:'20010405',ioc:'USA'},
 {player_id:'123',name_first:'Janet',name_last:'Doe',dob:'20010405',ioc:'USA'}]);
 assert.equal(evaluateIdentityEvidence(player,canonical,collision).reason,'MASTER_SOURCE_ID_COLLISION');
});
const row={w_svpt:74,w_1stWon:30,w_2ndWon:14,w_ace:5,w_df:2,
 l_svpt:68,l_1stWon:25,l_2ndWon:11,l_ace:3,l_df:4};
test('tier-specific hard and clay profiles stay independent and unqualified',()=>{
 const buckets=new Map();
 assert.equal(addSourceMatchEvidence(buckets,{tier:'ATP_QUAL_CHALL',surface:'hard',side:'w',row,date:'2026-09-01'}),true);
 assert.equal(addSourceMatchEvidence(buckets,{tier:'ATP_FUTURES',surface:'hard',side:'l',row,date:'2026-09-02'}),true);
 assert.equal(addSourceMatchEvidence(buckets,{tier:'ATP_QUAL_CHALL',surface:'clay',side:'w',row,date:'2026-09-03'}),true);
 const b=tierEvidence(buckets);
 assert.equal(b.length,3);
 assert.equal(b.reduce((s,x)=>s+x.validMatches,0),3);
 assert.equal(b.every(x=>x.competitionAdjustment==='NOT_ESTIMATED'),true);
 assert.equal(b.every(x=>x.projectionAuthority===false),true);
 assert.equal(b[0].meetsThreeMatchResearchMinimum,false);
 assert.ok(b.every(x=>x.servePointWinRate>0&&x.returnPointWinRate>0));
 assert.equal(addSourceMatchEvidence(buckets,{tier:'ATP_FUTURES',surface:'hard',side:'w',row:{...row,w_svpt:''},date:'2026-09-04'}),false);
 assert.equal(tierEvidence(buckets).reduce((s,x)=>s+x.validMatches,0),3);
});
