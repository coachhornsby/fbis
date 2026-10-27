// No bindings or external requests are used by this emergency deployment.
const paused=()=>Response.json({ok:false,status:"COST_STOP_20261027",executed:false},{status:503,headers:{"cache-control":"no-store"}});
export default {fetch:paused,async scheduled(){}};
export class PausedSession {
 constructor(ctx){this.ctx=ctx;}
 async fetch(){await this.ctx.storage.deleteAlarm();return paused();}
 async alarm(){await this.ctx.storage.deleteAlarm();}
 webSocketMessage(ws){ws.close(1000,"FBIS cost stop");}
 webSocketClose(){}
 webSocketError(){}
}
export {PausedSession as PolymarketMarketStream,PausedSession as PolymarketMarketStreamCoverage,PausedSession as PolymarketMarketStreamRecovered,PausedSession as KalshiPrivateAccountSession};
