import { soccerTeamDirectory, summarizeSoccerTeamMatches, summarizeSoccerAdvanced } from '../lib/soccerTeamProfiles.js';
import { loadSoccerPitchApiPlayerContributors } from '../lib/soccerTeamPlayerContributors.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'public, max-age=300'}});
async function roster(env,team) {
 const key=`soccer/team-profiles/${team.league}/${team.espnId}/roster.json`;
 let cached=null;
 try { const object=await env.ARCHIVE?.get(key); if(object)cached=await object.json(); }catch{}
 if(cached && Date.now()-Date.parse(cached.observedAt)<86400000)return {...cached,stale:false};
 try {
  const url=`https://site.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(team.league)}/teams/${team.espnId}/roster`;
  const res=await fetch(url,{signal:AbortSignal.timeout(6000)});
  if(!res.ok)throw new Error(`roster-http-${res.status}`);
  const body=await res.json();
  if(body.team?.id && String(body.team.id)!==team.espnId)throw new Error('roster-team-mismatch');
  const groups=body.athletes||[];
  const athletes=groups.flatMap(g=>Array.isArray(g.items)?g.items:[g]).filter(p=>p.id&&p.displayName);
  if(!athletes.length)throw new Error('roster-unavailable');
  const result={observedAt:new Date().toISOString(),source:'ESPN team roster',sourceUrl:url,
   players:athletes.map(p=>({id:String(p.id),name:p.displayName,position:p.position?.abbreviation||null,
    jersey:p.jersey||null,age:p.age??null,nationality:p.citizenship||null,headshot:p.headshot?.href||null}))};
  let persisted=false;
  if(env.ARCHIVE?.put){await env.ARCHIVE.put(key,JSON.stringify(result),{httpMetadata:{contentType:'application/json'}});persisted=true;}
  return {...result,stale:false,persisted};
 }catch(err){return cached?{...cached,stale:true,unavailableReason:String(err.message)}:
  {players:[],observedAt:null,source:null,stale:false,unavailableReason:String(err.message)};}
}
export async function onRequestGet(context) {
 const url=new URL(context.request.url),directory=soccerTeamDirectory(),id=url.searchParams.get('team'),league=url.searchParams.get('league');
 if(!id)return json({ok:true,competitions:directory,publicModel:'SOCCER-FBIS-v2',canQualify:false,canAuthorize:false});
 const candidates=directory.filter(c=>!league||c.league===league).flatMap(c=>c.teams).filter(t=>t.id===id||t.espnId===id);
 if(candidates.length!==1)return json({ok:false,error:'team-and-competition-required'},400);
 const team=candidates[0],asOf=new Date().toISOString(),start=new Date(Date.now()-900*86400000).toISOString().slice(0,10);
 if(!context.env.DB?.prepare)return json({ok:false,error:'database-unavailable'},503);
 try {
  const rows=(await context.env.DB.prepare("SELECT * FROM soccer_matches WHERE league=? AND status='FINAL' AND match_date>=? AND match_date<? ORDER BY match_date DESC").bind(team.league,start,asOf.slice(0,10)).all()).results||[];
  const stats=summarizeSoccerTeamMatches(rows,team,asOf);
  let advanced;
  try {
   const pitch=(await context.env.DB.prepare("SELECT * FROM soccer_pitchapi_match_features WHERE league_key=? AND status='finished' AND match_date>=? AND match_date<? ORDER BY match_date DESC").bind(team.league,start,asOf.slice(0,10)).all()).results||[];
   advanced=summarizeSoccerAdvanced(pitch,team,asOf);
  }catch(err){advanced={...summarizeSoccerAdvanced([],team,asOf),unavailableReason:String(err.message)};}
  const squad=await roster(context.env,team);
  let playerContributors;
  try{
    playerContributors=await loadSoccerPitchApiPlayerContributors(context.env,{
      league:team.league,teamIds:advanced.teamIds||[],startDate:start,asOf:asOf.slice(0,10)
    });
  }catch(err){playerContributors={source:'PitchAPI persisted player match observations',players:[],researchOnly:true,
    unavailableReason:String(err.message),providerIdPolicy:'Provider IDs are not interchangeable'};}
  return json({ok:true,team,stats,advanced,roster:squad,playerContributors,coverage:{branding:!!team.logo,history:stats.sampleSize,
   advancedMatches:advanced.sampleSize,advancedMetrics:advanced.availableMetrics,rosterPlayers:squad.players.length,rosterStale:squad.stale},persistentStateUsedInProjection:false,canQualify:false,canAuthorize:false});
 }catch(err){return json({ok:false,error:'team-profile-query-failed',detail:String(err.message)},503);}
}
