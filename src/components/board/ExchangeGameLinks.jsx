import {exchangeLinksForGame} from '../../lib/exchangeMarketLinks.js';
import './exchangeMarketLinks.css';

/** Source-verified navigation; no market is presented as a bet instruction. */
export default function ExchangeGameLinks({game,compact=false}){
 const links=exchangeLinksForGame(game);
 if(!links.length)return null;
 return <nav className={'fbis-exchange-links'+(compact?' is-compact':'')}
  aria-label="Open captured exchange markets" onClick={e=>e.stopPropagation()}>
   <span className="fbis-exchange-links-label">EXCHANGE MARKETS</span>
   <div className="fbis-exchange-links-actions">
     {links.slice(0,compact?2:4).map(link=><a key={link.provider+'|'+link.id}
        href={link.url} target="_blank" rel="noopener noreferrer"
        title={link.scope==='EVENT'?
          'Opens the provider event page. Choose the matching market there.':
          'Opens the matching exchange market; verify its current price and terms.'}
        aria-label={link.label+(link.description?' for '+link.description:'')+' (opens new tab)'}>
        <span>{link.label}</span><small>{link.scope==='EVENT'?'EVENT PAGE':link.description||'SOURCE CONTRACT'}</small>
        <span aria-hidden="true">↗</span>
      </a>)}
   </div>
   {links.length>(compact?2:4)?
    <details className="fbis-exchange-links-extra" onClick={e=>e.stopPropagation()}>
      <summary>+{links.length-(compact?2:4)} exchange markets</summary>
      <div className="fbis-exchange-links-actions">
       {links.slice(compact?2:4).map(link=><a key={link.provider+'|'+link.id}
        href={link.url} target="_blank" rel="noopener noreferrer"
        aria-label={link.label+(link.description?' for '+link.description:'')+' (opens new tab)'}>
        {link.label}<small>{link.scope==='EVENT'?'EVENT PAGE':link.description||'SOURCE CONTRACT'}</small><span aria-hidden="true">↗</span>
       </a>)}
      </div>
    </details>:null}
  </nav>;
}
