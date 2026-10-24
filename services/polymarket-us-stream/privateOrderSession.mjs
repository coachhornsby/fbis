import {DurableObject} from "cloudflare:workers";
import {fetchStreamUpgrade} from "./core.mjs";
import {privateOrderExecution,persistPrivateExecution} from "../../functions/lib/polymarketPrivateOrders.js";

const UPSTREAM="https://api.polymarket.us/v1/ws/private";
const BASE="https://fbis-myz.pages.dev/api/polymarket-private-stream-sign";
const reply=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store","x-robots-tag":"noindex"}});
/** Owner of private US account execution evidence. Market WS is NOT account-authoritative.
 * Socket auth uses a narrowly scoped signed proxy; secret key never resides here.
 */
export class PolymarketPrivateOrderSession extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ws=null;this.busy=false;this.connectedAt=0;this.lastMsg=0;
  this.lastError=null;this.received=0;this.written=0;this.rejected=0;this.snapshots=0;this.reconnects=0;}
 health(){return {readOnly:true,canAuthorizeWager:false,privateDataExposed:false,
  configured:Boolean(this.env.HARVEST_SECRET),
  connected:this.ws?.readyState===WebSocket.OPEN,
  lastEventAt:this.lastMsg?new Date(this.lastMsg).toISOString():null,
  lastConnectionAt:this.connectedAt?new Date(this.connectedAt).toISOString():null,
  received:this.received,saved:this.written,unresolved:this.rejected,
  snapshots:this.snapshots,reconnects:this.reconnects,lastError:this.lastError};}
 async fetch(req){
  const url=new URL(req.url);
  if(url.pathname==="/status")return reply(this.health());
  if(url.pathname!=="/wake"||req.method!=="POST")return reply({ok:false},405);
  await this.wake();
  return reply(this.health());
 }
 async wake(){
  if(this.busy)return;
  if(this.ws?.readyState===WebSocket.OPEN&&Date.now()-this.connectedAt<8*60*1000)return;
  if(!this.env.FBIS_STREAM_PROXY_TOKEN){this.lastError="BROKER_NOT_CONFIGURED";return;}
  this.busy=true;
  try{
   if(this.ws){try{this.ws.close(1000,"refresh")}catch{}this.ws=null;}
   const auth=await fetch(BASE,{method:"POST",headers:{"x-fbis-stream-token":this.env.FBIS_STREAM_PROXY_TOKEN,
     "content-type":"application/json"},body:"{}",
     signal:AbortSignal.timeout(12000)});
   if(!auth.ok)throw Error("PRIVATE_SIGNER_"+auth.status);
   const signed=await auth.json(),ts=Number(signed?.headers?.["X-PM-Timestamp"]);
   if(signed.ok!==true||signed.path!=="/v1/ws/private"||!signed.headers?.["X-PM-Signature"]||
       !signed.headers?.["X-PM-Access-Key"]||!Number.isFinite(ts)||
       Math.abs(Date.now()-ts)>15000)throw Error("PRIVATE_SIGNATURE_INVALID");
   const response=await fetchStreamUpgrade(UPSTREAM,{headers:{...signed.headers,Upgrade:"websocket"}});
   if(response.status!==101||!response.webSocket)throw Error("PRIVATE_HANDSHAKE_"+response.status);
   const ws=response.webSocket;ws.accept();this.ws=ws;this.connectedAt=Date.now();this.reconnects++;
   this.lastError=null;
   ws.addEventListener("message",event=>{if(this.ws===ws)this.ctx.waitUntil(this.onMessage(event.data,ws));});
   ws.addEventListener("close",()=>{if(this.ws===ws){this.ws=null;this.lastError="WS_CLOSED";this.ctx.storage.setAlarm(Date.now()+60000).catch(()=>{});}});
   ws.addEventListener("error",()=>{if(this.ws===ws){this.ws=null;this.lastError="WS_ERROR";this.ctx.storage.setAlarm(Date.now()+60000).catch(()=>{});}});
   // Historical snapshots cover open orders, not closed fills.
   // Distinct subscriptions: live order updates and one-shot open-order snapshot.
   ws.send(JSON.stringify({subscribe:{requestId:"fbis-private-order-updates",
       subscriptionType:"SUBSCRIPTION_TYPE_ORDER"}}));
   ws.send(JSON.stringify({subscribe:{requestId:"fbis-private-open-order-snapshot",
       subscriptionType:"SUBSCRIPTION_TYPE_ORDER_SNAPSHOT"}}));
  }catch(e){this.lastError=String(e?.message||"CONNECTION_FAILED").slice(0,90);}
  finally{this.busy=false;await this.ctx.storage.setAlarm(Date.now()+60000);}
 }
 async onMessage(raw,ws){
  this.received++;this.lastMsg=Date.now();
  let data;try{data=JSON.parse(typeof raw==="string"?raw:new TextDecoder().decode(raw));}catch{this.rejected++;return;}
  if(data?.heartbeat){try{ws.send(JSON.stringify({heartbeat:{}}));}catch{}return;}
  if(data?.orderSubscriptionSnapshot){this.snapshots++;return;}
  if(data?.error){this.lastError="PROVIDER_ORDER_SUBSCRIPTION_ERROR";return;}
  const execution=privateOrderExecution(data);
  if(!execution){if(data?.orderSubscriptionUpdate)this.rejected++;return;}
  try{const r=await persistPrivateExecution(this.env.DB,execution);
   if(r.saved)this.written++;else if(r.reason!=="enriched")this.rejected++;
  }catch{this.lastError="PRIVATE_LEDGER_WRITE_FAILED";this.rejected++;}
 }
 async alarm(){await this.wake();}
}
