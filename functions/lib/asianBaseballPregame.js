import { projectKboGame } from "./kboFbisV1.js";
import { projectKboV2Game } from "./kboFbisV2.js";
import { projectNpbGame } from "./npbFbisV1.js";
import { projectNpbV2Game } from "./npbFbisV2.js";

export const ASIAN_BASEBALL_PREGAME_VERSION="phase3-v1.0.0";
export const ASIAN_BASEBALL_PARK_VERSION="prior-games-shrunk-v1";
const DEFAULT_CUTOFF_MINUTES=360;
const PARK_SHRINK_GAMES=200;

const KBO_ABBR={
  "kbo-lg":"LG","kbo-han":"HANWHA","kbo-ssg":"SSG","kbo-sam":"SAMSUNG","kbo-nc":"NC",
  "kbo-kt":"KT","kbo-lot":"LOTTE","kbo-kia":"KIA","kbo-doo":"DOOSAN","kbo-kiw":"KIWOOM"
};
const NPB_ABBR={
  "npb-ht":"HAN","npb-ydb":"DEN","npb-yg":"YOM","npb-cd":"CHU","npb-hc":"HIR","npb-tys":"YAK",
  "npb-fsh":"SBH","npb-hnf":"HAM","npb-ob":"ORI","npb-tre":"RAK","npb-ssl":"SEI","npb-clm":"LOT"
};

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function r3(v){return v==null?null:Math.round(Number(v)*1000)/1000;}
function pct(n,d){return d?Number(n||0)/d:null;}
function safeJson(v){return JSON.parse(JSON.stringify(v,(_k,x)=>typeof x==="function"?undefined:x));}
function snapshotAt(start,cutoffMinutes=DEFAULT_CUTOFF_MINUTES){
  const t=Date.parse(start||""); if(!Number.isFinite(t)) return null;
  return new Date(t-Math.max(1,Number(cutoffMinutes)||DEFAULT_CUTOFF_MINUTES)*60000).toISOString();
}
function abbrFor(league,id){return (String(league).toUpperCase()==="KBO"?KBO_ABBR:NPB_ABBR)[id]||null;}

export function priorTeamState(history=[],teamId){
  const rows=(history||[]).filter(g=>g.home_team_id===teamId||g.away_team_id===teamId);
  let rf=0,ra=0,w=0,l=0,t=0;
  for(const g of rows){
    const home=g.home_team_id===teamId;
    const f=finite(home?g.home_final_runs:g.away_final_runs);
    const a=finite(home?g.away_final_runs:g.home_final_runs);
    if(f==null||a==null) continue;
    rf+=f;ra+=a;
    if(f>a)w++;else if(f<a)l++;else t++;
  }
  const games=w+l+t;
  return {
    games,wins:w,losses:l,ties:t,pct:games?(w+t*.5)/games:null,
    runsPerGame:games?rf/games:null,runsAllowedPerGame:games?ra/games:null,
    runsFor:rf,runsAgainst:ra,
    asOfMeaning:"official final games strictly before target game date",
    advanced:{
      avg:null,ops:null,obp:null,slg:null,kRate:null,bbRate:null,hrRate:null,risp:null,
      era:null,staffEra:null,whip:null,oppAvg:null,qs:null
    }
  };
}

export function priorParkState(history=[],venue,{shrinkGames=PARK_SHRINK_GAMES}={}){
  const usable=(history||[]).filter(g=>finite(g.home_final_runs)!=null&&finite(g.away_final_runs)!=null);
  const leagueRuns=usable.reduce((s,g)=>s+Number(g.home_final_runs)+Number(g.away_final_runs),0);
  const leagueGames=usable.length;
  const atVenue=usable.filter(g=>String(g.venue||"").trim()===String(venue||"").trim()&&String(venue||"").trim());
  const venueRuns=atVenue.reduce((s,g)=>s+Number(g.home_final_runs)+Number(g.away_final_runs),0);
  const lg=leagueGames?leagueRuns/leagueGames:null;
  const raw=lg&&atVenue.length?(venueRuns/atVenue.length)/lg:null;
  const weight=atVenue.length/(atVenue.length+shrinkGames);
  const shrunk=raw==null?1:1+(raw-1)*weight;
  return {
    venue:venue||null,priorGameSample:atVenue.length,leaguePriorGameSample:leagueGames,
    rawFactor:r3(raw),shrunkFactor:r3(shrunk),shrinkGames,
    methodologyVersion:ASIAN_BASEBALL_PARK_VERSION,
    asOfMeaning:"only official completed games strictly before target game date"
  };
}

