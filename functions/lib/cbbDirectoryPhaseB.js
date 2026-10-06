import { cbbdGet, cbbSeasonYear } from "./collegeApi.js";
import { mapSourceTeam } from "./collegeIdentity.js";
import { normalizeCbbIdentity } from "./cbbPersistentDirectory.js";


const SD_BASE="https://github.com/sportsdataverse/sportsdataverse-data/releases/download";
const SD={
 roster:{tag:"espn_mens_college_basketball_rosters",asset:"rosters_2027.csv"},
 teams:{tag:"mbb_crosswalk",asset:"mbb_team_crosswalk_2026.csv"},
 games:{tag:"espn_mens_college_basketball_schedules",asset:"mbb_schedule_2027.csv"},
 stats:{tag:"espn_mens_college_basketball_player_season_stats",asset:"player_season_stats_2026.csv"},
 gameRosters:{tag:"espn_mens_college_basketball_game_rosters",asset:"game_rosters_2026.csv"}
};
function csvRows(text){const rows=[];let row=[],field="",quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++}else if(ch==='"')quoted=false;else field+=ch}else if(ch==='"')quoted=true;else if(ch===','){row.push(field);field=""}else if(ch==='\n'){row.push(field.replace(/\r$/,""));rows.push(row);row=[];field=""}else field+=ch}if(field||row.length){row.push(field.replace(/\r$/,""));rows.push(row)}if(!rows.length)return[];const h=rows.shift();return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??""])))}
async function sdGet(spec){try{const url=SD_BASE+"/"+spec.tag+"/"+spec.asset,r=await fetch(url,{headers:{"user-agent":"FBIS-CBB-Phase-B/1.0"}});if(!r.ok)return{ok:false,status:r.status,reason:"sportsdataverse-http-"+r.status,data:[]};const data=csvRows(await r.text());return{ok:true,status:r.status,n:data.length,data,source:{tag:spec.tag,asset:spec.asset,url}}}catch(e){return{ok:false,status:0,reason:String(e?.message||e),data:[]}}}
function sdRoster(rows){return rows.map(x=>({id:x.athlete_id,athleteId:x.athlete_id,name:x.full_name||x.display_name,team:x.team_display_name,teamId:x.team_id,position:x.position_abbreviation||x.position_name,year:x.experience_display_value||x.experience_years,height:x.height,weight:x.weight,uid:x.uid,guid:x.guid}))}
function sdTeams(rows){return rows.map(x=>({id:x.espn_team_id,teamId:x.espn_team_id,team:x.espn_display_name,name:x.espn_display_name,conference:x.espn_conference}))}
function sdGames(rows){return rows.map(x=>({id:x.game_id||x.id,startDate:x.game_date_time||x.start_date||x.date,homeTeam:x.home_display_name,homeTeamId:x.home_id,awayTeam:x.away_display_name,awayTeamId:x.away_id,neutralSite:String(x.neutral_site).toLowerCase()==="true",venueId:x.venue_id,venueName:x.venue_full_name}))}
function sdStats(rows,gameRosterRows){const m=new Map();for(const x of rows){const id=String(x.athlete_id||""),tid=String(x.team_id||"");if(!id||!tid)continue;const k=id+"|"+tid;if(!m.has(k))m.set(k,{athleteId:id,teamId:tid,team:x.team_display_name,games:0,starts:0,minutes:0});const o=m.get(k),name=String(x.stat_name||x.stat_label||"").toLowerCase(),v=Number(x.value);if(!Number.isFinite(v))continue;if(name==="gamesplayed"||name==="games")o.games=Math.max(o.games,v);else if(name==="gamesstarted"||name==="starts")o.starts=Math.max(o.starts,v);else if(name==="minutes")o.minutes=Math.max(o.minutes,v);else if(name==="usage"||name==="usagerate")o.usage=v}
 const gr=new Map();for(const x of gameRosterRows||[]){const id=String(x.athlete_id||""),tid=String(x.team_id||"");if(!id||!tid)continue;const k=id+"|"+tid;if(!gr.has(k))gr.set(k,{games:new Set(),starts:0});const z=gr.get(k);z.games.add(String(x.game_id||""));if(String(x.starter).toLowerCase()==="true")z.starts++}
 for(const [k,z] of gr){if(!m.has(k)){const [id,tid]=k.split("|");m.set(k,{athleteId:id,teamId:tid,games:0,starts:0,minutes:0})}const o=m.get(k);o.games=Math.max(o.games,z.games.size);o.starts=Math.max(o.starts,z.starts)}
 return [...m.values()]
}

