export const NHL_PERSISTENT_PROFILE_VERSION="NHL-PERSISTENT-v1";

const GEO=Object.freeze({
 ANA:[33.8078,-117.8765,-8,157],BOS:[42.3662,-71.0621,-5,43],BUF:[42.875,-78.876,-5,600],CGY:[51.0374,-114.0519,-7,3428],
 CAR:[35.8033,-78.7218,-5,315],CHI:[41.8807,-87.6742,-6,594],COL:[39.7487,-105.0077,-7,5280],CBJ:[39.9693,-83.006,-5,750],
 DAL:[32.7905,-96.8103,-6,430],DET:[42.3411,-83.055,-5,600],EDM:[53.5461,-113.4977,-7,2116],FLA:[26.1584,-80.3256,-5,9],
 LA:[34.043,-118.2673,-8,305],MIN:[44.9448,-93.1011,-6,840],MTL:[45.496,-73.5693,-5,118],NSH:[36.1592,-86.7785,-6,597],
 NJ:[40.7335,-74.1711,-5,30],NYI:[40.7229,-73.5905,-5,65],NYR:[40.7505,-73.9934,-5,33],OTT:[45.2969,-75.9272,-5,230],
 PHI:[39.9012,-75.172,-5,39],PIT:[40.4396,-79.9892,-5,1200],SEA:[47.6221,-122.354,-8,20],SJ:[37.3327,-121.901,-8,85],
 STL:[38.6268,-90.2026,-6,466],TB:[27.9427,-82.4518,-5,15],TOR:[43.6435,-79.3791,-5,250],UTA:[40.7683,-111.9011,-7,4226],
 VAN:[49.2778,-123.1089,-8,6],VGK:[36.1029,-115.1783,-8,2030],WSH:[38.8981,-77.0209,-5,25],WPG:[49.8928,-97.1436,-6,781]
});
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const norm=v=>String(v||"").trim().toUpperCase().replace(/^L.?A.?$/,"LA").replace(/^N.?J.?$/,"NJ").replace(/^S.?J.?$/,"SJ").replace(/^T.?B.?$/,"TB");
const iso=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?new Date(t).toISOString():null};
const clock=v=>{if(v==null)return null;const n=Number(v);if(Number.isFinite(n))return n;const m=String(v).match(/^(?:(\d+):)?(\d+):(\d+)$/);return m?Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]):null};
const dist=(a,b)=>{if(!a||!b)return 0;const R=3958.8,r=Math.PI/180,dla=(b[0]-a[0])*r,dlo=(b[1]-a[1])*r,h=Math.sin(dla/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dlo/2)**2;return 2*R*Math.asin(Math.sqrt(h))};

export function normalizeNhlTeamKey(v){return norm(v)}
export function nhlSeasonId(d=new Date()){const x=new Date(d),y=x.getUTCFullYear(),m=x.getUTCMonth()+1;const start=m>=7?y:y-1;return `${start}${start+1}`}

export function deriveNhlScheduleStress(schedule=[],teamKey){
  const team=norm(teamKey),rows=[...(schedule||[])].filter(x=>x.startTime).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
  let roadRun=0;
  return rows.map((g,i)=>{
    const t=Date.parse(g.startTime),prev=rows[i-1],prevT=Date.parse(prev?.startTime||"");
    const days=Number.isFinite(prevT)?(t-prevT)/86400000:null,rest=days==null?null:Math.max(0,days-1);
    const within=(daysBack)=>rows.filter((x,j)=>j<i&&t-Date.parse(x.startTime)<=daysBack*86400000).length+1;
    const b2b=rest!=null&&rest<.6,three4=within(4)>=3,four6=within(6)>=4;
    const venue=norm(g.venueTeamKey||g.homeTeamKey||(g.homeAway==="home"?team:g.opponentKey)),prevVenue=norm(prev?.venueTeamKey||prev?.homeTeamKey||(prev?.homeAway==="home"?team:prev?.opponentKey));
    const miles=i?dist(GEO[prevVenue],GEO[venue]):0,zones=i&&GEO[prevVenue]&&GEO[venue]?Math.abs(GEO[venue][2]-GEO[prevVenue][2]):0;
    const away=String(g.homeAway||"").toLowerCase()==="away";roadRun=away?roadRun+1:0;
    const reasons=[];if(b2b)reasons.push("BACK_TO_BACK");if(three4)reasons.push("THREE_IN_FOUR");if(four6)reasons.push("FOUR_IN_SIX");
    if(miles>=1500)reasons.push("LONG_TRAVEL");if(zones>=2)reasons.push("MULTI_TIME_ZONE");if(away&&GEO[venue]?.[3]>=4000)reasons.push("ALTITUDE_ROAD_GAME");if(roadRun>=3)reasons.push("LONG_ROAD_SEQUENCE");
    const stress=clamp((b2b?.30:0)+(three4?.20:0)+(four6?.20:0)+Math.min(.18,miles/10000)+Math.min(.12,zones*.04)+Math.min(.12,Math.max(0,roadRun-1)*.04),0,1);
    return {...g,teamKey:team,restDays:rest,backToBack:b2b,threeInFour:three4,fourInSix:four6,travelMiles:Math.round(miles),timeZonesCrossed:zones,altitudeFeet:GEO[venue]?.[3]??null,roadTripGameNumber:roadRun,consecutiveRoadGames:roadRun,scheduleStressScore:Number(stress.toFixed(3)),stressReasons:reasons};
  });
}
export function nhlScheduleSummary(schedule=[],teamKey,{asOf=new Date().toISOString()}={}){
  const rows=deriveNhlScheduleStress(schedule,teamKey),cut=Date.parse(asOf),future=rows.filter(x=>Date.parse(x.startTime)>=cut);
  return {nextGame:future[0]||null,backToBacks:rows.filter(x=>x.backToBack).length,threeInFour:rows.filter(x=>x.threeInFour).length,fourInSix:rows.filter(x=>x.fourInSix).length,totalTravelMiles:rows.reduce((s,x)=>s+(x.travelMiles||0),0),weakSpots:future.filter(x=>x.scheduleStressScore>=.35).slice(0,12)};
}

