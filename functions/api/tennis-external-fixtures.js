// The former ESPN collection route is retired. No provider calls or D1 writes.
const retired=()=>new Response(JSON.stringify({ok:false,error:'TENNIS_ESPN_SOURCE_RETIRED',approvedSources:['KALSHI','POLYMARKET','ATP','WTA','ITF']}),{status:410,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestGet(){return retired();}
export async function onRequestPost(){return retired();}