const FAR_FUTURE="9999-12-31T23:59:59.999Z";
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const norm=normalizeCbbIdentity;
const iso=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null};
const js=v=>JSON.stringify(v??null);
function hid(...p){let h=2166136261;for(const ch of p.map(v=>String(v??"")).join("|")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,"0")}
function pidOf(x){const v=x?.id??x?.athleteId??x?.athleteSourceId??x?.playerId??x?.athlete?.id;return v==null?"":String(v)}
function nameOf(x){return x?.name||x?.displayName||x?.athleteName||x?.athlete?.displayName||[x?.firstName,x?.lastName].filter(Boolean).join(" ")||null}
function posOf(x){return x?.position?.abbreviation||x?.position?.name||x?.position||x?.positionAbbreviation||null}
function classOf(x){return x?.year||x?.classYear||x?.class||x?.academicYear||null}
function heightOf(x){if(x?.height)return String(x.height);if(x?.heightText)return String(x.heightText);const f=n(x?.heightFeet),i=n(x?.heightInches);return f!=null&&i!=null?String(f)+"ft "+String(i)+"in":null}
function sizeOf(x){return x?.weight??x?.weightText??null}
function rosterRows(rows=[]){const out=[];for(const r of rows||[]){const a=Array.isArray(r?.players)?r.players:Array.isArray(r?.roster)?r.roster:null;if(a){for(const p of a)out.push({...p,__team:r.team||r.school||r.name||r.displayName,__teamId:r.teamId||r.id})}else out.push({...r,__team:r.team||r.school||r.teamName||r.team?.school||r.team?.name,__teamId:r.teamId||r.team?.id})}return out}
function teamMap(name,id,season){const m=mapSourceTeam("cbb",{id,team:name,school:name},season);return m?.ok?m.canonicalId:null}
function rosterTeam(x,season){return teamMap(x.__team,x.__teamId,season)}
function statTeam(x,season){return teamMap(x?.team||x?.school||x?.teamName||x?.team?.school||x?.team?.name,x?.teamId||x?.team?.id,season)}
function teamId(x,season){return teamMap(x?.team||x?.school||x?.name||x?.displayName||x?.location||x?.team?.school||x?.team?.name,x?.teamId??x?.id??x?.sourceId??x?.team?.id,season)}
function gameTeamIds(g,season){return{home:teamMap(g?.homeTeam||g?.home_team||g?.home?.school||g?.home?.name,g?.homeTeamId||g?.home?.id,season),away:teamMap(g?.awayTeam||g?.away_team||g?.away?.school||g?.away?.name,g?.awayTeamId||g?.away?.id,season)}}
function gameStart(g){return iso(g?.startDate||g?.start_date||g?.date||g?.startTime||g?.start_time)}
function confOf(t){return t?.conference?.abbreviation||t?.conference?.name||t?.conferenceAbbreviation||t?.conference||null}
function coachOf(t){return t?.headCoach?.name||t?.headCoach||t?.coach?.name||t?.coach||null}
function venueOf(t){const v=t?.venue&&typeof t.venue==="object"?t.venue:{};return{id:t?.venueId??v.id??null,name:(typeof t?.venue==="string"?t.venue:null)??t?.venueName??v.name??null,lat:n(t?.venueLatitude??v.latitude??v.lat),lon:n(t?.venueLongitude??v.longitude??v.lon??v.lng)}}
function hav(a,b){if(!a||!b||a.lat==null||a.lon==null||b.lat==null||b.lon==null)return null;const r=3958.7613,d=Math.PI/180,dl=(b.lat-a.lat)*d,dn=(b.lon-a.lon)*d,q=Math.sin(dl/2)**2+Math.cos(a.lat*d)*Math.cos(b.lat*d)*Math.sin(dn/2)**2;return 2*r*Math.asin(Math.sqrt(q))}
async function first(db,sql,...p){return db.prepare(sql).bind(...p).first()}
async function all(db,sql,...p){const r=await db.prepare(sql).bind(...p).all();return r?.results||[]}
function st(db,sql,...p){return db.prepare(sql).bind(...p)}
async function batches(db,a,size=60){for(let i=0;i<a.length;i+=size)await db.batch(a.slice(i,i+size))}

