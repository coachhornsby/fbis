import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithCfbBackoff } from "../functions/lib/cfbProviderBackoff.js";
import { cfbdRequestHash, reserveCfbdRequest } from "../functions/lib/cfbCfbdAcquisition.js";
import { collegeRequest } from "../functions/lib/collegeApi.js";
import { resetCacheMem } from "../functions/lib/cache.js";

const football = "https://api.collegefootballdata.com/games?year=2026";
const basketball = "https://api.collegebasketballdata.com/games?year=2026";
function dbStub() {
  const seen = new Set();
  const receipts = [];
  return {
    receipts,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes("INSERT OR IGNORE INTO cfb_cfbd_acquisition_receipts")) {
                const id = args[0] + "|" + args[1];
                if (seen.has(id)) return {meta:{changes:0}};
                seen.add(id);
                receipts.push({day:args[0],endpoint:args[3]});
                return {meta:{changes:1}};
              }
              return {meta:{changes:1}};
            },
          };
        },
      };
    },
  };
}
test("CFBD and CBBD URLs get distinct durable hashes", async () => {
  assert.notEqual((await cfbdRequestHash(football)).hash,(await cfbdRequestHash(basketball)).hash);
  const a=await cfbdRequestHash(football);
  assert.equal(a.hash,(await cfbdRequestHash("https://api.collegefootballdata.com/games?year=2026")).hash);
});
test("basketball provider call denied without owner and without DB", async () => {
  resetCacheMem();
  let calls=0;
  const transport=async()=>{calls++;return Response.json([])};
  const denied=await fetchWithCfbBackoff(basketball,{}, {DB:dbStub()},transport);
  assert.equal(denied.status,503);
  assert.equal(calls,0);
  const noDb=await reserveCfbdRequest({cbbdNetworkAuthorized:true},basketball);
  assert.equal(noDb.allowed,false);
});
test("approved CBBD request uses the shared D1 ledger once per day", async () => {
  resetCacheMem();
  const DB=dbStub(); let calls=0;
  const transport=async()=>{calls++;return Response.json([])};
  const env={DB,cbbdNetworkAuthorized:true};
  const first=await fetchWithCfbBackoff(basketball,{},env,transport);
  const second=await fetchWithCfbBackoff(basketball,{},env,transport);
  assert.equal(first.status,200);
  assert.equal(second.status,503);
  assert.equal(calls,1);
  assert.equal(DB.receipts.length,1);
  assert.equal(DB.receipts[0].endpoint,"cbbd:/games");
});
test("CFBD 429 stops CBBD on the same cooldown without further provider traffic",async()=>{
  resetCacheMem();
  const DB=dbStub();
  let calls=0;
  const transport=async()=>{
    calls++;
    return new Response("quota exhausted",{status:429,headers:{"Retry-After":"120","X-CallLimit-Remaining":"0"}});
  };
  const football429=await fetchWithCfbBackoff(football,{}, {DB,cfbdNetworkAuthorized:true},transport);
  const basketballBlocked=await fetchWithCfbBackoff(basketball,{}, {DB,cbbdNetworkAuthorized:true},transport);
  assert.equal(football429.status,429);
  assert.equal(basketballBlocked.status,429);
  assert.equal(basketballBlocked.headers.get("X-FBIS-Cooldown"),"true");
  assert.equal(calls,1);
});
test("CBBD cache-only miss cannot make an outbound network request",async()=>{
  resetCacheMem();
  let calls=0;
  const result=await collegeRequest("cbbd","/games",
    {CBBD_API_KEY:"offline-test",cbbdCacheOnly:true},
    {query:{season:2026},fetchFn:async()=>{calls++;throw Error("unexpected request")}});
  assert.equal(result.ok,false);
  assert.equal(result.networkAttempted,false);
  assert.equal(calls,0);
});
