const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json","cache-control":"public, max-age=10"}});
/** Public market-only observations. No account routes, credentials or execution. */
export async function onRequestGet({request}){
 const u=new URL(request.url),market=u.searchParams.get("market"),window=u.searchParams.get("window")||"15m";
 if(market&&!/^[a-z0-9-]{1,160}$/i.test(market))return json({ok:false,error:"invalid-market"},400);
 if(!["1m","5m","15m","1h"].includes(window))return json({ok:false,error:"invalid-window"},400);
 const query=new URLSearchParams({window});if(market)query.set("market",market);
 try{
  const r=await fetch("https://fbis-polymarket-us-stream.coachhornsby.workers.dev/flow?"+query,{signal:AbortSignal.timeout(5000)});
  if(!r.ok)return json({ok:false,error:"flow-source-unavailable",researchOnly:true},503);
  return json(await r.json());
 }catch{return json({ok:false,error:"flow-source-unavailable",researchOnly:true},503)}
}
export async function onRequestPost(){return json({ok:false,error:"method-not-allowed"},405)}