export function buildShiftDeployment(shifts=[],roster=[]){
  const rosterById=new Map((roster||[]).map(p=>[String(p.id),p])),byPlayer=new Map(),byTeam=new Map();
  for(const s of shifts||[]){
    const pid=String(s.playerId||s.player_id||""),team=norm(s.teamAbbrev||s.team||s.team_abbrev),start=clock(s.startTime??s.start_time),end=clock(s.endTime??s.end_time);
    if(!pid||!team||start==null||end==null||end<=start)continue;
    if(!byPlayer.has(pid))byPlayer.set(pid,{playerId:pid,team,seconds:0,intervals:[]});
    const x=byPlayer.get(pid);x.seconds+=end-start;x.intervals.push([Number(s.period||1),start,end]);
    if(!byTeam.has(team))byTeam.set(team,[]);if(!byTeam.get(team).includes(pid))byTeam.get(team).push(pid);
  }
  const overlap=(a,b)=>{let z=0;for(const x of a||[])for(const y of b||[])if(x[0]===y[0])z+=Math.max(0,Math.min(x[2],y[2])-Math.max(x[1],y[1]));return z};
  const out={},edges=[];
  for(const [team,ids] of byTeam){
    for(const pid of ids){
      const a=byPlayer.get(pid),p=rosterById.get(pid)||{},mates=[];
      for(const qid of ids){if(qid===pid)continue;const q=rosterById.get(qid)||{};if(String(p.position||"")==="G"||String(q.position||"")==="G")continue;const sec=overlap(a.intervals,byPlayer.get(qid)?.intervals);if(sec>0)mates.push({playerId:qid,name:q.name||null,position:q.position||null,overlapSeconds:Math.round(sec)});}
      mates.sort((x,y)=>y.overlapSeconds-x.overlapSeconds);
      out[pid]={playerId:pid,team,toiSeconds:Math.round(a.seconds),linemates:mates.slice(0,5)};
      for(const m of mates.slice(0,5))edges.push({teamKey:team,playerId:pid,linemateId:m.playerId,overlapSeconds:m.overlapSeconds});
    }
  }
  return {players:out,edges};
}

export function inferNhlRoles(roster=[],statsById={},deployment={players:{}}){
  const rows=(roster||[]).map(p=>{const s=statsById[String(p.id)]||{},d=deployment.players?.[String(p.id)]||{};return {...p,toiSeconds:finite(d.toiSeconds)??finite(s.toiPerGame)??0,ppToiSeconds:finite(s.ppToiPerGame)??0,shotsPerGame:finite(s.shotsPerGame),pointsPerGame:finite(s.pointsPerGame),linemates:d.linemates||[]};});
  const sk=rows.filter(x=>x.position!=="G"),goalies=rows.filter(x=>x.position==="G");
  const fw=sk.filter(x=>x.position!=="D").sort((a,b)=>b.toiSeconds-a.toiSeconds),df=sk.filter(x=>x.position==="D").sort((a,b)=>b.toiSeconds-a.toiSeconds);
  fw.forEach((p,i)=>p.evRole="L"+Math.min(4,Math.floor(i/3)+1));df.forEach((p,i)=>p.evRole="D"+Math.min(3,Math.floor(i/2)+1));
  const pp=sk.slice().sort((a,b)=>b.ppToiSeconds-a.ppToiSeconds);pp.forEach((p,i)=>p.ppUnit=p.ppToiSeconds<30?"NONE":i<5?"PP1":i<10?"PP2":"NONE");
  return {skaters:sk,goalies};
}

