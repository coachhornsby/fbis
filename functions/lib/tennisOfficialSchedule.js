/** Official WTA order-of-play ingestion. ESPN never establishes official authority. */
const BASE='https://api.wtatennis.com/tennis';
const iso=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t).toISOString():null;};
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const sourceGroup=t=>String(t?.tournamentGroup?.id||'');
export function officialWtaMatchState(m,t,{now=new Date()}={}) {
 if(String(m.EventID)!==sourceGroup(t)||Number(m.EventYear)!==Number(t.year))return {reason:'OFFICIAL_TOURNAMENT_IDENTITY_MISMATCH'};
 if(m.DrawMatchType!=='S'||m.PlayerIDA2||m.PlayerIDB2)return {reason:'NOT_SINGLES'};
 if(!/^[A-Za-z0-9_-]+$/.test(String(m.MatchID||''))||!/^\d+$/.test(String(m.PlayerIDA||''))||!/^\d+$/.test(String(m.PlayerIDB||''))||String(m.PlayerIDA)===String(m.PlayerIDB))return {reason:'OFFICIAL_PLAYER_IDENTITY_MISSING'};
 if(!['U','P','F'].includes(m.MatchState))return {reason:'MATCH_STATE_UNVERIFIED'};
 if(!t.title||!['Hard','Clay','Grass','Carpet'].includes(t.surface))return {reason:'OFFICIAL_CONTEXT_MISSING'};
 const stamp=iso(m.MatchTimeStamp),start=Date.parse(stamp||'');
 if(m.MatchState==='U') {
  // Followed-by records carry an explicit 23:59 placeholder. Never call it a start.
  if(m.Unscheduled===true||m.isEstimatedStartTime===true||!m.NotBeforeISOTime||!/(Z|[+-]\d{2}:?\d{2})$/.test(m.MatchTimeStamp||'')||!stamp)return {state:'TIME_UNVERIFIED',start:null,reason:'OFFICIAL_START_TIME_UNVERIFIED'};
  const time=String(m.MatchTimeStamp).slice(11).replaceAll(':','').replace(/\.\d+/,'');
  const scheduled=String(m.NotBeforeISOTime).replaceAll(':','');
  if(!time.startsWith(scheduled.slice(0,4))||!time.endsWith(scheduled.slice(4)))return {state:'TIME_UNVERIFIED',start:null,reason:'OFFICIAL_START_CLOCK_MISMATCH'};
  if(start<=+now||start>+now+72*3600000)return {reason:'MATCH_OUTSIDE_UPCOMING_WINDOW'};
  return {state:'SCHEDULED',start:stamp,reason:null};
 }
 if(!stamp||start<+now-36*3600000||start>+now)return {reason:'MATCH_OUTSIDE_RECENT_WINDOW'};
 return {state:m.MatchState==='P'?'IN_PROGRESS':'FINAL',start:stamp,reason:null};
}
export async function ingestOfficialWtaSchedule(db,bucket,t,payload,{now=new Date(),rawText=JSON.stringify(payload)}={}) {
 const group=sourceGroup(t),year=Number(t.year);
 if(!/^\d+$/.test(group)||year!==now.getUTCFullYear()||!Array.isArray(payload?.matches)||sourceGroup(payload.tournament)!==group||Number(payload.tournament?.year)!==year||payload.tournament.surface!==t.surface||payload.tournament.title!==t.title)throw Error('WTA_OFFICIAL_CONTRACT_UNVERIFIED');
 const rawHash=await hash(rawText),rawKey=`tennis/official-schedule/wta/raw/${rawHash}.json`,observedAt=now.toISOString();
 await bucket.put(rawKey,rawText,{httpMetadata:{contentType:'application/json'}});
 const reasons={},fixtures=[];let written=0;
 for(const m of payload.matches) {
  const result=officialWtaMatchState(m,t,{now});
  if(!result.state){reasons[result.reason]=(reasons[result.reason]||0)+1;continue;}
  if(result.reason)reasons[result.reason]=(reasons[result.reason]||0)+1;
  const players=(await db.prepare(`SELECT s.source_player_id,p.fbis_player_id,p.canonical_name,p.tour FROM tennis_player_source_ids s JOIN tennis_players p ON p.fbis_player_id=s.fbis_player_id WHERE s.provider='WTA_OFFICIAL' AND s.source_player_id IN (?,?)`).bind(String(m.PlayerIDA),String(m.PlayerIDB)).all()).results||[];
  const p1=players.filter(p=>p.source_player_id===String(m.PlayerIDA)&&p.tour==='wta'),p2=players.filter(p=>p.source_player_id===String(m.PlayerIDB)&&p.tour==='wta');
  if(p1.length!==1||p2.length!==1||p1[0].fbis_player_id===p2[0].fbis_player_id){reasons.CANONICAL_PLAYER_LINK_MISSING=(reasons.CANONICAL_PLAYER_LINK_MISSING||0)+1;continue;}
  const sourceId=`${year}|${group}|${m.MatchID}`,id=`wta_${(await hash(`WTA_OFFICIAL|wta|${sourceId}`)).slice(0,24)}`;
  const provenance={source:'WTA_OFFICIAL',endpoint:`${BASE}/tournaments/${group}/${year}/matches`,rawHash,observedAt,
   sourceMatchState:m.MatchState,sourceStartTime:m.MatchTimeStamp||null,notBefore:m.NotBefore||null,
   unscheduled:m.Unscheduled===true,isEstimatedStartTime:m.isEstimatedStartTime??null,blockedReason:result.reason};
  await db.prepare(`INSERT INTO tennis_official_matches(match_id,tour,source,source_match_id,tournament_group_id,tournament_year,tournament_name,tournament_level,round_code,match_time,surface,indoor_outdoor,venue,player1_id,player2_id,source_player1_id,source_player2_id,completion_state,source_updated_at,observed_at,ingested_at,provenance_json,raw_artifact_key)
   VALUES(?,'wta','WTA_OFFICIAL',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(source,tour,source_match_id) DO UPDATE SET tournament_name=excluded.tournament_name,tournament_level=excluded.tournament_level,round_code=excluded.round_code,match_time=excluded.match_time,surface=excluded.surface,indoor_outdoor=excluded.indoor_outdoor,venue=excluded.venue,player1_id=excluded.player1_id,player2_id=excluded.player2_id,source_player1_id=excluded.source_player1_id,source_player2_id=excluded.source_player2_id,completion_state=excluded.completion_state,source_updated_at=excluded.source_updated_at,observed_at=excluded.observed_at,ingested_at=excluded.ingested_at,provenance_json=excluded.provenance_json,raw_artifact_key=excluded.raw_artifact_key WHERE julianday(excluded.observed_at)>julianday(tennis_official_matches.observed_at)`)
   .bind(id,sourceId,group,year,t.title,t.level||t.tournamentGroup?.level||null,String(m.RoundID??''),result.start,t.surface.toLowerCase(),t.inOutdoor==='I'?'INDOOR':t.inOutdoor==='O'?'OUTDOOR':null,[m.CourtName,t.city,t.country].filter(Boolean).join(' · ')||null,p1[0].fbis_player_id,p2[0].fbis_player_id,String(m.PlayerIDA),String(m.PlayerIDB),result.state,m.LastUpdated||payload.lastUpdated||null,observedAt,observedAt,JSON.stringify(provenance),rawKey).run();
  await db.prepare(`INSERT OR IGNORE INTO tennis_official_match_observations(observation_id,match_id,source,tour,source_match_id,raw_checksum,raw_artifact_key,source_updated_at,observed_at,ingested_at,provenance_json) VALUES(?,?,'WTA_OFFICIAL','wta',?,?,?,?,?,?,?)`)
   .bind(`wta_schedule_${(await hash(sourceId+'|'+rawHash)).slice(0,24)}`,id,sourceId,rawHash,rawKey,m.LastUpdated||payload.lastUpdated||null,observedAt,observedAt,JSON.stringify(provenance)).run();
  written++;fixtures.push({eventId:id,state:result.state,start:result.start,player1:p1[0].canonical_name,player2:p2[0].canonical_name});
 }
 return {group,year,written,fixtures,reasons,rawHash,rawKey};
}
export async function captureOfficialWtaSchedule(env,{now=new Date(),fetchImpl=fetch}={}) {
 if(!env.DB?.prepare||!env.ARCHIVE?.put)throw Error('DURABLE_STORAGE_REQUIRED');
 const read=async path=>{const r=await fetchImpl(BASE+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`WTA_OFFICIAL_HTTP_${r.status}`);const raw=await r.text();if(raw.length>2000000)throw Error('WTA_PAYLOAD_TOO_LARGE');return {body:JSON.parse(raw),raw};};
 const day=now.toISOString().slice(0,10),until=new Date(+now+7*86400000).toISOString().slice(0,10);
 const list=await read(`/tournaments/?page=0&pageSize=100&excludeLevels=ITF&from=${day}&to=${until}`);
 if(!Array.isArray(list.body?.content))throw Error('WTA_TOURNAMENT_LIST_UNVERIFIED');
 const horizon=new Date(+now+72*3600000).toISOString().slice(0,10);
 const selected=list.body.content.filter(t=>Number(t.year)===now.getUTCFullYear()&&t.endDate>=day&&t.startDate<=horizon&&/^\d+$/.test(sourceGroup(t))).slice(0,8);
 const tournaments=[],errors=[];
 for(const t of selected){try{const p=await read(`/tournaments/${sourceGroup(t)}/${t.year}/matches`);tournaments.push(await ingestOfficialWtaSchedule(env.DB,env.ARCHIVE,t,p.body,{now,rawText:p.raw}));}catch(e){errors.push({group:sourceGroup(t),reason:e.message});}}
 return {ok:errors.length===0,asOf:now.toISOString(),source:'WTA_OFFICIAL',tournaments,errors,
   scheduled:tournaments.flatMap(t=>t.fixtures).filter(f=>f.state==='SCHEDULED').length,
   timeUnverified:tournaments.flatMap(t=>t.fixtures).filter(f=>f.state==='TIME_UNVERIFIED').length,researchOnly:true,canQualify:false,canAuthorizeWager:false};
}