function missingFlags(league){
  return [
    "advanced_team_stats_historical_asof_unavailable",
    "starter_announcement_historical_asof_unavailable",
    "starter_stats_historical_asof_unavailable",
    "bullpen_role_fatigue_historical_asof_unavailable",
    "lineup_history_unavailable",
    "roster_history_unavailable",
    ...(String(league).toUpperCase()==="NPB"?["npb_hitter_ids_not_durably_resolved"]:["kbo_hitter_identity_history_incomplete"])
  ];
}

export function buildReconstructedPregameSnapshot(target,history=[],{cutoffMinutes=DEFAULT_CUTOFF_MINUTES}={}){
  const league=String(target.league||"").toUpperCase();
  const frozenAt=snapshotAt(target.scheduled_start,cutoffMinutes);
  const startMs=Date.parse(target.scheduled_start||""), frozenMs=Date.parse(frozenAt||"");
  const temporalEligible=Number.isFinite(startMs)&&Number.isFinite(frozenMs)&&frozenMs<startMs;
  const prior=(history||[]).filter(g=>g.league===league&&g.game_date<target.game_date&&g.is_final===1);
  const home=priorTeamState(prior,target.home_team_id),away=priorTeamState(prior,target.away_team_id);
  const park=priorParkState(prior,target.venue);
  const homeAbbr=abbrFor(league,target.home_team_id),awayAbbr=abbrFor(league,target.away_team_id);
  const game={
    id:target.canonical_game_id,venue:target.venue||"",
    home:{abbr:homeAbbr},away:{abbr:awayAbbr},
    probableStarterIds:{home:null,away:null}
  };
  const teams={
    [homeAbbr]:{games:home.games,pct:home.pct,runsPerGame:home.runsPerGame,runsAllowedPerGame:home.runsAllowedPerGame},
    [awayAbbr]:{games:away.games,pct:away.pct,runsPerGame:away.runsPerGame,runsAllowedPerGame:away.runsAllowedPerGame}
  };
  const parkFactors=target.venue?{[target.venue]:park.shrunkFactor}:{}; let v1=null,v2=null;
  if(homeAbbr&&awayAbbr&&home.games>0&&away.games>0){
    if(league==="KBO"){
      v1=projectKboGame(game,{teams,advancedTeams:{},pitchers:[],startersByGame:{},parkFactors});
      v2=projectKboV2Game(game,{teams,advancedTeams:{},pitchers:[],startersByGame:{},parkFactors});
    }else{
      v1=projectNpbGame(game,{teams,pitchersByTeam:{[homeAbbr]:[],[awayAbbr]:[]}});
      v2=projectNpbV2Game(game,{teams,pitchersByTeam:{[homeAbbr]:[],[awayAbbr]:[]},parkFactors});
    }
  }
  const flags=missingFlags(league);
  return {
    snapshotId:`${target.canonical_game_id}:RECONSTRUCTED_PIT_V1`,league,canonicalGameId:target.canonical_game_id,
    season:Number(target.season),gameDate:target.game_date,scheduledStart:target.scheduled_start,snapshotAt:frozenAt,
    cutoffMinutes:Number(cutoffMinutes),reconstructionMode:"RECONSTRUCTED_PIT_V1",
    homeTeamId:target.home_team_id,awayTeamId:target.away_team_id,homeTeamState:home,awayTeamState:away,
    starters:{home:null,away:null,resolution:"UNAVAILABLE_HISTORICAL_ASOF"},
    bullpen:{home:null,away:null,state:"UNAVAILABLE_HISTORICAL_ASOF"},
    park,lineup:{home:null,away:null,state:"UNAVAILABLE_HISTORICAL_ASOF"},missingFlags:flags,
    sourceRefs:[{contract:"ASIAN_BASEBALL_PHASE2_OFFICIAL_FINAL_HISTORY",priorGames:prior.length}],
    parserVersion:ASIAN_BASEBALL_PREGAME_VERSION,
    temporalEligible:temporalEligible?1:0,
    walkForwardEligible:temporalEligible&&home.games>0&&away.games>0&&Boolean(v1?.ok)&&Boolean(v2?.ok)?1:0,
    modelOutputs:{v1:safeJson(v1),v2:safeJson(v2)}
  };
}

