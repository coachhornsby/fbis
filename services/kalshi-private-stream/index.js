import { connectKalshiPrivateStream } from "../../functions/lib/kalshiAccountStream.js";
import { kalshiPrivateKeyPem,readKalshiAccount } from "../../functions/lib/kalshiAccount.js";

/**
 * Dedicated Durable Object for the Kalshi PRIVATE account stream.
 * Default OFF, independent Worker secrets, sanitized operational state only.
 * REST remains account authority; WS events are dirty markers, never ledger rows.
 */
const ENABLED = env => env?.KALSHI_PRIVATE_STREAM_MODE === "enabled"
  && !!env?.KALSHI_API_KEY_ID && !!kalshiPrivateKeyPem(env);
const quiet = (s, code=null) => ({
  state:s,code,privateDataStored:false,canAuthorizeWager:false,readOnly:true,
});
const stateKey="operational-status";
const fallback={...quiet("NOT_STARTED"),lastAttemptAt:null,lastMessageAt:null,
  lastReconciledAt:null,reconnects:0,received:0,pending:false};
const snapshot = s => ({
  readOnly:true,canAuthorizeWager:false,privateDataStored:false,
  state:s.state||"UNKNOWN",code:s.code||null,
  lastAttemptAt:s.lastAttemptAt||null,lastMessageAt:s.lastMessageAt||null,
  lastReconciledAt:s.lastReconciledAt||null,received:Number(s.received||0),
  reconnects:Number(s.reconnects||0),pending:!!s.pending,
});
export class KalshiPrivateAccountSession {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.socket=null;}
  async status(){return {...fallback,...(await this.ctx.storage.get(stateKey))};}
  async save(patch){
    const s={...(await this.status()),...patch};
    await this.ctx.storage.put(stateKey,s);
    return s;
  }
  async fetch(req) {
    const pathname=new URL(req.url).pathname;
    if(pathname==="/health"){
      const s=await this.status();
      // A persisted CONNECTED flag cannot prove a live socket after an eviction.
      return Response.json({...snapshot(s),connected:this.socket?.readyState===1});
    }
    if(pathname!=="/wake"||req.method!=="POST"){
      return new Response(null,{status:404});
    }
    if(!ENABLED(this.env)){
      const s=await this.save({state:this.env?.KALSHI_PRIVATE_STREAM_MODE==="enabled"?
        "CONFIGURATION_REQUIRED":"DISABLED",code:null,pending:false});
      return Response.json(snapshot(s));
    }
    if(this.socket?.readyState===1)return Response.json(snapshot(await this.status()));
    const now=new Date().toISOString();
    await this.save({state:"CONNECTING",lastAttemptAt:now,
      reconnects:(await this.status()).reconnects+1});
    try{
      this.socket=await connectKalshiPrivateStream(this.env,{
        onDirty:()=>{void this.recordDirty().catch(()=>{});},
      });
      this.socket.addEventListener("close",()=>{
        this.socket=null;
        void this.save({state:"DISCONNECTED",code:"WS_CLOSED"}).catch(()=>{});
      });
      this.socket.addEventListener("error",()=>{
        void this.save({state:"DISCONNECTED",code:"WS_ERROR"}).catch(()=>{});
      });
      const s=await this.save({state:"CONNECTED",code:null,pending:true});
      // Reconcile immediately following subscribe to recover missed events.
      await this.ctx.storage.setAlarm(Date.now()+30_000);
      return Response.json(snapshot(s));
    }catch{
      const s=await this.save({state:"DISCONNECTED",code:"WS_CONNECT_FAILED"});
      return Response.json(snapshot(s));
    }
  }
  async recordDirty(){
    const s=await this.status();
    await this.save({lastMessageAt:new Date().toISOString(),
      received:s.received+1,pending:true});
    const alarm=await this.ctx.storage.getAlarm();
    if(!alarm)await this.ctx.storage.setAlarm(Date.now()+30_000);
  }
  async alarm(){
    if(!ENABLED(this.env))return;
    const s=await this.status();
    if(!s.pending)return;
    const last=Date.parse(s.lastReconciledAt||"");
    if(Number.isFinite(last)&&Date.now()-last<120_000){
      await this.ctx.storage.setAlarm(last+120_000);
      return;
    }
    // No balances, fills, orders, headers, signatures or trade identifiers are
    // persisted, returned, or logged here. A successful REST refresh only
    // confirms that the connection can reconcile to authoritative private data.
    try{
      const account=await readKalshiAccount(this.env);
      await this.save({pending:false,state:this.socket?.readyState===1?"CONNECTED":"DISCONNECTED",
        lastReconciledAt:new Date().toISOString(),
        code:account.ok?null:"REST_RECONCILIATION_UNAVAILABLE"});
    }catch{
      await this.save({pending:false,state:"DISCONNECTED",code:"REST_RECONCILIATION_UNAVAILABLE"});
    }
  }
}
export default {
  async scheduled(_event,env,ctx){
    if(env?.KALSHI_PRIVATE_STREAM_MODE!=="enabled")return;
    const id=env.ACCOUNT_SESSION.idFromName("kalshi-single-account");
    const stub=env.ACCOUNT_SESSION.get(id);
    ctx.waitUntil(stub.fetch("https://kalshi.private.internal/wake",{method:"POST"}));
  },
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname!=="/health"||request.method!=="GET")return new Response(null,{status:404});
    const id=env.ACCOUNT_SESSION.idFromName("kalshi-single-account");
    const result=await env.ACCOUNT_SESSION.get(id).fetch("https://kalshi.private.internal/health");
    const status=await result.json();
    return Response.json({...status,enabled:env?.KALSHI_PRIVATE_STREAM_MODE==="enabled",
      mode:env?.KALSHI_PRIVATE_STREAM_MODE||"disabled"},{
      headers:{"cache-control":"no-store","x-robots-tag":"noindex"}
    });
  },
};
