const base=process.env.BASE||"https://fbis-myz.pages.dev";
const secret=process.env.HARVEST_SECRET;
if(!secret) throw new Error("HARVEST_SECRET missing");
const url=new URL("/api/nfl-wager-snapshot",base);
url.searchParams.set("_t",String(Date.now()));
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),90000);
try{
  const res=await fetch(url,{method:"POST",headers:{"x-harvest-secret":secret,"accept":"application/json"},signal:controller.signal});
  const body=await res.json().catch(()=>({}));
  console.log(JSON.stringify({
    http:res.status,ok:body.ok,date:body.date,games:body.games,decisionGames:body.decisionGames,
    candidates:body.candidates,pricedCandidates:body.pricedCandidates,inserted:body.inserted,
    bets:body.bets,passes:body.passes,confidenceValidated:body.confidenceValidated,blockers:body.blockers
  }));
  if(!res.ok||body.ok!==true) process.exit(1);
}finally{clearTimeout(timer);}
