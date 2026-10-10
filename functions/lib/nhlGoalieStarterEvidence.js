/**
 * Point-in-time, event-bound goalie starter evidence.
 *
 * A LAST_CONFIRMED_STARTER row refers to a previous game and is never proof
 * of the next game's starter. A database refresh timestamp does not by itself
 * constitute a fresh confirmed-start announcement.
 */
export function nhlGoalieTeamKey(team) {
  const key=String(team||"").trim().toLowerCase();
  return ({lak:"la",njd:"nj",sjs:"sj",tbl:"tb"})[key]||key;
}

const observedAt = v => {
  const ms=Date.parse(v||"");
  return Number.isFinite(ms)?ms:null;
};
const sameId = (a,b) => a!=null && b!=null && String(a)===String(b);
const probability = v => v!=null && v!=="" && Number.isFinite(Number(v)) && Number(v)>0 && Number(v)<=1;

/**
 * Confirmation: named source + explicit event ID + original source observation
 * time + matching team + current-game freshness (36h maximum).
 *
 * Projection: eligible only for EXPECTED_G1 with next-game team profile ID
 * matched to event and a fresh (<48h) source-provided probability.
 *
 * The result never changes a goalie merely because a player started most of
 * the season or was last confirmed in the previous game.
 */
export function resolveNhlGoalieStarterEvidence(
  profiles={},team,{eventId=null,gameStart=null,cutoff=null,projectionGoalieId=null}={}
) {
  const key=nhlGoalieTeamKey(team);
  const rows=profiles?.goalies?.[key]||[];
  const teamProfile=profiles?.teams?.[key]||{};
  const start=observedAt(gameStart),asOf=observedAt(cutoff);
  const fallback=(reason="NO_EVENT_BOUND_STARTER_EVIDENCE")=>({
    state:"HISTORICAL_PROXY_UNVERIFIED",playerId:projectionGoalieId==null?null:String(projectionGoalieId),
    eventId:null,expectedStartProbability:null,evidenceAt:null,source:null,
    lineupMatched:null,reason,
  });
  if(!eventId||!key||start==null||asOf==null||asOf>=start)
    return fallback("GAME_ID_OR_PIT_WINDOW_INVALID");
  const event=String(eventId);
  const confirmed=rows.filter(row=>{
    const posted=observedAt(row.confirmation_observed_at);
    const refreshed=observedAt(row.source_updated_at);
    return String(row.goalie_state||"").toUpperCase()==="CONFIRMED_STARTER" &&
      sameId(row.confirmation_game_id,event) &&
      String(row.team_key||"").toLowerCase()===key &&
      String(row.confirmation_source||"").trim().length>0 &&
      row.player_id!=null && posted!=null && refreshed!=null &&
      posted<=asOf && refreshed<=asOf && posted<=refreshed &&
      posted<start && posted>=start-36*3600000;
  }).sort((a,b)=>observedAt(b.confirmation_observed_at)-observedAt(a.confirmation_observed_at))[0]||null;
  if(confirmed) return {
    state:"CONFIRMED",playerId:String(confirmed.player_id),eventId:event,
    expectedStartProbability:1,evidenceAt:confirmed.confirmation_observed_at,
    source:confirmed.confirmation_source,
    lineupMatched:projectionGoalieId==null?null:sameId(projectionGoalieId,confirmed.player_id),
    reason:null,
  };
  if(!sameId(teamProfile.next_game_id,event))
    return fallback("TEAM_NEXT_GAME_NOT_MATCHED");
  const nextStart=observedAt(teamProfile.next_game_start);
  if(nextStart!=null && Math.abs(nextStart-start)>600000)
    return fallback("TEAM_NEXT_START_NOT_MATCHED");
  const projected=rows.filter(row=>{
    const observed=observedAt(row.source_updated_at);
    return String(row.goalie_state||"").toUpperCase()==="EXPECTED_G1" &&
      String(row.team_key||"").toLowerCase()===key &&
      row.player_id!=null && probability(row.expected_start_probability) &&
      observed!=null && observed<=asOf && observed<start &&
      observed>=start-48*3600000;
  }).sort((a,b)=>Number(b.expected_start_probability)-Number(a.expected_start_probability))[0]||null;
  if(!projected)return fallback("NO_FRESH_CURRENT_EVENT_EXPECTED_G1");
  return {
    state:"PROJECTED",playerId:String(projected.player_id),eventId:event,
    expectedStartProbability:Number(projected.expected_start_probability),
    evidenceAt:projected.source_updated_at,source:"EVENT_BOUND_EXPECTED_G1_PROFILE",
    lineupMatched:projectionGoalieId==null?null:sameId(projectionGoalieId,projected.player_id),
    reason:null,
  };
}
