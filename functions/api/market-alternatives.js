import {loadPolymarketUsBoardOffers} from '../lib/polymarketBoard.js';
import {loadPinnoddsBoardResearch} from '../lib/pinnoddsBoardResearch.js';
import {loadPinnoddsR2BoardResearch,preferFreshPinnoddsArchive} from '../lib/pinnoddsArchiveBoard.js';
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json','cache-control':'public, max-age=5'}});
export async function onRequestGet({request,env}){
 const u=new URL(request.url),sport=u.searchParams.get('sport'),id=u.searchParams.get('eventId');
 if(!['nfl','cfb'].includes(sport)||!/^[-a-z0-9_:]{1,160}$/i.test(id||''))return json({ok:false,error:'INVALID_EVENT_SCOPE'},400);
 const now=new Date();
 const fixture=await env.DB.prepare('SELECT id,home_name,away_name,home_abbr,away_abbr FROM games WHERE id=? AND sport=?').bind(id,sport).first();
 if(!fixture)return json({ok:false,error:'CANONICAL_EVENT_UNAVAILABLE'},404);
 const games=[fixture];
 try{
  const [primary,history,archive,poly]=await Promise.all([
   loadPinnoddsBoardResearch(env.DB,{sport,games,now:now.toISOString()}),
   loadPinnoddsBoardResearch(env.MARKET_HISTORY_DB,{sport,games,now:now.toISOString()}),
   loadPinnoddsR2BoardResearch(env.ARCHIVE,{sport,games,now:now.toISOString()}),
   loadPolymarketUsBoardOffers(env.DB,games,sport,{now,historyDb:env.MARKET_HISTORY_DB})]);
  const pin=preferFreshPinnoddsArchive(preferFreshPinnoddsArchive(primary,history),archive).byGame?.[id];
  const offers=[...(pin?.offers||[]),...(pin?.alternativeOffers||[]),...(poly.byId.get(id)||[])].filter(o=>o.period==='full_game'&&['spread','total'].includes(o.marketFamily)&&!/-tt(?:-|[12]h-)/.test(o.sourceMarketId||''));
  return json({ok:true,sport,eventId:id,checkedAt:now.toISOString(),offers,scope:'FULL_GAME_SPREAD_TOTAL_ONLY',canQualify:false,canAuthorizeWager:false});
 }catch{return json({ok:false,error:'ALTERNATIVE_MARKETS_UNAVAILABLE'},503);}
}
