import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { persistPitchApiBundle } from "../lib/soccerPitchApiStore.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function norm(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function parseStat(v){if(v==null)return null;const m=String(v).match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null;}
function flattenShots(data){return (data?.periods||[]).flatMap(p=>p?.shots||[]);}
function sumShots(shots,teamId,field){const xs=shots.filter(s=>String(s.team_id)===String(teamId)).map(s=>num(s[field])).filter(v=>v!=null);return xs.length?xs.reduce((a,b)=>a+b,0):null;}
function countShots(shots,teamId,fn=()=>true){return shots.filter(s=>String(s.team_id)===String(teamId)&&fn(s)).length;}
function statMap(data){const period=(data?.periods||[]).find(p=>String(p.period).toLowerCase()==="all")||data?.periods?.[0],out={};for(const g of period?.groups||[])for(const it of g?.items||[]){const k=String(it.key||"");if(k)out[k]={home:parseStat(it.home),away:parseStat(it.away)};}return out;}
function sideAdv(data,teamId){return (data?.teams||[]).find(x=>String(x?.team?.id)===String(teamId))||null;}
function pick(o,path){let x=o;for(const k of path.split(".")){if(x==null)return null;x=x[k];}return num(x);}
function playerRows(data){return (data?.players||[]).map(p=>({playerId:p?.player?.id,playerName:p?.player?.name,teamId:p?.team_id,minutesPlayed:num(p?.minutes_played),actions:num(p?.actions),xtTotal:pick(p,"possession_value.xt_total"),vaepTotal:pick(p,"possession_value.vaep_total"),xag:pick(p,"creation.xag"),xgChain:pick(p,"creation.xg_chain"),xgBuildup:pick(p,"creation.xg_buildup"),progressivePasses:pick(p,"passing.progressive_passes"),progressiveCarries:pick(p,"carrying.progressive_carries"),chancesCreated:pick(p,"creation.chances_created"),shots:pick(p,"shooting.shots"),raw:p})).filter(p=>p.playerId&&p.teamId);}
function lineupRows(data){const mk=(side,team)=>team?.id?{side,teamId:team.id,formation:data?.[side]?.formation||null,confirmed:data?.[side]?.confirmed===true,lineupType:data?.[side]?.lineup_type||null,starters:data?.[side]?.starters||[],subs:data?.[side]?.subs||[],coachName:data?.[side]?.coach?.name||null,raw:data?.[side]||null}:null;return[mk("home",data?.home_team),mk("away",data?.away_team)].filter(Boolean);}
const ALIASES={
  "eng.1":["Premier League"],"esp.1":["LaLiga","La Liga"],"ger.1":["Bundesliga"],"ita.1":["Serie A"],"fra.1":["Ligue 1"],
  "usa.1":["Major League Soccer","MLS"],"usa.nwsl":["National Women's Soccer League","NWSL"]
};
async function pitch(env,path,{optional=false}={}){
  const key=String(env?.PITCHAPI_API_KEY||"");if(!key)throw new Error("pitchapi-secret-unconfigured");
  let last=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const r=await fetch("https://api.pitchapi.dev"+path,{headers:{"X-API-KEY":key,accept:"application/json"},signal:AbortSignal.timeout(8000)});
      if(r.ok)return(await r.json())?.data??null;
      if(optional&&r.status===404)return null;
      last=new Error(`PitchAPI ${r.status}`);
      if(r.status===429){await new Promise(res=>setTimeout(res,Math.min(6000,attempt*1500)));continue;}
      if(r.status<500)break;
    }catch(e){last=e;}
  }
  if(optional)return null;throw last||new Error("pitchapi-request-failed");
}
function findLeague(leagues,key){const names=(ALIASES[key]||[]).map(norm);return leagues.find(l=>names.includes(norm(l.name)))||null;}
function bundle(match,advanced,stats,shotsData,players,lineups,league,season,leagueKey){
  const shots=flattenShots(shotsData),h=match.home_team,a=match.away_team,ha=sideAdv(advanced,h.id),aa=sideAdv(advanced,a.id),sm=statMap(stats),stat=(k,s)=>num(sm[k]?.[s]);
  return{leagueKey,season,pitchLeagueId:league.id,pitchLeagueName:league.name,observedAt:new Date().toISOString(),
    match:{id:match.id,date:match.date,startTime:match.time_utc,status:match.status,league:{id:league.id,name:league.name},homeTeam:{id:h.id,name:h.name},awayTeam:{id:a.id,name:a.name},homeScore:match.score_home,awayScore:match.score_away},
    features:{homeXg:sumShots(shots,h.id,"expected_goals")??stat("expected_goals","home"),awayXg:sumShots(shots,a.id,"expected_goals")??stat("expected_goals","away"),homeXgot:sumShots(shots,h.id,"expected_goals_on_target"),awayXgot:sumShots(shots,a.id,"expected_goals_on_target"),homeShots:shotsData?countShots(shots,h.id):null,awayShots:shotsData?countShots(shots,a.id):null,homeSot:shotsData?countShots(shots,h.id,s=>s.is_on_target===true):null,awaySot:shotsData?countShots(shots,a.id,s=>s.is_on_target===true):null,homeBigChances:stat("big_chances","home"),awayBigChances:stat("big_chances","away"),homePpda:pick(ha,"defending.ppda"),awayPpda:pick(aa,"defending.ppda"),homeFieldTilt:pick(ha,"territory.field_tilt"),awayFieldTilt:pick(aa,"territory.field_tilt"),homeFinalThirdEntries:pick(ha,"territory.final_third_entries"),awayFinalThirdEntries:pick(aa,"territory.final_third_entries"),homeBoxEntries:pick(ha,"territory.box_entries"),awayBoxEntries:pick(aa,"territory.box_entries"),homeHighTurnovers:pick(ha,"defending.high_turnovers"),awayHighTurnovers:pick(aa,"defending.high_turnovers"),homeCounterpressRegains:pick(ha,"defending.counterpress_regains_5s"),awayCounterpressRegains:pick(aa,"defending.counterpress_regains_5s"),homeBallRecoveryTime:pick(ha,"defending.ball_recovery_time"),awayBallRecoveryTime:pick(aa,"defending.ball_recovery_time"),homeXt:pick(ha,"possession_value.xt_total"),awayXt:pick(aa,"possession_value.xt_total"),homeVaep:pick(ha,"possession_value.vaep_total"),awayVaep:pick(aa,"possession_value.vaep_total"),homeProgressivePasses:pick(ha,"passing.progressive_passes"),awayProgressivePasses:pick(aa,"passing.progressive_passes"),homeProgressiveCarries:pick(ha,"carrying.progressive_carries"),awayProgressiveCarries:pick(aa,"carrying.progressive_carries"),homeXag:pick(ha,"creation.xag"),awayXag:pick(aa,"creation.xag"),homePossession:pick(ha,"territory.possession_pct"),awayPossession:pick(aa,"territory.possession_pct"),homePassesPerSequence:pick(ha,"tempo.passes_per_sequence"),awayPassesPerSequence:pick(aa,"tempo.passes_per_sequence"),homeDirectSpeed:pick(ha,"tempo.direct_speed"),awayDirectSpeed:pick(aa,"tempo.direct_speed")},
    players:playerRows(players),lineups:lineupRows(lineups),rawAdvanced:advanced,rawStats:stats,rawShots:shotsData};
}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  let body={};try{body=await context.request.json();}catch{return json({ok:false,error:"invalid-json"},400);}
  const leagueKey=String(body.leagueKey||""),mode=String(body.mode||"historical").toLowerCase(),offset=Math.max(0,Number(body.offset)||0),limit=Math.max(1,Math.min(12,Number(body.limit)||8));
  if(!ALIASES[leagueKey])return json({ok:false,error:"unsupported-league"},400);
  try{
    const leagueData=await pitch(context.env,"/v1/leagues"),league=findLeague(leagueData?.leagues||[],leagueKey);
    if(!league)return json({ok:false,error:"league-mapping-unresolved",leagueKey},422);
    const season=String(body.season||league.seasons?.[0]||"");if(!season)return json({ok:false,error:"season-unavailable"},422);
    const status=mode==="live"?"all":"played";
    const list=await pitch(context.env,`/v1/leagues/${league.id}/matches?season=${encodeURIComponent(season)}&status=${status}`);
    let matches=(list?.matches||[]).sort((a,b)=>String(a.time_utc||a.date).localeCompare(String(b.time_utc||b.date)));
    if(mode==="live"){const now=Date.now(),lo=new Date(now-8*86400000).toISOString().slice(0,10),hi=new Date(now+3*86400000).toISOString().slice(0,10);matches=matches.filter(m=>String(m.date)>=lo&&String(m.date)<=hi);}else matches=matches.filter(m=>m.status==="finished");
    const slice=matches.slice(offset,offset+limit);let persisted=0,playersCount=0,lineupsCount=0,analyticsUnavailable=0,errors=0;
    for(let i=0;i<slice.length;i+=3){
      const group=slice.slice(i,i+3);
      const results=await Promise.all(group.map(async m=>{
        try{
          const [advanced,shots]=await Promise.all([pitch(context.env,`/v1/matches/${m.id}/advanced`,{optional:true}),pitch(context.env,`/v1/matches/${m.id}/shots`,{optional:true})]);
          const [stats,players,lineups]=mode==="live"?await Promise.all([pitch(context.env,`/v1/matches/${m.id}/stats`,{optional:true}),pitch(context.env,`/v1/matches/${m.id}/advanced/players`,{optional:true}),pitch(context.env,`/v1/matches/${m.id}/lineups`,{optional:true})]):[null,null,null];
          if(!advanced)analyticsUnavailable++;
          const p=await persistPitchApiBundle(context.env,bundle(m,advanced,stats,shots,players,lineups,league,season,leagueKey));
          return p;
        }catch(e){errors++;return{ok:false,error:String(e?.message||e)};}
      }));
      for(const x of results){if(x?.ok){persisted+=x.match||0;playersCount+=x.players||0;lineupsCount+=x.lineups||0;}}
    }
    return json({ok:errors===0,leagueKey,pitchLeagueId:league.id,pitchLeagueName:league.name,season,mode,offset,limit,totalMatches:matches.length,processed:slice.length,persisted,players:playersCount,lineups:lineupsCount,analyticsUnavailable,errors,nextOffset:offset+slice.length,done:offset+slice.length>=matches.length,marketUsed:false});
  }catch(e){return json({ok:false,error:String(e?.message||e),leagueKey,mode},502);}
}
