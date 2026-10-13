/** Public publisher snapshot. No direct PrizePicks execution, paid acquisition or model authority. */
import {canonicalizeProPlayerPropMarket} from './proPlayerProps.js';
export const FREE_PROP_MIRROR_URL='https://raw.githubusercontent.com/enkday/prizepicks-data-mirror/main/data/prizepicks.json';
export const FREE_PROP_MIRROR_SOURCE='PrizePicks GitHub Mirror';
export const FREE_PROP_MIRROR_SPORTS=Object.freeze(['nfl','cfb','nba','mlb']);
const sports={NFL:'nfl',NCAAF:'cfb',NBA:'nba',MLB:'mlb'};
const names={
 'Pass Yards':'passing_yards','Pass Attempts':'passing_attempts','Pass Completions':'completions',
 'Pass TDs':'passing_touchdowns','Rush Yards':'rushing_yards','Rush Attempts':'rushing_attempts',
 'Receiving Yards':'receiving_yards','Receptions':'receptions','Anytime TDs':'touchdowns',
 '3-PT Made':'three_pointers_made','Pitcher Strikeouts':'strikeouts','Pitching Outs':'pitcher_outs',
 'Earned Runs Allowed':'earned_runs','Hits Allowed':'hits_allowed','Total Bases':'total_bases','Singles':'singles',
};
const text=v=>String(v??'').trim();
const key=v=>text(v).toLowerCase().replace(/[^a-z0-9]/g,'');
const teamCode=(sport,v)=>{const code=text(v).toUpperCase();return sport==='nfl'?({JAC:'JAX',SFO:'SF',WSH:'WAS',LA:'LAR',STL:'LAR',OAK:'LV',SD:'LAC',ARZ:'ARI'})[code]||code:code;};
export function matchMirrorEvent(row,games=[]){
 const start=Date.parse(row.startTimeIso||'');
 if(!Number.isFinite(start))return{id:null,reason:'EVENT_TIME_INVALID'};
 const sport=sports[row.sport];
 const matches=games.filter(g=>{
  if(g.sport!==sport||!Number.isFinite(Date.parse(g.start||''))||Math.abs(Date.parse(g.start)-start)>2*3600000)return false;
  const equals=(name,code,side)=>key(name)&&key(name)===key(g[side+'_name'])||text(code)&&teamCode(sport,code)===teamCode(sport,g[side+'_abbr']);
  return equals(row.Team,row.teamCode,'home')&&equals(row.Opponent,row.opponentCode,'away')||
    equals(row.Team,row.teamCode,'away')&&equals(row.Opponent,row.opponentCode,'home');
 });
 return matches.length===1?{id:String(matches[0].id),reason:'TWO_TEAM_KICKOFF_VERIFIED'}:{id:null,reason:matches.length?'AMBIGUOUS_EVENT_MATCH':'UNMATCHED_PROVIDER_EVENT'};
}
export function normalizeMirrorProps(feed,{games=[],snapshotId=null,collectedAt=new Date().toISOString(),now=new Date()}={}){
 if(!feed||!Array.isArray(feed.props)||!Array.isArray(feed.leagueResults))throw Error('MIRROR_SCHEMA_INVALID');
 const published=Date.parse(feed.scrapedAt||''),checked=now.getTime();
 if(!Number.isFinite(published)||!Number.isFinite(checked)||published>checked+60000)throw Error('MIRROR_PUBLICATION_TIME_INVALID');
 const leagueStatus=new Map(feed.leagueResults.map(r=>[r.leagueName,r]));
 const rows=[],reasons={},seen=new Set();
 for(const p of feed.props){
  const sport=sports[p.sport],observed=Date.parse(p.providerFetchedAt||''),start=Date.parse(p.startTimeIso||'');
  const line=p.line==null||text(p.line)===''?NaN:Number(p.line);
  let rejection=null;
  if(!sport)rejection='UNSUPPORTED_SPORT';
  else if(leagueStatus.get(p.sport)?.ok!==true)rejection='PUBLISHER_LEAGUE_COLLECTION_FAILED';
  else if(!text(p.projectionId)||!text(p.player)||!text(p.stat)||!Number.isFinite(line))rejection='INVALID_PROP_IDENTITY_OR_LINE';
  else if(!Number.isFinite(observed)||observed>published||!Number.isFinite(start))rejection='INVALID_PROP_CLOCK';
  else if(p.oddsType!=='standard'||p.status!=='pre_game')rejection='UNSUPPORTED_MIRROR_CONTRACT';
  const dedupe=[p.sport,p.projectionId].join('|');
  if(!rejection&&seen.has(dedupe))rejection='DUPLICATE_PROVIDER_PROP';
  if(rejection){reasons[rejection]=(reasons[rejection]||0)+1;continue;}
  seen.add(dedupe);
  const identity=matchMirrorEvent(p,games);
  const statFamily=names[p.stat]||canonicalizeProPlayerPropMarket(sport,p.stat);
  rows.push({source:FREE_PROP_MIRROR_SOURCE,sourceType:'pickem',sport,league:p.sport,
   eventId:identity.id,eventStart:new Date(start).toISOString(),playerId:null,playerName:p.player,
   team:p.teamCode||p.Team,opponent:p.opponentCode||p.Opponent,
   marketFamily:'player_prop',statFamily,side:null,line,americanOdds:null,contractPrice:null,
   standardOrAlt:'standard',period:'unspecified',sourceMarketId:String(p.projectionId),sourceOutcomeId:null,
   // This is the mirror publisher's claimed acquisition time, not a verified live bookmaker quote clock.
   sourceObservedAt:new Date(observed).toISOString(),fetchedAt:new Date(observed).toISOString(),executionEligible:false,
   raw:{providerEventId:String(p.gameId||''),providerPlayerId:String(p.playerId||''),
    sourceObservedAt:new Date(observed).toISOString(),providerTimeConfidence:'MIRROR_REPORTED_CAPTURE',
    sourceUrl:FREE_PROP_MIRROR_URL,snapshotId,publishedAt:feed.scrapedAt,collectedAt,
    eventMatchStatus:identity.reason,marketRaw:p.stat,marketMappingStatus:statFamily?'INTERPRETED':'UNSUPPORTED_FOR_MODEL',
    quoteKind:'DAILY_MIRROR_REFERENCE_NOT_LIVE_VERIFIED',original:p,
    canQualify:false,canAuthorizeWager:false,modelInfluence:'none'}});
 }
 return{rows,reasons,publishedAt:feed.scrapedAt,originalRows:feed.props.length,acceptedRows:rows.length,
  sourceSports:feed.leagueResults.map(r=>({sport:sports[r.leagueName]||r.leagueName,ok:r.ok===true,
    publishedCount:r.publishedCount??null,sourceCount:r.sourceCount??null,excludedByPublisher:r.excludedCount??null})),
  researchOnly:true,canQualify:false,canAuthorizeWager:false};
}

