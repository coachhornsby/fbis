/** Presentation-only normalization for FBS season rosters and statistical ledgers.
 * Team and player performance MUST come from timestamped game/season evidence.
 * Membership and roster observations are NOT performance.
 */
const text = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
const finite = (v) => v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const json = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
export const STAT_GROUPS = Object.freeze({
  team: ["offense","defense","passing","rushing","tempo","situational","explosiveness","havoc","line","special_teams","scoring","advanced","ratings"],
  player: ["passing","rushing","receiving","defense","special_teams","kicking","punting","returning","advanced"],
});
export function rosterProfile(r={}) {
  return {
    playerId: text(r.player_id), name: text(r.canonical_name),
    position: text(r.position_abbreviation) || text(r.position) || text(r.current_position),
    positionName: text(r.position), jersey: text(r.jersey),
    classYear: text(r.class_year),
    heightInches: finite(r.height), weightPounds: finite(r.weight),
    season: finite(r.season), firstGameAt: text(r.first_game_at), lastGameAt: text(r.last_game_at),
    gamesRostered: finite(r.games_rostered),
    observedAt: text(r.observed_at), source: text(r.source),
    identityStatus: text(r.identity_status), researchOnly: true,
    performanceAuthority: false,
    // This is a roster entry, not a confirmed starter or games-played statistic.
  };
}
export function toRosterProfiles(rows=[]) {
  const seen = new Set();
  return rows.map(rosterProfile).filter(r=>{
    if(!r.playerId || !r.name || seen.has(r.playerId))return false;
    seen.add(r.playerId); return true;
  });
}
export function teamSchedule(rows=[],team={}) {
  const names = new Set([team.school,team.displayName].filter(Boolean).map(s=>s.toLowerCase()));
  return rows.map(row=>{
    const home=names.has(String(row.home_name||"").toLowerCase());
    const away=names.has(String(row.away_name||"").toLowerCase());
    if(!home&&!away)return null;
    return {
      id:row.id, date:row.date || null, kickoff:row.start || null,
      location:home?"HOME":"AWAY", opponent:home?row.away_name:row.home_name,
      opponentAbbr:home?row.away_abbr:row.home_abbr,
      result:null, pointsFor:null, pointsAgainst:null, // 'games' has no verified final score columns.
      source:"STORED_GAMES_SCHEDULE", verifiedResult:false,
    };
  }).filter(Boolean);
}
export function normalizeStats(raw, groups=STAT_GROUPS.team) {
  const parsed=json(raw);
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))return null;
  // Preserve full named metric inventory without guessing semantic conversions.
  const out={};
  for(const [family,value] of Object.entries(parsed)){
    if(value==null)continue;
    if(typeof value==="object" && !Array.isArray(value)){
      const named={};
      for(const [k,v] of Object.entries(value)){
        const numeric=finite(v);
        if(numeric!==null)named[k]=numeric;
      }
      if(Object.keys(named).length)out[family]=named;
    } else {
      const numeric=finite(value);
      if(numeric!==null)out.other={...(out.other||{}),[family]:numeric};
    }
  }
  for(const name of groups)out[name]??={};
  return out;
}
export function statSnapshot(row, level="team") {
  if(!row)return {state:"NO_VERIFIED_STATS",asOf:null,groups:null,metricsCount:0,source:null,revision:null};
  const groups=normalizeStats(row.metrics_json,STAT_GROUPS[level]||STAT_GROUPS.team);
  const metricsCount=Object.values(groups||{}).reduce((sum,g)=>sum+Object.keys(g).length,0);
  return {
    state:metricsCount ? "SOURCE_OBSERVED" : "NO_VERIFIED_STATS",
    asOf:row.observed_at||null,source:row.source||null,
    sourceAsOf:row.source_timestamp||null,
    revision:row.content_hash||null,season:finite(row.season),
    groups:metricsCount?groups:null,metricsCount,
    researchOnly:true,canInfluenceProjection:false,
  };
}
export function playerStatLines(rows=[]){
  return rows.map(r=>({
    playerId:r.player_id,gameId:r.game_id,season:finite(r.season),
    gameAt:r.game_at||null,opponent:r.opponent||null,
    source:r.source||null,sourceTimestamp:r.source_timestamp||null,
    observedAt:r.observed_at||null,
    groups:normalizeStats(r.metrics_json,STAT_GROUPS.player),
    researchOnly:true,canInfluenceProjection:false,
  }));
}
