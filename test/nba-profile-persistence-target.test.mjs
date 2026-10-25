import test from "node:test";
import assert from "node:assert/strict";
import {readNbaPersistence} from "../scripts/nba-profile-persistence-verify.mjs";
const profile={asOf:"2026-10-25T00:00:00.000Z"};
test("NBA persistence verifier refuses missing D1 target without network access",async()=>{
 let calls=0;
 await assert.rejects(()=>readNbaPersistence(profile,{env:{CLOUDFLARE_ACCOUNT_ID:"a",CLOUDFLARE_API_TOKEN:"t"},fetchImpl:()=>{calls++;throw Error("network");}}),/NBA_PROFILE_D1_TARGET_REQUIRED/);
 assert.equal(calls,0);
});
test("NBA persistence verifier refuses PRIMARY D1 target without network access",async()=>{
 let calls=0;
 await assert.rejects(()=>readNbaPersistence(profile,{env:{CLOUDFLARE_ACCOUNT_ID:"a",CLOUDFLARE_API_TOKEN:"t",CLOUDFLARE_D1_DATABASE_ID:"b50c724c-903b-4241-8ce1-48d931e7a44c"},fetchImpl:()=>{calls++;throw Error("network");}}),/NBA_PROFILE_D1_TARGET_REQUIRED/);
 assert.equal(calls,0);
});
test("NBA persistence verifier accepts NBA_DB and reads target directly",async()=>{
 let uri="";
 const result=await readNbaPersistence(profile,{env:{CLOUDFLARE_ACCOUNT_ID:"a",CLOUDFLARE_API_TOKEN:"t",CLOUDFLARE_D1_DATABASE_ID:"ed992525-d2ed-4b1d-8a12-feeb2efa152c"},fetchImpl:async(u)=>{uri=u;return {ok:true,json:async()=>({success:true,result:[{success:true,results:[{teams:30,snapshots:30,players:518,schedule_items:2533}]}]})}}});
 assert.equal(result.teams,30);
 assert.match(uri,/ed992525-d2ed-4b1d-8a12-feeb2efa152c/);
});
