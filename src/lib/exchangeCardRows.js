import {validatePolymarketEventNavigation} from './polymarketEventNavigation.js';
import {exchangeMarketLink} from './exchangeMarketLinks.js';
import {exchangeMarketState,exchangeObservationTime} from './retainedExchangeQuotes.js';
const venues=['Kalshi','Polymarket'];
const families=['moneyline','spread','total','team_total'];
const labels={moneyline:'Moneyline',spread:'Spread',total:'Total',team_total:'Team totals'};
const validSides={moneyline:['away','home'],spread:['away','home'],total:['over','under'],
 team_total:['away_over','away_under','home_over','home_under']};
const validLine=x=>typeof x==='number'&&Number.isFinite(x);
const cents=x=>(x*100).toFixed(1)+'¢';
const timestamp=exchangeObservationTime;
const ageText=ms=>ms<60000?Math.floor(ms/1000)+'s ago':ms<3600000?Math.floor(ms/60000)+'m ago':ms<86400000?Math.floor(ms/3600000)+'h ago':Math.floor(ms/86400000)+'d ago';
const details=(q,clock)=>{
 const at=timestamp(q),state=exchangeMarketState(q),stale=q.stale===true||q.fresh===false||clock-Date.parse(q.receivedAt)>(q.transport==='WebSocket'?120000:900000);
 const source=Date.parse(q.sourceObservedAt||q.quoteSourceTime||'');
 const sourceTime=Number.isFinite(source)?'Provider quote time '+new Date(source).toISOString():'Provider quote time unknown';
 const statusLabel=state==='closed'?'Market closed':state==='unavailable'?'Quote unavailable':stale?'Stale':null;
 const link=state==='observed'?exchangeMarketLink({source:q.venue==='Kalshi'?'Kalshi':'Polymarket US WebSocket',sourceMarketId:q.marketId,eventTicker:q.eventTicker,marketUrl:q.marketUrl,eventNavigation:q.eventNavigation}):null;
 return {stale,state,statusLabel,link,observedLabel:(state==='observed'?'Fetched ':'Status checked ')+ageText(clock-at),
  title:(q.transport||'Capture')+' · '+(statusLabel||'Captured price')+' · fetched '+q.receivedAt+' · '+sourceTime,
  canAuthorizeWager:false,executionEligible:false};
};
const cell=(q,line,clock)=>{const d=details(q,clock);return {line,price:d.state==='observed'?cents(q.ask):'Unavailable',...d};};
const missing=family=>({line:null,price:'—',title:'No matched '+family+' observation'});
const thresholdKey=(q,family)=>family==='spread'?String(Math.abs(q.line)):String(q.line);
function chooseThreshold(offers,family,sides){
 const groups=new Map();
 for(const q of offers){const key=thresholdKey(q,family);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(q);
 }
 return [...groups.values()].sort((a,b)=>{
  const count=q=>new Set(q.map(x=>x.side).filter(side=>sides.includes(side))).size;
  const recency=Math.max(...b.map(timestamp))-Math.max(...a.map(timestamp));
  if(recency)return recency;
  const completeness=count(b)-count(a);
  if(completeness)return completeness;
  const close=q=>Math.min(...q.map(x=>Math.abs(x.ask-.5)));
  const proximity=close(a)-close(b);
  if(proximity)return proximity;
  return Math.max(...b.map(timestamp))-Math.max(...a.map(timestamp));
 })[0]||[];
}
function teamTotalCell(offers,side,clock){
 const same=offers.filter(q=>q.side.startsWith(side+'_'));
 const selected=chooseThreshold(same,'team_total',[side+'_over',side+'_under']);
 const lines=['over','under'].map(direction=>{
  const quote=selected.find(q=>q.side===side+'_'+direction);
  return quote?cell(quote,(direction==='over'?'O ':'U ')+quote.line,clock):null;
 }).filter(Boolean);
 return lines.length?{line:null,price:null,lines,title:lines.map(x=>x.title).join(' / ')}:
  missing('team total');
}
// Prices remain research references, not executable fills. A card must never
// combine incompatible thresholds or non-matching event start times.
export function exchangeCardRows(game,clock=Date.now()){
 const quotes=(game.exchangeReferenceQuotes||[]).filter(q=>{
  const family=q?.marketFamily||'moneyline',stamp=timestamp(q);
  return q&&venues.includes(q.venue)&&families.includes(family)&&
   (!q.period||q.period==='game'||q.period==='full_game')&&
   validSides[family].includes(q.side)&&
   (family==='moneyline'||validLine(q.line))&&
   (exchangeMarketState(q)!=='observed'||q.ask>0&&q.ask<1&&typeof q.ask==='number')&&
   Number.isFinite(stamp)&&clock>=stamp&&
   Math.abs(Date.parse(q.eventStart)-Date.parse(game.start))<=60000;
 }).map(q=>({...q,eventNavigation:validatePolymarketEventNavigation(q.eventNavigation,{sport:game.sport,canonicalEventId:String(game.id),eventStart:game.start})})).sort((a,b)=>timestamp(b)-timestamp(a));
 return venues.flatMap(venue=>families.map(family=>{
  const offers=quotes.filter(q=>q.venue===venue&&(q.marketFamily||'moneyline')===family);
  if(family==='team_total')return {venue,family,label:labels[family],
    cells:['away','home'].map(side=>teamTotalCell(offers,side,clock))};
  if(family==='moneyline')return {venue,family,label:labels[family],
    cells:['away','home'].map(side=>{
     const q=offers.find(x=>x.side===side);
     return q?cell(q,null,clock):missing(family);
    })};
  const sides=family==='total'?['over','under']:['away','home'];
  const selected=chooseThreshold(offers,family,sides);
  const pivot=selected[0];
  const awayLine=pivot&&family==='spread'?(pivot.side==='away'?pivot.line:-pivot.line):null;
  const cells=sides.map(side=>{
   const q=selected.find(x=>x.side===side&&(family==='total'||x.line===(side==='away'?awayLine:-awayLine)));
   return q?cell(q,family==='total'?(side==='over'?'O ':'U ')+q.line:(q.line>0?'+':'')+q.line,clock):missing(family);
  });
  return {venue,family,label:labels[family],cells};
 }));
}
