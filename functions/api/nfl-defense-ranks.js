import {loadNflVerseFeatures} from "../lib/nflVerseFeed.js";
const aliases={JAC:"JAX",SFO:"SF",WSH:"WAS",LA:"LAR",STL:"LAR",OAK:"LV",SD:"LAC",ARZ:"ARI"};
const code=v=>aliases[String(v||"").trim().toUpperCase()]||String(v||"").trim().toUpperCase();
const num=v=>v==null||v===""?null:Number.isFinite(Number(v))?Number(v):null;
export function nflDefenseRanks(feed){
 const result={};
 const entries=Object.entries(feed?.byTeam||{});
 for(const [type,field] of [["pass","passEpaAllowed"],["run","rushEpaAllowed"]]){
  const arr=entries.map(([team,data])=>({team:code(team),epa:num(data?.[field])})).filter(x=>x.epa!=null);
  arr.sort((a,b)=>a.epa-b.epa||a.team.localeCompare(b.team));
  // Only publish 1-32 rankings when all 32 valid team measurements exist.
  if(arr.length!==32||new Set(arr.map(x=>x.team)).size!==32)continue;
  for(const [index,x] of arr.entries()){
   result[x.team]??={};
   result[x.team][type]={rank:index+1,total:32,epaAllowedPerPlay:x.epa};
  }
 }
 return result;
}
export async function onRequestGet(context){
 const feed=await loadNflVerseFeatures(context.env||{},{forceNetwork:false});
 const ranks=nflDefenseRanks(feed);
 const complete=Object.values(ranks).filter(t=>t.pass&&t.run).length;
 return new Response(JSON.stringify({ok:complete===32,source:"NFLVERSE_DEFENSIVE_EPA_ALLOWED_PER_PLAY",asOf:feed?.meta?.builtAt||null,completeTeams:complete,teams:ranks,reason:complete===32?null:"DEFENSIVE_SOURCE_INCOMPLETE"}),{headers:{"content-type":"application/json","cache-control":"public, max-age=300"}});
}
