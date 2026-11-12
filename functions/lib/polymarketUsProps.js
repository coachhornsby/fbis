import {norm,canonicalPlayerId} from './propProviderAdapters.js';
import {propTeamKey} from './propResearchData.js';
import {matchPolymarketUsEvent,FBIS_POLY_SPORTS} from './polymarketUs.js';
const ROOT='player-props/polymarket-us/v1/';
export const usPropIndexKey=(sport,id)=>ROOT+sport+'/'+encodeURIComponent(String(id))+'.json';
const value=x=>{const v=x?.value??x;return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<1?Number(v):null;};
const stats={basketball_player_steals:'steals',basketball_player_blocks:'blocks',basketball_player_threes:'three_pointers_made',basketball_player_points:'points',basketball_player_rebounds:'rebounds',basketball_player_assists:'assists',basketball_player_three_pointers:'three_pointers_made',basketball_player_three_pointers_made:'three_pointers_made',basketball_player_points_rebounds_assists:'points_rebounds_assists',football_player_passing_yards:'passing_yards',football_player_rushing_yards:'rushing_yards',football_player_receiving_yards:'receiving_yards',football_player_receptions:'receptions',baseball_player_hits:'hits',baseball_player_home_runs:'home_runs',baseball_player_strikeouts:'strikeouts',hockey_player_points:'points',hockey_player_goals:'goals',hockey_player_assists:'assists',hockey_player_shots_on_goal:'shots_on_goal',hockey_player_saves:'saves'};
/** Exact event + provider player ID + named team roster + stat + rule threshold. */
export function mapPolymarketUsProp(m,event,game,players,{capturedAt}={}){
 const sport=game.sport,stat=stats[m.sportsMarketType],name=m.metadata?.playerName,providerId=m.metadata?.playerId;
 const rejected=reason=>({rejected:true,reason,contractId:m.slug,player_name:name||null,line:m.line??null,sport,source:'Polymarket US',provider:'Polymarket',venue:'Polymarket US',canonicalEventId:String(game.id),start_time:game.start,collectedAt:capturedAt});
 if(m.sportsMarketTypeV2!=='SPORTS_MARKET_TYPE_PROP'||m.active!==true||m.closed===true)return null;
 if(!stat)return rejected('US_PROP_STAT_DEFINITION_UNVERIFIED');
 if(!name||providerId==null||!/^[-a-z0-9]{1,160}$/i.test(m.slug||''))return rejected('US_PROP_PLAYER_ID_MISSING');
 if(String(event.id)===''||matchPolymarketUsEvent(event,[game],sport).id!==String(game.id)||Date.parse(m.gameStartTime)!==Date.parse(game.start))return rejected('US_PROP_EVENT_OR_START_MISMATCH');
 const long=m.marketSides?.find(s=>s.long===true),short=m.marketSides?.find(s=>s.long===false);
 const team=propTeamKey(sport,long?.team?.displayAbbreviation||long?.team?.abbreviation||'');
 const teams=[game.home_abbr,game.away_abbr].map(t=>propTeamKey(sport,t));
 const matches=players.filter(p=>p.sport===sport&&norm(p.player_name)===norm(name)&&propTeamKey(sport,p.team_key)===team&&teams.includes(team));
 const ids=[...new Set(matches.map(p=>String(p.player_id)))];
 if(ids.length!==1||!team||!teams.every(Boolean)||teams[0]===teams[1])return rejected('US_PROP_ROSTER_TEAM_IDENTITY_UNRESOLVED');
 const terms=String(m.description||''),line=Number(m.line);
 const trigger=/records? (\d+(?:\.\d+)?) or more /i.exec(terms)||/scores? (\d+(?:\.\d+)?) or more /i.exec(terms);
 if(!Number.isFinite(line)||!trigger||Number(trigger[1])!==line||!/official box score at the conclusion of the game/i.test(terms)||!/last fair market price/i.test(terms)||/first half|second half|first quarter|first period|first inning/i.test(terms))return rejected('US_PROP_SETTLEMENT_TEMPLATE_UNVERIFIED');
 const player=matches.find(p=>String(p.player_id)===ids[0]),history=sport==='nhl'?'nhl':sport==='mlb'?'mlb':'espn';
 return [long,short].filter(Boolean).map(side=>({id:'polymarket-us:'+m.slug+':'+(side.long?'yes':'no'),provider:'Polymarket',venue:'Polymarket US',source:'Polymarket US',sport,canonicalEventId:String(game.id),canonicalPlayerId:canonicalPlayerId(sport,history,player.player_id),providerEventId:String(event.id),providerPlayerId:String(providerId),contractId:m.slug,outcomeId:String(side.id),player_name:player.player_name,team,opponent:teams.find(t=>t!==team),start_time:game.start,canonical_market:stat,line,trigger:line,comparisonOperator:'gte',side:side.long?'yes':'no',statSide:side.long?'over':'under',period:'full_game',settlementTerms:terms,settlementScope:'POLYMARKET_US_OFFICIAL_GAME_AT_LEAST',dnpSettlement:'LAST_FAIR_MARKET_PRICE',identityVerified:true,priceVerified:false,observedReferencePrice:value(side.long?m.bestAskQuote:side.quote),observedAsk:null,purchaseAsk:null,executableSize:null,priceKind:'US_CAPTURED_REFERENCE_NOT_EXECUTABLE',observedAt:null,collectedAt:capturedAt,marketUrl:m.marketUrl||m.url||null,fees:null,fbis_projection:null,modelStatus:'UNMODELED',fresh:false,marketAvailable:false,reasons:['QUOTE_SOURCE_TIME_UNKNOWN','BOOK_DEPTH_NOT_VERIFIED',...(m.marketUrl||m.url?[]:['US_CONTRACT_DEEP_LINK_UNVERIFIED']),'MODEL_UNAVAILABLE','FEES_UNVERIFIED'],canQualify:false,executionEligible:false,canAuthorizeWager:false}));
}
/** Pointer indexes existing immutable REST details; no duplicate provider crawler. */
export async function indexCapturedPolymarketUsProps(env,{parentReceiptId,eventIndex}={}){
 if(!env.ARCHIVE?.get||!env.ARCHIVE?.put)return;
 const root='market-sources/polymarket-us/bootstrap/';
 const p=await env.ARCHIVE.get(root+parentReceiptId+'.json');if(!p)return;
 const parent=await p.json(),entry=parent.events?.[eventIndex];if(!entry||!FBIS_POLY_SPORTS.includes(parent.sport))return;
 const detailKey=root+parentReceiptId+'-event-'+eventIndex+'-detail.json';
 const detail=await env.ARCHIVE.get(detailKey);if(!detail)return;
 await env.ARCHIVE.put(usPropIndexKey(parent.sport,entry.canonicalId),JSON.stringify({version:1,sport:parent.sport,canonicalEventId:entry.canonicalId,providerEventId:String(entry.event.id),detailKey,capturedAt:parent.capturedAt}));
}
export async function loadCapturedPolymarketUsProps(env,{games=[],players=[],sport='all',now=Date.now()}={}){
 const rows=[],rejected=[],coverage=[];if(!env.ARCHIVE?.get)return {rows,rejected,coverage};
 for(const game of games.filter(g=>(sport==='all'||g.sport===sport)&&Date.parse(g.start)>now)){
  try{const obj=await env.ARCHIVE.get(usPropIndexKey(game.sport,game.id));if(!obj){coverage.push({eventId:String(game.id),sport:game.sport,status:'US_PROP_INVENTORY_NOT_CAPTURED'});continue;}
   const index=await obj.json(),age=now-Date.parse(index.capturedAt);
   if(index.canonicalEventId!==String(game.id)||index.sport!==game.sport||!Number.isFinite(age)||age<0||age>2*3600000||!String(index.detailKey||'').startsWith('market-sources/polymarket-us/bootstrap/')){coverage.push({eventId:String(game.id),sport:game.sport,status:'US_PROP_INVENTORY_STALE_OR_UNVERIFIED'});continue;}
   const raw=await env.ARCHIVE.get(index.detailKey);if(!raw)throw Error('US_PROP_DETAIL_MISSING');const event=await raw.json();
   if(String(event.id)!==index.providerEventId||!Array.isArray(event.markets)||!Number.isInteger(event.marketCounts?.numMarkets))throw Error('US_PROP_DETAIL_IDENTITY_MISMATCH');
   const props=event.markets.filter(m=>m.sportsMarketTypeV2==='SPORTS_MARKET_TYPE_PROP');
   const marketIds=event.markets.map(m=>String(m.id??m.slug??'')).filter(Boolean);
   const advertised=event.marketCounts.numMarkets,observed=event.markets.length;
   // A provider count disagreement does not prove a complete inventory. Preserve
   // every captured contract as MARKET-ONLY instead of dropping the entire event.
   if(advertised!==observed||marketIds.length!==observed||new Set(marketIds).size!==observed){
    for(const m of props)rejected.push({
     rejected:true,reason:'US_PROP_INVENTORY_COUNT_MISMATCH',
     provider:'Polymarket',venue:'Polymarket US',source:'Polymarket US',
     sport:game.sport,canonicalEventId:String(game.id),providerEventId:String(event.id),
     contractId:String(m.slug??m.id??''),providerMarketId:m.id==null?null:String(m.id),
     rawTitle:m.question||m.title||null,player_name:m.metadata?.playerName||null,
     providerPlayerId:m.metadata?.playerId==null?null:String(m.metadata.playerId),
     statFamily:m.sportsMarketType||null,
     playerStatContract:/(^|_)player_/.test(m.sportsMarketType||''),
     line:m.line==null||!Number.isFinite(Number(m.line))?null:Number(m.line),
     period:m.period||null,active:m.active===true,closed:m.closed===true,
     collectedAt:index.capturedAt,canQualify:false,canAuthorizeWager:false
    });
    coverage.push({eventId:String(game.id),sport:game.sport,
     status:'US_PROP_INVENTORY_COUNT_MISMATCH',advertisedMarkets:advertised,
     observedMarkets:observed,uniqueMarketIds:new Set(marketIds).size,
     contracts:props.length,playerStatContracts:props.filter(m=>/(^|_)player_/.test(m.sportsMarketType||'')).length,
     capturedAt:index.capturedAt});
    continue;
   }
   for(const m of props){const r=mapPolymarketUsProp(m,event,game,players,{capturedAt:index.capturedAt});if(r?.rejected)rejected.push(r);else if(Array.isArray(r))rows.push(...r);}
   coverage.push({eventId:String(game.id),sport:game.sport,status:props.length?'US_PROP_INVENTORY_CAPTURED':'NO_US_PROPS_IN_VERIFIED_EVENT',contracts:props.length,capturedAt:index.capturedAt});
  }catch{coverage.push({eventId:String(game.id),sport:game.sport,status:'US_PROP_INVENTORY_READ_FAILED'});}
 }
 return {rows,rejected,coverage};
}
