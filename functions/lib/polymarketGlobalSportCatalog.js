import {PROP_SPORTS} from './exchangePlayerProps.js';
export const GLOBAL_PAGE_SIZE=20;
const ROOT='player-props/poly-global-discovery/v1/';
const valid=(s,d)=>PROP_SPORTS.includes(s)&&/^\d{4}-\d{2}-\d{2}$/.test(d||'');
export const catalogStatusKey=(s,d)=>ROOT+d+'/'+s+'/status.json';
export async function getGlobalSportCatalog(env,{sport,day}={}){
 if(!valid(sport,day))return {ok:false,code:'INVALID_SCOPE'};
 const x=await env.ARCHIVE.get(catalogStatusKey(sport,day));
 return x?await x.json():{ok:true,sport,day,status:'NOT_CAPTURED',complete:false,nextOffset:0,
 pages:[],events:0,markets:0,canAuthorizeWager:false};
}
export async function captureGlobalSportCatalogPage(env,{sport,day,offset,events,now=new Date()}={}){
 if(!valid(sport,day)||!Number.isInteger(offset)||offset<0||
 offset%GLOBAL_PAGE_SIZE!==0||!Array.isArray(events)||events.length>GLOBAL_PAGE_SIZE)
  return {ok:false,code:'INVALID_PAGE'};
 if(!env.ARCHIVE?.get||!env.ARCHIVE?.put)return {ok:false,code:'ARCHIVE_UNBOUND'};
 const prior=await getGlobalSportCatalog(env,{sport,day});
 const state=prior.complete&&offset===0?{...prior,pages:[],events:0,markets:0,
  complete:false,nextOffset:0}:prior;
 if(!state.ok||state.nextOffset!==offset)return {ok:false,code:'NONADVANCING_CURSOR'};
 const complete=events.length<GLOBAL_PAGE_SIZE&&
  events.every(e=>e&&typeof e.slug==='string'&&Array.isArray(e.markets));
 const pageKey=ROOT+day+'/'+sport+'/'+Date.now()+'-'+offset+'.json';
 await env.ARCHIVE.put(pageKey,JSON.stringify({sport,day,offset,capturedAt:now.toISOString(),
  priceKind:'GAMMA_REFERENCE_NOT_ASK',events,canAuthorizeWager:false}));
 const status={...state,version:1,status:complete?'COMPLETE':'PARTIAL',
  complete,nextOffset:complete?null:offset+events.length,
  pages:[...state.pages,pageKey],events:state.events+events.length,
  markets:state.markets+events.reduce((n,e)=>n+(Array.isArray(e?.markets)?e.markets.length:0),0),
  capturedAt:now.toISOString(),canQualify:false,canAuthorizeWager:false};
 await env.ARCHIVE.put(catalogStatusKey(sport,day),JSON.stringify(status));
 return {...status,pageCount:status.pages.length};
}
