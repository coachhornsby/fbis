import {useState} from 'react';
import TeamLogo from '../TeamLogo.jsx';
import {sharedVenueFetchAge} from '../../lib/sharedVenueFetchAge.js';
import {comparisonPrice,comparisonExtras,syntheticReference} from '../../lib/marketComparisonDisplay.js';
import './marketComparisonGrid.css';
const venues=['Pinnacle','Kalshi','Polymarket'];
const markets=[['moneyline','ML'],['spread','Spread'],['total','Total']];
const name=t=>t?.name||t?.fullName||t?.abbr||'Team';
function Quote({cell,venue,mode,hideAge=false}){
 const c=cell||{price:'—'},derived=syntheticReference(c);
 return <div className={'fbis-compare-quote'+(c.stale?' is-stale':'')} title={c.title} data-market-state={c.state||'missing'}>
  <span className="fbis-compare-price">{c.line!=null&&<span>{c.line}</span>}<strong>{comparisonPrice(c,venue,mode)}</strong></span>
  {(c.statusLabel||derived)&&<small>{[c.statusLabel,derived?'Derived NO':null].filter(Boolean).join(' · ')}</small>}
  {!hideAge&&c.observedLabel&&<small className="fbis-compare-age">{c.observedLabel}</small>}
  {c.link&&<a className="fbis-compare-link" href={c.link.url} target="_blank" rel="noopener noreferrer" aria-label={c.link.label}>↗</a>}
 </div>;
}
export default function MarketComparisonGrid({game,rows,clock}){
 const [market,setMarket]=useState('moneyline'),[mode,setMode]=useState('cents');
 const ages=Object.fromEntries(venues.map(v=>[v,sharedVenueFetchAge(rows.filter(r=>r.venue===v))]));
 const extra=comparisonExtras(game,clock,rows);
 return <section className="fbis-comparison" aria-label="Captured market comparison" data-selected-market={market}>
  <div className="fbis-compare-toolbar">
   <div className="fbis-compare-selector" role="group" aria-label="Market shown on narrow screens">{markets.map(([key,label])=><button key={key} type="button" aria-pressed={market===key} onClick={()=>setMarket(key)}>{label}</button>)}</div>
   <label>Exchange <select aria-label="Exchange price format" value={mode} onChange={e=>setMode(e.target.value)}><option value="cents">Cents</option><option value="american">American odds</option></select></label>
  </div>
  <table className="fbis-compare-table" aria-label="Team market comparison"><thead><tr><th scope="col">Team</th>{markets.map(([key,label])=><th key={key} data-market={key} scope="col">{label}{key==='total'&&<small>Over / Under</small>}</th>)}</tr></thead><tbody>
   {['away','home'].map((side,i)=><tr key={side}><th scope="row"><TeamLogo team={game[side]} size={24} tone="light"/><span>{name(game[side])}</span><small>{side==='away'?'Away':'Home'}</small></th>{markets.map(([family])=><td key={family} data-market={family}><div className="fbis-compare-sources">{venues.map(venue=>{const row=rows.find(r=>r.venue===venue&&r.family===family);return <div key={venue} className={'fbis-compare-source is-'+venue.toLowerCase()}><span className="fbis-compare-source-name">{venue}</span><Quote cell={row?.cells[i]} venue={venue} mode={mode} hideAge={!!ages[venue]}/></div>;})}</div></td>)}</tr>)}
  </tbody></table>
  <div className="fbis-compare-source-ages">{venues.map(v=><span key={v}>{v} · {ages[v]|| (rows.some(r=>r.venue===v&&r.cells.some(c=>c.observedLabel||c.lines?.some(x=>x.observedLabel)))?'Ages by quote':'No captured prices')}</span>)}</div>
  <small className="fbis-compare-disclosure">{mode==='american'?'Exchange odds are converted from captured contract prices; fees excluded.':'Exchange prices in cents; Pinnacle in American odds.'} References only, not executable. Totals are game over/under, not team totals.</small>
  <details className="fbis-compare-more"><summary>More markets{extra.length?' ('+extra.length+')':''}</summary>{extra.length?<div>{extra.slice(0,40).map((row,i)=><section key={i} aria-label={row.venue+' '+row.label}><strong>{row.venue} · {row.alternative?'Alternate ':''}{row.label}</strong><div className="fbis-compare-extra-row">{row.cells.map((cell,j)=><div key={j}><span>{row.family==='total'?(j?'Under':'Over'):name(game[j?'home':'away'])}</span>{cell.lines?cell.lines.map((c,k)=><Quote key={k} cell={c} venue={row.venue} mode={mode}/>):<Quote cell={cell} venue={row.venue} mode={mode}/>}</div>)}</div></section>)}{extra.length>40&&<p>Showing first 40 captured additional markets.</p>}</div>:<p>No additional captured team totals or alternate lines.</p>}</details>
 </section>;
}
