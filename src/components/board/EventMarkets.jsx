import {useEffect,useState} from 'react';
import './eventPlayerProps.css';
import {marketDisplayAmerican,marketDisplayImplied,signedAmerican} from '../../lib/marketQuoteDisplay.js';
const price=value=>value==null?'—':Number.isFinite(Number(value))?`${(Number(value)*100).toFixed(1)}%`:'—';
export default function EventMarkets({game}){
 const eventId=String(game?.id||''),sport=String(game?.sport||'').toLowerCase();
 const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[error,setError]=useState(null),[loading,setLoading]=useState(false);
 async function load(next,signal){
  setLoading(true);setError(null);
  try{const response=await fetch(`/api/market-observations?${new URLSearchParams({eventId,sport,cursor:next})}`,{signal});const body=await response.json();if(!response.ok||!body.ok)throw Error(body.error||`HTTP ${response.status}`);
   if(signal?.aborted)return;setRows(previous=>next==='0'?body.rows:[...previous,...body.rows]);setCursor(body.nextCursor);
  }catch(e){if(e.name!=='AbortError')setError(e.message);}finally{if(!signal?.aborted)setLoading(false);}
 }
 useEffect(()=>{if(!open||!eventId)return;const controller=new AbortController();setRows([]);setCursor(null);load('0',controller.signal);return()=>controller.abort();},[open,eventId,sport]);
 if(!eventId)return null;
 return <details className="event-player-props event-markets" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>MARKET DETAILS <span>Books, periods and alternate lines</span></summary>
  {open?<div className="event-props-body"><p>Source prices converted to American equivalents; percentages are raw implied/buy-cost only. Research only · No wager authority</p>
   {rows.length?<div className="event-props-table"><table><thead><tr><th>Source / market</th><th>Selection / line</th><th>Observed price</th><th>Evidence</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}>
    <td><strong>{row.source}</strong><span>{String(row.statFamily||row.marketFamily||'Uninterpreted market').replaceAll('_',' ')} · {row.period||'unspecified'}</span>{row.playerName?<span>{row.playerName}</span>:null}</td>
    <td>{row.side||'Unspecified'}<span>{row.line??'—'}</span></td>
    <td>{marketDisplayAmerican(row)==null?'No quoted price':`${signedAmerican(marketDisplayAmerican(row))}${marketDisplayImplied(row)==null?'':` · ${price(marketDisplayImplied(row))}`}`}{row.decimalOdds!=null?<span>{Number(row.decimalOdds).toFixed(3)} decimal</span>:null}<span>{row.quoteKind}</span></td>
    <td>{row.temporal?.status||'SOURCE_TIME_UNKNOWN'}<span>Provider {row.providerObservedAt||'unknown'}</span><span>Collected {row.collectedAt||'unknown'}</span><span>RESEARCH / NOT QUALIFIED</span></td>
   </tr>)}</tbody></table></div>:!loading&&!error?<p>No captured source contracts for this event.</p>:null}
   {loading?<p role="status">Loading markets…</p>:null}{error?<p role="alert">{error}</p>:null}
   {cursor&&!loading?<button type="button" onClick={()=>load(cursor)}>Load more markets</button>:null}
   <p>{rows.length} contracts shown{cursor?' · More available':''}</p>
  </div>:null}
 </details>;
}
