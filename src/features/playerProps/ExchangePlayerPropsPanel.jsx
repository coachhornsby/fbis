import './exchangePlayerProps.css';
import { useEffect, useMemo, useState } from 'react';
import { PROP_SPORTS } from '../../../functions/lib/exchangePlayerProps.js';
import { independentPropRows,joinIndependentPropModels } from '../../../functions/lib/propResearchData.js';
import FBISPlayerPropCard from './FBISPlayerPropCard.jsx';
import { orderExchangeResearchCards, buildVenueComparisonRows, groupExchangePlayerStatCards } from './buildPlayerPropsBoard.js';
import ExchangePlayerWorkspace from './ExchangePlayerWorkspace.jsx';
import { basketballPropWatermarkCoverage } from '../../../functions/lib/basketballPropTeam.js';

function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export default function ExchangePlayerPropsPanel({board=null,sportFilter='all',onSportFilterChange,compact=false,limit=100}) {
  const [localSport,setLocalSport]=useState(sportFilter),[date,setDate]=useState(today),[provider,setProvider]=useState('all');
  const [modelRows,setModelRows]=useState([]),[modelError,setModelError]=useState(''),[coverageFilter,setCoverageFilter]=useState('all'),[freshness,setFreshness]=useState('all');
  const [search,setSearch]=useState(()=>typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('propPlayer')||''),[stat,setStat]=useState('all'),[side,setSide]=useState('all'),[selected,setSelected]=useState(null);
  const [state,setState]=useState({loading:true,rows:[],coverage:[],error:''});
  const sport=onSportFilterChange?sportFilter:localSport;
  useEffect(()=>{ if(!onSportFilterChange) setLocalSport(sportFilter); },[sportFilter,onSportFilterChange]);
  useEffect(()=>{
    const controller=new AbortController();
    const load=()=>{
      const q=new URLSearchParams({sport:sport==='top25'?'all':sport,date});
      fetch(`/api/exchange-player-props?${q}`,{signal:controller.signal,credentials:'same-origin'})
        .then(async r=>{const body=await r.json();if(!r.ok||!body.ok)throw Error(body.error||`HTTP ${r.status}`);return body;})
        .then(body=>{if(!controller.signal.aborted)setState({...body,loading:false,error:''});})
        .catch(e=>{if(!controller.signal.aborted)setState({loading:false,rows:[],coverage:[],error:String(e.message)});});
    };
    setSelected(null);setState({loading:true,rows:[],coverage:[],error:''});load();
    const timer=setInterval(load,60_000);return()=>{controller.abort();clearInterval(timer);};
  },[sport,date]);
  useEffect(()=>{
    setModelError('');setModelRows([]);
    if(board?.date===date){setModelRows(independentPropRows(board).filter(r=>sport==='all'||sport==='top25'||r.sport===sport));}
    if(sport==='all'||sport==='top25')return undefined;
    const controller=new AbortController();
    fetch(`/api/prop-projections?${new URLSearchParams({sport,date})}`,{signal:controller.signal}).then(async r=>{const b=await r.json();if(!r.ok||!b.ok)throw Error(b.error||'Model unavailable');return b;}).then(b=>{if(!controller.signal.aborted)setModelRows(b.rows||[]);}).catch(e=>{if(!controller.signal.aborted)setModelError(e.message);});
    return()=>controller.abort();
  },[sport,date,board]);
  const allRows=useMemo(()=>joinIndependentPropModels(state.rows,modelRows),[state.rows,modelRows]);
  const matchingRows=useMemo(()=>allRows.filter(r=>(provider==='all'||r.provider===provider)&&(stat==='all'||r.canonical_market===stat)&&(side==='all'||r.side===side||r.statSide===side)&&
    (coverageFilter==='all'||coverageFilter==='model'&&r.fbis_projection!=null||coverageFilter==='contract'&&r.contractId||coverageFilter==='qualified'&&r.canQualify===true)&&
    (freshness==='all'||freshness==='current'&&r.fresh===true||freshness==='unknown'&&!r.fresh)&&
    `${r.player_name} ${r.team}`.toLowerCase().includes(search.toLowerCase())),[allRows,provider,stat,side,search,coverageFilter,freshness]);
  const comparableRows=useMemo(()=>buildVenueComparisonRows(matchingRows),[matchingRows]);
  const statCards=useMemo(()=>groupExchangePlayerStatCards(comparableRows),[comparableRows]);
  const rows=useMemo(()=>orderExchangeResearchCards(statCards,limit),[statCards,limit]);
  const basketballWatermarks=useMemo(()=>basketballPropWatermarkCoverage(rows),[rows]);

  return <section className="pp-premium-page exchange-props-panel" aria-label="FBIS Player Props">
    <div className="pp-hero"><div><h1>{compact?'Top FBIS Player Props':'FBIS Player Props'}</h1><p>Kalshi + Polymarket · Verified contracts · Independent model research</p></div><span>{state.loading?'Loading…':`Showing ${rows.length} of ${statCards.length} player/stat cards · ${rows.filter(r=>r.venueComparison?.groupedContractSides>1).length} with both Over/Under · ${rows.filter(r=>Object.values(r.venueComparison?.marketSides||{}).some(s=>s.providerCount===2)).length} paired exchanges`}</span></div>
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
    {state.degraded?<p role="status">Coverage unknown: one or more observation stores could not be read completely.</p>:null}
    {!state.loading&&!state.error&&!rows.length?<p className="pp-empty">Market unavailable for these filters. No mapped contract or independent projection is available. Select a sport to load its model research.</p>:null}
    {!compact&&basketballWatermarks.total>0?<details className="pp-basketball-watermark-audit">
      <summary>Basketball team watermarks: {basketballWatermarks.resolved}/{basketballWatermarks.total} resolved
        {basketballWatermarks.unresolved ? ` · ${basketballWatermarks.unresolved} need team identity` : ' · all verified'}
      </summary>
      <p>NBA {basketballWatermarks.bySport.nba} · WNBA {basketballWatermarks.bySport.wnba} · CBB {basketballWatermarks.bySport.cbb} displayed cards. Logos use canonical player teams, never opponents.</p>
      {basketballWatermarks.unresolvedRows.length?<ul>{basketballWatermarks.unresolvedRows.slice(0,30).map((x,i)=>
        <li key={i}>{x.sport.toUpperCase()} · {x.player||'Unknown player'} · team {x.team||'missing'} · {x.status.replaceAll('_',' ')}</li>)}</ul>:null}
    </details>:null}
    <div className="pp-card-grid pp-premium-grid exchange-prop-grid">{rows.map(r=><FBISPlayerPropCard key={r.id} row={r} onResearch={setSelected}/>)}</div>
    {selected?<ExchangePlayerWorkspace row={selected} onClose={()=>setSelected(null)}/>:null}
    {!compact&&state.collectorCoverage?.length?<details><summary>Collector evidence and mapping</summary><p>Kalshi contracts captured: {state.collectorCoverage.reduce((n,c)=>n+(c.records||0),0)}. Only exact player/event/stat matches appear as cards.</p><table className="exchange-prop-coverage"><thead><tr><th>Series</th><th>Sport</th><th>Status</th><th>Captured</th></tr></thead><tbody>{state.collectorCoverage.map(c=><tr key={c.series}><td>{c.series}</td><td>{c.sport}</td><td>{c.status}</td><td>{c.capturedAt||'—'}</td></tr>)}</tbody></table></details>:null}
    {!compact&&state.coverage.length?<details><summary>Coverage by sport and exchange</summary><table className="exchange-prop-coverage"><thead><tr><th>Sport</th><th>Exchange</th><th>Verified quotes</th><th>Coverage</th><th>Model</th></tr></thead><tbody>{state.coverage.filter(c=>provider==='all'||provider===c.provider).map(c=><tr key={`${c.sport}-${c.provider}`}><td>{c.sport.toUpperCase()}</td><td>{c.provider}</td><td>{c.verifiedMarkets}</td><td>{c.status.replaceAll('_',' ')}</td><td>{modelRows.some(r=>r.sport===c.sport)?"Research projections":"No independent projection delivered"}</td></tr>)}</tbody></table></details>:null}
  </section>;
}
