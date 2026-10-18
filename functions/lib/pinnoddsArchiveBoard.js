import {selectPinnoddsBoardOffers} from './pinnoddsBoardResearch.js';

// Free PinnOdds full-board collection archives every provider response in R2.
// D1 can reach its 10-GB limit; read the modeled-only prepared R2 receipt for
// board display without granting executable market/wager authority.
const PROVIDER_SPORT_IDS=Object.freeze({
 soccer:[1],tennis:[2],nba:[3],cbb:[3],wnba:[3],nhl:[4],
 cfb:[5],nfl:[5],mlb:[6],npb:[6],kbo:[6]
});
const numeric=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const parse=v=>{const n=Date.parse(String(v||''));return Number.isFinite(n)?n:null;};
export async function loadPinnoddsR2BoardResearch(archive,{sport,games=[],now=new Date().toISOString(),includeStarted=false}={}){
 const sportIds=PROVIDER_SPORT_IDS[sport]||[];
 if(!archive?.get||!sportIds.length)return {byGame:{},rows:0,reason:'ARCHIVE_UNAVAILABLE'};
 const current=parse(now);
 if(current===null)return {byGame:{},rows:0,reason:'INVALID_TIME'};
 const allowed=new Set(games.map(g=>String(g?.id||'')).filter(Boolean));
 if(!allowed.size)return {byGame:{},rows:0,reason:'NO_VERIFIED_EVENT_IDS'};
 const offers=[];
 let checked=0,failed=0;
 for(const sportId of sportIds)for(const feed of ['prematch','live']){
  const key=`market-sources/pinnodds/latest-modeled/board-${sportId}-${feed}.json`;
  let result;
  try{const obj=await archive.get(key);if(!obj)continue;result=await obj.json();}
  catch{failed++;continue;}
  checked++;
  if(result?.source!=='PinnOdds'||result?.schemaVersion!==1||
     result?.readOnly!==true||result?.canAuthorizeWager!==false||
     !['IMMUTABLE_FULL_BOARD_FETCH_FBISEXISTING_PROJECTIONS_GAME_MARKETS','VERIFIED_CANONICAL_GAME_MARKET_INVENTORY_8_DAYS'].includes(result?.ingestionScope)||
     result?.sportId!==sportId||result?.feed!==feed||!Array.isArray(result.rows))continue;
  const at=parse(result.collectedAt);
  if(at===null||at>current||current-at>24*3600000)continue;
  for(const o of result.rows){
   if(o?.source!=='PinnOdds'||o?.sport!==sport||!allowed.has(String(o.eventId||'')))continue;
   const kick=parse(o.eventStart);
   if(kick===null||at>=kick||(current>=kick&&(!includeStarted||current-kick>12*3600000)))continue;
   if(!['moneyline','spread','total'].includes(o.marketFamily)||o.period!=='full_game')continue;
   if(!['away','home','over','under'].includes(o.side)||numeric(o.decimalOdds)<=1)continue;
   if(o.sourceObservedAt!=null)continue; // provider clock is not independently verified
   offers.push({
    source:'PinnOdds',canonical_event_id:o.eventId,
    market_family:o.marketFamily,period:o.period,side:o.side,line:o.line,
    decimal_odds:o.decimalOdds,american_odds:o.americanOdds??null,
    collected_at:result.collectedAt,source_observed_at:null,
    event_start_time:o.eventStart,source_market_id:o.sourceMarketId,
    source_outcome_id:o.sourceOutcomeId,standard_or_alt:o.standardOrAlt||'unknown'
   });
  }
 }
 return {byGame:selectPinnoddsBoardOffers(offers,{now}),rows:offers.length,
  reason:offers.length?'R2_MODELED_BOARD_CAPTURE':failed?'ARCHIVE_READ_FAILED':'NO_R2_MODELED_BOARD_CAPTURE',
  source:'PinnOdds',archiveReads:checked,archiveFailures:failed,readOnly:true,
  canQualify:false,canAuthorizeWager:false};
}
export function preferFreshPinnoddsArchive(dbResult={},archiveResult={}){
 const combined={...(dbResult.byGame||{})};
 for(const [id,record] of Object.entries(archiveResult.byGame||{})){
  const before=parse(combined[id]?.latestCapturedAt)??-Infinity;
  const incoming=parse(record?.latestCapturedAt)??-Infinity;
  if(incoming>before||!combined[id]?.offers?.length)combined[id]=record;
 }
 return {...dbResult,byGame:combined,
  rows:(dbResult.rows||0)+(archiveResult.rows||0),
  reason:Object.keys(combined).length?'SOURCE_CAPTURE_PRESENT':
    archiveResult.reason||dbResult.reason||'NO_PINNODDS_OBSERVATIONS',
  r2ArchiveCoverage:{matchedGames:Object.keys(archiveResult.byGame||{}).length,
   rows:archiveResult.rows||0,reason:archiveResult.reason||null}};
}
