import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { applyFinalToForm, persistSoccerMatch } from "../lib/store.js";
import { SOCCER_LEAGUES, soccerSeasonYear } from "../lib/soccerFbisV1.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function team(c){return {name:c?.team?.displayName||c?.team?.name||"",abbr:c?.team?.abbreviation||"",espnId:c?.team?.id!=null?String(c.team.id):null};}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function monthsBetween(start,end){
  const a=new Date(start+"T12:00:00Z"),b=new Date(end+"T12:00:00Z"),out=[];
  let y=a.getUTCFullYear(),m=a.getUTCMonth()+1;
  while(y<b.getUTCFullYear() || (y===b.getUTCFullYear()&&m<=b.getUTCMonth()+1)){
    out.push(String(y)+String(m).padStart(2,"0")); if(m===12){y++;m=1}else m++;
  }
  return out;
}
async function fetchLeague(league,start,end){
  const events=[];
  for(const dates of monthsBetween(start,end)){
    const url=`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${dates}&limit=1000`;
    const r=await fetch(url,{headers:{"user-agent":"FBIS-Soccer-Backfill/2.0",accept:"application/json"}});
    if(!r.ok)throw new Error(`${league} ${dates} HTTP ${r.status}`);
    const j=await r.json(); events.push(...(j.events||[]));
  }
  const uniq=[...new Map(events.map(x=>[String(x.id),x])).values()];
  return uniq.flatMap(ev=>{
    const c=ev.competitions?.[0], comps=c?.competitors||[];
    const h=comps.find(x=>x.homeAway==="home"),a=comps.find(x=>x.homeAway==="away");
    const hs=finite(h?.score),as=finite(a?.score),done=ev.status?.type?.completed===true||c?.status?.type?.completed===true;
    const date=String(ev.date||"").slice(0,10);
    if(!h||!a||!done||hs==null||as==null||date<start||date>end)return[];
    return[{id:String(ev.id),eventId:String(ev.id),date,startTime:ev.date||null,league,home:team(h),away:team(a),homeScore:hs,awayScore:as,source:`espn:${league}`}];
  });
}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(),401);
  let body={};try{body=await context.request.json();}catch{}
  const start=String(body.start||""),end=String(body.end||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start)return json({ok:false,error:"valid-start-end-required"},400);
  const leagues=Array.isArray(body.leagues)&&body.leagues.length?body.leagues.filter(x=>SOCCER_LEAGUES.includes(x)):SOCCER_LEAGUES;
  let finals=0,applied=0,skipped=0,failed=0,canonicalApplied=0;const errors=[];
  const supplied=Array.isArray(body.games)?body.games:null;

  const applyGames=async(games=[],defaultLeague=null)=>{
    for(const g of games){
      const league=String(g?.league||defaultLeague||"");
      const date=String(g?.date||g?.startTime||"").slice(0,10);
      const hs=finite(g?.homeScore),as=finite(g?.awayScore);
      if(!SOCCER_LEAGUES.includes(league)||!g?.id||!date||hs==null||as==null){failed++;continue;}
      finals++;
      const season=soccerSeasonYear(new Date(date+"T12:00:00Z"),league);
      const canonical=await persistSoccerMatch(context.env,{
        ...g,
        eventId:String(g.eventId||g.id),
        league,
        season,
        matchDate:date,
        startTime:g.startTime||null,
        homeScore:hs,
        awayScore:as,
        status:"FINAL",
        source:g.source||`espn:${league}`,
        sourceObservedAt:new Date().toISOString(),
        provenance:{transport:supplied?"trusted-runner-payload":"cloud-fetch",provider:"ESPN",league,marketUsed:false},
      });
      if(canonical?.ok)canonicalApplied++;else{failed++;errors.push(`${league}:${g.id}: canonical ${canonical?.reason||"failed"}`);continue;}
      const res=await applyFinalToForm(context.env,{sport:`soccer:${league}`,season,gameId:String(g.id),date,home:g.home||{},away:g.away||{},homeScore:hs,awayScore:as});
      if(res?.skipped)skipped++;else if(res?.ok)applied++;else{failed++;errors.push(`${league}:${g.id}: team_form ${res?.reason||"failed"}`);}
    }
  };

  if(supplied){
    await applyGames(supplied);
  }else{
    for(const league of leagues){
      try{await applyGames(await fetchLeague(league,start,end),league);}
      catch(err){errors.push(`${league}: ${String(err?.message||err)}`);}
    }
  }
  return json({
    ok:errors.length===0&&failed===0,
    start,end,leagues,
    source:supplied?"trusted-runner-payload":"cloud-fetch",
    finals,canonicalApplied,applied,skipped,failed,errors,
    canonicalTable:"soccer_matches",
    pointInTime:true,
    marketUsed:false,
  });
}
