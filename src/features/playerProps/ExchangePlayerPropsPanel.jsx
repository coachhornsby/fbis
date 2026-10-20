import './exchangePlayerProps.css';
import { useEffect, useMemo, useState } from 'react';
import { PROP_SPORTS } from '../../../functions/lib/exchangePlayerProps.js';
import FBISPlayerPropCard from './FBISPlayerPropCard.jsx';
import ExchangePlayerWorkspace from './ExchangePlayerWorkspace.jsx';

function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export default function ExchangePlayerPropsPanel({sportFilter='all',onSportFilterChange,compact=false,limit=100}) {
  const [localSport,setLocalSport]=useState(sportFilter),[date,setDate]=useState(today),[provider,setProvider]=useState('all');
  const [search,setSearch]=useState(''),[stat,setStat]=useState('all'),[side,setSide]=useState('all'),[selected,setSelected]=useState(null);
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
  const rows=useMemo(()=>state.rows.filter(r=>(provider==='all'||r.provider===provider)&&(stat==='all'||r.canonical_market===stat)&&(side==='all'||r.side===side)&&`${r.player_name} ${r.team}`.toLowerCase().includes(search.toLowerCase())).slice(0,limit),[state.rows,provider,stat,side,search,limit]);
  return <section className="pp-premium-page exchange-props-panel" aria-label="FBIS Player Props">
    <div className="pp-hero"><div><h1>{compact?'Top FBIS Player Props':'FBIS Player Props'}</h1><p>Kalshi + Polymarket · Verified contracts · Independent model research</p></div><span>{state.loading?'Loading…':`${rows.length} verified markets`}</span></div>
    {!compact?<div className="exchange-prop-filters">
      <label>Sport <select value={sport==='top25'?'all':sport} onChange={e=>{setStat('all');(onSportFilterChange||setLocalSport)(e.target.value);}}><option value="all">All sports</option>{PROP_SPORTS.map(s=><option key={s} value={s}>{s.toUpperCase()}</option>)}</select></label>
      <label>Game date <input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label>Provider <select value={provider} onChange={e=>setProvider(e.target.value)}><option value="all">All exchanges</option><option>Kalshi</option><option>Polymarket</option></select></label>
      <label>Stat <select value={stat} onChange={e=>setStat(e.target.value)}><option value="all">All stats</option>{[...new Set(state.rows.map(r=>r.canonical_market))].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Side <select value={side} onChange={e=>setSide(e.target.value)}><option value="all">All sides</option>{['over','under','yes','no'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Player / team <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search players"/></label>
    </div>:null}
    {state.error?<p role="alert">Player prop delivery failed: {state.error}</p>:null}
    {state.degraded?<p role="status">Coverage unknown: one or more observation stores could not be read completely.</p>:null}
    {!state.loading&&!state.error&&!rows.length?<p className="pp-empty">Market unavailable for these filters. No current contract has passed player, event, settlement, purchase-price, and freshness checks.</p>:null}
    <div className="pp-card-grid pp-premium-grid exchange-prop-grid">{rows.map(r=><FBISPlayerPropCard key={r.id} row={r} onResearch={setSelected}/>)}</div>
    {selected?<ExchangePlayerWorkspace row={selected} onClose={()=>setSelected(null)}/>:null}
    {!compact&&state.coverage.length?<details><summary>Coverage by sport and exchange</summary><table className="exchange-prop-coverage"><thead><tr><th>Sport</th><th>Exchange</th><th>Markets</th><th>Coverage</th><th>Model</th></tr></thead><tbody>{state.coverage.filter(c=>provider==='all'||provider===c.provider).map(c=><tr key={`${c.sport}-${c.provider}`}><td>{c.sport.toUpperCase()}</td><td>{c.provider}</td><td>{c.verifiedMarkets}</td><td>{c.status.replaceAll('_',' ')}</td><td>Model join pending</td></tr>)}</tbody></table></details>:null}
  </section>;
}
