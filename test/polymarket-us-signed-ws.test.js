import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto,createPrivateKey,createPublicKey,verify} from "node:crypto";
import {signedPolymarketUsHeaders,polymarketUsSubscribe,parsePolymarketUsLite} from "../functions/lib/polymarketUsSignedWs.js";

test("Ed25519 US signed WebSocket handshake is verifiable and omits secret",async()=>{
 const seed=Buffer.alloc(32,7);
 const key=Buffer.concat([seed,Buffer.alloc(32,5)]).toString("base64");
 const ts=1791867600000,accessId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
 const result=await signedPolymarketUsHeaders({keyId:accessId,secretKey:key,timestamp:ts,webCrypto:webcrypto});
 const prefix=Buffer.from("302e020100300506032b657004220420","hex");
 const pk=createPrivateKey({key:Buffer.concat([prefix,seed]),format:"der",type:"pkcs8"});
 assert.equal(result["X-PM-Access-Key"],accessId);
 assert.equal(result["X-PM-Timestamp"],String(ts));
 assert.ok(verify(null,Buffer.from(ts+"GET"+"/v1/ws/markets"),createPublicKey(pk),Buffer.from(result["X-PM-Signature"],"base64")));
 assert.equal(JSON.stringify(result).includes(key),false);
 await assert.rejects(signedPolymarketUsHeaders({keyId:accessId,secretKey:"bad",webCrypto:webcrypto}),/secret-not-configured/);
 await assert.rejects(signedPolymarketUsHeaders({keyId:accessId,secretKey:key,path:"/v1/orders",webCrypto:webcrypto}),/read-only/);
});

test("WebSocket BBO lite subscription uses immutable slug allowlist and numeric type 2",()=>{
 const s=polymarketUsSubscribe(["valid-market","valid-market","../bad","other-market"]);
 assert.deepEqual(s.subscribe.market_slugs,["valid-market","other-market"]);
 assert.equal(s.subscribe.subscription_type,2);
 assert.equal(s.subscribe.responses_debounced,true);
 assert.throws(()=>polymarketUsSubscribe(["../bad"]),/no-valid/);
});

test("BBO decoder accepts snake_case and camelCase but ignores malformed and crossed prices",()=>{
 const first=parsePolymarketUsLite({market_data_lite:{
  market_slug:"nfl-buf-lar",best_bid:{value:"0.52"},best_ask:{value:"0.54"},
  last_trade_px:{value:"0.53"},bid_depth:5,ask_depth:4}});
 assert.deepEqual(first,{marketSlug:"nfl-buf-lar",bestBid:0.52,bestAsk:0.54,lastTrade:0.53,current:null,bidDepth:5,askDepth:4});
 assert.equal(parsePolymarketUsLite({heartbeat:{}}),null);
 assert.equal(parsePolymarketUsLite({error:"unauthorized"}),null);
 assert.equal(parsePolymarketUsLite({marketDataLite:{marketSlug:"ab",bestBid:0.9,bestAsk:0.2}}),null);
 assert.equal(parsePolymarketUsLite("not-json"),null);
});
