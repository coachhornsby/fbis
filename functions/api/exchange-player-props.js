import {loadCapturedPolymarketUsProps} from '../lib/polymarketUsProps.js';
import {loadPolymarketGlobalNba} from '../lib/polymarketGlobalNbaProps.js';
import { readNbaFrozenMarketLines } from '../lib/nbaPropMarketFreeze.js';
import { buildNhlOfficialScopeCandidates } from '../lib/nhlPropScopeCandidates.js';
import { loadPropFixturesAndPlayers } from '../lib/propResearchData.js';
import { loadCapturedKalshiProps } from '../lib/kalshiPlayerPropCollector.js';
import { listMarketHistoryReadDbs } from '../lib/databaseTopology.js';
import { PROP_SPORTS, latestExchangeProps } from '../lib/exchangePlayerProps.js';
import { chicagoDayBounds } from '../lib/chicagoDayBounds.js';
import { readExchangeObservationPage } from '../lib/exchangePropPagination.js';
const respond = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
// Market inventory status is not the same as a verified absence of listed contracts.
// Keep Polymarket US and Global distinct; a partial US REST capture cannot become NO MARKET.
export function summarizeExchangeCoverage({sports=[],props=[],marketOnly=[],candidates=[],usCoverage=[],degraded=false}={}){
  const venueFor=p=>{
    const source=String(p.venue||p.source||'').toLowerCase();
    if(source.includes('polymarket us'))return 'Polymarket US';
    if(source.includes('polymarket global')||source.includes('gamma'))return 'Polymarket Global';
    if(p.provider==='Kalshi')return 'Kalshi';
    return 'Polymarket Unclassified';
  };
  const venueNames=['Kalshi','Polymarket US','Polymarket Global'];
  const coverage=[],venueCoverage=[];
  for(const sport of sports){
    const usEvents=usCoverage.filter(c=>c.sport===sport);
    const partial=usEvents.filter(c=>c.status==='US_PROP_INVENTORY_COUNT_MISMATCH');
    const usFailure=usEvents.filter(c=>c.status==='US_PROP_INVENTORY_READ_FAILED');
    const usStale=usEvents.filter(c=>c.status==='US_PROP_INVENTORY_STALE_OR_UNVERIFIED');
    for(const venue of venueNames){
      const venueProps=props.filter(p=>p.sport===sport&&venueFor(p)===venue);
      const venueOnly=marketOnly.filter(p=>p.sport===sport&&venueFor(p)===venue);
      const hasPartial=venue==='Polymarket US'&&partial.length>0;
      const status=hasPartial?'PARTIAL_SOURCE_CAPTURE':
        venue==='Polymarket US'&&usFailure.length?'SOURCE_READ_FAILED':
        venue==='Polymarket US'&&usStale.length?'SOURCE_STALE_OR_UNVERIFIED':
        venueProps.some(p=>p.marketAvailable)?'VERIFIED_MARKET':
        venueProps.length||venueOnly.length?'CONTRACTS_RESEARCH_ONLY':'COVERAGE_UNKNOWN';
      venueCoverage.push({sport,venue,status,
        capturedContracts:venueProps.length+venueOnly.length,
        marketOnlyContracts:venueOnly.length,
        verifiedMarkets:venueProps.filter(p=>p.marketAvailable).length,
        partialEvents:hasPartial?partial.length:0,
        sourceInventoryComplete:false,canAuthorizeWager:false});
    }
    for(const provider of ['Kalshi','Polymarket']){
      const providerProps=props.filter(p=>p.sport===sport&&p.provider===provider);
      const providerOnly=marketOnly.filter(p=>p.sport===sport&&p.provider===provider);
      const partialProvider=provider==='Polymarket'&&partial.length>0;
      const status=partialProvider?'PARTIAL_SOURCE_CAPTURE':
        providerProps.some(p=>p.marketAvailable)?'VERIFIED_MARKET':
        providerProps.length||providerOnly.length?'CONTRACTS_RESEARCH_ONLY':'COVERAGE_UNKNOWN';
      coverage.push({sport,provider,status,
        verifiedMarkets:providerProps.filter(p=>p.marketAvailable).length,
        verifiedContracts:providerProps.filter(p=>p.identityVerified).length,
        marketOnlyContracts:providerOnly.length,
        partialEvents:partialProvider?partial.length:0,
        observations:candidates.filter(p=>p.sport===sport&&p.provider===provider).length,
        modelStatus:'INDEPENDENT_MODEL_JOIN_REQUIRED',
        sourceInventoryComplete:false,canAuthorizeWager:false});
    }
  }
  return {coverage,venueCoverage};
}

