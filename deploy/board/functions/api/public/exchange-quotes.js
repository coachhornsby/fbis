import {readExchangeCardQuotes} from '../../../../../functions/lib/exchangeCardDelivery.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'public, max-age=10','x-content-type-options':'nosniff'}});
export async function onRequestGet({request,env}){
 const u=new URL(request.url),sport=u.searchParams.get('sport'),date=u.searchParams.get('date');
 if(!['nfl','cfb','nba','cbb','nhl'].includes(sport)||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return json({ok:false,code:'INVALID_SCOPE'},400);
 try{return json(await readExchangeCardQuotes({...env,ARCHIVE:env.FBIS_PRIVATE_CBB},{sport,date}));}
 catch{return json({ok:false,code:'EXCHANGE_QUOTES_UNAVAILABLE',byEvent:{},canAuthorizeWager:false},503);}
}
