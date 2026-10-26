import {exchangeMarketLink} from '../../lib/exchangeMarketLinks.js';
import './exchangeQuoteLinks.css';
/** The actual displayed quote/threshold is the navigation control. */
export default function ExchangeQuoteLink({offer,value,children,className='',title='',onClick}){
 const link=exchangeMarketLink(offer);
 const content=children??value??'—';
 if(!link)return <span className={className}>{content}</span>;
 return <a className={'fbis-exchange-quote-link '+className}
  href={link.url} target="_blank" rel="noopener noreferrer" onClick={e=>{e.stopPropagation();onClick?.(e);}}
  aria-label={link.provider+': '+String(typeof content==='string'||typeof content==='number'?content:'market quote')+' (opens provider market in a new tab)'}
  title={title||(
   link.scope==='EVENT'?'Open the verified exchange event; select the corresponding contract there':
   'Open the exact provider market; current prices and terms may differ')}
  >{content}<span className="fbis-quote-external" aria-hidden="true">↗</span></a>;
}
