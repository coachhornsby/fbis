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

const observed=c=>c?.state==='observed'&&c.price&&c.price!=='—'&&c.price!=='Unavailable';
const numericLine=c=>typeof c?.line==='string'?Number(c.line.replace(/^[OU]\s+/,'')):NaN;
function referenceLine(row,family){
 if(!row||!Array.isArray(row.cells)||row.cells.length!==2||!row.cells.every(observed))return null;
 const a=numericLine(row.cells[0]),b=numericLine(row.cells[1]);
 return Number.isFinite(a)&&Number.isFinite(b)&&(family==='spread'?a===-b:a===b)?a:null;
}
// A new alternate quote is not evidence that the book's main line moved.
// Align only identical thresholds and spread orientation across the main grid.
export function alignedComparisonRows(game,clock,rows){
 const result=rows.filter(r=>!['spread','total'].includes(r.family));
 for(const family of ['spread','total']){
  const pin=rows.find(r=>r.venue==='Pinnacle'&&r.family===family);
  let target=referenceLine(pin,family);
  if(pin)result.push(pin);
  if(target==null&&!pin?.cells.some(observed)){
   const candidates=new Map();
   for(const venue of ['Kalshi','Polymarket']){
    const quotes=(game.exchangeReferenceQuotes||[]).filter(q=>q.venue===venue&&q.marketFamily===family&&Number.isFinite(q.line));
    const targets=[...new Set(quotes.map(q=>family==='spread'?(q.side==='away'?q.line:-q.line):q.line))];
    for(const value of targets){
     const scoped=quotes.filter(q=>q.line===(family==='spread'&&q.side==='home'?-value:value));
     const row=exchangeCardRows({...game,exchangeReferenceQuotes:scoped},clock).find(r=>r.venue===venue&&r.family===family);
     if(referenceLine(row,family)==null)continue;
     const balance=row.cells.reduce((n,c)=>n+Math.abs(c.contractPrice-.5),0);
     if(!Number.isFinite(balance))continue;
     const old=candidates.get(value)||{value,venues:0,balance:0};old.venues++;old.balance+=balance;candidates.set(value,old);
    }
   }
   const selected=[...candidates.values()].sort((a,b)=>a.balance/a.venues-b.balance/b.venues||b.venues-a.venues||Math.abs(a.value)-Math.abs(b.value))[0];
   target=selected?.value??null;
  }
  for(const venue of ['Kalshi','Polymarket']){
   const quotes=target==null?[]:(game.exchangeReferenceQuotes||[]).filter(q=>q.venue===venue&&q.marketFamily===family&&q.line===(family==='spread'&&q.side==='home'?-target:target));
   const row=exchangeCardRows({...game,exchangeReferenceQuotes:quotes},clock).find(r=>r.venue===venue&&r.family===family);
   if(row)result.push({...row,comparisonThreshold:target,providerMainVerified:false});
  }
 }
 return result;
}
