import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
import {loadKalshiR2Shadow} from "../lib/kalshiR2Shadow.js";
import {matchKalshiCfbMoneylines} from "../lib/cfbKalshiMarkets.js";
import {persistCfbMarketQuotes} from "../lib/cfbMarketState.js";
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store","x-robots-tag":"noindex"}});
/** Scheduled authenticated bridge. Public Kalshi REST snapshot -> verified CFB team pairs -> CFB D1.
 * Never calls Kalshi on behalf of a browser or mutates model projections or bets.
 */
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),403);
 if(!env.CFB_DB?.prepare||!env.ARCHIVE?.get)return json({ok:false,error:"CFB_BINDINGS_UNAVAILABLE"},503);
 const now=new Date(),future=new Date(now.getTime()+72*3600000).toISOString();
 try{
  const dbGames=await env.CFB_DB.prepare(`SELECT id,start,home_name,away_name,home_abbr,away_abbr
   FROM games WHERE sport='cfb' AND julianday(start)>julianday(?)
    AND julianday(start)<julianday(?) ORDER BY start`).bind(now.toISOString(),future).all();
  const games=(dbGames.results||[]).map(g=>({
   id:g.id,start:g.start,home:{name:g.home_name,abbr:g.home_abbr},
   away:{name:g.away_name,abbr:g.away_abbr}
  }));
  const snapshot=await loadKalshiR2Shadow(env,"cfb",{now});
  if(snapshot.ok!==true)return json({ok:false,source:"Kalshi",error:snapshot.code||"SNAPSHOT_NOT_READY",
    capturedAt:snapshot.capturedAt||null,readOnly:true,canAuthorizeWager:false},503);
  const matching=matchKalshiCfbMoneylines(snapshot.records||[],games,{now});
  const offers=[...matching.byId.values()].flat();
  const saved=await persistCfbMarketQuotes(env,offers);
  return json({ok:saved.ok===true,source:"Kalshi",providerMarkets:snapshot.records?.length||0,
   capturedAt:snapshot.capturedAt,sourcePaginationComplete:snapshot.paginationComplete===true,
   futureCfbGames:games.length,matchedGames:matching.matchedGames,matchedOffers:matching.quotes,
   unmatchedPairs:matching.unmatchedPairs,rejected:matching.rejected,
   persistedCurrentQuotes:saved.stored,reason:saved.reason||null,
   readOnly:true,canAuthorizeWager:false},saved.ok?200:503);
 }catch(error){return json({ok:false,error:"CFB_MARKET_REFRESH_FAILED",
   detail:String(error?.message||error).slice(0,200),readOnly:true,canAuthorizeWager:false},503)}
}
export async function onRequestGet(){return json({ok:false,error:"METHOD_NOT_ALLOWED"},405)}
