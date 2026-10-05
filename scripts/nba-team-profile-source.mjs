#!/usr/bin/env node
import fs from "node:fs";
import teams from "../data/teams/nba.js";
import { normalizeNbaTeamKey } from "../functions/lib/nbaTeamProfile.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const out=args.out||"artifacts/nba-team-profile-source.json";
const now=new Date(),season=Number(args.season||((now.getUTCMonth()+1)>=7?now.getUTCFullYear()+1:now.getUTCFullYear()));
const concurrency=Math.max(1,Math.min(8,Number(args.concurrency||6)));
const ua={"user-agent":"FBIS-NBA-Team-Profiles/1.0",accept:"application/json"};

async function get(url){
 const r=await fetch(url,{headers:ua});
 if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);
 return r.json();
}
function athleteRows(roster){
 const groups=Array.isArray(roster?.athletes)?roster.athletes:[];
 const out=[];
 for(const g of groups){
   if(Array.isArray(g?.items))for(const p of g.items)out.push(p);
   else if(g?.id||g?.displayName)out.push(g);
 }
 return out.map(p=>({
   id:String(p.id||""),name:p.displayName||[p.firstName,p.lastName].filter(Boolean).join(" "),
   firstName:p.firstName||null,lastName:p.lastName||null,
   position:p.position?.abbreviation||p.position?.name||null,jersey:p.jersey||null,
   status:p.status?.type||p.status?.name||null,experienceYears:Number(p.experience?.years??p.experience??0)||0,
   age:Number(p.age)||null,height:Number(p.height)||null,weight:Number(p.weight)||null
 })).filter(p=>p.id||p.name);
}
function coaches(roster){
 return (Array.isArray(roster?.coach)?roster.coach:[]).map((c,i)=>({
   id:String(c.id||""),name:c.displayName||[c.firstName,c.lastName].filter(Boolean).join(" "),
   role:c.position?.displayName||c.position?.name||c.type?.text||c.type|| (i===0?"Head Coach":"Coach"),
   experienceYears:Number(c.experience?.years??c.experience??0)||0
 })).filter(c=>c.name);
}
function compTeamKey(c){return normalizeNbaTeamKey(c?.team?.abbreviation||c?.team?.shortDisplayName||"")}
function scheduleRows(schedule,teamId,teamKey){
 const events=Array.isArray(schedule?.events)?schedule.events:[];
 return events.map(ev=>{
   const comp=ev.competitions?.[0]||{},cs=comp.competitors||[];
   const self=cs.find(x=>String(x.team?.id||x.id)===String(teamId))||cs.find(x=>compTeamKey(x)===teamKey);
   const opp=cs.find(x=>x!==self)||{};
   const home=cs.find(x=>x.homeAway==="home")||{};
   return {
     gameId:String(ev.id||""),startTime:ev.date||comp.date||null,
     opponentKey:compTeamKey(opp),homeTeamKey:compTeamKey(home),venueTeamKey:compTeamKey(home),
     homeAway:self?.homeAway||null,neutralSite:Boolean(comp.neutralSite),
     completed:Boolean(ev.status?.type?.completed||comp.status?.type?.completed),
     status:ev.status?.type?.name||comp.status?.type?.name||null,
     seasonType:ev.season?.type??schedule?.season?.type??null,
     venue:comp.venue?.fullName||null,
     source:"ESPN_TEAM_SCHEDULE"
   };
 }).filter(x=>x.gameId&&x.startTime);
}
async function one(t){
 const teamId=String(t.espnId||t.sources?.espn?.id||"");
 const teamKey=normalizeNbaTeamKey(t.sources?.espn?.abbr||t.abbr);
 const base=`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}`;
 const [rosterResult,scheduleResult]=await Promise.allSettled([
   get(base+`/roster?season=${season}`),
   get(base+`/schedule?season=${season}`)
 ]);
 const roster=rosterResult.status==="fulfilled"?rosterResult.value:null;
 const schedule=scheduleResult.status==="fulfilled"?scheduleResult.value:null;
 return {
   teamId,teamKey,teamName:t.displayName,season,
   roster:athleteRows(roster),coaches:coaches(roster),schedule:scheduleRows(schedule,teamId,teamKey),
   sourceState:{
     roster:rosterResult.status==="fulfilled"?"OK":"ERROR",
     schedule:scheduleResult.status==="fulfilled"?"OK":"ERROR",
     rosterError:rosterResult.status==="rejected"?String(rosterResult.reason):null,
     scheduleError:scheduleResult.status==="rejected"?String(scheduleResult.reason):null
   }
 };
}
const queue=[...teams],results=[];
async function worker(){while(queue.length){const t=queue.shift();if(!t)break;results.push(await one(t))}}
await Promise.all(Array.from({length:concurrency},worker));
results.sort((a,b)=>a.teamName.localeCompare(b.teamName));
const payload={generatedAt:new Date().toISOString(),season,source:"ESPN_PUBLIC",teams:results,
 quality:{teams:results.length,rostersOk:results.filter(x=>x.sourceState.roster==="OK").length,schedulesOk:results.filter(x=>x.sourceState.schedule==="OK").length,players:results.reduce((s,x)=>s+x.roster.length,0),coaches:results.reduce((s,x)=>s+x.coaches.length,0),games:results.reduce((s,x)=>s+x.schedule.length,0)}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");
console.log(JSON.stringify(payload.quality,null,2));