export function resolveNhlPlayerState({player,priorState=null,lastScratch=false,lastGameActive=false,observedAt=new Date().toISOString()}={}){
  const priorStatus=String(priorState?.status||"UNKNOWN"),priorAt=iso(priorState?.state_source_timestamp||priorState?.as_of);
  if(lastGameActive)return {status:"ACTIVE",source:"ACTUAL_GAME_ROSTER",sourceTimestamp:observedAt,carriedForward:false,confidence:.98};
  if(lastScratch)return {status:"CONFIRMED_SCRATCH",source:"NHL_GAMECENTER_SCRATCH",sourceTimestamp:observedAt,carriedForward:false,confidence:.99};
  if(["OUT","IR","CONFIRMED_SCRATCH","RETURN_PENDING","QUESTIONABLE"].includes(priorStatus)&&priorAt){
    const age=(Date.parse(observedAt)-Date.parse(priorAt))/3600000;
    return {status:priorStatus,source:"PERSISTED_STATE",sourceTimestamp:priorAt,carriedForward:true,confidence:clamp(.92-age/240,.55,.92)};
  }
  return {status:"ROSTERED",source:"NHL_OFFICIAL_ROSTER",sourceTimestamp:observedAt,carriedForward:false,confidence:.86};
}

export function replacementCandidates(playerId,players=[]){
  const target=players.find(x=>String(x.id)===String(playerId));if(!target)return[];
  const roleNum=v=>Number(String(v||"").match(/\d+/)?.[0]||9);
  return players.filter(x=>String(x.id)!==String(playerId)&&x.position!=="G").map(x=>{
    let score=0;if(x.position===target.position)score+=3;if(String(x.evRole||"")[0]===String(target.evRole||"")[0])score+=1.5;
    score+=Math.max(0,3-Math.abs(roleNum(x.evRole)-roleNum(target.evRole)));if(x.ppUnit===target.ppUnit&&target.ppUnit!=="NONE")score+=2;
    const mate=(target.linemates||[]).find(m=>String(m.playerId)===String(x.id));if(mate)score+=Math.min(3,mate.overlapSeconds/500);
    score+=(finite(x.toiSeconds)||0)/1800;
    return {playerId:String(x.id),playerName:x.name,score:Number(score.toFixed(3)),evRole:x.evRole,ppUnit:x.ppUnit};
  }).sort((a,b)=>b.score-a.score).slice(0,5);
}

export async function loadNhlPersistentProfiles(db,games=[]){
  if(!db?.prepare)return {ok:false,byTeam:{},byPlayer:{},goaliesByTeam:{},reason:"d1_unavailable"};
  const teams=[...new Set((games||[]).flatMap(g=>[norm(g?.home?.abbr),norm(g?.away?.abbr)]).filter(Boolean))];
  if(!teams.length)return {ok:true,byTeam:{},byPlayer:{},goaliesByTeam:{}};
  const qs=teams.map(()=>"?").join(",");
  const [tp,pp,gp]=await Promise.all([
    db.prepare(`SELECT team_key,as_of,profile_json,state_confidence FROM nhl_team_profiles WHERE team_key IN (${qs})`).bind(...teams).all(),
    db.prepare(`SELECT * FROM nhl_player_state_profiles WHERE team_key IN (${qs})`).bind(...teams).all(),
    db.prepare(`SELECT * FROM nhl_goalie_state_profiles WHERE team_key IN (${qs})`).bind(...teams).all()
  ]);
  const byTeam={};for(const r of tp.results||[]){try{byTeam[r.team_key]={...JSON.parse(r.profile_json),stateConfidence:r.state_confidence,asOf:r.as_of}}catch{}}
  const byPlayer={};for(const r of pp.results||[])byPlayer[String(r.player_id)]={...r,linemates:safe(r.linemates_json,[]),replacements:safe(r.replacement_json,[])};
  const goaliesByTeam={};for(const r of gp.results||[]){if(!goaliesByTeam[r.team_key])goaliesByTeam[r.team_key]=[];goaliesByTeam[r.team_key].push(r)}
  return {ok:Object.keys(byTeam).length>0,byTeam,byPlayer,goaliesByTeam,teamsRequested:teams.length,teamsLoaded:Object.keys(byTeam).length};
}
function safe(s,f){try{return JSON.parse(s)}catch{return f}}

export function persistentOpportunityForGame(persistent,game){
  const home=norm(game?.home?.abbr),away=norm(game?.away?.abbr),side=(team)=>persistent?.byTeam?.[team]?.deployment||{};
  const pack=(team)=>{
    const prof=persistent?.byTeam?.[team]||{},dep=side(team),avail=prof.availability||{};
    return {team,available:Boolean(prof.teamKey||prof.team_key||prof.roster),asOf:prof.asOf||prof.as_of||null,scratched:avail.scratched||[],out:avail.out||[],deployment:dep,schedule:prof.schedule||{},goalies:persistent?.goaliesByTeam?.[team]||[]};
  };
  return {available:Boolean(persistent?.byTeam?.[home]||persistent?.byTeam?.[away]),source:"NHL_PERSISTENT_D1",home:pack(home),away:pack(away)};
}