export async function onRequestGet({env,request}) {
  const url = new URL(request.url), sport = url.searchParams.get('sport') || 'all';
  const date = url.searchParams.get('date') || new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if ((sport !== 'all' && !PROP_SPORTS.includes(sport)) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return respond({ok:false,error:'Invalid sport or date'},400);
  let bounds; try { bounds = chicagoDayBounds(date); } catch { return respond({ok:false,error:'Invalid date'},400); }
  const stores = listMarketHistoryReadDbs(env);
  if (env.DB?.prepare && !stores.some(s=>s.db===env.DB)) stores.push({db:env.DB,binding:'PRIMARY_D1'});
  const queriedSports=sport==='all'?PROP_SPORTS:[sport];
  let page;
  try{
    const cursor=url.searchParams.get('cursor'),budgetRaw=url.searchParams.get('pageBudget');
    const pageBudget=budgetRaw==null?3:Number(budgetRaw);
    page=await readExchangeObservationPage(stores,{
      start:bounds.start,end:bounds.end,sports:queriedSports,cursor,pageBudget
    });
  }catch(error){return respond({ok:false,error:String(error.message||'INVALID_CURSOR')},400);}
  const {rows,diagnostics}=page;
  const context=await loadPropFixturesAndPlayers(env,{start:bounds.start,end:bounds.end,sport});
  const captured=await loadCapturedKalshiProps(env,{...context,sport,date});
  const us=await loadCapturedPolymarketUsProps(env,{...context,sport});
  const candidates = latestExchangeProps(rows);
  const gamma = sport==='all'||sport==='nba'?await loadPolymarketGlobalNba(env,{day:date}):{rows:[],status:'NOT_REQUESTED'};
  const now=Date.now();
  const nbaRequested=sport==='all'||sport==='nba';
  const frozen=nbaRequested?await Promise.all(['Kalshi','Polymarket'].map(provider=>
    readNbaFrozenMarketLines(env,{provider,date,now}))):[];
  const frozenRows=frozen.flatMap(result=>result.rows);
  const active=rows=>rows.filter(r=>r.sport!=='nba'||Date.parse(r.start_time)>now);
  // Started NBA games read ONLY proven pretip source observations, never a
  // newly fetched in-play / postgame quote masquerading as the closing line.
  const props=[...active(candidates.filter(p=>p.identityVerified)),
    ...active(captured.rows),...active(us.rows),...active(gamma.rows),...frozenRows];
  // Return nonqualified market observations for research. Failure to match a
  // canonical player or verify a provider quote is a data-quality state, not
  // permission to silently discard an exchange-listed contract.
  const marketOnly=candidates.filter(p=>!p.identityVerified).map(p=>({
    id:p.id,provider:p.provider,source:p.source,sport:p.sport,
    contractId:p.contractId,player_name:p.player_name||null,
    canonical_market:p.canonical_market||null,line:p.line,
    side:p.side,period:p.period,team:p.team||null,opponent:p.opponent||null,
    collectedAt:p.collectedAt,reason:p.reasons||[],
    identityVerified:false,marketAvailable:false,priceVerified:false,
    purchaseAsk:null,canQualify:false,canAuthorizeWager:false
  }));
  marketOnly.push(...captured.rejected.map(r=>({
    id:'kalshi-raw:'+r.id,provider:'Kalshi',source:r.source||'Kalshi REST',
    sport:r.sport,contractId:r.id,series:r.series,
    rawTitle:r.rawTitle||null,player_name:null,
    canonical_market:null,line:r.line,side:null,period:null,
    collectedAt:r.collectedAt||null,reason:[r.reason||'IDENTITY_UNVERIFIED'],
    identityVerified:false,priceVerified:false,marketAvailable:false,
    purchaseAsk:null,canQualify:false,canAuthorizeWager:false
  })));
  marketOnly.push(...(gamma.marketOnly||[]).filter(r=>
    date && (Date.parse(r.start_time)>now || r.collectedAt &&
      Date.parse(r.collectedAt)<Date.parse(r.start_time) && r.historicalReference===true)
  ));
  marketOnly.push(...us.rejected.map(r=>({...r,identityVerified:false,priceVerified:false,marketAvailable:false,purchaseAsk:null,canQualify:false,canAuthorizeWager:false})));
  const officialScopeCandidates = buildNhlOfficialScopeCandidates(captured.rows,{capturedAt:new Date().toISOString()});

  const degraded = !stores.length || page.degraded || page.moreAvailable;
  const {coverage,venueCoverage} = summarizeExchangeCoverage({
    sports:PROP_SPORTS.filter(s=>sport==='all'||s===sport),
    props,marketOnly,candidates,usCoverage:us.coverage,degraded
  });
  return respond({ok:true,date,rows:props,marketOnly,marketOnlyCount:marketOnly.length,
    coverage,venueCoverage,diagnostics,degraded,readComplete:page.readComplete&&stores.length>0,
    nextCursor:page.nextCursor,moreAvailable:page.moreAvailable,
    polymarketUsResearch:{coverage:us.coverage,matchedOutcomeRows:us.rows.length,rejectedContracts:us.rejected.length,venue:'Polymarket US',canAuthorizeWager:false},collectorCoverage:captured.coverage,historicalReferenceDate:date,
    nbaPregameFreeze:nbaRequested?{Kalshi:frozen[0].status,Polymarket:frozen[1].status,
      capturedContracts:frozenRows.length,policy:'LAST_CAPTURE_BEFORE_GAME_START',canAuthorizeWager:false}:null,polymarketGlobalResearch:{status:gamma.status,contracts:gamma.rows.length,capturedAt:gamma.capturedAt||null,venue:'POLYMARKET_GLOBAL_NOT_US',priceSemantics:'DISPLAY_REFERENCE_NOT_BEST_ASK',canAuthorizeWager:false},officialScopeResearch:{status:'UNCERTIFIED_CANDIDATES_ONLY',candidateCount:officialScopeCandidates.scopes.length,rejectedCount:officialScopeCandidates.rejected.length,canActivateCollector:false},identityDiagnostics:context.diagnostics,identityCoverage:{fixtures:context.games.length,rosterPlayers:context.players.length,contractRejections:captured.rejected.reduce((a,r)=>(a[r.reason]=(a[r.reason]||0)+1,a),{})},rejected:candidates.filter(p=>!p.marketAvailable).map(p=>({id:p.id,provider:p.provider,sport:p.sport,reasons:p.reasons})),
    canQualify:false,canAuthorizeWager:false});
}