async function all(db,sql,...binds){return (await db.prepare(sql).bind(...binds).all())?.results||[];}

export async function persistPregameSnapshot(env,s){
  const db=env?.DB;if(!db?.prepare)return{ok:false,error:"d1-unbound"};
  const now=new Date().toISOString();
  await db.prepare(`INSERT INTO asian_baseball_pregame_snapshots(
    snapshot_id,league,canonical_game_id,season,game_date,scheduled_start,snapshot_at,cutoff_minutes,reconstruction_mode,
    home_team_id,away_team_id,home_team_state_json,away_team_state_json,starter_state_json,bullpen_state_json,park_state_json,
    lineup_state_json,missing_flags_json,source_refs_json,parser_version,model_outputs_json,temporal_eligible,walk_forward_eligible,
    research_only,can_qualify,can_authorize,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,0,?,?)
  ON CONFLICT(snapshot_id) DO UPDATE SET
    home_team_state_json=excluded.home_team_state_json,away_team_state_json=excluded.away_team_state_json,
    park_state_json=excluded.park_state_json,missing_flags_json=excluded.missing_flags_json,
    source_refs_json=excluded.source_refs_json,parser_version=excluded.parser_version,model_outputs_json=excluded.model_outputs_json,
    temporal_eligible=excluded.temporal_eligible,walk_forward_eligible=excluded.walk_forward_eligible,updated_at=excluded.updated_at`)
    .bind(s.snapshotId,s.league,s.canonicalGameId,s.season,s.gameDate,s.scheduledStart,s.snapshotAt,s.cutoffMinutes,s.reconstructionMode,
      s.homeTeamId,s.awayTeamId,JSON.stringify(s.homeTeamState),JSON.stringify(s.awayTeamState),JSON.stringify(s.starters),
      JSON.stringify(s.bullpen),JSON.stringify(s.park),JSON.stringify(s.lineup),JSON.stringify(s.missingFlags),JSON.stringify(s.sourceRefs),
      s.parserVersion,JSON.stringify(s.modelOutputs),s.temporalEligible,s.walkForwardEligible,now,now).run();
  if(s.park?.venue){
    const id=`${s.snapshotId}:PARK`;
    await db.prepare(`INSERT INTO asian_baseball_park_factors(
      id,league,canonical_game_id,venue,as_of_date,prior_game_sample,league_prior_game_sample,raw_factor,shrunk_factor,
      shrink_games,methodology_version,source_contract,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET prior_game_sample=excluded.prior_game_sample,league_prior_game_sample=excluded.league_prior_game_sample,
      raw_factor=excluded.raw_factor,shrunk_factor=excluded.shrunk_factor,updated_at=excluded.updated_at`)
      .bind(id,s.league,s.canonicalGameId,s.park.venue,s.gameDate,s.park.priorGameSample,s.park.leaguePriorGameSample,
        s.park.rawFactor,s.park.shrunkFactor,s.park.shrinkGames,s.park.methodologyVersion,"ASIAN_BASEBALL_PHASE2_OFFICIAL_FINAL_HISTORY",now,now).run();
  }
  return{ok:true};
}

