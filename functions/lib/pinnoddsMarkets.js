/** Complete REST-market interpretation. Unrecognized fields remain in immutable raw snapshots. */
import {classifyBaseballLeague} from '../../workers/pinnodds-baseball-probe.mjs';
import {matchPolymarketUsEvent} from './polymarketUs.js';
import {canonicalizeProPlayerPropMarket} from './proPlayerProps.js';
const num=value=>value==null||value===''?null:Number.isFinite(Number(value))?Number(value):null;
const decimal=value=>{const n=num(value);return n>1?n:null;};
export function pinnoddsSport(sportId,league=''){
 if(sportId===1)return 'soccer';if(sportId===2)return 'tennis';
 if(sportId===3)return /wnba|women.*national basketball/i.test(league)?'wnba':/ncaa|college|ncaab/i.test(league)?'cbb':/\bnba\b/i.test(league)?'nba':null;
 if(sportId===4)return /\bnhl\b|national hockey league/i.test(league)?'nhl':null;
 if(sportId===5)return /ncaa|college|ncaaf/i.test(league)?'cfb':/\bnfl\b|national football league/i.test(league)?'nfl':null;
 if(sportId===6){const scope=classifyBaseballLeague(league);return scope==='MLB'?'mlb':scope==='NPB'?'npb':scope==='KBO'?'kbo':null;}
 return null;
}
export function normalizePinnoddsMarkets(body,{sportId,feed,capturedAt,games=[],snapshotId,rawKey}={}){
 if(!Array.isArray(body?.events))throw Error('PINNODDS_EVENTS_CONTRACT_CHANGED');
 // The vendor's nested specials mode returns one parent row per match.
 // Expand in memory after immutable source archival so every prop/alt/special
 // retains its own ID, price, parent linkage and provenance.
 const events=[];
 for(const parent of body.events){
  events.push(parent);
  if(parent.specials==null)continue;
  if(!Array.isArray(parent.specials))throw Error('PINNODDS_NESTED_SPECIALS_CONTRACT_CHANGED');
  for(const special of parent.specials){
   if(!special||typeof special!=='object'||special.event_id==null)throw Error('PINNODDS_NESTED_SPECIAL_ID_REQUIRED');
   if(special.parent_id!=null&&String(special.parent_id)!==String(parent.event_id))throw Error('PINNODDS_NESTED_PARENT_CONFLICT');
   events.push({...special,parent_id:parent.event_id,league_name:special.league_name||parent.league_name});
  }
 }
 const rows=[],reasons={},parents=new Map(events.filter(e=>!e.special&&!e.special_category).map(e=>[String(e.event_id),e]));
 for(const event of events){
  const sport=pinnoddsSport(sportId,event.league_name);if(!sport){reasons.UNSUPPORTED_LEAGUE=(reasons.UNSUPPORTED_LEAGUE||0)+1;continue;}
  const parent=event.special||event.special_category?parents.get(String(event.parent_id)):event;
  const identity=parent?matchPolymarketUsEvent({startTime:parent.starts,homeTeam:{name:parent.home},awayTeam:{name:parent.away},
   // Tennis requires two full player names, tour and start to match safely.
   title:sport==='tennis'?String(parent.home||'')+' vs. '+String(parent.away||''):undefined,
   seriesSlug:sport==='tennis'?(/\bwta\b/i.test(parent.league_name||'')?'wta':/\batp\b/i.test(parent.league_name||'')?'atp':''):undefined},
   games.filter(g=>g.sport===sport),sport):{id:null,reason:'PARENT_EVENT_UNAVAILABLE'};
  const base={source:'PinnOdds',sourceType:'sportsbook',sport,league:event.league_name,eventId:identity.id,eventStart:parent?.starts||event.starts,
   homeTeam:parent?.home||null,awayTeam:parent?.away||null,sourceObservedAt:null,fetchedAt:capturedAt,executionEligible:false};
  function add({family,period,selection,line=null,price,marketKey,scope=null,stat=null,player=null,original}){
   const odds=decimal(price);
   if(odds===null){reasons.UNPRICED_SELECTION=(reasons.UNPRICED_SELECTION||0)+1;return;}
   rows.push({...base,marketFamily:family,statFamily:stat,playerId:null,playerName:player,team:scope,side:selection,line,decimalOdds:odds,
    americanOdds:null,contractPrice:null,period,standardOrAlt:original?.is_main===true?'standard':original?.is_main===false?'alternate':'unknown',
    sourceMarketId:[event.event_id,period,family,marketKey,scope||''].join(':'),sourceOutcomeId:String(original?.participant_id||selection),
    raw:{providerEventId:String(event.event_id),providerParentId:event.parent_id||null,providerPlayerId:event.player_id||null,snapshotId,rawSnapshotKey:rawKey,feed,
      providerCursor:body.last??null,providerEventLast:event.last??null,sourceObservedAt:null,providerTimeConfidence:'UNKNOWN',
      eventMatchStatus:identity.reason,quoteKind:'DECIMAL_BOOK_REFERENCE_NOT_EXECUTION_VERIFIED',marketRaw:event.special||null,
      unitsRaw:event.special_units||null,periodRaw:period,marketKey,scope,providerPrice:price,original,
      canQualify:false,canAuthorizeWager:false,modelInfluence:'none'}});
  }
  for(const [key,period] of Object.entries(event.periods||{})){
   const periodId=period.number===0||key==='num_0'?'full_game':key;
   for(const side of ['home','away','draw'])if(period.money_line?.[side]!=null)add({family:'moneyline',period:periodId,selection:side,price:period.money_line[side],marketKey:'money_line',original:period.money_line});
   for(const [lineKey,spread] of Object.entries(period.spreads||{}))for(const side of ['home','away'])if(spread?.[side]!=null){const line=num(spread.hdp??lineKey);add({family:'spread',period:periodId,selection:side,line:line==null?null:side==='away'?-line:line,price:spread[side],marketKey:lineKey,original:spread});}
   for(const [lineKey,total] of Object.entries(period.totals||{}))for(const side of ['over','under'])if(total?.[side]!=null)add({family:'total',period:periodId,selection:side,line:num(total.points??lineKey),price:total[side],marketKey:lineKey,original:total});
   for(const field of ['team_total','team_totals'])for(const [side,group] of Object.entries(period[field]||{})){
    const totals=group&&typeof group==='object'&&('over' in group||'under' in group)?[[String(group.points??'unknown'),group]]:Object.entries(group||{});
    for(const [lineKey,total] of totals)for(const selection of ['over','under'])if(total?.[selection]!=null)add({family:'team_total',period:periodId,selection,line:num(total.points??lineKey),price:total[selection],marketKey:field+':'+lineKey,scope:side,original:total});
   }
  }
  for(const [period,markets] of Object.entries(event.special_markets||{}))for(const market of Array.isArray(markets)?markets:[]){
   const isPlayer=/player|pitcher|batter/i.test(event.special_category||'');
   const matched=/^(.+?)\s*\(([^()]*)\)\s*$/.exec(String(event.special||''));
   const player=event.player_name||matched?.[1]||null;
   const stat=isPlayer?canonicalizeProPlayerPropMarket(sport,event.special_units||matched?.[2]||''):null;
   for(const [index,outcome] of (market.prices||[]).entries())add({family:isPlayer?'player_prop':'special',period:period==='num_0'?'full_game':period,
    selection:String(outcome.name||index),line:num(outcome.points),price:outcome.price,marketKey:[market.type,market.key,index].join(':'),
    stat,player:isPlayer?(player||(!/^(over|under|yes|no|home|away|draw)(\s|$)/i.test(String(outcome.name||''))?String(outcome.name||'')||null:null)):null,original:{...outcome,market}});
  }
 }
 return{rows,reasons,inputEvents:events.length,normalizedRows:rows.length,matchedRows:rows.filter(r=>r.eventId).length};
}
