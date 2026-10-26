import {exchangeMarketLink,exchangeLinksForGame} from '../../lib/exchangeMarketLinks.js';
import './nbaBookEventButtons.css';

const books=[
 {key:'Pinnacle',label:'PINNACLE'},
 {key:'Kalshi',label:'KALSHI'},
 {key:'Polymarket',label:'POLYMARKET'},
];
/** Match source-backed links only; a sport homepage is never an event destination. */
export function nbaBookEventDestinations(game={}){
 const prices=[...(game?.pinnoddsResearch?.offers||[]),
  ...(game?.market?.venueOffers||[]),
  ...(game?.market?.reference?.venueOffers||[])];
 const exchange=exchangeLinksForGame(game);
 return books.map(book=>{
  let links=[];
  if(book.key==='Pinnacle'){
   links=prices.filter(o=>/^pinn(odds|acle)$/i.test(String(o.source||o.provider||'')))
    .map(o=>exchangeMarketLink(o)).filter(Boolean);
  }else{
   links=exchange.filter(x=>book.key==='Kalshi'?x.provider==='Kalshi':
    x.provider==='Polymarket US'||x.provider==='Polymarket Global');
  }
  const first=links.find(l=>l.scope==='MARKET')||links.find(l=>l.scope==='EVENT')||null;
  return {...book,url:first?.url||null,scope:first?.scope||null,
   available:!!first,linkedMarkets:links.length};
 });
}
export default function NbaBookEventButtons({game,compact=false}){
 if(String(game?.sport||'').toLowerCase()!=='nba')return null;
 const destinations=nbaBookEventDestinations(game);
 return <nav className={'nba-book-event-nav'+(compact?' is-compact':'')}
  aria-label="NBA event links by sportsbook" onClick={e=>e.stopPropagation()}>
  <div className="nba-book-event-heading"><strong>OPEN THIS GAME</strong>
   <span>Verified event destinations · prices may change</span></div>
  <div className="nba-book-event-actions">
   {destinations.map(book=>book.available?
     <a key={book.key} className={'nba-book-event-button is-'+book.key.toLowerCase()}
      href={book.url} target="_blank" rel="noopener noreferrer"
      aria-label={'Open this NBA '+(book.scope==='MARKET'?'market':'event')+' on '+book.key+' (new tab)'}
      title={'Open verified '+book.scope.toLowerCase()+' on '+book.key}>
      <span>{book.label}</span><small>{book.scope==='MARKET'?'VIEW MARKET':'VIEW EVENT'}</small>
      <span aria-hidden="true">↗</span>
     </a>:
     <span key={book.key} className={'nba-book-event-button is-unavailable is-'+book.key.toLowerCase()}
      role="status" aria-label={book.key+' exact event link unavailable'}
      title="No verified event-specific provider URL. A generic homepage would not open this game.">
      <span>{book.label}</span><small>EVENT LINK UNAVAILABLE</small>
     </span>)}
  </div>
 </nav>;
}
