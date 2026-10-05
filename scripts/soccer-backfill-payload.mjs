#!/usr/bin/env node
const start=String(process.argv[2]||"");
const end=String(process.argv[3]||"");
const leagues=(process.argv[4]||"eng.1,esp.1,ger.1,ita.1,fra.1,usa.1,usa.nwsl").split(",").filter(Boolean);
if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start){
  console.error("usage: node scripts/soccer-backfill-payload.mjs <start> <end> [leagueCsv]");
  process.exit(2);
}
function monthsBetween(a,b){
  const s=new Date(a+"T12:00:00Z"),e=new Date(b+"T12:00:00Z"),out=[];
  let y=s.getUTCFullYear(),m=s.getUTCMonth()+1;
  while(y<e.getUTCFullYear()||(y===e.getUTCFullYear()&&m<=e.getUTCMonth()+1)){
    out.push(String(y)+String(m).padStart(2,"0"));
    if(m===12){y++;m=1}else m++;
  }
  return out;
}
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const team=c=>({name:c?.team?.displayName||c?.team?.name||"",abbr:c?.team?.abbreviation||"",espnId:c?.team?.id!=null?String(c.team.id):null});

const advancedEnabled=String(process.env.SOCCER_ADVANCED||"0")==="1";
const advancedMax=Math.max(0,Math.min(20,Number(process.env.SOCCER_ADVANCED_MAX)||12));
function statMap(summary){
  const teams=summary?.boxscore?.teams||[];
  const out={};
  for(const row of teams){
    const id=String(row?.team?.id||"");
    const stats={};
    for(const s of row?.statistics||[]){
      const k=String(s?.name||s?.label||s?.abbreviation||"").toLowerCase().replace(/[^a-z0-9]/g,"");
      const v=finite(s?.value??String(s?.displayValue||"").replace("%",""));
      if(k&&v!=null)stats[k]=v;
    }
    if(id)out[id]=stats;
  }
  return out;
}
function pickStat(stats,names){
  for(const name of names){
    const k=String(name).toLowerCase().replace(/[^a-z0-9]/g,"");
    if(stats&&stats[k]!=null)return stats[k];
  }
  return null;
}
async function enrichGame(game){
  const url=`https://site.api.espn.com/apis/site/v2/sports/soccer/${game.league}/summary?event=${game.id}`;
  try{
    const r=await fetch(url,{headers:{"user-agent":"FBIS-Soccer-Advanced/1.0",accept:"application/json"},signal:AbortSignal.timeout(4500)});
    if(!r.ok)return game;
    const j=await r.json(),sm=statMap(j);
    const hs=sm[String(game.home?.espnId||"")]||{},as=sm[String(game.away?.espnId||"")]||{};
    return{
      ...game,
      homeShots:pickStat(hs,["totalshots","shots"]),
      awayShots:pickStat(as,["totalshots","shots"]),
      homeShotsOnTarget:pickStat(hs,["shotsontarget","shotstarget"]),
      awayShotsOnTarget:pickStat(as,["shotsontarget","shotstarget"]),
      homePossession:pickStat(hs,["possessionpct","possessionpercentage","possession"]),
      awayPossession:pickStat(as,["possessionpct","possessionpercentage","possession"]),
      homeCorners:pickStat(hs,["cornerkicks","corners"]),
      awayCorners:pickStat(as,["cornerkicks","corners"]),
      homeXg:pickStat(hs,["expectedgoals","xg"]),
      awayXg:pickStat(as,["expectedgoals","xg"]),
      homePpda:pickStat(hs,["ppda"]),
      awayPpda:pickStat(as,["ppda"]),
      homeDeepCompletions:pickStat(hs,["deepcompletions","deepcompleted"]),
      awayDeepCompletions:pickStat(as,["deepcompletions","deepcompleted"]),
      homeExpectedPoints:pickStat(hs,["expectedpoints","xpoints"]),
      awayExpectedPoints:pickStat(as,["expectedpoints","xpoints"]),
      advancedSource:"espn-summary",
      advancedObservedAt:new Date().toISOString(),
    };
  }catch{return game;}
}

const games=[];
for(const league of leagues){
  const events=[];
  for(const dates of monthsBetween(start,end)){
    const url=`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${dates}&limit=1000`;
    let r=null,lastErr=null;
    for(let attempt=1;attempt<=3;attempt++){
      try{
        r=await fetch(url,{headers:{"user-agent":"FBIS-Soccer-Backfill-Runner/2.0",accept:"application/json"},signal:AbortSignal.timeout(12000)});
        if(r.ok)break;
        lastErr=new Error(`${league} ${dates} HTTP ${r.status}`);
      }catch(err){lastErr=err;}
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1000));
    }
    if(!r?.ok)throw lastErr||new Error(`${league} ${dates} fetch failed`);
    const j=await r.json(); events.push(...(j.events||[]));
  }
  const uniq=[...new Map(events.map(x=>[String(x.id),x])).values()];
  for(const ev of uniq){
    const c=ev.competitions?.[0],xs=c?.competitors||[];
    const h=xs.find(x=>x.homeAway==="home"),a=xs.find(x=>x.homeAway==="away");
    const hs=finite(h?.score),as=finite(a?.score);
    const done=ev.status?.type?.completed===true||c?.status?.type?.completed===true;
    const date=String(ev.date||"").slice(0,10);
    if(!h||!a||!done||hs==null||as==null||date<start||date>end) continue;
    games.push({id:String(ev.id),eventId:String(ev.id),date,startTime:ev.date||null,league,home:team(h),away:team(a),homeScore:hs,awayScore:as,source:`espn:${league}`});
  }
}
if(advancedEnabled&&advancedMax>0&&games.length){
  const limit=Math.min(advancedMax,games.length);
  for(let i=0;i<limit;i++)games[i]=await enrichGame(games[i]);
}
process.stdout.write(JSON.stringify({start,end,leagues,games,advanced:{enabled:advancedEnabled,max:advancedMax,enriched:games.filter(g=>g.advancedSource).length}}));
