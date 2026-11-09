// Narrow replacement for the production cost-stop stub. All unrelated fetch,
// scheduled and websocket behavior remains paused. Existing secrets only.
import {handlePinnoddsCapture} from './pinnodds-capture-route.mjs';
import {handlePinnoddsAccountCheck} from './pinnodds-account-check-route.mjs';
const paused=()=>Response.json({ok:false,status:'COST_STOP_20261027',executed:false},{status:503,headers:{'cache-control':'no-store'}});
export default {async fetch(request,env){
 return await handlePinnoddsCapture(request,env)||await handlePinnoddsAccountCheck(request,env)||paused();
},async scheduled(){}};
export class PausedSession {
 constructor(ctx){this.ctx=ctx;}
 async fetch(){await this.ctx.storage.deleteAlarm();return paused();}
 async alarm(){await this.ctx.storage.deleteAlarm();}
 webSocketMessage(ws){ws.close(1000,'FBIS cost stop');}
 webSocketClose(){}
 webSocketError(){}
}
export {PausedSession as PolymarketMarketStream,PausedSession as PolymarketMarketStreamCoverage,PausedSession as PolymarketMarketStreamRecovered,PausedSession as KalshiPrivateAccountSession};
