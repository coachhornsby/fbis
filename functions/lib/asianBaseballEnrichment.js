export const ASIAN_BASEBALL_ENRICHMENT_VERSION="phase4b-v1.0.0";
export const KBO_GAMECENTER_CONTRACT="KBO_OFFICIAL_GAMECENTER_ENRICHMENT_V1";
export const KBO_PLAYER_HISTORY_CONTRACT="KBO_OFFICIAL_PLAYER_HISTORY_V1";

const KBO_PROVIDER_TEAMS=Object.freeze({
  LG:"kbo-lg",HH:"kbo-han",SK:"kbo-ssg",SS:"kbo-sam",NC:"kbo-nc",
  KT:"kbo-kt",LT:"kbo-lot",HT:"kbo-kia",OB:"kbo-doo",WO:"kbo-kiw"
});

function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function isoMs(v){const x=Date.parse(v||"");return Number.isFinite(x)?x:null;}
function safeDate(v){return String(v||"").slice(0,10);}
function outsFromIp(v){
  if(v==null)return null;
  const s=String(v).trim();
  if(/^\d+$/.test(s))return Number(s)*3;
  const m=s.match(/^(\d+)\.(\d)$/);
  if(!m)return null;
  const whole=Number(m[1]),frac=Number(m[2]);
  return frac>=0&&frac<=2?whole*3+frac:null;
}
export function kboProviderGameIdParts(providerGameId){
  const s=String(providerGameId||"").trim();
  const m=s.match(/^(\d{8})([A-Z]{2})([A-Z]{2})(\d)$/);
  if(!m)return null;
  return {
    gameDate:`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`,
    awayCode:m[2],homeCode:m[3],gameNo:Number(m[4]),
    awayTeamId:KBO_PROVIDER_TEAMS[m[2]]||null,
    homeTeamId:KBO_PROVIDER_TEAMS[m[3]]||null
  };
}
export function providerGameIdIsDoubleheaderSafe(ids=[]){
  const parsed=ids.map(kboProviderGameIdParts).filter(Boolean);
  const groups=new Map();
  for(const p of parsed){
    const k=`${p.gameDate}:${p.awayCode}:${p.homeCode}`;
    const a=groups.get(k)||[];a.push(p.gameNo);groups.set(k,a);
  }
  const collisions=[...groups.entries()].filter(([,nos])=>new Set(nos).size!==nos.length);
  return {safe:collisions.length===0,groups:[...groups.entries()].map(([key,nos])=>({key,gameNos:nos})),collisions};
}
export function canonicalMatchKey({league="KBO",gameDate,awayTeamId,homeTeamId,gameNo=null}={}){
  const base=`${String(league).toUpperCase()}:${safeDate(gameDate)}:${awayTeamId||""}:${homeTeamId||""}`;
  return gameNo==null?base:`${base}:${Number(gameNo)}`;
}
export function matchKboProviderGame(providerGame,canonicalGames=[]){
  const p=kboProviderGameIdParts(providerGame?.providerGameId||providerGame?.G_ID);
  if(!p)return{status:"UNMATCHED",reason:"invalid-provider-game-id",candidate:null};
  const candidates=(canonicalGames||[]).filter(g=>
    String(g.league||"KBO").toUpperCase()==="KBO" &&
    safeDate(g.game_date||g.gameDate)===p.gameDate &&
    (g.away_team_id||g.awayTeamId)===p.awayTeamId &&
    (g.home_team_id||g.homeTeamId)===p.homeTeamId
  );
  if(candidates.length!==1)return{status:candidates.length?"AMBIGUOUS":"UNMATCHED",reason:candidates.length?"multiple-canonical-candidates":"no-canonical-candidate",candidates};
  const g=candidates[0];
  const scoreMatch=n(g.away_final_runs??g.awayFinalRuns)===n(providerGame.awayScore??providerGame.away_score) &&
    n(g.home_final_runs??g.homeFinalRuns)===n(providerGame.homeScore??providerGame.home_score);
  const venueA=String(g.venue||"").trim().toUpperCase(),venueB=String(providerGame.stadium||providerGame.venue||"").trim().toUpperCase();
  const venueMatch=!venueA||!venueB||venueA===venueB;
  return{status:scoreMatch?"MATCH":"CONFLICT",candidate:g,scoreMatch,venueMatch,provider:p,
    confidence:scoreMatch&&venueMatch?1:scoreMatch?.95:.5};
}
export function normalizeKboPlayerObservation(raw={}){
  const role=String(raw.observationRole||raw.role||"UNKNOWN").toUpperCase();
  return {
    league:"KBO",canonicalGameId:raw.canonicalGameId,provider:"KBO_OFFICIAL",
    providerGameId:raw.providerGameId||null,providerPlayerId:String(raw.providerPlayerId||raw.P_ID||""),
    teamId:raw.teamId||null,opponentTeamId:raw.opponentTeamId||null,gameDate:safeDate(raw.gameDate),
    scheduledStart:raw.scheduledStart||null,completedAt:raw.completedAt||null,
    observationRole:["STARTER","RELIEVER","HITTER","FIELDER","RUNNER"].includes(role)?role:"UNKNOWN",
    battingOrder:n(raw.battingOrder),positionText:raw.positionText||null,
    inningsOuts:raw.inningsOuts??outsFromIp(raw.ip??raw.IP),battersFaced:n(raw.battersFaced??raw.TBF),
    pitches:n(raw.pitches??raw.NP),hitsAllowed:n(raw.hitsAllowed??raw.HA??raw.H),
    homeRunsAllowed:n(raw.homeRunsAllowed??raw.HRA??raw.HR),walks:n(raw.walks??raw.BB),
    strikeouts:n(raw.strikeouts??raw.SO),runsAllowed:n(raw.runsAllowed??raw.R),earnedRuns:n(raw.earnedRuns??raw.ER),
    plateAppearances:n(raw.plateAppearances??raw.PA),atBats:n(raw.atBats??raw.AB),hits:n(raw.hits),
    homeRuns:n(raw.homeRuns),temporalClass:"POSTGAME",pregameEligible:0
  };
}
export function priorPitcherState(observations=[],providerPlayerId,targetStart){
  const target=isoMs(targetStart);
  const rows=(observations||[]).filter(r=>String(r.providerPlayerId||r.provider_player_id)===String(providerPlayerId) &&
    ["STARTER","RELIEVER"].includes(String(r.observationRole||r.observation_role)) &&
    (isoMs(r.completedAt||r.completed_at)||isoMs(r.scheduledStart||r.scheduled_start))<target
  ).sort((a,b)=>(isoMs(a.completedAt||a.completed_at)||isoMs(a.scheduledStart||a.scheduled_start))-(isoMs(b.completedAt||b.completed_at)||isoMs(b.scheduledStart||b.scheduled_start)));
  let starts=0,relief=0,outs=0,bf=0,pitches=0,h=0,hr=0,bb=0,so=0,r=0,er=0;
  for(const x of rows){
    String(x.observationRole||x.observation_role)==="STARTER"?starts++:relief++;
    outs+=n(x.inningsOuts??x.innings_outs)||0;bf+=n(x.battersFaced??x.batters_faced)||0;pitches+=n(x.pitches)||0;
    h+=n(x.hitsAllowed??x.hits_allowed)||0;hr+=n(x.homeRunsAllowed??x.home_runs_allowed)||0;bb+=n(x.walks)||0;so+=n(x.strikeouts)||0;
    r+=n(x.runsAllowed??x.runs_allowed)||0;er+=n(x.earnedRuns??x.earned_runs)||0;
  }
  const last=rows.at(-1)||null,lastMs=last?(isoMs(last.completedAt||last.completed_at)||isoMs(last.scheduledStart||last.scheduled_start)):null;
  const workload=days=>rows.filter(x=>{const t=isoMs(x.completedAt||x.completed_at)||isoMs(x.scheduledStart||x.scheduled_start);return t!=null&&target-t>0&&target-t<=days*86400000;});
  const roll=days=>{const xs=workload(days);return{appearances:xs.length,pitches:xs.reduce((s,x)=>s+(n(x.pitches)||0),0),inningsOuts:xs.reduce((s,x)=>s+(n(x.inningsOuts??x.innings_outs)||0),0)};};
  return {
    providerPlayerId:String(providerPlayerId),asOf:targetStart,priorAppearances:rows.length,priorStarts:starts,priorReliefAppearances:relief,
    inningsOuts:outs,innings:outs/3,battersFaced:bf,pitches,hitsAllowed:h,homeRunsAllowed:hr,walks:bb,strikeouts:so,runsAllowed:r,earnedRuns:er,
    kPerBf:bf?so/bf:null,bbPerBf:bf?bb/bf:null,hrPerBf:bf?hr/bf:null,
    previousAppearanceAt:lastMs?new Date(lastMs).toISOString():null,daysRest:lastMs?Math.floor((target-lastMs)/86400000):null,
    previousAppearancePitches:last?n(last.pitches):null,trailing3:roll(3),trailing7:roll(7),trailing14:roll(14),
    provenance:"completed prior games only"
  };
}
export function priorBullpenState(observations=[],teamId,targetStart){
  const target=isoMs(targetStart);
  const prior=(observations||[]).filter(r=>(r.teamId||r.team_id)===teamId &&
    String(r.observationRole||r.observation_role)==="RELIEVER" &&
    (isoMs(r.completedAt||r.completed_at)||isoMs(r.scheduledStart||r.scheduled_start))<target);
  const ids=[...new Set(prior.map(r=>String(r.providerPlayerId||r.provider_player_id)).filter(Boolean))];
  const pitchers=ids.map(id=>priorPitcherState(observations,id,targetStart));
  return {teamId,asOf:targetStart,knownPriorRelievers:ids.length,pitchers,rosterCertainty:"PARTICIPATION_HISTORY_ONLY",
    warning:"Does not infer active roster from later-season appearances."};
}
export async function persistGameProviderCrosswalk(env,row){
  const db=env?.DB;if(!db?.prepare)return{ok:false,error:"d1-unbound"};
  const now=new Date().toISOString();
  const id=`${row.league}:${row.provider}:${row.providerGameId}`;
  await db.prepare(`INSERT INTO asian_baseball_game_provider_crosswalk(
    id,league,canonical_game_id,provider,provider_game_id,game_date,home_team_id,away_team_id,provider_home_team,provider_away_team,
    stadium,scheduled_start,match_method,match_confidence,source_contract,source_ref,parser_version,first_observed_at,last_observed_at,
    research_only,can_influence_projection,can_qualify,can_authorize,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,0,0,?,?)
  ON CONFLICT(league,provider,provider_game_id) DO UPDATE SET
    canonical_game_id=excluded.canonical_game_id,stadium=excluded.stadium,scheduled_start=excluded.scheduled_start,
    match_method=excluded.match_method,match_confidence=excluded.match_confidence,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at`)
    .bind(id,row.league,row.canonicalGameId,row.provider,row.providerGameId,row.gameDate,row.homeTeamId,row.awayTeamId,row.providerHomeTeam||null,
      row.providerAwayTeam||null,row.stadium||null,row.scheduledStart||null,row.matchMethod,row.matchConfidence,row.sourceContract,row.sourceRef||null,
      ASIAN_BASEBALL_ENRICHMENT_VERSION,now,now,now,now).run();
  return{ok:true,id};
}
export async function persistPlayerIdentity(env,row){
  const db=env?.DB;if(!db?.prepare)return{ok:false,error:"d1-unbound"};
  const now=new Date().toISOString(),id=`${row.league}:${row.provider}:${row.providerPlayerId}`;
  await db.prepare(`INSERT INTO asian_baseball_player_identities(
    id,league,fbis_player_id,provider,provider_player_id,observed_name,team_id,first_observed_date,last_observed_date,
    match_method,match_confidence,ambiguity_state,source_contract,provenance_json,parser_version,research_only,
    can_influence_projection,can_qualify,can_authorize,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,0,0,?,?)
  ON CONFLICT(league,provider,provider_player_id) DO UPDATE SET
    fbis_player_id=COALESCE(excluded.fbis_player_id,asian_baseball_player_identities.fbis_player_id),
    observed_name=COALESCE(excluded.observed_name,asian_baseball_player_identities.observed_name),
    team_id=COALESCE(excluded.team_id,asian_baseball_player_identities.team_id),
    first_observed_date=MIN(COALESCE(asian_baseball_player_identities.first_observed_date,excluded.first_observed_date),excluded.first_observed_date),
    last_observed_date=MAX(COALESCE(asian_baseball_player_identities.last_observed_date,excluded.last_observed_date),excluded.last_observed_date),
    match_method=excluded.match_method,match_confidence=excluded.match_confidence,ambiguity_state=excluded.ambiguity_state,
    provenance_json=excluded.provenance_json,updated_at=excluded.updated_at`)
    .bind(id,row.league,row.fbisPlayerId||null,row.provider,row.providerPlayerId,row.observedName||null,row.teamId||null,
      row.firstObservedDate||null,row.lastObservedDate||null,row.matchMethod,row.matchConfidence||0,row.ambiguityState||"UNRESOLVED",
      row.sourceContract,JSON.stringify(row.provenance||{}),ASIAN_BASEBALL_ENRICHMENT_VERSION,now,now).run();
  return{ok:true,id};
}
