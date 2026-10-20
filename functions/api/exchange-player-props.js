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
      const result = await store.db.prepare(`SELECT * FROM normalized_market_observations
        WHERE source IN ('Kalshi','Kalshi REST','Kalshi WebSocket','Polymarket','Polymarket US','Polymarket US WebSocket')
        AND market_family='player_prop' AND event_start_time >= ? AND event_start_time < ?
        AND sport IN (${queriedSports.map(()=>'?').join(',')})
        ORDER BY collected_at DESC LIMIT 500`).bind(bounds.start,bounds.end,...queriedSports).all();
      rows.push(...(result.results || [])); diagnostics.push({store:store.binding,status:'READ',observations:result.results?.length || 0,truncated:result.results?.length===500});
    } catch { diagnostics.push({store:store.binding,status:'READ_FAILED'}); }
  }
  const context=await loadPropFixturesAndPlayers(env,{start:bounds.start,end:bounds.end,sport});
  const captured=await loadCapturedKalshiProps(env,{...context,sport});
  const candidates = latestExchangeProps(rows);
  const props = [...candidates.filter(p=>p.identityVerified),...captured.rows];

  const degraded = !stores.length || diagnostics.some(d=>d.status==='READ_FAILED' || d.truncated);
  const coverage = PROP_SPORTS.filter(s=>sport==='all'||s===sport).flatMap(s=>['Kalshi','Polymarket'].map(provider=>({
    sport:s,provider,status:props.some(p=>p.sport===s&&p.provider===provider&&p.marketAvailable)?'VERIFIED_MARKET':props.some(p=>p.sport===s&&p.provider===provider)?'CONTRACTS_RESEARCH_ONLY':degraded?'COVERAGE_UNKNOWN':'MARKET_UNAVAILABLE',
    verifiedMarkets:props.filter(p=>p.sport===s&&p.provider===provider&&p.marketAvailable).length,
    verifiedContracts:props.filter(p=>p.sport===s&&p.provider===provider&&p.identityVerified).length,
    observations:candidates.filter(p=>p.sport===s&&p.provider===provider).length,modelStatus:'INDEPENDENT_MODEL_JOIN_REQUIRED',
  })));
  return respond({ok:true,date,rows:props,coverage,diagnostics,degraded,collectorCoverage:captured.coverage,identityDiagnostics:context.diagnostics,rejected:candidates.filter(p=>!p.marketAvailable).map(p=>({id:p.id,provider:p.provider,sport:p.sport,reasons:p.reasons})),
    canQualify:false,canAuthorizeWager:false});
}