export async function loadFreeMirrorRows(db,eventIds=[],sport=null){
 if(!eventIds.length)return [];
 const query=`WITH latest AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY sport,source_market_id ORDER BY collected_at DESC,id DESC) rn
  FROM normalized_market_observations WHERE source=? AND canonical_event_id IN (${eventIds.map(()=>'?').join(',')})
  ${sport?'AND sport=?':''} AND julianday(collected_at) BETWEEN julianday('now','-24 hours') AND julianday('now'))
  SELECT * FROM latest WHERE rn=1 ORDER BY canonical_event_id,player_name,stat_family,source_market_id`;
 const result=await db.prepare(query).bind(FREE_PROP_MIRROR_SOURCE,...eventIds,...(sport?[sport]:[])).all();
 return(result?.results||[]).map(r=>{
  let raw={};try{raw=JSON.parse(r.raw_payload_json||'{}')}catch{}
  return{provider:'PRIZEPICKS_FREE_MIRROR',sport:r.sport,fbisEventId:r.canonical_event_id,
   providerGameId:r.provider_event_id,providerPlayerId:r.provider_player_id,fbisPlayerId:null,
   playerName:r.player_name,team:r.team,opponent:r.opponent,market:r.stat_family||raw.marketRaw,
   marketCanonical:r.stat_family,period:r.period||'unspecified',book:'PrizePicks · free mirror',
   line:r.line,price:null,overOdds:null,underOdds:null,sourceObservedAt:r.source_observed_at,
   collectedAt:r.collected_at,publishedAt:raw.publishedAt,providerTimeConfidence:'MIRROR_REPORTED_CAPTURE',
   quoteKind:'DAILY_MIRROR_REFERENCE_NOT_LIVE_VERIFIED',sourceUrl:raw.sourceUrl||FREE_PROP_MIRROR_URL,
   gameIdentityConfidence:raw.eventMatchStatus||'UNKNOWN',playerIdentityConfidence:'PROVIDER_ID_ONLY',
   marketComplete:r.line!=null,fbisProjection:null,decisionEligible:false,canQualify:false,canAuthorizeWager:false,
   reasonCodes:['FREE_DAILY_MIRROR_REFERENCE','NOT_LIVE_VERIFIED','NOT_DECISION_ELIGIBLE']};
 });
}
