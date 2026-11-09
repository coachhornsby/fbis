import {useState} from 'react';
import TeamLogo from '../TeamLogo.jsx';
import {teamRecordDisplay} from '../../lib/teamRecordDisplay.js';
import {sharedVenueFetchAge} from '../../lib/sharedVenueFetchAge.js';
import {comparisonPrice,comparisonExtras,syntheticReference,alignedComparisonRows} from '../../lib/marketComparisonDisplay.js';
import './marketComparisonGrid.css';
const venues=['Pinnacle','Kalshi','Polymarket'];
const logos={Pinnacle:'/brands/pinnacle-wordmark-transparent.svg',Kalshi:'/brands/kalshi-watermark.png',Polymarket:'/brands/polymarket-watermark.png'};
const markets=[['moneyline','ML'],['spread','Spread'],['total','Total']];
const available=c=>c?.state==='observed'&&c.price&&c.price!=='—'&&c.price!=='Unavailable';
const name=t=>t?.name||t?.fullName||t?.abbr||'Team';
function Quote({cell,venue,mode,hideAge=false}){
 if(!available(cell))return null;
 const c=cell,derived=syntheticReference(c);
 return <div className={'fbis-compare-quote'+(c.stale?' is-stale':'')} title={c.title} data-market-state={c.state||'missing'}>
  <span className="fbis-compare-price">{c.line!=null&&<span>{c.line}</span>}<strong>{comparisonPrice(c,venue,mode)}</strong></span>
  {(c.statusLabel||derived)&&<small>{[c.statusLabel,derived?'Derived NO':null].filter(Boolean).join(' · ')}</small>}
  {!hideAge&&c.observedLabel&&<small className="fbis-compare-age">{c.observedLabel}</small>}
  {c.link&&<a className="fbis-compare-link" href={c.link.url} target="_blank" rel="noopener noreferrer" aria-label={c.link.label}>↗</a>}
 </div>;
}
export default function MarketComparisonGrid({game,rows:inputRows,clock}){
 const rows=alignedComparisonRows(game,clock,inputRows);
 const [market,setMarket]=useState('moneyline'),[mode,setMode]=useState('cents');
 const shownVenues=venues.filter(v=>rows.some(r=>r.venue===v&&['moneyline','spread','total'].includes(r.family)&&r.cells.some(available)));
 const ages=Object.fromEntries(venues.map(v=>[v,sharedVenueFetchAge(rows.filter(r=>r.venue===v))]));
 const extra=comparisonExtras(game,clock,rows);
 return <section className="fbis-comparison" aria-label="Captured market comparison" data-selected-market={market}>
  <div className="fbis-compare-toolbar">
   <div className="fbis-compare-selector" role="group" aria-label="Market shown on narrow screens">{markets.map(([key,label])=><button key={key} type="button" aria-pressed={market===key} onClick={()=>setMarket(key)}>{label}</button>)}</div>
   <label>Exchange <select aria-label="Exchange price format" value={mode} onChange={e=>setMode(e.target.value)}><option value="cents">Cents</option><option value="american">American odds</option></select></label>
  </div>
  <table className="fbis-compare-table" aria-label="Team market comparison"><thead><tr><th scope="col">Team</th>{markets.map(([key,label])=><th key={key} data-market={key} scope="col">{label}{key==='total'&&<small>Over / Under</small>}</th>)}</tr></thead><tbody>
   {['away','home'].map((side,i)=><tr key={side}><th scope="row" className="fbis-compare-team" aria-label={name(game[side])+' · '+side}><TeamLogo team={game[side]} size={68} tone="light" title={name(game[side])}/>{teamRecordDisplay(game[side],clock).map(r=><small key={r.label} title={r.title}>{r.label} {r.text}</small>)}</th>{markets.map(([family])=><td key={family} data-market={family}><div className="fbis-compare-sources" style={{'--source-count':Math.max(1,shownVenues.length)}}>{shownVenues.map(venue=>{const row=rows.find(r=>r.venue===venue&&r.family===family);if(!available(row?.cells[i]))return <div key={venue} className="fbis-compare-empty-slot" aria-hidden="true"/>;return <div key={venue} role="group" aria-label={venue+' captured price'} className={'fbis-compare-source is-'+venue.toLowerCase()}><span className="fbis-mini-sr-only">{venue}</span><Quote cell={row?.cells[i]} venue={venue} mode={mode} hideAge={!!ages[venue]}/></div>;})}</div></td>)}</tr>)}
  </tbody></table>
  <div className="fbis-compare-source-ages">{shownVenues.filter(v=>ages[v]).map(v=><span key={v} className="fbis-compare-age-source" aria-label={v+' · '+ages[v]}><img src={logos[v]} alt=""/>{ages[v]}</span>)}</div>
  <small className="fbis-compare-disclosure">{mode==='american'?'Exchange odds are converted from captured contract prices; fees excluded.':'Exchange prices in cents; Pinnacle in American odds.'} References only, not executable. Game O/U only. Equal thresholds are aligned; fees and settlement may differ. Other lines are in More markets; provider main-line status is unverified.</small>
  {extra.length>0&&<details className="fbis-compare-more"><summary>More markets{extra.length?' ('+extra.length+')':''}</summary>{extra.length?<div className="fbis-compare-more-list" role="region" aria-label="Additional captured markets" tabIndex={0}>{extra.slice(0,40).map((row,i)=><section key={i} aria-label={row.venue+' '+row.label}><strong><img className="fbis-compare-extra-logo" src={logos[row.venue]} alt=""/>{row.alternative?'Other captured ':''}{row.label}</strong><div className="fbis-compare-extra-row">{row.cells.map((cell,j)=><div key={j}><span>{row.family==='total'?(j?'Under':'Over'):name(game[j?'home':'away'])}</span>{cell.lines?cell.lines.map((c,k)=><Quote key={k} cell={c} venue={row.venue} mode={mode}/>):<Quote cell={cell} venue={row.venue} mode={mode}/>}</div>)}</div></section>)}{extra.length>40&&<p>Showing first 40 captured additional markets.</p>}</div>:<p>No additional captured team totals or alternate lines.</p>}</details>}
 </section>;
}
