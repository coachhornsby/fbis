import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyMlbCompletionApi} from '../scripts/verify-mlb-completion-api.mjs';
test('long archives permit compatible newer releases and refuse a missing or changed API contract',async()=>{
 const result=await verifyMlbCompletionApi({fetchImpl:async()=>Response.json({ok:true,prospectiveReport:{version:'mlb-completion-v1'}}),attempts:1});assert.equal(result.ok,true);
 for(const version of [undefined,'mlb-completion-v2'])await assert.rejects(()=>verifyMlbCompletionApi({fetchImpl:async()=>Response.json({ok:true,prospectiveReport:{version}}),attempts:1}));
});
