import {exchangePriceLabel} from '../../lib/exchangePriceLabel.js';
import { useEffect, useState } from 'react';
import { joinIndependentPropModels } from '../../../functions/lib/propResearchData.js';
import ExchangeQuoteLink from './ExchangeQuoteLink.jsx';
import './eventPlayerProps.css';

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const decimal = value => {const n=number(value);return n!=null&&n>1?`${n.toFixed(3)} dec`:'—';};
const odds = value => { const n=number(value); return n == null ? '—' : `${n > 0 ? '+' : ''}${n}`; };

/** Event-bound observed prices. A missing forecast never becomes a market-derived model. */
export default function EventPlayerProps({game}) {
  const eventId=String(game?.id || ''),sport=String(game?.sport || '').toLowerCase();
  const [expanded,setExpanded]=useState(true),[result,setResult]=useState(null),[error,setError]=useState(null);
  useEffect(()=>{
    if(!expanded || !eventId || sport==='tennis')return;
    const controller=new AbortController();
    setResult(null);setError(null);
    if(['nba','nfl','nhl','mlb','cfb','cbb'].includes(sport) && game?.start){
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(game.start));
      const q=new URLSearchParams({sport,date});
      const read=async url=>{
        const response=await fetch(url,{signal:controller.signal});
        const body=await response.json();
        if(!response.ok||!body.ok)throw Error(body.error||`HTTP ${response.status}`);
        return body;
      };
      Promise.all([read(`/api/exchange-player-props?${q}`),read(`/api/prop-projections?${q}`)])
        .then(([contracts,forecast])=>{
          if(controller.signal.aborted)return;
          const source=(contracts.rows||[]).filter(r=>String(r.canonicalEventId)===eventId&&
            r.identityVerified===true&&r.line!=null&&['Kalshi','Polymarket'].includes(r.provider));
          const models=(forecast.rows||[]).filter(r=>String(r.canonicalEventId)===eventId&&r.independent===true);
          const joined=joinIndependentPropModels(source,models).filter(r=>r.contractId);
          // Group only within one provider, athlete, stat, period and threshold.
          // Kalshi and Polymarket settlement rules differ; do not merge prices.
          const grouped=new Map();
          for(const r of joined){
            const key=[r.provider,r.contractId,r.canonicalPlayerId,r.canonical_market,r.period,r.line].join('|');
            const row=grouped.get(key)||{exchangeReference:true,sport,fbisEventId:eventId,
              playerName:r.player_name,marketCanonical:r.canonical_market,period:r.period,
              line:r.line,book:r.provider,source:r.source||r.provider,
              sourceMarketId:r.contractId,providerEventId:r.providerEventId||null,providerEventSlug:r.providerEventSlug||null,
              marketUrl:r.marketUrl||null,fbisProjection:r.fbis_projection,
              collectedAt:r.collectedAt,sourceObservedAt:r.observedAt||null,
              quoteKind:'CAPTURED_REFERENCE_NOT_EXECUTABLE',quotes:{}};
            const price=Number(r.observedAsk??r.observedReferencePrice);
            if(['yes','no','over','under'].includes(String(r.side)) &&
              (r.observedAsk!=null||r.observedReferencePrice!=null) &&
              Number.isFinite(price)&&price>0&&price<1){
              row.quotes[r.side]=price;
            }
            if(row.fbisProjection==null&&r.fbis_projection!=null)row.fbisProjection=r.fbis_projection;
            grouped.set(key,row);
          }
          const groupedRows=[...grouped.values()].sort((a,b)=>
            Number(b.fbisProjection!=null)-Number(a.fbisProjection!=null)||
            String(a.playerName).localeCompare(String(b.playerName))||
            String(a.marketCanonical).localeCompare(String(b.marketCanonical)));
          setResult({exchangeReference:true,rows:groupedRows.slice(0,120),totalMatched:groupedRows.length,
            diagnostics:{sourceStatus:[{source:'Kalshi / Polymarket',state:'CAPTURED_RESEARCH_REFERENCE',reason:'No verified execution quote inferred'}]}});
        })
        .catch(err=>{if(!controller.signal.aborted)setError(err.message);});
      return ()=>controller.abort();
    }
    fetch(`/api/player-props?${new URLSearchParams({eventIds:eventId,sport})}`,{signal:controller.signal})
      .then(async response=>{const body=await response.json();if(!response.ok||!body.ok)throw Error(body.error||`HTTP ${response.status}`);return body;})
      .then(body=>setResult({...body,rows:(body.rows||[]).filter(row=>String(row.fbisEventId)===eventId&&row.sport===sport)}))
      .catch(err=>{if(err.name!=='AbortError')setError(err.message);});
    return()=>controller.abort();
  },[expanded,eventId,sport,game?.start]);
  if(!eventId||sport==='tennis')return null;
  return <details defaultOpen className="event-player-props" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary>PLAYER PROPS <span>{result ? `${result.totalMatched??result.rows.length} captured markets` : 'View sources and markets'}</span></summary>
    {expanded ? <div className="event-props-body">
      <p>{result?.exchangeReference?'Kalshi / Polymarket player thresholds · captured prices, not verified live purchase quotes':'Observed market prices'}</p>
      {error ? <p role="alert">Prop source unavailable: {error}</p> : !result ? <p role="status">Loading event markets…</p> : <>
        {result.rows.length ? <div className="event-props-table"><table>
          <thead><tr><th>Player / market</th><th>Book / line</th><th>Over / Under</th><th>FBIS</th><th>Evidence</th></tr></thead>
          <tbody>{result.rows.map((row,i)=>{
            const projection=row.exchangeReference?number(row.fbisProjection):row.eligibleForCard===true&&row.modelSource&&row.modelVersion&&row.temporal?.currentDisplayEligible ? number(row.fbisProjection) : null;
            const line=number(row.line),gap=projection!=null&&line!=null?Math.round((projection-line)*10)/10:null;
            return <tr key={[row.provider,row.providerPlayerId,row.marketCanonical,row.period,row.line,row.book,i].join('|')}>
              <td><strong>{row.playerName||row.providerPlayerId||'Unidentified player'}</strong><span>{String(row.marketCanonical||row.market||'Unknown market').replaceAll('_',' ')} · {row.period||'event'}</span></td>
              <td>{row.book||row.provider||'Unknown source'}<span>{line??'—'}</span></td>
              <td><ExchangeQuoteLink offer={row} value={row.exchangeReference?
                exchangePriceLabel(row.quotes):
                row.decimalPrice!=null?`${row.side||'Observed'} ${decimal(row.decimalPrice)}`:`${row.overOdds!=null?odds(row.overOdds):decimal(row.overDecimalOdds)} / ${row.underOdds!=null?odds(row.underOdds):decimal(row.underDecimalOdds)}`}/></td>
              <td>{projection??'No comparable projection'}{gap!=null?<span>Difference {gap>0?'+':''}{gap}</span>:null}</td>
              <td>{row.exchangeReference?'SOURCE_TIME_UNKNOWN · CAPTURED REFERENCE':row.temporal?.status||'SOURCE_TIME_UNKNOWN'}<span>Collected {row.collectedAt||'unknown'}</span><span>{row.providerTimeConfidence==='MIRROR_REPORTED_CAPTURE'?'Mirror capture':'Provider time'} {row.sourceObservedAt||'unknown'}</span>{row.quoteKind==='DAILY_MIRROR_REFERENCE_NOT_LIVE_VERIFIED'?<span>Daily snapshot · Not live verified</span>:null}</td>
            </tr>;
          })}</tbody>
        </table></div> : <p>{result.diagnostics?.absenceReason||'NO_OBSERVED_PROPS_FOR_EVENTS'}</p>}
        {result.exchangeReference&&result.totalMatched>result.rows.length?<p>{result.rows.length} of {result.totalMatched} matching captured thresholds shown.</p>:null}
        {(result.diagnostics?.sourceStatus||[]).map(source=><p key={source.source}>{source.source}: {source.state} {source.reason ? `· ${source.reason}` : ''}</p>)}
        {result.diagnostics?.prizePicksError?<p>PrizePicks read failed: {result.diagnostics.prizePicksError}</p>:null}
      </>}
    </div>:null}
  </details>;
}
