import {CFB_FUTURE_EXCHANGE_PACKETS} from '../../../../../functions/lib/cfbFutureExchangePackets.js';
import {readExchangeCardQuotes} from '../../../../../functions/lib/exchangeCardDelivery.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'public, max-age=10','x-content-type-options':'nosniff'}});
export async function onRequestGet({request,env}){
 const u=new URL(request.url),sport=u.searchParams.get('sport'),date=u.searchParams.get('date');
 if(!['nfl','cfb','nba','cbb','nhl'].includes(sport)||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return json({ok:false,code:'INVALID_SCOPE'},400);
 try{return json(await readExchangeCardQuotes({...env,ARCHIVE:env.FBIS_PRIVATE_CBB},{sport,date,futureCfbPacket:sport==='cfb'?CFB_FUTURE_EXCHANGE_PACKETS[date]:undefined}));}
 catch(error){
  // Share only a coarse read-state; do not leak policy details or provider credentials.
  const reason=String(error?.message||'');
  const paused=/ACCOUNT_BUDGET|PAUSED|UNAPPROVED_JOB|MISSING_UNIT_BOUNDS|JOB_POLICY|UNIT_LIMIT|CYCLE_ALLOCATION/.test(reason);
  return json({ok:false,code:paused?'EXCHANGE_FEED_READ_PAUSED':'EXCHANGE_QUOTES_UNAVAILABLE',
   byEvent:{},referenceOnly:true,canAuthorizeWager:false},503);
 }
}
