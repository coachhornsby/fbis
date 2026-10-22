import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/tennis-private-official-portrait-import.js';
const secret='a'.repeat(32);
function context(payload) {
 const env={HARVEST_SECRET:secret,DB:{prepare(){return {bind(){return {first:async()=>({rights_evidence_ref:null,rights_verification:'EVIDENCE_REQUIRED',access_verification:'PUBLIC_OR_UNVERIFIED',activation_state:'BLOCKED'})}}}}},ARCHIVE:{put(){throw Error('R2 write must be blocked')},head(){return null},delete(){return null}}};
 const request=new Request('https://example.com/api/tennis-private-official-portrait-import',{method:'POST',headers:{'x-harvest-secret':secret,'content-type':'application/json'},body:JSON.stringify(payload)});
 return {request,env};
}
test('portrait importer refuses image copy without documented rights',async()=>{
 const r=await onRequestPost(context({tour:'atp',playerKey:'player',playerId:'tennis:atp:player',sha256:'a'.repeat(64),dataBase64:'AAAA'}));
 assert.equal(r.status,403);
 assert.equal((await r.json()).reason,'RIGHTS_OR_PRIVATE_ACCESS_NOT_VERIFIED');
});
test('portrait importer refuses invalid manifest without touching R2',async()=>{
 const r=await onRequestPost(context({tour:'atp',playerId:'player'}));
 assert.equal(r.status,422);
});
