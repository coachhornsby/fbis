import test from "node:test";
import assert from "node:assert/strict";
import {examine} from "../scripts/cfb-phase5-ncaa-pbp.mjs";
test("accepts NCAA period play history, not status-only stub",()=>{
 const ok=examine({data:{playbyplay:{periods:[{playbyplayStats:[{id:"a"},{id:"b"}]},{playbyplayStats:[{id:"c"}]}]}}});
 assert.deepEqual(ok,{valid:true,periods:2,plays:3});
});
test("empty and GraphQL error documents cannot certify play coverage",()=>{
 assert.equal(examine({data:{playbyplay:{periods:[{playbyplayStats:[]}]}}}).valid,false);
 assert.equal(examine({errors:[{message:"no source"}]}).valid,false);
});
