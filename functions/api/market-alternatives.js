import {polymarketUsCanonicalSide} from '../lib/polymarketUs.js';
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
  // Contract identity can outlive its original REST quote. Read old identity
  // only; never copy its old price or clock onto a new WebSocket observation.
  const meta=(await env.DB.prepare(`SELECT n.source_market_id,n.source_outcome_id,
    json_extract(s.value,'$.description') description,json_extract(s.value,'$.team.name') team_name,
    MAX(n.collected_at) metadata_captured_at
    FROM normalized_market_observations n,
      json_each(n.raw_payload_json,'$.providerMarket.marketSides') s
    WHERE n.sport=? AND n.canonical_event_id=? AND n.source='Polymarket US'
      AND n.market_family='spread' AND n.period='full_game' AND n.collected_at>=?
      AND CAST(json_extract(s.value,'$.id') AS TEXT)=n.source_outcome_id
    GROUP BY n.source_market_id,n.source_outcome_id`).bind(sport,id,new Date(+now-72*3600000).toISOString()).all()).results||[];
  const bindings=new Map(meta.map(m=>{
    const side=polymarketUsCanonicalSide({sport,marketFamily:'spread',raw:{providerSide:{team:{name:m.team_name}}}},fixture);
    const line=/^[+-]?\d+(?:\.\d+)?$/.test(m.description||'')?Number(m.description):null;
    return [m.source_market_id+'|'+m.source_outcome_id,{side,line}];
  }));
  const offers=[...(pin?.offers||[]),...(pin?.alternativeOffers||[]),...(poly.byId.get(id)||[])].filter(o=>o.period==='full_game'&&['spread','total'].includes(o.marketFamily)&&!/-tt(?:-|[12]h-)/.test(o.sourceMarketId||'')).map(o=>{
    const binding=bindings.get(o.sourceMarketId+'|'+o.sourceOutcomeId);
    return o.marketFamily==='spread'&&binding?.side&&binding.line!=null&&Math.abs(Math.abs(binding.line)-Math.abs(Number(o.line)))<.00001?{...o,side:binding.side,line:binding.line}:o;
  });
  return json({ok:true,sport,eventId:id,checkedAt:now.toISOString(),offers,scope:'FULL_GAME_SPREAD_TOTAL_ONLY',canQualify:false,canAuthorizeWager:false});
 }catch{return json({ok:false,error:'ALTERNATIVE_MARKETS_UNAVAILABLE'},503);}
}
