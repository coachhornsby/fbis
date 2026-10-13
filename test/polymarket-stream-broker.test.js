import test from "node:test";
import assert from "node:assert/strict";
import {onRequestPost,onRequestGet} from "../functions/api/polymarket-stream-sign.js";
test("signed market-only broker rejects unauthenticated requests and never accepts GET",async()=>{
  const env={POLYMARKET_STREAM_PROXY_TOKEN:"internal-only",POLYMARKET_US_KEY_ID:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    POLYMARKET_US_SECRET_KEY:Buffer.concat([Buffer.alloc(32,6),Buffer.alloc(32,8)]).toString("base64")};
  const denied=await onRequestPost({request:new Request("https://x/api/polymarket-stream-sign",{method:"POST"}),env});
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).ok,false);
  const deniedGet=await onRequestGet();assert.equal(deniedGet.status,405);
  const authorized=await onRequestPost({request:new Request("https://x/api/polymarket-stream-sign",{
    method:"POST",headers:{"x-fbis-stream-token":"internal-only"}}),env});
  const body=await authorized.json();
  assert.equal(authorized.status,200);
  assert.equal(body.path,"/v1/ws/markets");
  assert.ok(body.headers["X-PM-Signature"]);
  assert.ok(!JSON.stringify(body).includes(env.POLYMARKET_US_SECRET_KEY));
});
