import { useEffect, useState } from 'react';
import './eventPlayerProps.css';

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const decimal = value => {const n=number(value);return n!=null&&n>1?`${n.toFixed(3)} dec`:'—';};
const odds = value => { const n=number(value); return n == null ? '—' : `${n > 0 ? '+' : ''}${n}`; };

/** Event-bound observed prices. A missing forecast never becomes a market-derived model. */
export default function EventPlayerProps({game}) {
  const eventId=String(game?.id || ''),sport=String(game?.sport || '').toLowerCase();
  const [expanded,setExpanded]=useState(false),[result,setResult]=useState(null),[error,setError]=useState(null);
  useEffect(()=>{
    if(!expanded || !eventId || sport==='tennis')return;
    const controller=new AbortController();
    setResult(null);setError(null);
    fetch(`/api/player-props?${new URLSearchParams({eventIds:eventId,sport})}`,{signal:controller.signal})
      .then(async response=>{const body=await response.json();if(!response.ok||!body.ok)throw Error(body.error||`HTTP ${response.status}`);return body;})
      .then(body=>setResult({...body,rows:(body.rows||[]).filter(row=>String(row.fbisEventId)===eventId&&row.sport===sport)}))
      .catch(err=>{if(err.name!=='AbortError')setError(err.message);});
    return()=>controller.abort();
  },[expanded,eventId,sport]);
  if(!eventId||sport==='tennis')return null;
  return <details className="event-player-props" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary>PLAYER PROPS <span>{result ? `${result.rows.length} observed markets` : 'View sources and markets'}</span></summary>
    {expanded ? <div className="event-props-body">
      <p>Observed market prices · Research only · No wager authority</p>
      {error ? <p role="alert">Prop source unavailable: {error}</p> : !result ? <p role="status">Loading event markets…</p> : <>
        {result.rows.length ? <div className="event-props-table"><table>
          <thead><tr><th>Player / market</th><th>Book / line</th><th>Over / Under</th><th>FBIS</th><th>Evidence</th></tr></thead>
          <tbody>{result.rows.map((row,i)=>{
            const projection=row.eligibleForCard===true&&row.modelSource&&row.modelVersion&&row.temporal?.currentDisplayEligible ? number(row.fbisProjection) : null;
            const line=number(row.line),gap=projection!=null&&line!=null?Math.round((projection-line)*10)/10:null;
            return <tr key={[row.provider,row.providerPlayerId,row.marketCanonical,row.period,row.line,row.book,i].join('|')}>
              <td><strong>{row.playerName||row.providerPlayerId||'Unidentified player'}</strong><span>{String(row.marketCanonical||row.market||'Unknown market').replaceAll('_',' ')} · {row.period||'event'}</span></td>
              <td>{row.book||row.provider||'Unknown source'}<span>{line??'—'}</span></td>
              <td>{row.decimalPrice!=null?`${row.side||'Observed'} ${decimal(row.decimalPrice)}`:`${row.overOdds!=null?odds(row.overOdds):decimal(row.overDecimalOdds)} / ${row.underOdds!=null?odds(row.underOdds):decimal(row.underDecimalOdds)}`}</td>
              <td>{projection??'No comparable projection'}{gap!=null?<span>Difference {gap>0?'+':''}{gap}</span>:null}</td>
              <td>{row.temporal?.status||'SOURCE_TIME_UNKNOWN'}<span>Collected {row.collectedAt||'unknown'}</span><span>{row.providerTimeConfidence==='MIRROR_REPORTED_CAPTURE'?'Mirror capture':'Provider time'} {row.sourceObservedAt||'unknown'}</span>{row.quoteKind==='DAILY_MIRROR_REFERENCE_NOT_LIVE_VERIFIED'?<span>Daily snapshot · Not live verified</span>:null}<span>RESEARCH / NOT QUALIFIED</span></td>
            </tr>;
          })}</tbody>
        </table></div> : <p>{result.diagnostics?.absenceReason||'NO_OBSERVED_PROPS_FOR_EVENTS'}</p>}
        {(result.diagnostics?.sourceStatus||[]).map(source=><p key={source.source}>{source.source}: {source.state} {source.reason ? `· ${source.reason}` : ''}</p>)}
        {result.diagnostics?.prizePicksError?<p>PrizePicks read failed: {result.diagnostics.prizePicksError}</p>:null}
      </>}
    </div>:null}
  </details>;
}
