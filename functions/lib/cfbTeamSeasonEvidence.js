/** Optional read-only FBS team/player performance ledgers plus dated roster.
 * No provider acquisition, live projection influence or fabricated numeric stats.
 */
import { toRosterProfiles, teamSchedule, statSnapshot, playerStatLines } from "./cfbTeamStatProfile.js";
export const CFB_PROFILE_SEASON_MIN=2004;
export const CFB_PROFILE_SEASON_MAX=2026;
const playerPattern=/^cfb:[a-z0-9-]+:\d{1,15}$/i;
const absent=reason=>({state:"NOT_POPULATED",reason,rows:[]});
const noSchema=e=>/no such table|no such column/i.test(String(e?.message||e||""));
async function optionally(db,sql,bindings=[],transform=x=>x){
 try {
  const r=await db.prepare(sql).bind(...bindings).all();
  return {state:"AVAILABLE",rows:transform(r?.results||[])};
 } catch(e) {
  return noSchema(e)?absent("STATISTICAL_STORAGE_NOT_INSTALLED")
   :{state:"READ_ERROR",reason:"SAVED_STATISTICAL_DATA_UNAVAILABLE",rows:[]};
 }
}
export async function loadFbsTeamSeasonEvidence(db,team,season=2026,playerId=null,{sportDb=db}={}){
 const teamId=team.teamId;
 const [rosterResult,seasonsResult,scheduleResult,teamStatsResult,playerStatsResult,teamGamesResult]=await Promise.all([
  optionally(sportDb,"SELECT m.player_id,m.position,m.position_abbreviation,m.jersey,m.class_year, "+
    "m.height,m.weight,m.season,m.first_game_at,m.last_game_at,m.games_rostered,"+
    "m.observed_at,m.source,p.canonical_name,p.current_position,p.identity_status "+
    "FROM cfb_roster_membership m LEFT JOIN cfb_canonical_players p ON p.player_id=m.player_id "+
    "WHERE m.team_id=? AND m.season=? ORDER BY m.position_abbreviation,m.jersey,m.player_id LIMIT 350",
    [teamId,season],toRosterProfiles),
  optionally(sportDb,"SELECT DISTINCT season FROM cfb_roster_membership WHERE team_id=? "+
    "AND season BETWEEN 2004 AND 2026 ORDER BY season DESC LIMIT 30",[teamId],
    rows=>rows.map(r=>Number(r.season)).filter(Number.isFinite)),
  optionally(sportDb,"SELECT id,date,start,home_name,away_name,home_abbr,away_abbr "+
    "FROM games WHERE sport='cfb' AND date >= ? AND date < ? "+
    "AND (home_name IN (?,?) OR away_name IN (?,?)) "+
    "ORDER BY date DESC, start DESC LIMIT 32",
    [String(season)+"-01-01",String(season+1)+"-01-01",
      team.school,team.displayName,team.school,team.displayName],
    rows=>teamSchedule(rows,team)),
  optionally(db,"SELECT metrics_json,source,source_timestamp,observed_at,season,content_hash "+
    "FROM cfb_team_season_stat_snapshots WHERE team_id=? AND season=? "+
    "ORDER BY observed_at DESC LIMIT 1",[teamId,season]),
  optionally(db,"SELECT player_id,metrics_json,source,source_timestamp,observed_at,season,content_hash "+
    "FROM cfb_player_season_stat_snapshots WHERE team_id=? AND season=? "+
    "ORDER BY observed_at DESC LIMIT 350",[teamId,season]),
  optionally(db,"SELECT game_id,opponent,game_at,metrics_json,source,source_timestamp,"+
    "observed_at,season,content_hash FROM cfb_team_game_stat_observations "+
    "WHERE team_id=? AND season=? ORDER BY game_at DESC LIMIT 30",[teamId,season]),
 ]);
 const roster=rosterResult.rows;
 const known=new Set(roster.map(r=>r.playerId));
 const playerStats=new Map();
 for(const row of playerStatsResult.rows){
  if(!known.has(row.player_id)||playerStats.has(row.player_id))continue;
  playerStats.set(row.player_id,statSnapshot(row,"player"));
 }
 const chosen=playerId&&known.has(playerId)?playerId:null;
 let playerGameStats=absent("SELECT_A_ROSTER_PLAYER");
 if(chosen){
  playerGameStats=await optionally(db,"SELECT player_id,game_id,game_at,season,opponent,source,"+
    "source_timestamp,observed_at,metrics_json FROM cfb_player_game_stat_observations "+
    "WHERE team_id=? AND season=? AND player_id=? ORDER BY game_at DESC LIMIT 25",
    [teamId,season,chosen],playerStatLines);
 }
 return {
  season,availableSeasons:seasonsResult.rows,
  roster:{state:rosterResult.state,source:"SPORTSDATAVERSE_ESPN_CFB_ROSTERS",
   players:roster,count:roster.length,
   provenance:"Dated roster memberships, not confirmed playing time or depth chart",modelAuthority:false},
  schedule:{state:scheduleResult.state,games:scheduleResult.rows,count:scheduleResult.rows.length,
   provenance:"Stored fixtures; result scores not verified"},
  teamGameStatistics:{state:teamGamesResult.state,storageReason:teamGamesResult.reason||null,
    count:teamGamesResult.rows.length,
    games:teamGamesResult.rows.map(r=>({
      gameId:r.game_id,gameAt:r.game_at,opponent:r.opponent,
      stats:statSnapshot(r,"team"),
    }))},
  teamStatistics:{...statSnapshot(teamStatsResult.rows[0]||null,"team"),
   storageState:teamStatsResult.state,storageReason:teamStatsResult.reason||null,
   provenance:"Source-labeled season statistics; no future observations allowed in historical pregame input"},
  playerStatistics:{state:playerStatsResult.state,storageReason:playerStatsResult.reason||null,
   availableCount:playerStats.size,byPlayer:Object.fromEntries(playerStats),
   provenance:"Saved game performance, distinct from mere roster inclusion"},
  selectedPlayer:chosen,playerGameStatistics:playerGameStats,
 };
}
export function validProfileSeason(v){
 const n=Number(v);
 return Number.isInteger(n)&&n>=CFB_PROFILE_SEASON_MIN&&n<=CFB_PROFILE_SEASON_MAX;
}
export function validProfilePlayer(v){return playerPattern.test(String(v||""));}
