import {mergeRetainedExchangeQuotes,loadRetainedExchangeQuotes,saveRetainedExchangeQuotes} from '../../lib/retainedExchangeQuotes.js';
import {useEffect,useMemo,useState,useRef} from 'react';
import {exchangeGameMarkets,formatAmericanFromCost,marketCoverageStatus} from '../../lib/exchangeMarketExplorer.js';
import './eventPlayerProps.css';
import './exchangeMarketExplorer.css';
// One bounded snapshot fetch per sport/date, shared across expanded game cards.
// No per-card upstream/provider fanout or automatic background polling.
const cache=new Map();
const CT=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
function boardDate(game){const t=Date.parse(game?.start||'');return Number.isFinite(t)?CT.format(new Date(t)):null;}
async function loadSnapshot(sport,date,{force=false}={}){
 const key=sport+'|'+date,old=cache.get(key);
 if(!force&&old&&Date.now()-old.at<10000)return old.promise;
 const promise=fetch('/api/public/exchange-quotes?'+new URLSearchParams({sport,date}),{headers:{accept:'application/json'}})
  .then(async response=>{const data=await response.json();if(!response.ok||data.ok!==true||data.sport!==sport||data.date!==date)throw Error(data.code||'EXCHANGE_FEED_UNAVAILABLE');return data;});
 cache.set(key,{at:Date.now(),promise});
 try{return await promise;}catch(err){cache.delete(key);throw err;}
}
const labelSide=x=>x==='over'?'OVER':x==='under'?'UNDER':x==='home'?'HOME':x==='away'?'AWAY':String(x||'UNKNOWN').replaceAll('_',' ').toUpperCase();
const browserStore=()=>{try{return window.sessionStorage;}catch{return null;}};
const clock=t=>{if(!t)return 'Unknown';const d=new Date(t);return Number.isFinite(+d)?d.toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',second:'2-digit'} )+' CT':'Unknown';};
export default function EventMarkets({game}){
 const id=String(game?.id||''),sport=String(game?.sport||'').toLowerCase(),date=boardDate(game);
 const scopeRef=useRef(sport+'|'+date);scopeRef.current=sport+'|'+date;
 const [now,setNow]=useState(Date.now());
 const [open,setOpen]=useState(false),[snapshot,setSnapshot]=useState(null),[error,setError]=useState(null),[loading,setLoading]=useState(false);
 const [venue,setVenue]=useState('all'),[period,setPeriod]=useState(sport==='cbb'?'1h':'game'),[family,setFamily]=useState('all'),[limit,setLimit]=useState(40);
 const validScope=['nfl','cfb','nba','cbb','nhl'].includes(sport)&&Boolean(date&&id);
 const request=async (force=false,cancelled=()=>false)=>{
  const scope=sport+'|'+date;setLoading(true);setError(null);
  try{const data=await loadSnapshot(sport,date,{force});if(!cancelled()&&scopeRef.current===scope)setSnapshot(old=>{const byEvent=mergeRetainedExchangeQuotes(old?.byEvent||{},data.byEvent||{},Date.now(),data.unavailableMarkets||[]);saveRetainedExchangeQuotes(browserStore(),scope,byEvent);return {...data,byEvent};});}
  catch(e){if(!cancelled()&&scopeRef.current===scope){setError(e.message||'Exchange snapshots unavailable');}}
  finally{if(!cancelled()&&scopeRef.current===scope)setLoading(false);}
 };
 useEffect(()=>{if(!open||!validScope)return;let stopped=false;const scope=sport+'|'+date;const saved=loadRetainedExchangeQuotes(browserStore(),scope);
  setSnapshot(old=>old?.sport===sport&&old?.date===date?{...old,byEvent:mergeRetainedExchangeQuotes(old.byEvent,saved)}:{ok:true,sport,date,referenceOnly:true,canAuthorizeWager:false,byEvent:saved});
  request(false,()=>stopped);return()=>{stopped=true;};},[open,id,sport,date,validScope]);
 useEffect(()=>{if(!open)return;setNow(Date.now());const t=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(t);},[open]);
 const rows=useMemo(()=>exchangeGameMarkets(snapshot,game,{now}),[snapshot,game,now]);
 const selected=rows.filter(r=>(venue==='all'||r.venue===(venue==='poly'?'Polymarket US':'Kalshi'))&&r.period===period&&(family==='all'||r.family===family));
 const venues=venue==='all'?['Kalshi','Polymarket US']:[venue==='poly'?'Polymarket US':'Kalshi'];
 if(!validScope)return null;
 return <details className="event-player-props event-markets fbis-market-explorer"
   onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}
   onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary>EXCHANGE MARKETS <span>Kalshi · Polymarket US · Full game / 1st half</span></summary>
  {open?<div className="event-props-body market-explorer-body">
   <p className="market-explorer-note">Captured exchange quotes only · Not confirmed executable · No automatic bets</p>
   <div className="market-explorer-controls" role="group" aria-label="Exchange filters">
    <div className="market-explorer-pills" aria-label="Provider">
     {[['all','ALL'],['kalshi','KALSHI'],['poly','POLYMARKET US']].map(([value,title])=>
      <button type="button" key={value} className={venue===value?'selected':''} aria-pressed={venue===value} onClick={()=>{setVenue(value);setLimit(40);}}>{title}</button>)}
    </div>
    <div className="market-explorer-pills" aria-label="Period">
     {[['1h','1ST HALF'],['game','FULL GAME']].map(([value,title])=>
      <button type="button" key={value} className={period===value?'selected':''} aria-pressed={period===value} onClick={()=>{setPeriod(value);setLimit(40);}}>{title}</button>)}
    </div>
    <label className="market-explorer-family">Market type
     <select value={family} onChange={e=>{setFamily(e.target.value);setLimit(40);}}>
      <option value="all">All available</option><option value="total">Totals</option>
      <option value="spread">Spreads</option><option value="moneyline">Moneylines</option>
      <option value="team_total">Team totals</option>
     </select></label>
   </div>
   {loading?<p role="status">Reading bounded exchange snapshots…</p>:null}
   {error?<p role="alert">Market feed: {error}. Last fetched references are retained where available.</p>:null}
   {!loading&&!error?<div className="market-explorer-coverage">
    {venues.map(source=><span key={source}><strong>{source}</strong> · {marketCoverageStatus(snapshot,{venue:source==='Polymarket US'?'Polymarket':source,period}).replaceAll('_',' ')}</span>)}
   </div>:null}
   {selected.length?<div className="event-props-table market-explorer-table"><table>
    <thead><tr><th>Exchange / market</th><th>Selection</th><th>Ask cost / raw odds</th><th>Evidence</th></tr></thead>
    <tbody>{selected.slice(0,limit).map(r=><tr key={r.id}>
     <td><strong>{r.venue}</strong><span>{r.familyLabel} · {r.period==='1h'?'1st half':'Full game'}</span><span>{r.transport}</span></td>
     <td><strong>{labelSide(r.side)} {r.line==null?'':r.line}</strong></td>
     <td><strong>{r.cost==null?'Unavailable':r.link?<a href={r.link.url} target="_blank" rel="noopener noreferrer" aria-label={r.link.label}>{Math.round(r.cost*1000)/10}¢ · {formatAmericanFromCost(r.cost)}</a>:<>{Math.round(r.cost*1000)/10}¢ · {formatAmericanFromCost(r.cost)}</>}</strong><span>Saved reference · Not an executable quote</span></td>
     <td><strong className={r.status==='STALE'?'market-explorer-stale':'market-explorer-captured'}>{r.status==='STALE'?'SAVED · STALE':r.status}</strong>
       <span>{r.statusObservedAt?'Status checked '+clock(r.statusObservedAt):'Fetched '+clock(r.receivedAt)} · {r.ageSeconds}s old</span>
       <span>{r.providerTimestampVerified?'Provider quote time '+clock(r.sourceObservedAt):'Provider quote time unknown'}</span>
       {r.marketId?<span title={r.marketId}>Contract {r.marketId.length>42?r.marketId.slice(0,39)+'…':r.marketId}</span>:null}</td>
    </tr>)}</tbody></table></div>:!loading&&!error?<p role="status">No matching captured contracts. This does not prove the exchange does not offer this market.</p>:null}
   {selected.length>limit?<button type="button" className="market-explorer-more" onClick={()=>setLimit(n=>n+40)}>Show more ({selected.length-limit} remaining)</button>:null}
   <div className="market-explorer-footer">
    <span>{selected.length} matching captured offers · {rows.length} for this game · Inventory may be partial</span>
    <button type="button" disabled={loading} onClick={()=>request(true)}>Refresh snapshots</button>
   </div>
   {sport==='cbb'&&period==='1h'?<p className="market-explorer-note">CBB first-half totals require a separate verified Kalshi series capture. The FBIS 1H model is research-only; no approved under is implied.</p>:null}
  </div>:null}
 </details>;
}
