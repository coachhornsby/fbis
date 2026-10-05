const BASE="https://fbis-myz.pages.dev";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}

async function call(env,path,body={}){
  const res=await fetch(BASE+path,{
    method:"POST",
    headers:{
      "x-soccer-worker-token":String(env.SOCCER_WORKER_TOKEN||""),
      "content-type":"application/json",
      accept:"application/json"
    },
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(120000)
  });
  const text=await res.text();
  let parsed={};try{parsed=text?JSON.parse(text):{};}catch{parsed={ok:false,error:"non-json-response",sample:text.slice(0,180)};}
  if(!res.ok||parsed?.ok===false)throw new Error(path+" http="+res.status+" "+String(parsed?.error||parsed?.status||"request-failed"));
  return parsed;
}

async function drainOne(env){
  const claim=await call(env,"/api/soccer-pitchapi-queue-claim",{});
  if(claim.empty)return{status:"QUEUE_EMPTY"};
  if(claim.contended)return{status:"CONTENDED"};
  const item=claim.item;
  let sync;
  try{
    sync=await call(env,"/api/soccer-pitchapi-sync",{
      leagueKey:item.leagueKey,
      pitchLeagueId:item.pitchLeagueId,
      mode:"historical",
      season:item.season,
      offset:item.offset,
      limit:Math.min(4,Number(item.pageSize)||4)
    });
  }catch(e){
    await call(env,"/api/soccer-pitchapi-queue-complete",{id:item.id,ok:false,error:String(e?.message||e).slice(0,500)}).catch(()=>{});
    return{status:"RETRY",id:item.id,error:String(e?.message||e)};
  }
  const done=await call(env,"/api/soccer-pitchapi-queue-complete",{
    id:item.id,
    ok:true,
    processed:sync.processed||0,
    persisted:sync.persisted||0,
    analyticsUnavailable:sync.analyticsUnavailable||0,
    done:sync.done===true
  });
  return{status:"PROCESSED",id:item.id,league:item.heritageName,season:item.season,offset:item.offset,processed:sync.processed||0,persisted:sync.persisted||0,nextId:done.nextId||null,done:done.done===true};
}

async function cycle(env){
  const started=Date.now();
  let discovery=null;
  try{discovery=await call(env,"/api/soccer-pitchapi-discover",{limit:40});}
  catch(e){discovery={ok:false,error:String(e?.message||e)};}
  const work=[];
  for(let i=0;i<2;i++){
    if(Date.now()-started>230000)break;
    try{
      const r=await drainOne(env);work.push(r);
      if(r.status==="QUEUE_EMPTY")break;
    }catch(e){work.push({status:"ERROR",error:String(e?.message||e)});break;}
  }
  return{ok:true,at:new Date().toISOString(),durationMs:Date.now()-started,discovery,work};
}

export default{
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/health")return json({ok:true,service:"fbis-soccer-pitchapi-backfill",version:"v2-pages-proxy",cron:true});
    if(request.method==="POST"&&url.pathname==="/run"){
      const token=String(request.headers.get("x-control-token")||"");
      if(!env.SOCCER_CONTROL_TOKEN||token!==env.SOCCER_CONTROL_TOKEN)return json({ok:false,error:"unauthorized"},401);
      return json(await cycle(env));
    }
    return json({ok:false,error:"not found"},404);
  },
  async scheduled(_controller,env,ctx){
    ctx.waitUntil(cycle(env).then(r=>console.log(JSON.stringify({event:"soccer_pitchapi_cycle",...r}))).catch(e=>console.error(JSON.stringify({event:"soccer_pitchapi_cycle_failed",error:String(e?.message||e)}))));
  }
};
