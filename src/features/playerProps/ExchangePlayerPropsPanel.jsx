import './exchangePlayerProps.css';
import { useEffect, useMemo, useState } from 'react';
import { PROP_SPORTS } from '../../../functions/lib/exchangePlayerProps.js';
import { joinIndependentPropModels } from '../../../functions/lib/propResearchData.js';
import FBISPlayerPropCard from './FBISPlayerPropCard.jsx';
import { selectProjectedPropCards, buildVenueComparisonRows, groupExchangePlayerStatCards } from './buildPlayerPropsBoard.js';
import ExchangePlayerWorkspace from './ExchangePlayerWorkspace.jsx';
import { basketballPropWatermarkCoverage } from '../../../functions/lib/basketballPropTeam.js';

function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export default function ExchangePlayerPropsPanel({board=null,sportFilter='all',onSportFilterChange,compact=false,limit=100,selectedDate=null}) {
  const [localSport,setLocalSport]=useState(sportFilter),[date,setDate]=useState(()=>selectedDate||board?.date||today()),[provider,setProvider]=useState('all');
  const [modelLoading,setModelLoading]=useState(true);
  const [modelRows,setModelRows]=useState([]),[modelError,setModelError]=useState(''),[coverageFilter,setCoverageFilter]=useState('all'),[freshness,setFreshness]=useState('all');
  const [search,setSearch]=useState(()=>typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('propPlayer')||''),[stat,setStat]=useState('all'),[side,setSide]=useState('all'),[selected,setSelected]=useState(null);
  const [state,setState]=useState({loading:true,rows:[],coverage:[],error:''});
  const sport=onSportFilterChange?sportFilter:localSport;
  useEffect(()=>{if(selectedDate)setDate(selectedDate);},[selectedDate]);
  const modelSports=sport==='all'||sport==='top25'?[...new Set([...(state.rows||[]).map(r=>r.sport),...(board?.games||[]).map(g=>g.sport)])].filter(s=>PROP_SPORTS.includes(s)).sort().join(','):sport;
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
  const allRows=useMemo(()=>joinIndependentPropModels(state.rows,modelRows),[state.rows,modelRows]);
  const matchingRows=useMemo(()=>allRows.filter(r=>(provider==='all'||r.provider===provider)&&(stat==='all'||r.canonical_market===stat)&&(side==='all'||r.side===side||r.statSide===side)&&
    (coverageFilter==='all'||coverageFilter==='model'&&r.fbis_projection!=null||coverageFilter==='contract'&&r.contractId||coverageFilter==='qualified'&&r.canQualify===true)&&
    (freshness==='all'||freshness==='current'&&r.fresh===true||freshness==='unknown'&&!r.fresh)&&
    `${r.player_name} ${r.team}`.toLowerCase().includes(search.toLowerCase())),[allRows,provider,stat,side,search,coverageFilter,freshness]);
  const comparableRows=useMemo(()=>buildVenueComparisonRows(matchingRows),[matchingRows]);
  const statCards=useMemo(()=>groupExchangePlayerStatCards(comparableRows),[comparableRows]);
  const rows=useMemo(()=>selectProjectedPropCards(statCards,{limit,distinctPlayers:compact}),[statCards,limit,compact]);
  const unmodeled=statCards.filter(r=>r.fbis_projection==null||r.independent!==true).length;
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
    {state.degraded?<p role="status">Coverage unknown: one or more observation stores could not be read completely.</p>:null}
    {!state.loading&&!modelLoading&&!state.error&&!rows.length?<p className="pp-empty">No independent FBIS projections available for these filters. Contracts without a matched projection stay off the board.</p>:null}
    {!compact&&basketballWatermarks.total>0?<details className="pp-basketball-watermark-audit">
      <summary>Basketball team watermarks: {basketballWatermarks.resolved}/{basketballWatermarks.total} resolved
        {basketballWatermarks.unresolved ? ` · ${basketballWatermarks.unresolved} need team identity` : ' · all verified'}
      </summary>
      <p>NBA {basketballWatermarks.bySport.nba} · WNBA {basketballWatermarks.bySport.wnba} · CBB {basketballWatermarks.bySport.cbb} displayed cards. Logos use canonical player teams, never opponents.</p>
      {basketballWatermarks.unresolvedRows.length?<ul>{basketballWatermarks.unresolvedRows.slice(0,30).map((x,i)=>
        <li key={i}>{x.sport.toUpperCase()} · {x.player||'Unknown player'} · team {x.team||'missing'} · {x.status.replaceAll('_',' ')}</li>)}</ul>:null}
    </details>:null}
    <div className="pp-card-grid pp-premium-grid exchange-prop-grid">{rows.map((r,i)=><FBISPlayerPropCard key={r.id} row={r} rank={compact?i+1:null} compact={compact} onResearch={setSelected}/>)}</div>
    {!compact&&unmodeled>0?<p className="pp-board-coverage">{unmodeled} contract thresholds withheld: independent player/stat projections are not matched. Alternate thresholds for projected players are in player research.</p>:null}
    {selected?<ExchangePlayerWorkspace row={selected} onClose={()=>setSelected(null)}/>:null}
    {!compact&&state.collectorCoverage?.length?<details><summary>Collector evidence and mapping</summary><p>Kalshi contracts captured: {state.collectorCoverage.reduce((n,c)=>n+(c.records||0),0)}. Only exact player/event/stat matches appear as cards.</p><table className="exchange-prop-coverage"><thead><tr><th>Series</th><th>Sport</th><th>Status</th><th>Captured</th></tr></thead><tbody>{state.collectorCoverage.map(c=><tr key={c.series}><td>{c.series}</td><td>{c.sport}</td><td>{c.status}</td><td>{c.capturedAt||'—'}</td></tr>)}</tbody></table></details>:null}
    {!compact&&state.coverage.length?<details><summary>Coverage by sport and exchange</summary><table className="exchange-prop-coverage"><thead><tr><th>Sport</th><th>Exchange</th><th>Verified quotes</th><th>Coverage</th><th>Model</th></tr></thead><tbody>{state.coverage.filter(c=>provider==='all'||provider===c.provider).map(c=><tr key={`${c.sport}-${c.provider}`}><td>{c.sport.toUpperCase()}</td><td>{c.provider}</td><td>{c.verifiedMarkets}</td><td>{c.status.replaceAll('_',' ')}</td><td>{modelRows.some(r=>r.sport===c.sport)?"Research projections":"No independent projection delivered"}</td></tr>)}</tbody></table></details>:null}
  </section>;
}