export async function buildControlledPregameSample(env,{league,season=2025,month=9,limit=12,cutoffMinutes=DEFAULT_CUTOFF_MINUTES}={}){
  const db=env?.DB;if(!db?.prepare)return{ok:false,error:"d1-unbound"};
  const L=String(league||"").toUpperCase();if(!["KBO","NPB"].includes(L))return{ok:false,error:"invalid-league"};
  const prefix=`${Number(season)}-${String(Number(month)).padStart(2,"0")}`;
  const targets=await all(db,`SELECT * FROM asian_baseball_games WHERE league=? AND substr(game_date,1,7)=? AND is_final=1
    AND scheduled_start IS NOT NULL ORDER BY game_date DESC,canonical_game_id DESC LIMIT ?`,L,prefix,Math.max(1,Math.min(20,Number(limit)||12)));
  const history=await all(db,"SELECT * FROM asian_baseball_games WHERE league=? AND is_final=1 AND game_date<? ORDER BY game_date,canonical_game_id",L,prefix+"-32");
  const snapshots=[];
  for(const t of targets){
    const s=buildReconstructedPregameSnapshot(t,history,{cutoffMinutes});
    await persistPregameSnapshot(env,s);snapshots.push(s);
  }
  return{ok:true,league:L,targetGames:targets.length,snapshotsCreated:snapshots.length,
    snapshotsBeforeFirstPitch:snapshots.filter(s=>s.temporalEligible).length,
    walkForwardEligible:snapshots.filter(s=>s.walkForwardEligible).length,
    starterResolved:snapshots.filter(s=>s.starters?.home&&s.starters?.away).length,
    teamStateCoverage:snapshots.filter(s=>s.homeTeamState.games>0&&s.awayTeamState.games>0).length,
    pitcherStateCoverage:0,bullpenStateCoverage:0,
    parkFactorCoverage:snapshots.filter(s=>s.park?.priorGameSample>0).length,
    lineupCoverage:0,stablePlayerIdCoverage:0,leakageRejections:snapshots.filter(s=>!s.temporalEligible).length,
    missingFeatureReasons:[...new Set(snapshots.flatMap(s=>s.missingFlags))],
    sample:snapshots.map(s=>({snapshotId:s.snapshotId,canonicalGameId:s.canonicalGameId,gameDate:s.gameDate,snapshotAt:s.snapshotAt,
      scheduledStart:s.scheduledStart,walkForwardEligible:Boolean(s.walkForwardEligible),park:s.park,modelOutputs:s.modelOutputs}))
  };
}

export async function pregameQualityReport(env,{league,season=2025,month=9}={}){
  const db=env?.DB;if(!db?.prepare)return{ok:false,error:"d1-unbound"};
  const L=String(league||"").toUpperCase(),prefix=`${Number(season)}-${String(Number(month)).padStart(2,"0")}`;
  const r=await db.prepare(`SELECT COUNT(*) n,SUM(temporal_eligible) temporal,SUM(walk_forward_eligible) wf,
    SUM(CASE WHEN json_extract(park_state_json,'$.priorGameSample')>0 THEN 1 ELSE 0 END) park
    FROM asian_baseball_pregame_snapshots WHERE league=? AND substr(game_date,1,7)=?`).bind(L,prefix).first();
  const n=Number(r?.n||0);
  return{ok:true,league:L,snapshots:n,temporalEligible:Number(r?.temporal||0),walkForwardEligible:Number(r?.wf||0),
    parkFactorSnapshots:Number(r?.park||0),starterResolved:0,pitcherStateCoverage:0,bullpenStateCoverage:0,lineupCoverage:0,
    canQualify:false,canAuthorize:false};
}

export async function controlledWalkForwardRows(env,{league,season=2025,month=9}={}){
  const db=env?.DB;if(!db?.prepare)return[];
  const L=String(league||"").toUpperCase(),prefix=`${Number(season)}-${String(Number(month)).padStart(2,"0")}`;
  const rows=await all(db,`SELECT s.*,g.home_final_runs,g.away_final_runs FROM asian_baseball_pregame_snapshots s
    JOIN asian_baseball_games g ON g.canonical_game_id=s.canonical_game_id
    WHERE s.league=? AND substr(s.game_date,1,7)=? ORDER BY s.game_date,s.canonical_game_id`,L,prefix);
  return rows.map(r=>{
    const m=JSON.parse(r.model_outputs_json||"{}");
    return{start:r.scheduled_start,frozenAt:r.snapshot_at,homeRuns:r.home_final_runs,awayRuns:r.away_final_runs,
      v1:m.v1?.ok?{home:m.v1.home,away:m.v1.away,pHome:m.v1.probabilities?.pHomeWin??null}:null,
      v2:m.v2?.ok?{home:m.v2.home,away:m.v2.away,pHome:m.v2.probabilities?.pHomeWin??null}:null};
  }).filter(r=>r.v1&&r.v2);
}
