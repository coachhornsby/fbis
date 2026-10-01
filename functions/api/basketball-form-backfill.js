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
  const dates=dateList(start,end); if(!dates.length)return json({ok:false,error:"date-range-required-max-14-days"},400);
  let finals=0,applied=0,skipped=0,failed=0; const errors=[];
  for(const date of dates){
    try{
      const rows=await fetchResultsForReconcile(sport,date,{});
      for(const g of rows||[]){
        if(g?.status?.completed!==true)continue;
        const hs=Number(g?.home?.score),as=Number(g?.away?.score);
        if(!Number.isFinite(hs)||!Number.isFinite(as))continue;
        finals++;
        const res=await applyFinalToForm(context.env,{
          sport,season:season(sport,date),gameId:String(g.id),date,
          home:{name:g.home?.name,abbr:g.home?.abbr,espnId:g.home?.espnId},
          away:{name:g.away?.name,abbr:g.away?.abbr,espnId:g.away?.espnId},
          homeScore:hs,awayScore:as,
        });
        if(res?.skipped)skipped++; else if(res?.ok)applied++; else failed++;
      }
    }catch(err){errors.push(`${date}: ${String(err?.message||err)}`);}
  }
  return json({ok:errors.length===0&&failed===0,sport,start,end,dates:dates.length,finals,applied,skipped,failed,errors});
}
