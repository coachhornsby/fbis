const venues=['Kalshi','Polymarket'];
const families=['moneyline','spread','total','team_total'];
const labels={moneyline:'Moneyline',spread:'Spread',total:'Total',team_total:'Team totals'};
const validSides={moneyline:['away','home'],spread:['away','home'],total:['over','under'],
 team_total:['away_over','away_under','home_over','home_under']};
const validLine=x=>typeof x==='number'&&Number.isFinite(x);
const cents=x=>(x*100).toFixed(1)+'¢';
const timestamp=q=>Date.parse(q.receivedAt);
const priceTitle=q=>q.transport+' · '+new Date(q.receivedAt).toLocaleTimeString('en-US',
 {timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})+' CT · observed ask';
const missing=family=>({line:null,price:'—',title:'No current matched '+family+' offer'});
const thresholdKey=(q,family)=>family==='spread'?String(Math.abs(q.line)):String(q.line);
function chooseThreshold(offers,family,sides){
 const groups=new Map();
 for(const q of offers){const key=thresholdKey(q,family);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(q);
 }
 return [...groups.values()].sort((a,b)=>{
  const count=q=>new Set(q.map(x=>x.side).filter(side=>sides.includes(side))).size;
  const completeness=count(b)-count(a);
  if(completeness)return completeness;
  const close=q=>Math.min(...q.map(x=>Math.abs(x.ask-.5)));
  const proximity=close(a)-close(b);
  if(proximity)return proximity;
  return Math.max(...b.map(timestamp))-Math.max(...a.map(timestamp));
 })[0]||[];
}
function teamTotalCell(offers,side){
 const same=offers.filter(q=>q.side.startsWith(side+'_'));
 const selected=chooseThreshold(same,'team_total',[side+'_over',side+'_under']);
 const lines=['over','under'].map(direction=>{
  const quote=selected.find(q=>q.side===side+'_'+direction);
  return quote?{line:(direction==='over'?'O ':'U ')+quote.line,
   price:cents(quote.ask),title:priceTitle(quote)}:null;
 }).filter(Boolean);
 return lines.length?{line:null,price:null,lines,title:lines.map(x=>x.title).join(' / ')}:
  missing('team total');
}
// Prices remain research references, not executable fills. A card must never
// combine incompatible thresholds or non-matching event start times.
export function exchangeCardRows(game,clock=Date.now()){
 const quotes=(game.exchangeReferenceQuotes||[]).filter(q=>{
  const family=q.marketFamily||'moneyline',stamp=timestamp(q);
  return venues.includes(q.venue)&&families.includes(family)&&
   validSides[family].includes(q.side)&&
   (family==='moneyline'||validLine(q.line))&&
   q.ask>0&&q.ask<1&&typeof q.ask==='number'&&
   Number.isFinite(stamp)&&clock>=stamp&&
   clock-stamp<=(q.transport==='WebSocket'?120000:900000)&&
   Math.abs(Date.parse(q.eventStart)-Date.parse(game.start))<=60000;
 }).sort((a,b)=>timestamp(b)-timestamp(a));
 return venues.flatMap(venue=>families.map(family=>{
  const offers=quotes.filter(q=>q.venue===venue&&(q.marketFamily||'moneyline')===family);
  if(family==='team_total')return {venue,family,label:labels[family],
    cells:['away','home'].map(side=>teamTotalCell(offers,side))};
  if(family==='moneyline')return {venue,family,label:labels[family],
    cells:['away','home'].map(side=>{
     const q=offers.find(x=>x.side===side);
     return q?{line:null,price:cents(q.ask),title:priceTitle(q)}:missing(family);
    })};
  const sides=family==='total'?['over','under']:['away','home'];
  const selected=chooseThreshold(offers,family,sides);
  const pivot=selected[0];
  const awayLine=pivot&&family==='spread'?(pivot.side==='away'?pivot.line:-pivot.line):null;
  const cells=sides.map(side=>{
   const q=selected.find(x=>x.side===side&&(family==='total'||x.line===(side==='away'?awayLine:-awayLine)));
   return q?{line:family==='total'?(side==='over'?'O ':'U ')+q.line:(q.line>0?'+':'')+q.line,
    price:cents(q.ask),title:priceTitle(q)}:missing(family);
  });
  return {venue,family,label:labels[family],cells};
 }));
}
