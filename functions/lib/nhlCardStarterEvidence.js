/**
 * Read-only event-bound starter names for NHL Board cards. Data must be an
 * existing point-in-time persisted profile, not the prior game's starter.
 * Presentation only; does not influence a goal projection or wager authority.
 */
import { nhlGoalieTeamKey, resolveNhlGoalieStarterEvidence } from "./nhlGoalieStarterEvidence.js";

export function attachNhlCardStarterEvidence(games=[],profiles={},nowMs=Date.now()){
  let matched=0,unverified=0;
  const out=(games||[]).map(game=>{
    if(String(game?.sport||"").toLowerCase()!=="nhl")return game;
    const startMs=Date.parse(game.start||"");
    const cutoffMs=Number.isFinite(startMs)?Math.min(nowMs,startMs-1000):NaN;
    const cutoff=Number.isFinite(cutoffMs)?new Date(cutoffMs).toISOString():null;
    const resolve=side=>{
      const team=String(game?.[side]?.abbr||"");
      const key=nhlGoalieTeamKey(team),list=profiles?.goalies?.[key]||[];
      const modeled=game?.nhlProV2?.layers?.goalie?.[side]||null;
      const evidence=resolveNhlGoalieStarterEvidence(profiles,team,{
        eventId:game?.id,gameStart:game?.start,cutoff,
        projectionGoalieId:modeled?.goalieId||null
      });
      const known=evidence.state==="CONFIRMED"||evidence.state==="PROJECTED";
      const player=known?list.find(x=>String(x.player_id)===evidence.playerId):null;
      if(known)matched++;else unverified++;
      return {...evidence,name:player?.player_name||null,team,cutoff,advisoryOnly:true};
    };
    return {...game,nhlStarterEvidence:{
      home:resolve("home"),away:resolve("away"),
      role:"POINT_IN_TIME_CARD_CONTEXT_ONLY",
      modelInputsChanged:false,marketInformed:false,canQualify:false,canAuthorizeWager:false
    }};
  });
  return {games:out,meta:{modelId:"NHL-CARD-STARTER-CONTEXT-v1",matched,unverified,
    marketInformed:false,canQualify:false,canAuthorizeWager:false}};
}
