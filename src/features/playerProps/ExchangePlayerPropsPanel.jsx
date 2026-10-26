import './exchangePlayerProps.css';
import { useEffect, useMemo, useState } from 'react';
import { PROP_SPORTS } from '../../../functions/lib/exchangePlayerProps.js';
import { joinIndependentPropModels } from '../../../functions/lib/propResearchData.js';
import FBISPlayerPropCard from './FBISPlayerPropCard.jsx';
import { selectProjectedPropCards, buildVenueComparisonRows, groupExchangePlayerStatCards } from './buildPlayerPropsBoard.js';
import ExchangePlayerWorkspace from './ExchangePlayerWorkspace.jsx';
import TennisExchangeResearch from './TennisExchangeResearch.jsx';
import { basketballPropWatermarkCoverage } from '../../../functions/lib/basketballPropTeam.js';
import { nbaActualForMarket } from '../../../functions/lib/nbaOfficialPropTotals.js';

function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export default function ExchangePlayerPropsPanel({board=null,sportFilter='all',onSportFilterChange,compact=false,limit=100,selectedDate=null}) {
  const [localSport,setLocalSport]=useState(sportFilter),[date,setDate]=useState(()=>selectedDate||board?.date||today()),[provider,setProvider]=useState('all');
  const [modelLoading,setModelLoading]=useState(true);
  const [modelRows,setModelRows]=useState([]),[modelError,setModelError]=useState(''),[coverageFilter,setCoverageFilter]=useState('all'),[freshness,setFreshness]=useState('all');
  const [search,setSearch]=useState(()=>typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('propPlayer')||''),[stat,setStat]=useState('all'),[side,setSide]=useState('all'),[selected,setSelected]=useState(null);
  const [state,setState]=useState({loading:true,rows:[],coverage:[],error:''});
  const [nbaFinalTotals,setNbaFinalTotals]=useState([]);
  const [marketOnlyPage,setMarketOnlyPage]=useState(0);
  const sport=onSportFilterChange?sportFilter:localSport;
  useEffect(()=>{if(selectedDate)setDate(selectedDate);},[selectedDate]);
  const modelSports=sport==='all'||sport==='top25'?[...new Set([...(state.rows||[]).map(r=>r.sport),...(board?.games||[]).map(g=>g.sport)])].filter(s=>PROP_SPORTS.includes(s)).sort().join(','):sport;
  useEffect(()=>{ if(!onSportFilterChange) setLocalSport(sportFilter); },[sportFilter,onSportFilterChange]);
  useEffect(()=>{
    const controller=new AbortController();
    let cursor=null,inFlight=false,seen=new Set(),seenMarket=new Set();
    let accumulated=null,rounds=0;
    const load=async()=>{
      if(inFlight||controller.signal.aborted)return;
      inFlight=true;
      try{
       // Bound each refresh to a small number of source reads. Continue from
       // the same scoped keyset cursor on the following refresh until complete.
       for(let n=0;n<3&&!controller.signal.aborted;n++){
        const q=new URLSearchParams({sport:sport==='top25'?'all':sport,date,pageBudget:'2'});
        if(cursor)q.set('cursor',cursor);
        const response=await fetch(`/api/exchange-player-props?${q}`,{signal:controller.signal,credentials:'same-origin'});
        const body=await response.json();
        if(!response.ok||!body.ok)throw Error(body.error||`HTTP ${response.status}`);
        if(!accumulated)accumulated={...body,rows:[],marketOnly:[]};
        for(const r of body.rows||[]){
         const key=[r.provider,r.contractId,r.outcomeId||r.side,r.canonicalPlayerId,
          r.canonical_market,r.period,r.line].join('|');
         if(!seen.has(key)){seen.add(key);accumulated.rows.push(r);}
        }
        for(const r of body.marketOnly||[]){
         const key=r.id||[r.provider,r.contractId,r.line,r.rawTitle].join('|');
         if(!seenMarket.has(key)){seenMarket.add(key);accumulated.marketOnly.push(r);}
        }
        cursor=body.nextCursor||null;
        accumulated={...accumulated,
         degraded:accumulated.degraded||body.degraded,
         readComplete:body.readComplete===true&&!cursor&&!accumulated.degraded,
         nextCursor:cursor,moreAvailable:!!cursor,
         marketOnlyCount:accumulated.marketOnly.length,
         diagnostics:body.diagnostics,coverage:body.coverage
        };
        rounds++;
        if(!controller.signal.aborted)setState({...accumulated,loading:false,error:'',inventoryBatches:rounds});
        if(!cursor)break;
       }
       // On completion, the next timed refresh starts a new current snapshot.
       if(!cursor){accumulated=null;seen=new Set();seenMarket=new Set();rounds=0;}
      }catch(e){
       if(!controller.signal.aborted)setState(prev=>({...prev,loading:false,
        error:'Exchange inventory incomplete: '+String(e.message),readComplete:false}));
      }finally{inFlight=false;}
    };
    setSelected(null);setState({loading:true,rows:[],coverage:[],error:''});load();
    const timer=setInterval(load,60_000);return()=>{controller.abort();clearInterval(timer);};
  },[sport,date]);
  useEffect(()=>{
    setModelLoading(true);setModelError('');setModelRows([]);
    const sports=modelSports.split(',').filter(Boolean);
    if(!sports.length){setModelLoading(false);return undefined;}
    const controller=new AbortController();
    Promise.all(sports.map(async s=>{
      const res=await fetch(`/api/prop-projections?${new URLSearchParams({sport:s,date})}`,{signal:controller.signal});
      const body=await res.json();if(!res.ok||!body.ok)throw Error(`${s.toUpperCase()}: ${body.error||'Model unavailable'}`);return body.rows||[];
    }).map(p=>p.then(rows=>({rows}),e=>({rows:[],error:e.message})))).then(results=>{
      if(controller.signal.aborted)return;
      setModelLoading(false);setModelRows(results.flatMap(r=>r.rows));setModelError(results.map(r=>r.error).filter(Boolean).join('; '));
    });
    return()=>controller.abort();
  },[modelSports,date]);
  useEffect(()=>{
    setNbaFinalTotals([]);
    if(!['nba','all','top25'].includes(sport))return undefined;
    const controller=new AbortController();
    const load=async()=>{
      try{
        const res=await fetch('/api/nba-prop-actuals?'+new URLSearchParams({date}),{signal:controller.signal});
        const body=await res.json();
        if(!controller.signal.aborted)setNbaFinalTotals(res.ok&&body.ok?body.rows||[]:[]);
      }catch{if(!controller.signal.aborted)setNbaFinalTotals([]);}
    };
    load();const timer=setInterval(load,120000);
    return()=>{controller.abort();clearInterval(timer);};
  },[sport,date]);
  const actualIndex=useMemo(()=>new Map(nbaFinalTotals.filter(r=>r.officialVerified===true)
    .map(r=>[r.eventId+'|'+r.canonicalPlayerId,r])),[nbaFinalTotals]);
  const allRows=useMemo(()=>joinIndependentPropModels(state.rows,modelRows).map(r=>{
    if(r.sport!=='nba')return r;
    const verified=actualIndex.get(r.canonicalEventId+'|'+r.canonicalPlayerId);
    const actual=nbaActualForMarket(verified,r.canonical_market);
    return {...r,officialActual:actual,officialActualVerified:verified?.officialVerified===true&&actual!=null,
      officialActualSource:actual!=null?verified?.source:null};
  }),[state.rows,modelRows,actualIndex]);
  const matchingRows=useMemo(()=>allRows.filter(r=>(provider==='all'||r.provider===provider)&&(stat==='all'||r.canonical_market===stat)&&(side==='all'||r.side===side||r.statSide===side)&&
    (coverageFilter==='all'||coverageFilter==='model'&&r.fbis_projection!=null||coverageFilter==='contract'&&r.contractId||coverageFilter==='qualified'&&r.canQualify===true)&&
    (freshness==='all'||freshness==='current'&&r.fresh===true||freshness==='unknown'&&!r.fresh)&&
    `${r.player_name} ${r.team}`.toLowerCase().includes(search.toLowerCase())),[allRows,provider,stat,side,search,coverageFilter,freshness]);
  const comparableRows=useMemo(()=>buildVenueComparisonRows(matchingRows),[matchingRows]);
  const statCards=useMemo(()=>groupExchangePlayerStatCards(comparableRows),[comparableRows]);
  const rows=useMemo(()=>selectProjectedPropCards(statCards,{limit,distinctPlayers:compact}),[statCards,limit,compact]);
  const unmodeled=statCards.filter(r=>r.fbis_projection==null||r.independent!==true).length;
  const marketOnly=useMemo(()=>(state.marketOnly||[]).filter(r=>
    (provider==='all'||r.provider===provider) &&
    (stat==='all'||r.canonical_market===stat||r.canonical_market==null) &&
    (side==='all'||r.side===side||r.side==null) &&
    (sport==='all'||sport==='top25'||r.sport===sport) &&
    `${r.player_name||''} ${r.rawTitle||''} ${r.contractId||''} ${r.team||''}`
      .toLowerCase().includes(search.toLowerCase())
  ),[state.marketOnly,provider,stat,side,sport,search]);
  const marketPages=Math.ceil(marketOnly.length/50);
  const currentMarketPage=Math.min(marketOnlyPage,Math.max(0,marketPages-1));
  const visibleMarketOnly=marketOnly.slice(currentMarketPage*50,(currentMarketPage+1)*50);
  const basketballWatermarks=useMemo(()=>basketballPropWatermarkCoverage(rows),[rows]);

  return <section className="pp-premium-page exchange-props-panel" aria-label="FBIS Player Props">
    <div className="pp-hero"><div><h1>{compact?'Top FBIS Player Props':'FBIS Player Props'}</h1><p>Independent FBIS projections · Player form · Exchange thresholds</p></div><span>{state.loading||modelLoading?'Loading player projections…':`${rows.length} projected ${compact?'players':'player/stat cards'} · One threshold per stat`}</span></div>
    {!compact?<div className="exchange-prop-filters">
      <label>Sport <select value={sport==='top25'?'all':sport} onChange={e=>{setStat('all');(onSportFilterChange||setLocalSport)(e.target.value);}}><option value="all">All sports</option>{PROP_SPORTS.map(s=><option key={s} value={s}>{s.toUpperCase()}</option>)}</select></label>
      <label>Game date <input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label>Provider <select value={provider} onChange={e=>setProvider(e.target.value)}><option value="all">All exchanges</option><option>Kalshi</option><option>Polymarket</option></select></label>
      <label>Stat <select value={stat} onChange={e=>setStat(e.target.value)}><option value="all">All stats</option>{[...new Set(allRows.map(r=>r.canonical_market))].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Side <select value={side} onChange={e=>setSide(e.target.value)}><option value="all">All sides</option>{['over','under','yes','no'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Research status <select value={coverageFilter} onChange={e=>setCoverageFilter(e.target.value)}><option value="all">All research</option><option value="model">Projection available</option><option value="contract">Contract mapped</option><option value="qualified">Qualified opportunities</option></select></label>
      <label>Quote freshness <select value={freshness} onChange={e=>setFreshness(e.target.value)}><option value="all">All quote states</option><option value="current">Verified current</option><option value="unknown">Unknown / unavailable</option></select></label>
      <label>Player / team <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search players"/></label>
    </div>:null}
    {state.error?<p role="alert">Player prop delivery failed: {state.error}</p>:null}
    {modelError?<p role="status">Model delivery: {modelError}</p>:null}
    {state.moreAvailable?<p role="status">Exchange observation inventory is still loading across database pages ({state.inventoryBatches||1} batches). Prices and cards are provisional until the source read completes.</p>:null}
    {state.degraded&&!state.moreAvailable?<p role="status">Coverage unknown: one or more observation stores could not be read completely.</p>:null}
    {!state.loading&&!modelLoading&&!state.error&&!rows.length?<p className="pp-empty">{sport==="tennis" ? "No independent tennis player-stat projections available for these filters. Available tennis match/set/game exchange markets are shown separately below." : "No independent FBIS projections available for these filters. Unmatched exchange markets appear in the market-only inventory below."}</p>:null}
    {!compact&&basketballWatermarks.total>0?<details className="pp-basketball-watermark-audit">
      <summary>Basketball team watermarks: {basketballWatermarks.resolved}/{basketballWatermarks.total} resolved
        {basketballWatermarks.unresolved ? ` · ${basketballWatermarks.unresolved} need team identity` : ' · all verified'}
      </summary>
      <p>NBA {basketballWatermarks.bySport.nba} · WNBA {basketballWatermarks.bySport.wnba} · CBB {basketballWatermarks.bySport.cbb} displayed cards. Logos use canonical player teams, never opponents.</p>
      {basketballWatermarks.unresolvedRows.length?<ul>{basketballWatermarks.unresolvedRows.slice(0,30).map((x,i)=>
        <li key={i}>{x.sport.toUpperCase()} · {x.player||'Unknown player'} · team {x.team||'missing'} · {x.status.replaceAll('_',' ')}</li>)}</ul>:null}
    </details>:null}
    <div className="pp-card-grid pp-premium-grid exchange-prop-grid">{rows.map((r,i)=><FBISPlayerPropCard key={r.id} row={r} rank={compact?i+1:null} compact={compact} onResearch={setSelected}/>)}</div>
    {!compact&&marketOnly.length>0?<details className="pp-board-coverage">
      <summary>Exchange market-only inventory: {marketOnly.length} source observations without verified player/event identity</summary>
      <p>These are exchange-source research records, not qualified model edges or executable quotes. An unmatched contract must never receive invented FBIS projections.</p>
      <table className="exchange-prop-coverage"><thead><tr><th>Sport</th><th>Exchange</th><th>Source contract</th><th>Player / market</th><th>Threshold</th><th>Missing proof</th></tr></thead>
        <tbody>{visibleMarketOnly.map((r,i)=><tr key={r.id||i}>
          <td>{String(r.sport||'—').toUpperCase()}</td>
          <td>{r.provider||'—'}</td>
          <td>{r.contractId||'—'}</td>
          <td>{r.rawTitle||`${r.player_name||'Unknown'} · ${r.canonical_market||'Unmapped'}`}</td>
          <td>{r.line??'—'}</td>
          <td>{(r.reason||[]).join(', ')||'Identity unverified'}</td>
        </tr>)}</tbody>
      </table>
      {marketPages>1?<div className="exchange-market-pagination">
        <button type="button" disabled={currentMarketPage===0} onClick={()=>setMarketOnlyPage(v=>Math.max(0,v-1))}>Previous</button>
        <span>{currentMarketPage+1} / {marketPages}</span>
        <button type="button" disabled={currentMarketPage>=marketPages-1} onClick={()=>setMarketOnlyPage(v=>Math.min(marketPages-1,v+1))}>Next</button>
      </div>:null}
    </details>:null}
    {!compact && sport==="tennis" ? <TennisExchangeResearch date={date} provider={provider} search={search} /> : null}
    {!compact&&unmodeled>0?<p className="pp-board-coverage">{unmodeled} contract thresholds withheld: independent player/stat projections are not matched. Unmatched contracts are listed separately as market-only research; alternate thresholds for projected players are in player research.</p>:null}
    {selected?<ExchangePlayerWorkspace row={selected} onClose={()=>setSelected(null)}/>:null}
    {!compact&&state.collectorCoverage?.length?<details><summary>Collector evidence and mapping</summary><p>Kalshi contracts captured: {state.collectorCoverage.reduce((n,c)=>n+(c.records||0),0)}. Only exact player/event/stat matches appear as cards.</p><table className="exchange-prop-coverage"><thead><tr><th>Series</th><th>Sport</th><th>Status</th><th>Captured</th></tr></thead><tbody>{state.collectorCoverage.map(c=><tr key={c.series}><td>{c.series}</td><td>{c.sport}</td><td>{c.status}</td><td>{c.capturedAt||'—'}</td></tr>)}</tbody></table></details>:null}
    {!compact&&state.coverage.length?<details><summary>Coverage by sport and exchange</summary><table className="exchange-prop-coverage"><thead><tr><th>Sport</th><th>Exchange</th><th>Verified quotes</th><th>Coverage</th><th>Model</th></tr></thead><tbody>{state.coverage.filter(c=>provider==='all'||provider===c.provider).map(c=><tr key={`${c.sport}-${c.provider}`}><td>{c.sport.toUpperCase()}</td><td>{c.provider}</td><td>{c.verifiedMarkets}</td><td>{c.status.replaceAll('_',' ')}</td><td>{modelRows.some(r=>r.sport===c.sport)?"Research projections":"No independent projection delivered"}</td></tr>)}</tbody></table></details>:null}
  </section>;
}
