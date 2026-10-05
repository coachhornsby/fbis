#!/usr/bin/env node
import fs from "node:fs";
import teams from "../data/teams/nfl.js";
import { normalizeNflTeamKey } from "../functions/lib/nflTeamProfile.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const out=args.out||"artifacts/nfl-team-profile-source.json";
const now=new Date(),season=Number(args.season||now.getUTCFullYear());
const concurrency=Math.max(1,Math.min(4,Number(args.concurrency||2)));
const shardCount=Math.max(1,Number(args.shardCount||1));
const shardIndex=Math.max(0,Number(args.shardIndex||0));
const timeoutMs=Math.max(3000,Math.min(15000,Number(args.timeoutMs||8000)));
const ua={"user-agent":"FBIS-NFL-Team-Profiles/1.0",accept:"application/json"};

async function get(url){
  const c=new AbortController(),t=setTimeout(()=>c.abort("timeout"),timeoutMs);
  try{
    const r=await fetch(url,{headers:ua,signal:c.signal});
    if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);
    return await r.json();
  }finally{clearTimeout(t)}
}
function athleteRows(roster){
  const groups=Array.isArray(roster?.athletes)?roster.athletes:[];
  const rows=[];
  for(const g of groups){
    const items=Array.isArray(g?.items)?g.items:[g];
    for(const p of items){
      if(!p||(!p.id&&!p.displayName))continue;
      rows.push({
        id:String(p.id||""),name:p.displayName||[p.firstName,p.lastName].filter(Boolean).join(" "),
        position:p.position?.abbreviation||p.position?.name||g?.position||null,
        jersey:p.jersey||null,status:p.status?.type||p.status?.name||null,
        experienceYears:Number(p.experience?.years??p.experience??0)||0,
        age:Number(p.age)||null,height:Number(p.height)||null,weight:Number(p.weight)||null,
      });
    }
  }
  return rows;
}
function coachRows(body){
  const candidates=[
    ...(Array.isArray(body?.coach)?body.coach:[]),
    ...(Array.isArray(body?.coaches)?body.coaches:[]),
  ];
  return candidates.map((c,i)=>({
    id:String(c.id||""),name:c.displayName||[c.firstName,c.lastName].filter(Boolean).join(" "),
    role:c.position?.displayName||c.position?.name||c.type?.text||c.type|| (i===0?"Head Coach":"Coach"),
    experienceYears:Number(c.experience?.years??c.experience??0)||0
  })).filter(c=>c.name);
}
function compKey(c){return normalizeNflTeamKey(c?.team?.abbreviation||c?.team?.shortDisplayName||"")}
function scheduleRows(schedule,teamId,teamKey){
  const events=Array.isArray(schedule?.events)?schedule.events:[];
  return events.map(ev=>{
    const comp=ev.competitions?.[0]||{},cs=comp.competitors||[];
    const self=cs.find(x=>String(x.team?.id||x.id)===String(teamId))||cs.find(x=>compKey(x)===teamKey);
    const opp=cs.find(x=>x!==self)||{};
    const home=cs.find(x=>x.homeAway==="home")||{};
    const venue=comp.venue||{};
    const addr=venue.address||{};
    const country=addr.country||addr.countryCode||null;
    return {
      gameId:String(ev.id||""),startTime:ev.date||comp.date||null,
      opponentKey:compKey(opp),homeTeamKey:compKey(home),venueTeamKey:compKey(home),
      homeAway:self?.homeAway||null,neutralSite:Boolean(comp.neutralSite),
      completed:Boolean(ev.status?.type?.completed||comp.status?.type?.completed),
      status:ev.status?.type?.name||comp.status?.type?.name||null,
      week:Number(ev.week?.number??ev.week??0)||null,
      venueName:venue.fullName||null,venueCity:addr.city||null,venueState:addr.state||null,
      venueCountry:country,international:Boolean(country&&String(country).toUpperCase()!=="USA"&&String(country).toUpperCase()!=="US"),
      source:"ESPN_TEAM_SCHEDULE"
    };
  }).filter(x=>x.gameId&&x.startTime);
}
async function one(t){
  const teamId=String(t.espnId||t.sources?.espn?.id||"");
  const teamKey=normalizeNflTeamKey(t.sources?.espn?.abbr||t.abbr);
  const base=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}`;
  const [rosterResult,scheduleResult,teamResult]=await Promise.allSettled([
    get(base+`/roster?season=${season}`),
    get(base+`/schedule?season=${season}`),
    get(base),
  ]);
  const roster=rosterResult.status==="fulfilled"?rosterResult.value:null;
  const schedule=scheduleResult.status==="fulfilled"?scheduleResult.value:null;
  const teamBody=teamResult.status==="fulfilled"?teamResult.value:null;
  const coaches=[...coachRows(roster),...coachRows(teamBody)];
  const uniqueCoaches=[...new Map(coaches.map(x=>[(x.id||x.name)+"|"+x.role,x])).values()];
  return {
    teamId,teamKey,teamName:t.displayName,season,
    roster:athleteRows(roster),coaches:uniqueCoaches,schedule:scheduleRows(schedule,teamId,teamKey),
    sourceState:{
      roster:rosterResult.status==="fulfilled"?"OK":"ERROR",
      schedule:scheduleResult.status==="fulfilled"?"OK":"ERROR",
      team:teamResult.status==="fulfilled"?"OK":"ERROR",
      rosterError:rosterResult.status==="rejected"?String(rosterResult.reason):null,
      scheduleError:scheduleResult.status==="rejected"?String(scheduleResult.reason):null,
      teamError:teamResult.status==="rejected"?String(teamResult.reason):null,
    }
  };
}
const selected=teams.filter((_,i)=>i%shardCount===shardIndex),queue=[...selected],results=[];
async function worker(){while(queue.length){const t=queue.shift();if(!t)break;try{results.push(await one(t))}catch(err){results.push({teamId:String(t.espnId||""),teamKey:normalizeNflTeamKey(t.abbr),teamName:t.displayName,season,roster:[],coaches:[],schedule:[],sourceState:{roster:"ERROR",schedule:"ERROR",team:"ERROR",error:String(err)}})}}}
await Promise.all(Array.from({length:concurrency},worker));
results.sort((a,b)=>a.teamName.localeCompare(b.teamName));
const payload={generatedAt:new Date().toISOString(),season,source:"ESPN_PUBLIC",shard:{index:shardIndex,count:shardCount,selected:selected.length},teams:results,
  quality:{teams:results.length,rostersOk:results.filter(x=>x.sourceState.roster==="OK").length,schedulesOk:results.filter(x=>x.sourceState.schedule==="OK").length,players:results.reduce((s,x)=>s+x.roster.length,0),coaches:results.reduce((s,x)=>s+x.coaches.length,0),games:results.reduce((s,x)=>s+x.schedule.length,0)}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");
console.log(JSON.stringify(payload.quality,null,2));
