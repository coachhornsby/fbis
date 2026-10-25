import { resolveNbaResearchOwnerDb } from "./nbaResearchOwnerDb.js";
import { captureNbaPregameMarketLines } from './nbaPropMarketFreeze.js';
/** Polymarket Global Gamma: independently matched NBA props, display prices only. */
const ROOT='player-props/polymarket-global/v1/';
const abbr=x=>({NY:'NYK',SA:'SAS',GS:'GSW',NO:'NOP'}[String(x||'').toUpperCase()]||String(x||'').toUpperCase());
const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const day=x=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));
const nextDay=d=>new Date(Date.parse(d+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const eligibleDays=now=>[day(now),nextDay(day(now))];
const price=x=>x!=null&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0&&Number(x)<1?Number(x):null;
const typeMap={Points:'points',Rebounds:'rebounds',Assists:'assists'};
const key=x=>String(x||'').toLowerCase();
const tag=g=>'nba-'+key(abbr(g.away_abbr))+'-'+key(abbr(g.home_abbr))+'-'+day(g.start);
export function verifyGlobalNbaFixture(event,game){
 if(!event||!game||event.slug!==tag(game)||!Array.isArray(event.teams)||event.teams.length!==2)return false;
 return event.teams.some(t=>t.ordering==='away'&&key(t.abbreviation)===key(abbr(game.away_abbr)))&&
  event.teams.some(t=>t.ordering==='home'&&key(t.abbreviation)===key(abbr(game.home_abbr)));
}
export function normalizeGlobalNbaProp(m,e,g,players,{capturedAt}={}){
 if(!m||!e||!g||!m.active||m.closed||!String(m.slug||'').startsWith(e.slug+'-'))return [];
 const parts=/^(.+?): (Points|Rebounds|Assists) O\/U (\d+(?:\.\d+)?)$/.exec(m.question||'');
 if(!parts||m.sportsMarketType!==typeMap[parts[2]]||!Array.isArray(players))return [];
 const playerName=parts[1],stat=typeMap[parts[2]],threshold=Number(parts[3]);
 if(!Number.isFinite(Number(m.line))||Number(m.line)!==threshold||threshold<0)return [];
 const desc=String(m.description||'');
 const expected=stat==='points'?playerName+' scores more than '+threshold+' points':
  playerName+' records more than '+threshold+(stat==='rebounds'?' total rebounds':' assists');
 if(!desc.includes(expected)||!/entire game including all overtime periods/i.test(desc)||
  !/player is listed as inactive or otherwise does not take the court/i.test(desc)||
  !/market will resolve "No"/i.test(desc))return [];
 const start=Date.parse(String(m.gameStartTime||'').replace(' ','T').replace(/\+00$/,'Z'));
 if(!Number.isFinite(start)||Math.abs(start-Date.parse(g.start))>7200000)return [];
 const gameTeams=[abbr(g.away_abbr),abbr(g.home_abbr)];
 const matches=players.filter(p=>norm(p.player_name)===norm(playerName)&&gameTeams.includes(abbr(p.team_key)));
 const ids=[...new Set(matches.map(p=>String(p.player_id)))];
 if(ids.length!==1||!ids[0])return [];
 let outcomes,prices;
 try{outcomes=typeof m.outcomes==='string'?JSON.parse(m.outcomes):m.outcomes;
  prices=typeof m.outcomePrices==='string'?JSON.parse(m.outcomePrices):m.outcomePrices;
 }catch{return []}
 if(!Array.isArray(outcomes)||outcomes.join('|')!=='Yes|No'||!Array.isArray(prices)||prices.length!==2)return [];
 const values=prices.map(price);if(values.some(x=>x==null))return [];
 const athlete=matches.find(p=>String(p.player_id)===ids[0]);
 const team=abbr(athlete.team_key),opponent=gameTeams.find(x=>x!==team);
 if(!opponent)return [];
 return ['yes','no'].map((side,i)=>({
  id:'polymarket-global:'+m.slug+':'+side,provider:'Polymarket',venue:'Polymarket Global',
  source:'Polymarket Global Gamma',sport:'nba',canonicalEventId:String(g.id),
  canonicalPlayerId:'nba:espn:'+ids[0],providerEventId:String(e.id),
  providerPlayerId:null,contractId:String(m.slug),outcomeId:side,
  player_name:athlete.player_name,team,opponent,start_time:g.start,
  canonical_market:stat,line:threshold,side,statSide:i===0?'over':'under',period:'full_game',
  observedReferencePrice:values[i],priceKind:'DISPLAY_REFERENCE_NOT_ASK',
  collectedAt:capturedAt,observedAt:null,quoteClockStatus:'SOURCE_TIME_UNKNOWN',
  settlementTerms:desc,settlementScope:'GAMMA_NBA_FULL_GAME_OT',
  dnpSettlement:'NO_IF_INACTIVE',identityVerified:true,priceVerified:false,fresh:false,
  marketAvailable:false,purchaseAsk:null,observedAsk:null,executableSize:null,
  fbis_projection:null,modelStatus:'UNMODELED',fees:null,expectedReturn:null,
  reasons:['GAMMA_DISPLAY_PRICE_NOT_BEST_ASK','QUOTE_CLOCK_UNKNOWN','DNP_SETTLEMENT_DIFFERS_FROM_KALSHI',
   'MODEL_UNAVAILABLE','FEES_UNVERIFIED'],canQualify:false,executionEligible:false,canAuthorizeWager:false
 }));
}
export async function listGlobalNbaFixtureSlugs(env,{now=new Date()}={}){
 const owner=await resolveNbaResearchOwnerDb(env);
 if(!owner.ok)return {ok:false,code:owner.reason||'NBA_OWNER_UNAVAILABLE'};
 const db=owner.db;
 const days=eligibleDays(now),today=days[0];
 const games=(await db.prepare("SELECT id,date,start,home_abbr,away_abbr FROM games WHERE sport='nba' AND date IN (?,?) ORDER BY start LIMIT 48").bind(...days).all()).results||[];
 return {ok:true,day:today,days,slugs:games.filter(g=>days.includes(g.date)&&Number.isFinite(Date.parse(g.start))&&
   Date.parse(g.start)>=now.getTime()-3*3600000&&Date.parse(g.start)<=now.getTime()+48*3600000).map(tag),
  canAuthorizeWager:false};
}
export async function capturePolymarketGlobalNba(env,{now=new Date(),fetchImpl=fetch,providedEvents=null}={}){
 if(!env?.ARCHIVE?.put)return {ok:false,code:'STORAGE_UNBOUND'};
 const owner=await resolveNbaResearchOwnerDb(env);
 if(!owner.ok)return {ok:false,code:owner.reason||'NBA_OWNER_UNAVAILABLE'};
 const db=owner.db;
 const days=eligibleDays(now),today=days[0],capturedAt=now.toISOString();
 const games=(await db.prepare("SELECT id,date,start,home_abbr,away_abbr FROM games WHERE sport='nba' AND date IN (?,?) ORDER BY start LIMIT 48").bind(...days).all()).results||[];
 const players=(await db.prepare("SELECT player_id,player_name,team_key FROM nba_player_state_profiles WHERE julianday(as_of)>=julianday(?) LIMIT 1500").bind(new Date(now.getTime()-14*86400000).toISOString()).all()).results||[];
 const rows=[],errors=[],fixtures=[],sourceOnly=[];
 for(const g of games){
  if(!days.includes(g.date))continue;
  const kickoff=Date.parse(g.start||'');
  if(!Number.isFinite(kickoff)||kickoff<now.getTime()-3*3600000||kickoff>now.getTime()+48*3600000)continue;
  const slug=tag(g);
  try{
   const url='https://gamma-api.polymarket.com/events?slug='+encodeURIComponent(slug)+'&limit=1';
   let event=null;
   if(Array.isArray(providedEvents)){
    // Signed GitHub Actions sends raw public Gamma event payloads, not prequalified rows.
    // Identity, settlement and canonical player rules are still validated here.
    if(providedEvents.length>32){errors.push({slug,code:'BATCH_TOO_LARGE'});continue}
    event=providedEvents.find(x=>x?.slug===slug)||null;
   }else{
    const response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(16000)});
    if(!response.ok){errors.push({slug,code:'PROVIDER_HTTP_'+response.status});continue}
    const data=await response.json();event=Array.isArray(data)&&data.length===1?data[0]:null;
   }
   if(!verifyGlobalNbaFixture(event,g)){errors.push({slug,code:'EVENT_IDENTITY_UNRESOLVED'});continue}
   let count=0;
   for(const market of event.markets||[]){
    const found=normalizeGlobalNbaProp(market,event,g,players,{capturedAt});
    rows.push(...found);count+=found.length;
    // Preserve provider-native player threshold candidates even when the
    // recognized stat/roster/settlement contract does not map yet.
    // No value here is an executable ask or an independent model.
    if(found.length===0 && market?.active===true && market.closed!==true &&
       typeof market.question==='string' &&
       /:\\s*[^:]+\\bO\\/U\\s*\\d+(?:\\.\\d+)?/i.test(market.question)){
       sourceOnly.push({
         id:'polymarket-global-raw:'+String(market.id||market.slug||''),
         provider:'Polymarket',venue:'Polymarket Global',sport:'nba',
         providerEventId:String(event.id),canonicalEventId:String(g.id),
         contractId:String(market.slug||market.id||''),
         rawTitle:market.question.slice(0,240),
         canonical_market:null,line:Number.isFinite(Number(market.line))?Number(market.line):null,
         player_name:null,team:null,opponent:null,start_time:g.start,
         collectedAt:capturedAt,source:'Polymarket Global Gamma',
         reason:['PLAYER_STAT_OR_SETTLEMENT_NOT_VERIFIED'],
         priceKind:'GAMMA_DISPLAY_REFERENCE_NOT_ASK',
         identityVerified:false,priceVerified:false,marketAvailable:false,
         purchaseAsk:null,canQualify:false,canAuthorizeWager:false
       });
    }
   }
   fixtures.push({slug,canonicalEventId:String(g.id),providerEventId:String(event.id),providerMarkets:event.markets?.length||0,statSides:count});
  }catch(err){errors.push({slug,code:'PROVIDER_'+String(err?.name||'FETCH_FAILURE').toUpperCase().replace(/[^A-Z_]/g,'_')})}
 }
 // Partition independent calendar-day receipts. Tomorrow's NBA offers must be
 // captured before tipoff, but they must never be stamped onto today's archive.
 const dateReceipts=[];
 for(const ledgerDate of days){
 const includedIds=new Set(games.filter(g=>g.date===ledgerDate).map(g=>String(g.id)));
 const dailyRows=rows.filter(r=>includedIds.has(String(r.canonicalEventId)));
 const dailySourceOnly=sourceOnly.filter(r=>includedIds.has(String(r.canonicalEventId)));
 const dailyFixtures=fixtures.filter(f=>includedIds.has(String(f.canonicalEventId)));
 const dailyErrors=errors.filter(e=>String(e.slug||'').endsWith('-'+ledgerDate));
 // Daily Gamma capture must be cumulative. Later post-start sweeps see fewer
 // active events; never overwrite verified earlier game/player thresholds with
 // a smaller subset. Preserve each row's OWN original capture time and all
 // historical (non-executable) quote caveats.
 const archiveKey=ROOT+'nba-'+ledgerDate+'.json';
 let previous=null;
 try{const original=await env.ARCHIVE.get(archiveKey);previous=original?await original.json():null;}catch{}
 const validPrevious=previous?.day===ledgerDate&&previous?.source==='POLYMARKET_GLOBAL_GAMMA'&&
  previous?.canAuthorizeWager===false&&Array.isArray(previous?.rows);
 const history=new Map();
 if(validPrevious)for(const row of previous.rows){
  if(row?.id&&row.identityVerified===true&&row.canAuthorizeWager===false&&row.venue==='Polymarket Global'&&
    row.canonicalEventId&&row.canonicalPlayerId&&row.collectedAt&&row.line!=null)history.set(row.id,row);
 }
 const retained=history.size;
 for(const row of dailyRows)if(row?.id&&row.identityVerified===true&&row.canAuthorizeWager===false)
  history.set(row.id,row);
 const sourceOnlyHistory=new Map();
 if(validPrevious)for(const row of previous.sourceOnly||[])
   if(row?.id&&row?.canAuthorizeWager===false)sourceOnlyHistory.set(row.id,row);
 for(const row of dailySourceOnly)if(row?.id&&row?.canAuthorizeWager===false)
   sourceOnlyHistory.set(row.id,row);
 const fixtureMap=new Map();
 if(validPrevious)for(const f of previous.fixtures||[])if(f?.slug)fixtureMap.set(f.slug,f);
 for(const f of dailyFixtures)if(f?.slug)fixtureMap.set(f.slug,f);
 const freeze=await captureNbaPregameMarketLines(env,{provider:'Polymarket',date:ledgerDate,rows:dailyRows,now});
 const result={ok:true,source:'POLYMARKET_GLOBAL_GAMMA',day:ledgerDate,capturedAt,
  rows:[...history.values()],sourceOnly:[...sourceOnlyHistory.values()],
  fixtures:[...fixtureMap.values()],errors:dailyErrors,
  pregameLineFreeze:freeze,
  retainedReferenceRows:retained,latestCaptureRows:dailyRows.length,
  prices:'GAMMA_DISPLAY_REFERENCE_NOT_ORDERBOOK_ASK',canQualify:false,canAuthorizeWager:false};
 await env.ARCHIVE.put(archiveKey,JSON.stringify(result),{httpMetadata:{contentType:'application/json',cacheControl:'private,max-age=0'}});
 dateReceipts.push({date:ledgerDate,contracts:result.rows.length,
  rawMarketOnly:result.sourceOnly.length,latestCaptureRows:dailyRows.length,
  retainedReferenceRows:retained,fixtures:result.fixtures.length,pregameLineFreeze:freeze});
 }
 return {ok:true,source:'POLYMARKET_GLOBAL_GAMMA',day:today,days,capturedAt,
  contracts:dateReceipts.reduce((n,r)=>n+r.contracts,0),
  latestCaptureRows:rows.length,
  sourceMarketOnly:dateReceipts.reduce((n,r)=>n+r.rawMarketOnly,0),
  retainedReferenceRows:dateReceipts.reduce((n,r)=>n+r.retainedReferenceRows,0),
  fixtures:dateReceipts.reduce((n,r)=>n+r.fixtures,0),errors,
  dateReceipts,pregameLineFreeze:dateReceipts[0]?.pregameLineFreeze||null,
  canQualify:false,canAuthorizeWager:false};
}
export async function loadPolymarketGlobalNba(env,{day:date,now=Date.now()}={}){
 if(!env?.ARCHIVE?.get||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return {rows:[],status:'UNAVAILABLE'};
 try{
  const obj=await env.ARCHIVE.get(ROOT+'nba-'+date+'.json');if(!obj)return {rows:[],status:'NOT_CAPTURED'};
  const d=await obj.json(),age=now-Date.parse(d.capturedAt||'');
  // Game-day archives remain useful for dated historical comparisons after
  // the strict 2h current-research freshness window. Never relabel as live.
  if(!Array.isArray(d.rows)||age<0||!Number.isFinite(age)||age>48*3600000)return {rows:[],marketOnly:[],status:'STALE'};
  const historical=age>2*3600000;
  return {rows:d.rows.filter(r=>r.identityVerified&&r.canAuthorizeWager===false&&r.venue==='Polymarket Global')
    .map(r=>historical?{...r,historicalReference:true,fresh:false,marketAvailable:false,
      priceVerified:false,purchaseAsk:null,priceKind:'DISPLAY_REFERENCE_NOT_ASK'}:r),
   marketOnly:(d.sourceOnly||[]).filter(r=>r?.canAuthorizeWager===false &&
     r.venue==='Polymarket Global' && r.identityVerified===false &&
     (!historical || r.collectedAt)).map(r=>({
       ...r,historicalReference:historical,marketAvailable:false,
       priceVerified:false,purchaseAsk:null,canQualify:false,canAuthorizeWager:false
     })),
   status:historical?'HISTORICAL_REFERENCE':d.errors?.length?'PARTIAL':'RESEARCH_CAPTURED',
   capturedAt:d.capturedAt,fixtures:d.fixtures||[]};
 }catch{return {rows:[],status:'READ_FAILED'}}
}