export async function refreshCbbDirectoryPhaseB(env={},opts={}){
  const db=env.DB;if(!db)return{ok:false,status:"failed",reason:"d1-unbound"};
  const now=iso(opts.observedAt||new Date())||new Date().toISOString();
  const season=Number(opts.season??cbbSeasonYear(new Date(now))),priorSeason=season-1,day=now.slice(0,10);
  if(!await first(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='cbb_directory_phase_b_runs'"))return{ok:true,status:"skipped",reason:"phase-b-schema-not-applied",season};
  const done=await first(db,"SELECT id,qa_json FROM cbb_directory_phase_b_runs WHERE season=? AND substr(observed_at,1,10)=? AND status='COMPLETE' ORDER BY observed_at DESC LIMIT 1",season,day);
  if(done&&!opts.force)return{ok:true,status:"already_complete",runId:done.id,qa:JSON.parse(done.qa_json||"{}")};

  const [rawRoster,rawTeams,rawGames,rawStats,rawGameRosters]=await Promise.all([sdGet(SD.roster),sdGet(SD.teams),sdGet(SD.games),sdGet(SD.stats),sdGet(SD.gameRosters)]);
  const primary=[rawRoster,rawTeams,rawGames,rawStats,rawGameRosters];
  const sources=[
    {provider:"SPORTSDATAVERSE_ESPN",kind:"roster",...rawRoster.source,ok:rawRoster.ok,status:rawRoster.status,n:rawRoster.n,reason:rawRoster.reason||null},
    {provider:"SPORTSDATAVERSE_ESPN",kind:"teams",...rawTeams.source,ok:rawTeams.ok,status:rawTeams.status,n:rawTeams.n,reason:rawTeams.reason||null},
    {provider:"SPORTSDATAVERSE_ESPN",kind:"games",...rawGames.source,ok:rawGames.ok,status:rawGames.status,n:rawGames.n,reason:rawGames.reason||null},
    {provider:"SPORTSDATAVERSE_ESPN",kind:"stats",...rawStats.source,ok:rawStats.ok,status:rawStats.status,n:rawStats.n,reason:rawStats.reason||null},
    {provider:"SPORTSDATAVERSE_ESPN",kind:"game_rosters",...rawGameRosters.source,ok:rawGameRosters.ok,status:rawGameRosters.status,n:rawGameRosters.n,reason:rawGameRosters.reason||null}
  ];
  if(!primary.every(x=>x.ok))return{ok:false,status:"failed",reason:"bounded-sportsdataverse-source-failure",season,sources};
  const rr={ok:true,data:sdRoster(rawRoster.data)},tr={ok:true,data:sdTeams(rawTeams.data)},gr={ok:true,data:sdGames(rawGames.data)},sr={ok:true,data:sdStats(rawStats.data,rawGameRosters.data)};

  const canonicalTeams=Number((await first(db,"SELECT COUNT(*) n FROM cbb_canonical_teams WHERE classification='D1'"))?.n||0);
  const prior=await all(db,"SELECT DISTINCT p.player_id,p.canonical_name,m.team_id,m.season FROM cbb_players p JOIN cbb_roster_membership m ON m.player_id=p.player_id WHERE m.season<=?",priorSeason);
  const prov=await all(db,"SELECT player_id,provider_player_id FROM cbb_player_provider_ids WHERE provider='ESPN'");
  const provMap=new Map(prov.map(x=>[String(x.provider_player_id),String(x.player_id)]));
  const byKey=new Map(),bySeasonKey=new Map();
  for(const p of prior){const k=p.team_id+"|"+norm(p.canonical_name);if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(p);const sk=String(p.season)+"|"+k;if(!bySeasonKey.has(sk))bySeasonKey.set(sk,[]);bySeasonKey.get(sk).push(p)}
  const stats=Array.isArray(sr.data)?sr.data:[],statMap=new Map();for(const x of stats){const id=pidOf(x);if(id)statMap.set(id,x)}

  const current=[],ambiguous=[],transfers=[];
  for(const x of rosterRows(Array.isArray(rr.data)?rr.data:[])){
    const provider=pidOf(x),name=nameOf(x),tid=rosterTeam(x,season);if(!provider||!name||!tid)continue;
    let playerId=provMap.get(provider)||null,basis=playerId?"EXISTING_PROVIDER_ID":null;
    const ps=statMap.get(provider)||null,ptid=ps?statTeam(ps,priorSeason):null;
    if(!playerId&&ps&&ptid){const hits=bySeasonKey.get(String(priorSeason)+"|"+ptid+"|"+norm(name))||[];if(hits.length===1){playerId=hits[0].player_id;basis="PROVIDER_PRIOR_SEASON_TEAM_NAME"}else if(hits.length>1){ambiguous.push({provider,name,currentTeamId:tid,priorTeamId:ptid,candidates:hits.map(v=>v.player_id)});continue}}
    if(!playerId){const hits=byKey.get(tid+"|"+norm(name))||[];if(hits.length===1){playerId=hits[0].player_id;basis="CURRENT_TEAM_NAME_UNIQUE"}else if(hits.length>1){ambiguous.push({provider,name,currentTeamId:tid,candidates:hits.map(v=>v.player_id)});continue}}
    if(!playerId){playerId="cbb:provider:"+provider;basis="NEW_STABLE_PROVIDER_ID"}
    if(ptid&&ptid!==tid&&basis==="PROVIDER_PRIOR_SEASON_TEAM_NAME")transfers.push({playerId,provider,fromTeamId:ptid,toTeamId:tid});
    provMap.set(provider,playerId);
    current.push({playerId,provider,name,tid,position:posOf(x),classYear:classOf(x),height:heightOf(x),size:sizeOf(x),basis,priorStat:ps,priorTid:ptid});
  }
  const uniq=new Map();for(const p of current)uniq.set(p.provider,p);const players=[...uniq.values()];
  const byTeam=new Map();for(const p of players){if(!byTeam.has(p.tid))byTeam.set(p.tid,[]);byTeam.get(p.tid).push(p)}

  const ctx=new Map();for(const x of Array.isArray(tr.data)?tr.data:[]){const tid=teamId(x,season);if(tid)ctx.set(tid,{conference:confOf(x),coach:coachOf(x),venue:venueOf(x)})}
  const priorMembers=new Set(prior.filter(x=>Number(x.season)===priorSeason).map(x=>x.player_id+"|"+x.team_id));
  const rotations=new Map();
  for(const p of players){const s=p.priorStat;if(!s||p.priorTid!==p.tid)continue;const games=n(s.games)||0,starts=n(s.starts)||0,minutes=n(s.minutes)||0,mpg=games?minutes/games:null;if(mpg==null)continue;const row={...p,games,starts,minutes,mpg,expectedMinutes:Math.max(0,Math.min(40,mpg)),starterEvidence:games?starts/games:null,usage:n(s.usage)};if(!rotations.has(p.tid))rotations.set(p.tid,[]);rotations.get(p.tid).push(row)}
  for(const a of rotations.values())a.sort((x,y)=>y.expectedMinutes-x.expectedMinutes||x.name.localeCompare(y.name));

  const replacements=new Map(),derived=new Map();
  for(const [tid,roster] of byTeam){const rot=rotations.get(tid)||[],rank=new Map(rot.map((p,i)=>[p.playerId,i+1]));const cont=roster.length?roster.filter(p=>priorMembers.has(p.playerId+"|"+tid)).length/roster.length:null;for(const p of rot){const same=rot.filter(x=>x.playerId!==p.playerId&&p.position&&x.position===p.position),pool=same.length?same:rot.filter(x=>x.playerId!==p.playerId),r=pool.find(x=>(rank.get(x.playerId)||999)>(rank.get(p.playerId)||0))||pool[0]||null;if(r)replacements.set(p.playerId,{playerId:r.playerId,name:r.name,rotationRank:rank.get(r.playerId),basis:same.length?"SAME_POSITION_PRIOR_MINUTES":"PRIOR_MINUTES"})}derived.set(tid,{continuity:cont,rotation:rot,expected:rot.slice(0,5).map((p,i)=>({playerId:p.playerId,name:p.name,rank:i+1,expectedMinutes:p.expectedMinutes,starterEvidence:p.starterEvidence,basis:"PRIOR_SEASON_SAME_TEAM"})),bench:rot.slice(5).map((p,i)=>({playerId:p.playerId,name:p.name,rank:i+6,expectedMinutes:p.expectedMinutes}))})}

  const games=(Array.isArray(gr.data)?gr.data:[]).map(g=>{const z=gameTeamIds(g,season);return{raw:g,id:String(g.id??g.gameId??g.game_id??""),start:gameStart(g),home:z.home,away:z.away,neutral:Boolean(g.neutralSite??g.neutral_site??g.neutral)}}).filter(g=>g.id&&g.start&&g.home&&g.away);
  const tg=new Map();for(const g of games){for(const q of [[g.home,"HOME",g.away],[g.away,"AWAY",g.home]]){if(!tg.has(q[0]))tg.set(q[0],[]);tg.get(q[0]).push({g,ha:q[1],opp:q[2]})}}for(const a of tg.values())a.sort((x,y)=>x.g.start.localeCompare(y.g.start));
  const sched=new Map();for(const [tid,a] of tg){for(let i=0;i<a.length;i++){const x=a[i],prev=a[i-1],rest=prev?Math.max(0,(Date.parse(x.g.start)-Date.parse(prev.g.start))/86400000-1):null,prior7=a.slice(0,i).filter(y=>Date.parse(x.g.start)-Date.parse(y.g.start)<=7*86400000).length,origin=ctx.get(tid)?.venue||null,dest=x.ha==="HOME"?origin:ctx.get(x.opp)?.venue||null;sched.set(tid+"|"+x.g.id,{restDays:rest,travelMiles:x.g.neutral?null:hav(origin,dest),fixtureCongestion:{prior7Days:prior7},homeAway:x.ha,opponentTeamId:x.opp,start:x.g.start})}}

  const w=[],events=[];
  for(const p of players){
    w.push(st(db,"INSERT INTO cbb_players(player_id,canonical_name,identity_status,provider_player_id,position,class_year,height_text,size_text,first_observed_at,last_observed_at,source_json,research_only,can_influence_projection,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET canonical_name=excluded.canonical_name,identity_status='STABLE_PROVIDER',provider_player_id=excluded.provider_player_id,position=COALESCE(excluded.position,cbb_players.position),class_year=COALESCE(excluded.class_year,cbb_players.class_year),height_text=COALESCE(excluded.height_text,cbb_players.height_text),size_text=COALESCE(excluded.size_text,cbb_players.size_text),last_observed_at=excluded.last_observed_at,source_json=excluded.source_json,updated_at=excluded.updated_at",p.playerId,p.name,"STABLE_PROVIDER",p.provider,p.position,p.classYear,p.height,p.size,now,now,js({source:"SportsDataverse ESPN roster release",season,identityLinkBasis:p.basis}),1,0,now,now));
    w.push(st(db,"INSERT OR IGNORE INTO cbb_player_provider_ids(id,player_id,provider,provider_player_id,evidence_type,observed_at,confidence,provenance_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)","provider:"+hid(p.provider),p.playerId,"ESPN",p.provider,p.basis,now,1,js({endpoint:"/teams/roster",season,priorSeason}),now));
    w.push(st(db,"INSERT OR IGNORE INTO cbb_player_aliases(id,player_id,alias,normalized_alias,source,observed_at,confidence,created_at) VALUES(?,?,?,?,?,?,?,?)","phaseb-alias:"+hid(p.playerId,p.name),p.playerId,p.name,norm(p.name),"SPORTSDATAVERSE_ESPN_ROSTER",now,1,now));
    w.push(st(db,"INSERT OR IGNORE INTO cbb_roster_observations(id,player_id,team_id,season,provider_player_id,canonical_name,position,class_year,height_text,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)","roster-b:"+hid(p.provider,p.tid,season,day),p.playerId,p.tid,season,p.provider,p.name,p.position,p.classYear,p.height,now,now,now,"SPORTSDATAVERSE_ESPN_ROSTER",js({endpoint:"/teams/roster",season,identityLinkBasis:p.basis}),1,0,null,1,1,now));
    w.push(st(db,"INSERT OR IGNORE INTO cbb_roster_membership(id,player_id,team_id,season,effective_from,effective_to,pit_resolvable,membership_basis,source,observed_at,confidence,provenance_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)","member-b:"+hid(p.provider,p.tid,season),p.playerId,p.tid,season,now,FAR_FUTURE,1,"VERIFIED_PROVIDER_ROSTER","SPORTSDATAVERSE_ESPN_ROSTER",now,1,js({providerPlayerId:p.provider,identityLinkBasis:p.basis}),now));
    events.push(st(db,"INSERT OR IGNORE INTO cbb_state_events(id,entity_type,entity_id,team_id,game_id,season,state_family,state_value_json,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,can_influence_projection,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)","state-b-roster:"+hid(p.provider,p.tid,day),"player",p.playerId,p.tid,null,season,"CURRENT_ROSTER",js({providerPlayerId:p.provider,position:p.position,classYear:p.classYear,height:p.height,identityLinkBasis:p.basis}),now,now,now,"SPORTSDATAVERSE_ESPN_ROSTER",js({endpoint:"/teams/roster",season}),1,0,null,1,1,0,now));
  }

  let confTeams=0,coachTeams=0,venueTeams=0;
  for(const [tid,t] of ctx){if(t.conference)confTeams++;if(t.coach)coachTeams++;if(t.venue.name)venueTeams++;
    w.push(st(db,"INSERT OR IGNORE INTO cbb_team_context_observations(id,team_id,season,conference,head_coach,coach_tenure_start,venue_id,venue_name,venue_latitude,venue_longitude,hca_reference,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)","teamctx:"+hid(tid,season,day),tid,season,t.conference,t.coach,null,t.venue.id,t.venue.name,t.venue.lat,t.venue.lon,null,now,now,now,"SPORTSDATAVERSE_ESPN_TEAMS",js({endpoint:"/teams",season}),.95,0,null,1,1,now));
    if(t.conference)w.push(st(db,"INSERT OR IGNORE INTO cbb_conference_membership(id,team_id,conference_name,effective_from,effective_to,source,observed_at,confidence,provenance_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)","conf-b:"+hid(tid,season,t.conference),tid,t.conference,now,FAR_FUTURE,"SPORTSDATAVERSE_ESPN_TEAMS",now,.95,js({endpoint:"/teams",season}),now));
    w.push(st(db,"UPDATE cbb_canonical_teams SET current_conference=COALESCE(?,current_conference),home_venue=COALESCE(?,home_venue),head_coach_name=COALESCE(?,head_coach_name),last_observed_at=?,updated_at=? WHERE team_id=?",t.conference,t.venue.name,t.coach,now,now,tid));
  }

  let rotN=0,starterN=0,replN=0,contTeams=0;
  for(const [tid,d] of derived){if(d.continuity!=null)contTeams++;for(let i=0;i<d.rotation.length;i++){const p=d.rotation[i],rank=i+1,repl=replacements.get(p.playerId)||null;rotN++;if(p.starterEvidence!=null)starterN++;if(repl)replN++;
    w.push(st(db,"INSERT OR IGNORE INTO cbb_rotation_observations(id,player_id,team_id,season,as_of,games,starts,minutes,minutes_per_game,recent_minutes,expected_minutes,starter_evidence,rotation_rank,usage_rate,source,provenance_json,confidence,observed_at,effective_at,ingested_at,stale,supersedes_id,pit_eligible,research_only,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)","rot-b:"+hid(p.provider,season,day),p.playerId,tid,season,now,p.games,p.starts,p.minutes,p.mpg,p.mpg,p.expectedMinutes,p.starterEvidence,rank,p.usage,"SPORTSDATAVERSE_ESPN_PLAYER_SEASON_PRIOR",js({endpoint:"/stats/player/season",sourceSeason:priorSeason,rule:"prior-season baseline only when provider identity and team match verified current roster"}),.75,now,now,now,0,null,1,1,now));
    w.push(st(db,"INSERT OR IGNORE INTO cbb_player_state_snapshots(id,player_id,team_id,season,as_of,starter_role,rotation_rank,recent_minutes,expected_minutes,usage_role,availability_status,injury_status,replacement_json,source,provenance_json,confidence,research_only,can_influence_projection,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)","player-b-snap:"+hid(p.playerId,day),p.playerId,tid,season,now,p.starterEvidence!=null&&p.starterEvidence>=.5?"PRIOR_STARTER_BASELINE":"UNKNOWN",rank,p.mpg,p.expectedMinutes,p.usage!=null?String(p.usage):"UNKNOWN","UNKNOWN","UNKNOWN",repl?js(repl):null,"SPORTSDATAVERSE_ESPN_PHASE_B",js({rotation:"prior-season same-team only",availability:"UNKNOWN absent explicit verified source"}),.75,1,0,now));
    events.push(st(db,"INSERT OR IGNORE INTO cbb_state_events(id,entity_type,entity_id,team_id,game_id,season,state_family,state_value_json,observed_at,effective_at,ingested_at,source,provenance_json,confidence,stale,supersedes_id,pit_eligible,research_only,can_influence_projection,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)","state-b-rotation:"+hid(p.provider,season,day),"player",p.playerId,tid,null,season,"ROTATION_BASELINE",js({rotationRank:rank,expectedMinutes:p.expectedMinutes,starterEvidence:p.starterEvidence,replacement:repl}),now,now,now,"SPORTSDATAVERSE_ESPN_PLAYER_SEASON_PRIOR",js({sourceSeason:priorSeason,teamMatch:true}),.75,0,null,1,1,0,now));
  }
    w.push(st(db,"INSERT OR IGNORE INTO cbb_team_state_snapshots(id,team_id,season,as_of,last_verified_starting_lineup_json,expected_starting_lineup_json,lineup_continuity,rotation_hierarchy_json,bench_hierarchy_json,schedule_state_json,availability_state,source,provenance_json,confidence,research_only,can_influence_projection,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)","team-b-snap:"+hid(tid,day),tid,season,now,null,js(d.expected),d.continuity,js(d.rotation.map((p,i)=>({playerId:p.playerId,name:p.name,rotationRank:i+1,expectedMinutes:p.expectedMinutes,starterEvidence:p.starterEvidence}))),js(d.bench),js({games:(tg.get(tid)||[]).length}),"UNKNOWN","SPORTSDATAVERSE_ESPN_PHASE_B",js({lineupContinuity:"verified current roster vs prior-season persistent identity",expectedLineup:"derived prior-season same-team baseline; not observed current starter fact"}),.75,1,0,now));
  }

  for(const [key,s] of sched){const cut=key.indexOf("|"),tid=key.slice(0,cut),gameId=key.slice(cut+1);w.push(st(db,"INSERT OR IGNORE INTO cbb_schedule_items(id,game_id,team_id,opponent_team_id,season,game_date,home_away,rest_days,travel_miles,fixture_congestion_json,source,observed_at,provenance_json,research_only,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)","sched-b:"+hid(gameId,tid,season),gameId,tid,s.opponentTeamId,season,s.start,s.homeAway,s.restDays,s.travelMiles,js(s.fixtureCongestion),"SPORTSDATAVERSE_ESPN_GAMES",now,js({endpoint:"/games",season,travelRule:s.travelMiles==null?"UNKNOWN_UNVERIFIED_COORDINATES":"VERIFIED_HOME_VENUE_COORDINATES"}),1,now))}

  let snaps=0;
  for(const g of games){if(Date.parse(g.start)<=Date.parse(now))continue;const state=tid=>{const d=derived.get(tid)||{continuity:null,expected:[],rotation:[]},t=ctx.get(tid)||{},r=byTeam.get(tid)||[],s=sched.get(tid+"|"+g.id)||null;return{roster:r.map(p=>({playerId:p.playerId,providerPlayerId:p.provider,name:p.name,position:p.position,classYear:p.classYear})),expectedLineup:d.expected,lineupContinuity:d.continuity,rotation:d.rotation.map((p,i)=>({playerId:p.playerId,rank:i+1,expectedMinutes:p.expectedMinutes,starterEvidence:p.starterEvidence,replacement:replacements.get(p.playerId)||null})),availability:{status:"UNKNOWN",verifiedObservations:0},conference:t.conference||null,venue:t.venue||null,schedule:s}};
    w.push(st(db,"INSERT OR IGNORE INTO cbb_game_state_snapshots(id,game_id,season,game_start,feature_cutoff,home_team_id,away_team_id,home_state_json,away_state_json,unresolved_json,temporal_integrity_ok,post_tip_observations,future_membership_leaks,future_availability_leaks,future_lineup_leaks,mode,overlay_version,research_only,can_influence_projection,can_qualify,can_authorize_wager,provenance_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)","gamesnap-b:"+hid(g.id,now),g.id,season,g.start,now,g.home,g.away,js(state(g.home)),js(state(g.away)),js({availability:"UNKNOWN absent explicit verified status source",currentStarters:"UNRESOLVED; expected lineup is derived prior-season research state",travel:sched.get(g.away+"|"+g.id)?.travelMiles==null?"UNKNOWN unless both venue coordinates verified":null}),1,0,0,0,0,"SHADOW","FBIS-STATE-OVERLAY-v1",1,0,0,0,js({roster:"SportsDataverse ESPN roster release",teams:"SportsDataverse ESPN team crosswalk release",games:"SportsDataverse ESPN schedule release",rotation:"SportsDataverse ESPN prior-season stats same-team only",capturedAt:now}),now));snaps++}
  w.push(...events);
  await batches(db,w);

  const stable=Number((await first(db,"SELECT COUNT(DISTINCT player_id) n FROM cbb_player_provider_ids WHERE provider='ESPN'"))?.n||0);
  const unresolved=Number((await first(db,"SELECT COUNT(*) n FROM cbb_players WHERE identity_status='PROVISIONAL'"))?.n||0);
  const rosterTeams=new Set(players.map(x=>x.tid)).size,scheduleTeams=new Set([...sched.keys()].map(k=>k.split("|")[0])).size;
  const posN=players.filter(x=>x.position).length,classN=players.filter(x=>x.classYear).length,heightN=players.filter(x=>x.height).length;
  const qa={id:"CBB-DIRECTORY-PHASE-B-v1",season,priorSeason,observedAt:now,canonicalTeams,stableIdPlayers:stable,unresolvedProvisionalPlayers:unresolved,ambiguousIdentities:ambiguous.length,transferLinks:transfers.length,roster:{players:players.length,teams:rosterTeams,coverage:canonicalTeams?rosterTeams/canonicalTeams:0},biography:{position:players.length?posN/players.length:0,classYear:players.length?classN/players.length:0,height:players.length?heightN/players.length:0},conference:{teams:confTeams,coverage:canonicalTeams?confTeams/canonicalTeams:0},coach:{teams:coachTeams,coverage:canonicalTeams?coachTeams/canonicalTeams:0},venue:{teams:venueTeams,coverage:canonicalTeams?venueTeams/canonicalTeams:0},schedule:{teams:scheduleTeams,coverage:canonicalTeams?scheduleTeams/canonicalTeams:0,games:games.length},availability:{verified:0,unknown:players.length,unknownRate:players.length?1:0,rule:"UNKNOWN absent explicit verified status source"},rotation:{players:rotN,coverage:players.length?rotN/players.length:0,starterEvidencePlayers:starterN,starterEvidenceCoverage:players.length?starterN/players.length:0},lineupContinuity:{teams:contTeams,coverage:rosterTeams?contTeams/rosterTeams:0},replacementHierarchy:{players:replN,coverage:rotN?replN/rotN:0},pit:{gameStateSnapshots:snaps,temporalIntegrityOk:true,postTipObservations:0,futureMembershipLeaks:0,futureAvailabilityLeaks:0,futureLineupLeaks:0},stateEventsAdded:events.length,sources,governance:{overlay:"FBIS-STATE-OVERLAY-v1",mode:"SHADOW",totalsDefinitions:0,canInfluenceProjection:false,canQualify:false,canAuthorizeWager:false}};
  const runId="cbb-dir-b:"+String(season)+":"+day+":"+hid(now,players.length,games.length);
  await db.prepare("INSERT OR REPLACE INTO cbb_directory_phase_b_runs(id,season,observed_at,status,canonical_teams,stable_id_players,unresolved_provisional_players,ambiguous_identities,transfer_links,roster_teams,roster_players,rotation_players,starter_evidence_players,lineup_continuity_teams,replacement_players,schedule_teams,game_state_snapshots,verified_availability,unknown_availability,qa_json,source_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(runId,season,now,"COMPLETE",canonicalTeams,stable,unresolved,ambiguous.length,transfers.length,rosterTeams,players.length,rotN,starterN,contTeams,replN,scheduleTeams,snaps,0,players.length,JSON.stringify(qa),JSON.stringify(sources),now).run();
  return{ok:true,status:"success",season,runId,qa};
}
