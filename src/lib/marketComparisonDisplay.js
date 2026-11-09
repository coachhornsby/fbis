import {exchangeCardRows} from './exchangeCardRows.js';
import {pinnoddsCardRows} from './pinnoddsCardRows.js';
export function comparisonPrice(cell,venue,mode='cents'){
 const price=cell?.price||'—';
 if(venue==='Pinnacle'||mode!=='american'||cell?.state!=='observed')return price;
 if(!/^\d+(?:\.\d+)?¢$/.test(price))return price;
 const p=cell.contractPrice;if(!Number.isFinite(p)||!(p>0&&p<1))return price;
 const n=Math.round(p>=.5?-100*p/(1-p):100*(1-p)/p);return (n>0?'+':'')+n;
}
export const syntheticReference=cell=>cell?.quoteKind==='SYNTHETIC_NO_FROM_YES_BID_REFERENCE'||/Synthetic NO reference/.test(cell?.title||'');
const signature=row=>row.cells.map(c=>c.line??'').join('|');
// Reuse the exact existing event/period/status validators for every extra line.
export function comparisonExtras(game,clock,mainRows){
 const extras=mainRows.filter(r=>r.family==='team_total');
 for(const venue of ['Pinnacle','Kalshi','Polymarket'])for(const family of ['spread','total']){
  const source=venue==='Pinnacle'?game.pinnoddsResearch?.offers||[]:game.exchangeReferenceQuotes||[];
  const filtered=source.filter(q=>(q.marketFamily||'moneyline')===family&&(venue==='Pinnacle'||q.venue===venue)&&Number.isFinite(q.line));
  const thresholds=[...new Set(filtered.map(q=>family==='spread'?Math.abs(q.line):q.line))];
  const chosen=mainRows.find(r=>r.venue===venue&&r.family===family);
  for(const threshold of thresholds){const quotes=filtered.filter(q=>(family==='spread'?Math.abs(q.line):q.line)===threshold);
   const scoped=venue==='Pinnacle'?{...game,market:{...game.market,venueOffers:[]},pinnoddsResearch:{...game.pinnoddsResearch,offers:quotes}}:{...game,exchangeReferenceQuotes:quotes};
   const row=(venue==='Pinnacle'?pinnoddsCardRows(scoped,clock):exchangeCardRows(scoped,clock)).find(r=>r.venue===venue&&r.family===family);
   if(row&&row.cells.some(c=>c.state==='observed')&&(!chosen||signature(row)!==signature(chosen)))extras.push({...row,alternative:true});
  }
 }
 // Team-total scope is explicit; never relabel a game total as a team total.
 for(const team of ['away','home']){
  const offers=(game.pinnoddsResearch?.offers||[]).filter(q=>q.marketFamily==='team_total'&&q.team===team&&['over','under'].includes(q.side)&&Number.isFinite(q.line));
  for(const line of [...new Set(offers.map(q=>q.line))]){
   const scoped={...game,market:{...game.market,venueOffers:[]},pinnoddsResearch:{...game.pinnoddsResearch,offers:offers.filter(q=>q.line===line).map(q=>({...q,marketFamily:'total'}))}};
   const row=pinnoddsCardRows(scoped,clock).find(r=>r.family==='total');
   if(row?.cells.every(c=>c.state==='observed')){const cells=[{price:'—'},{price:'—'}];cells[team==='away'?0:1]={lines:row.cells};extras.push({venue:'Pinnacle',family:'team_total',label:'Team totals',cells});}
  }
 }
 return extras;
}
