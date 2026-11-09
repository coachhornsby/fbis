import {selectPinnoddsGameMarkets} from './pinnoddsMarketSelection.js';
import {marketDisplayAmerican,signedAmerican} from './marketQuoteDisplay.js';
const age=ms=>ms<60000?Math.floor(ms/1000)+'s ago':ms<3600000?Math.floor(ms/60000)+'m ago':ms<86400000?Math.floor(ms/3600000)+'h ago':Math.floor(ms/86400000)+'d ago';
// Display adapter only. Preserve American book prices, never exchange cents.
export function pinnoddsCardRows(game,clock=Date.now()){
 const research=game?.pinnoddsResearch,at=Date.parse(research?.latestCapturedAt);
 if(!Number.isFinite(clock)||!['cbb','cfb'].includes(game?.sport)||!Number.isFinite(Date.parse(game.start))||['live','final','cancelled','postponed'].includes(game.status)||!research?.offers?.length||!Number.isFinite(at)||at>clock||Date.parse(game.start)<=clock)return [];
 const selection=selectPinnoddsGameMarkets(game),stale=research.stale===true||clock-at>=2700000;
 return ['moneyline','spread','total'].map(family=>({venue:'Pinnacle',family,label:family==='moneyline'?'Moneyline':family==='spread'?'Spread':'Total',cells:(family==='total'?['over','under']:['away','home']).map(side=>{
  const q=selection.families[family]?.quotes.find(q=>q.side===side);
  if(!q)return {line:null,price:'—',title:'No captured PinnOdds '+family+' price',state:'missing'};
  const line=family==='moneyline'?null:family==='total'?(side==='over'?'O ':'U ')+q.line:(q.line>0?'+':'')+q.line;
  return {line,price:signedAmerican(marketDisplayAmerican(q)),stale,state:'observed',statusLabel:stale?'Stale':null,observedAtMs:at,observedLabel:'Fetched '+age(clock-at),title:'Pinnacle via PinnOdds · fetched '+research.latestCapturedAt+' · Provider quote time unknown',link:null,canAuthorizeWager:false,executionEligible:false};
 })}));
}

