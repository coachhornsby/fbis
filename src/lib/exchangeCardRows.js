const venues=['Kalshi','Polymarket'];
const families=['moneyline','spread','total'];
// Preserve source line and side. Never pair offers from different thresholds.
export function exchangeCardRows(game,clock=Date.now()){
 const quotes=(game.exchangeReferenceQuotes||[]).filter(q=>{
  const family=q.marketFamily||'moneyline',stamp=Date.parse(q.receivedAt);
  return venues.includes(q.venue)&&families.includes(family)&&
   (family==='total'?['over','under']:['away','home']).includes(q.side)&&
   (family==='moneyline'||typeof q.line==='number'&&Number.isFinite(q.line))&&
   q.ask>0&&q.ask<1&&Number.isFinite(stamp)&&clock>=stamp&&
   clock-stamp<=(q.transport==='WebSocket'?120000:900000)&&
   Math.abs(Date.parse(q.eventStart)-Date.parse(game.start))<=60000;
 }).sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt));
 return venues.flatMap(venue=>families.map(family=>{
  const offers=quotes.filter(q=>q.venue===venue&&(q.marketFamily||'moneyline')===family);
  const anchor=offers[0];
  const line=anchor?(family==='spread'?(anchor.side==='away'?anchor.line:-anchor.line):anchor.line):null;
  const sides=family==='total'?['over','under']:['away','home'];
  return {venue,family,label:{moneyline:'Moneyline',spread:'Spread',total:'Total'}[family],cells:sides.map(side=>{
   const q=offers.find(q=>q.side===side&&(family==='moneyline'||q.line===(family==='spread'&&side==='home'?-line:line)));
   return q?{line:family==='moneyline'?null:family==='total'?(side==='over'?'O ':'U ')+q.line:(q.line>0?'+':'')+q.line,price:(q.ask*100).toFixed(1)+'¢',title:q.transport+' · '+new Date(q.receivedAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})+' CT · observed ask'}:
    {line:null,price:'—',title:'No current matched '+family+' offer'};
  })};
 }));
}
