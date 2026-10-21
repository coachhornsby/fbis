import {loadPolymarketUsTennisInventory} from "../lib/tennisExchangeInventory.js";
const respond=(data,status=200)=>Response.json(data,{status,headers:{"cache-control":"no-store",
 "x-content-type-options":"nosniff"}});
/** Public source-only diagnostic. Never reports authorization or model authority. */
export async function onRequestGet({env}){
 const snapshot=await loadPolymarketUsTennisInventory(env.ARCHIVE);
 if(!snapshot.ok)return respond({ok:false,source:"Polymarket US",status:snapshot.code,
  inventoryFresh:false,canAuthorizeWager:false},503);
 const byTour=Object.fromEntries(["atp","wta"].map(tour=>{
  const events=snapshot.events.filter(x=>x.tour===tour);
  return [tour,{events:events.length,eventsWithMoneyline:events.filter(x=>x.offers?.length>0).length,
   pricedSides:events.reduce((n,x)=>n+(x.offers?.length||0),0)}];
 }));
 const dates={};
 const ct=x=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",
  month:"2-digit",day:"2-digit"}).format(new Date(x));
 for(const e of snapshot.events){
  const date=ct(e.start);
  dates[date]=(dates[date]||0)+1;
 }
 return respond({ok:true,source:"Polymarket US",status:snapshot.code,
  inventoryFresh:true,complete:snapshot.complete,capturedAt:snapshot.capturedAt,
  totalEvents:snapshot.events.length,byTour,byDate:dates,
  sources:snapshot.sources,modelIndependent:true,
  quoteKind:"DISPLAY_REFERENCE_NOT_EXECUTABLE",
  canQualify:false,canAuthorizeWager:false});
}
export async function onRequestPost(){
 return respond({ok:false,error:"READ_ONLY"},405);
}
