import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { fetchResultsForReconcile } from "../lib/slateEngine.js";
import { applyFinalToForm } from "../lib/store.js";

const ALLOWED=new Set(["nba","wnba"]);
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function season(sport,date){
  const y=Number(String(date).slice(0,4)),m=Number(String(date).slice(5,7));
  if(sport==="nba") return m>=7?y:y-1;
  return y;
}
function dateList(start,end){
  const a=Date.parse(start+"T12:00:00Z"),b=Date.parse(end+"T12:00:00Z");
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<a) return [];
  const n=Math.floor((b-a)/86400000)+1;
  if(n>14) return [];
  return Array.from({length:n},(_,i)=>new Date(a+i*86400000).toISOString().slice(0,10));
}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env); if(!auth.ok)return json(unauthorizedBody(),401);
  let body={};try{body=await context.request.json();}catch{}
  const sport=String(body.sport||"").toLowerCase(),start=String(body.start||""),end=String(body.end||body.start||"");
  if(!ALLOWED.has(sport))return json({ok:false,error:"unsupported-sport",allowed:[...ALLOWED]},400);
  const supplied=Array.isArray(body.games)?body.games:null;
  const dates=supplied?[]:dateList(start,end);
  if(!supplied&&!dates.length)return json({ok:false,error:"date-range-required-max-14-days"},400);
  let finals=0,applied=0,skipped=0,failed=0; const errors=[];
  const applyGames=async(rows=[],fallbackDate=null)=>{
    for(const g of rows||[]){
      const date=String(g?.date||fallbackDate||"").slice(0,10);
      const hs=Number(g?.homeScore??g?.home?.score),as=Number(g?.awayScore??g?.away?.score);
      const completed=supplied?true:g?.status?.completed===true;
      if(!completed||!date||!Number.isFinite(hs)||!Number.isFinite(as))continue;
      finals++;
      const res=await applyFinalToForm(context.env,{
        sport,season:season(sport,date),gameId:String(g.id),date,
        home:{name:g.home?.name,abbr:g.home?.abbr,espnId:g.home?.espnId},
        away:{name:g.away?.name,abbr:g.away?.abbr,espnId:g.away?.espnId},
        homeScore:hs,awayScore:as,
      });
      if(res?.skipped)skipped++; else if(res?.ok)applied++; else failed++;
    }
  };
  if(supplied){
    await applyGames(supplied);
  }else{
    for(const date of dates){
      try{await applyGames(await fetchResultsForReconcile(sport,date,{}),date);}
      catch(err){errors.push(`${date}: ${String(err?.message||err)}`);}
    }
  }
  return json({ok:errors.length===0&&failed===0,sport,start,end,source:supplied?"trusted-runner-payload":"cloud-fetch",dates:supplied?null:dates.length,finals,applied,skipped,failed,errors});
}
