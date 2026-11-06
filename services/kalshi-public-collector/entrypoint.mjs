import {recordExchangeDiagnostic} from '../exchangeDiagnostics.mjs';
// Deploy only the controlled handlers. Legacy helper exports are testable in
// index.js but must not become named Worker entrypoints.
import {DurableObject} from 'cloudflare:workers';
import rest,{relaySignedPages} from './index.js';
import {reserveJobExecution,beginJobExecution} from '../account-budget/jobScope.mjs';
import {KALSHI_RELAY_JOB} from '../account-budget/executionJobs.mjs';
import {runKalshiMarketSession,KALSHI_STREAM_JOB} from './marketSession.mjs';
export class KalshiMarketPriceSession extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.running=false;}
 async run(slot){
  if(!Number.isSafeInteger(slot)||Math.abs(slot-Math.floor(Date.now()/60000))>1||this.running)return {ok:false,code:'INVALID_OR_BUSY_SLOT'};
  this.running=true;
  try{const {env,lease}=await reserveJobExecution(this.env,KALSHI_STREAM_JOB,{reservationId:'kalshi-market-ws-'+slot,
   network:{origin:'https://fbis-myz.pages.dev',path:'/api/kalshi-market-stream-sign',method:'POST'}});
   return await runKalshiMarketSession(env,lease);
  }catch(e){await recordExchangeDiagnostic(this.env,'kalshi-ws',{error:e.message});return {ok:false,code:String(e.message||'KALSHI_MARKET_STREAM_STOPPED')};}finally{this.running=false;}
 }
 async alarm(){await this.ctx.storage.deleteAlarm();}
}
export default{
 fetch:rest.fetch,
 async scheduled(event,env,ctx){
  const minute=Math.floor((event?.scheduledTime||Date.now())/60000);
  ctx.waitUntil(env.MARKET_SESSION.getByName('bounded-market-price-v1').run(minute));
  // Preserve existing main-game cadence on even minutes; use the same signed
  // budget-gated relay on odd minutes for verified basketball line families.
  ctx.waitUntil((async()=>{
   const scoped=await beginJobExecution(env,KALSHI_RELAY_JOB,{reservationId:'kalshi-rest-'+minute,
    network:{origin:'https://fbis-myz.pages.dev',path:'/api/kalshi-collector-internal',method:'POST'}});
   const games=['nfl','cfb','nba','cbb','nhl'];
   const lines=['nba_spread','nba_total','nba_team_total','cbb_spread','cbb_total','cbb_team_total','cbb_1h_total'];
   const sport=minute%2===0?games[Math.floor(minute/2)%games.length]:lines[Math.floor(minute/2)%lines.length];
   const result=await relaySignedPages(scoped,{scope:'markets',sport,fetchImpl:scoped.FBIS_JOB_FETCH});
   if(!result.ok)await recordExchangeDiagnostic(env,'kalshi-rest',result);return result;
  })().catch(error=>recordExchangeDiagnostic(env,'kalshi-rest',{error:error.message})));
 }
};
