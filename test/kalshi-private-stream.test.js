import test from "node:test";
import assert from "node:assert/strict";
import privateWorker,{KalshiPrivateAccountSession} from "../services/kalshi-private-stream/index.js";

function session() {
 const store=new Map(),ctx={
  storage:{
   get:async k=>store.get(k),
   put:async(k,v)=>{store.set(k,v);},
   getAlarm:async()=>store.get("__alarm")||null,
   setAlarm:async t=>{store.set("__alarm",t);},
  }
 };
 return {instance:new KalshiPrivateAccountSession(ctx,{}),ctx,store};
}
test("Kalshi private WS worker defaults off and has no network or secret dependency",async()=>{
 const {instance,store}=session();
 const r=await instance.fetch(new Request("https://kalshi.private.internal/wake",{method:"POST"}));
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.state,"DISABLED");
 assert.equal(data.canAuthorizeWager,false);
 assert.equal(data.privateDataStored,false);
 assert.equal(store.get("__alarm"),undefined);
 const missing=await instance.fetch(new Request("https://kalshi.private.internal/illegal",{method:"POST"}));
 assert.equal(missing.status,404);
});
test("mode enabled without independent Worker secrets fails closed",async()=>{
 const {instance}=session();
 instance.env={KALSHI_PRIVATE_STREAM_MODE:"enabled",KALSHI_API_KEY_ID:"configured-key-id"};
 const r=await instance.fetch(new Request("https://kalshi.private.internal/wake",{method:"POST"}));
 assert.equal((await r.json()).state,"CONFIGURATION_REQUIRED");
});
test("public stream health does not leak event counts, trade activity or positions",async()=>{
 const {instance}=session();
 await instance.save({state:"CONNECTED",received:503,lastMessageAt:"2026-10-20T09:00:00Z",
  lastReconciledAt:"2026-10-20T09:00:00Z"});
 const env={KALSHI_PRIVATE_STREAM_MODE:"disabled",ACCOUNT_SESSION:{
  idFromName:x=>x,get:()=>({fetch:(uri)=>instance.fetch(new Request(uri))})
 }};
 const resp=await privateWorker.fetch(new Request("https://service.test/health"),env);
 assert.equal(resp.status,200);
 const body=await resp.json();
 assert.equal(body.readOnly,true);
 assert.equal(body.privateDataStored,false);
 assert.equal(body.enabled,false);
 assert.equal(body.connected,false); // persisted state cannot prove current socket.
 assert.ok(!JSON.stringify(body).includes("503"));
 assert.ok(!JSON.stringify(body).includes("2026-10-20"));
 assert.equal((await privateWorker.fetch(new Request("https://service.test/positions"),env)).status,404);
});
test("scheduled action does not start stream until explicitly enabled",async()=>{
 let started=false;
 await privateWorker.scheduled({},{
  KALSHI_PRIVATE_STREAM_MODE:"disabled",
  ACCOUNT_SESSION:{get:()=>{started=true;}},
 },{waitUntil:()=>{started=true;}});
 assert.equal(started,false);
});
