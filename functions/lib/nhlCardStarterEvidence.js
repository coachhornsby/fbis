/**
 * Event-bound NHL goalie evidence on a board that uses ESPN event IDs.
 * Official NHL team schedules use a different game identifier: crosswalk only
 * when BOTH team schedules agree on the same opponent, venue side and kickoff.
 * Read-only context; no projection input, promotion, or wagering authority.
 */
import { nhlGoalieTeamKey, resolveNhlGoalieStarterEvidence } from "./nhlGoalieStarterEvidence.js";

const millis=value=>{const n=Date.parse(value||"");return Number.isFinite(n)?n:null;};
const freshAt=(value,start,cutoff,maxHours=48)=>{
 const at=millis(value);
 return at!=null&&at<=cutoff&&at<start&&at>=start-maxHours*3600000;
};

/** Exact event bridge; NEVER infer a match from the date or one team alone. */
export function nhlOfficialEventCrosswalk(game,profiles={},nowMs=Date.now()){
 const start=millis(game?.start),cutoff=start==null?null:Math.min(nowMs,start-1000);
 const home=nhlGoalieTeamKey(game?.home?.abbr),away=nhlGoalieTeamKey(game?.away?.abbr);
 const h=profiles?.teams?.[home],a=profiles?.teams?.[away];
 if(!h||!a||!home||!away||home===away||start==null||cutoff==null)return null;
 const hid=String(h.next_game_id||""),aid=String(a.next_game_id||"");
 const hs=millis(h.next_game_start),as=millis(a.next_game_start);
 if(!hid||hid!==aid||hs==null||as==null||Math.abs(hs-start)>600000||Math.abs(as-start)>600000)return null;
 if(nhlGoalieTeamKey(h.next_opponent_key)!==away||nhlGoalieTeamKey(a.next_opponent_key)!==home)return null;
 if(String(h.next_site||"").toUpperCase()!=="HOME"||String(a.next_site||"").toUpperCase()!=="ROAD")return null;
 if(!freshAt(h.source_updated_at,start,cutoff)||!freshAt(a.source_updated_at,start,cutoff))return null;
 return {officialGameId:hid,boardGameId:String(game?.id||""),start:game.start,source:"MATCHED_BOTH_OFFICIAL_TEAM_SCHEDULES"};
}

export function attachNhlCardStarterEvidence(games=[],profiles={},nowMs=Date.now()){
 let matched=0,unverified=0,priorStarter=0,bridged=0;
 const out=(games||[]).map(game=>{
  if(String(game?.sport||"").toLowerCase()!=="nhl")return game;
  const startMs=millis(game.start);
  const cutoffMs=startMs==null?null:Math.min(nowMs,startMs-1000);
  const cutoff=cutoffMs==null?null:new Date(cutoffMs).toISOString();
  const bridge=nhlOfficialEventCrosswalk(game,profiles,nowMs);
  if(bridge&&bridge.officialGameId!==String(game.id))bridged++;
  const resolve=side=>{
   const team=String(game?.[side]?.abbr||"");
   const key=nhlGoalieTeamKey(team),list=profiles?.goalies?.[key]||[];
   const modeled=game?.nhlProV2?.layers?.goalie?.[side]||null;
   const evidence=resolveNhlGoalieStarterEvidence(profiles,team,{
    eventId:bridge?.officialGameId||game?.id,gameStart:game?.start,cutoff,
    projectionGoalieId:modeled?.goalieId||null
   });
   const known=evidence.state==="CONFIRMED"||evidence.state==="PROJECTED";
   const player=known?list.find(x=>String(x.player_id)===evidence.playerId):null;
   if(known)matched++;else unverified++;
   // When no CURRENT-GAME starter is known, a recorded previous starter can
   // provide context, but must NEVER be described as expected or confirmed.
   const prior=!known&&bridge&&cutoffMs!=null
    ?list.filter(x=>String(x.goalie_state||"").toUpperCase()==="LAST_CONFIRMED_STARTER"&&
       freshAt(x.source_updated_at,startMs,cutoffMs))
       .sort((x,y)=>Number(x.hierarchy_rank||999)-Number(y.hierarchy_rank||999))[0]
    :null;
   if(prior)priorStarter++;
   return {
    ...evidence,
    name:player?.player_name||prior?.player_name||null,
    state:known?evidence.state:prior?"PRIOR_GAME_STARTER_UNVERIFIED":evidence.state,
    priorGameStarter: Boolean(prior),team,cutoff,
    source:known?evidence.source:prior?"OFFICIAL_PERSISTED_LAST_STARTER":null,
    evidenceAt:known?evidence.evidenceAt:prior?.source_updated_at||null,
    eventIdentity:bridge||null,advisoryOnly:true
   };
  };
  return {...game,nhlStarterEvidence:{
   home:resolve("home"),away:resolve("away"),
   eventIdentity:bridge,
   role:"POINT_IN_TIME_CARD_CONTEXT_ONLY",
   modelInputsChanged:false,marketInformed:false,canQualify:false,canAuthorizeWager:false
  }};
 });
 return {games:out,meta:{modelId:"NHL-CARD-STARTER-CONTEXT-v2",matched,unverified,priorStarter,bridged,
  marketInformed:false,canQualify:false,canAuthorizeWager:false}};
}
