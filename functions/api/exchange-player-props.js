import {loadPolymarketGlobalNba} from '../lib/polymarketGlobalNbaProps.js';
import { readNbaFrozenMarketLines } from '../lib/nbaPropMarketFreeze.js';
import { buildNhlOfficialScopeCandidates } from '../lib/nhlPropScopeCandidates.js';
import { loadPropFixturesAndPlayers } from '../lib/propResearchData.js';
import { loadCapturedKalshiProps } from '../lib/kalshiPlayerPropCollector.js';
import { listMarketHistoryReadDbs } from '../lib/databaseTopology.js';
import { PROP_SPORTS, latestExchangeProps } from '../lib/exchangePlayerProps.js';
import { chicagoDayBounds } from '../lib/chicagoDayBounds.js';
const respond = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestGet({env,request}) {
  const url = new URL(request.url), sport = url.searchParams.get('sport') || 'all';
  const date = url.searchParams.get('date') || new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if ((sport !== 'all' && !PROP_SPORTS.includes(sport)) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return respond({ok:false,error:'Invalid sport or date'},400);
  let bounds; try { bounds = chicagoDayBounds(date); } catch { return respond({ok:false,error:'Invalid date'},400); }
  const stores = listMarketHistoryReadDbs(env);
  if (env.DB?.prepare && !stores.some(s=>s.db===env.DB)) stores.push({db:env.DB,binding:'PRIMARY_D1'});
  const diagnostics = [], rows = [];
  const queriedSports=sport==='all'?PROP_SPORTS:[sport];
  for (const store of stores) {
    try {
      let cursor=null,complete=false,count=0;
      for(let page=0;page<10;page++){
       const result=await store.db.prepare(`SELECT * FROM normalized_market_observations
        WHERE source IN ('Kalshi','Kalshi REST','Kalshi WebSocket','Polymarket','Polymarket US','Polymarket US WebSocket')
        AND market_family='player_prop' AND event_start_time >= ? AND event_start_time < ?
        AND sport IN (${queriedSports.map(()=>'?').join(',')})
        ${cursor?'AND (collected_at < ? OR (collected_at = ? AND id < ?))':''}
        ORDER BY collected_at DESC,id DESC LIMIT 500`).bind(bounds.start,bounds.end,...queriedSports,...(cursor?[cursor.collected_at,cursor.collected_at,cursor.id]:[])).all();
       const batch=result.results||[];rows.push(...batch);count+=batch.length;
       if(batch.length<500){complete=true;break;}
       const last=batch.at(-1);if(last.id==null||!last.collected_at)break;cursor=last;
      }
      diagnostics.push({store:store.binding,status:'READ',observations:count,truncated:!complete});
    } catch { diagnostics.push({store:store.binding,status:'READ_FAILED'}); }
  }
  const context=await loadPropFixturesAndPlayers(env,{start:bounds.start,end:bounds.end,sport});
  const captured=await loadCapturedKalshiProps(env,{...context,sport,date});
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
    ...active(captured.rows),...active(gamma.rows),...frozenRows];
  const officialScopeCandidates = buildNhlOfficialScopeCandidates(captured.rows,{capturedAt:new Date().toISOString()});

  const degraded = !stores.length || diagnostics.some(d=>d.status==='READ_FAILED' || d.truncated);
  const coverage = PROP_SPORTS.filter(s=>sport==='all'||s===sport).flatMap(s=>['Kalshi','Polymarket'].map(provider=>({
    sport:s,provider,status:props.some(p=>p.sport===s&&p.provider===provider&&p.marketAvailable)?'VERIFIED_MARKET':props.some(p=>p.sport===s&&p.provider===provider)?'CONTRACTS_RESEARCH_ONLY':degraded?'COVERAGE_UNKNOWN':'MARKET_UNAVAILABLE',
    verifiedMarkets:props.filter(p=>p.sport===s&&p.provider===provider&&p.marketAvailable).length,
    verifiedContracts:props.filter(p=>p.sport===s&&p.provider===provider&&p.identityVerified).length,
    observations:candidates.filter(p=>p.sport===s&&p.provider===provider).length,modelStatus:'INDEPENDENT_MODEL_JOIN_REQUIRED',
  })));
  return respond({ok:true,date,rows:props,coverage,diagnostics,degraded,collectorCoverage:captured.coverage,historicalReferenceDate:date,
    nbaPregameFreeze:nbaRequested?{Kalshi:frozen[0].status,Polymarket:frozen[1].status,
      capturedContracts:frozenRows.length,policy:'LAST_CAPTURE_BEFORE_GAME_START',canAuthorizeWager:false}:null,polymarketGlobalResearch:{status:gamma.status,contracts:gamma.rows.length,capturedAt:gamma.capturedAt||null,venue:'POLYMARKET_GLOBAL_NOT_US',priceSemantics:'DISPLAY_REFERENCE_NOT_BEST_ASK',canAuthorizeWager:false},officialScopeResearch:{status:'UNCERTIFIED_CANDIDATES_ONLY',candidateCount:officialScopeCandidates.scopes.length,rejectedCount:officialScopeCandidates.rejected.length,canActivateCollector:false},identityDiagnostics:context.diagnostics,identityCoverage:{fixtures:context.games.length,rosterPlayers:context.players.length,contractRejections:captured.rejected.reduce((a,r)=>(a[r.reason]=(a[r.reason]||0)+1,a),{})},rejected:candidates.filter(p=>!p.marketAvailable).map(p=>({id:p.id,provider:p.provider,sport:p.sport,reasons:p.reasons})),
    canQualify:false,canAuthorizeWager:false});
}
