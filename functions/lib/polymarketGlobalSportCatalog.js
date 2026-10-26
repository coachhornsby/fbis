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

/** Public research reader: bounded single R2 page, no inferred best asks. */
export async function readGlobalSportCatalogPage(env,{sport,day,page=0}={}){
 const status=await getGlobalSportCatalog(env,{sport,day});
 if(!status.ok)return status;
 if(!Number.isInteger(page)||page<0||page>5000)return {ok:false,code:'INVALID_PAGE'};
 const key=status.pages?.[page];
 if(!key)return {ok:true,sport,day,marketOnly:[],page,
  nextPage:null,tagWalkComplete:status.complete===true,
  status:status.status,canAuthorizeWager:false};
 const obj=await env.ARCHIVE.get(key);
 if(!obj)return {ok:false,code:'ARCHIVED_CATALOG_PAGE_MISSING'};
 const data=await obj.json();
 const stat=/^([^:]+):\\s*(points|rebounds|assists|points\\s*\\+\\s*rebounds|passing yards|rushing yards|receiving yards|receptions|strikeouts|saves|shots on goal|goals|hits|home runs|touchdowns).*?(?:O\\/U|over\\/under)\\s*(\\d+(?:\\.\\d+)?)/i;
 const marketOnly=[];
 for(const event of data.events||[])for(const market of event.markets||[]){
  const title=String(market.question||'').slice(0,240);
  const match=stat.exec(title);
  if(!match||market.active!==true||market.closed===true)continue;
  marketOnly.push({
   id:'polymarket-global-catalog:'+String(market.id||market.slug||''),
   contractId:String(market.slug||market.id||''),provider:'Polymarket',
   venue:'Polymarket Global',source:'Gamma sport-tag reference',
   providerEventId:String(event.id||''),rawTitle:title,sport,
   player_name:match[1].trim(),line:Number(match[3]),
   canonical_market:null,period:null,
   collectedAt:data.capturedAt,observedAt:null,
   priceKind:'GAMMA_REFERENCE_NOT_ASK',
   identityVerified:false,marketAvailable:false,priceVerified:false,
   purchaseAsk:null,canQualify:false,canAuthorizeWager:false,
   reason:['PLAYER_EVENT_STAT_SETTLEMENT_NOT_INDEPENDENTLY_VERIFIED']
  });
 }
 return {ok:true,sport,day,page,marketOnly,
  nextPage:page+1<status.pages.length?page+1:null,
  tagWalkComplete:status.complete===true,status:status.status,
  canAuthorizeWager:false};
}
