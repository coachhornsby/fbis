/**
 * NFL injury visibility only.
 *
 * Pipeline order (2026-10-18+): verified availability is attached BEFORE
 * NFL-PRO scoring so authorized SHADOW challengers can consume it.
 * The displayed NFL-PRO-v1.2 research score still does NOT consume injuries.
 * Production champion remains NFL-PRO-v1.1. Neither this diagnostic nor
 * injuries authorize bets.
 */
const UNAVAILABLE=new Set(["OUT","IR","PUP","NFI","SUSPENDED"]);
const normalized=x=>String(x??"").trim().toUpperCase();
const finiteTimestamp=x=>x&&Number.isFinite(Date.parse(String(x)))?String(x):null;
const position=p=>normalized(p?.position);
const health=p=>normalized(p?.health_state??p?.healthState);
const role=p=>normalized(p?.role_label??p?.roleLabel);
const name=p=>String(p?.player_name??p?.playerName??"").trim();
const source=p=>String(p?.state_source??p?.stateSource??"").toLowerCase();
const playerStamp=p=>finiteTimestamp(p?.state_source_updated_at??p?.stateSourceUpdatedAt);
const teamPlayers=x=>Array.isArray(x?.players)?x.players:[];
function replacementFor(qb,players){
  const replacements=teamPlayers({players})
    .filter(p=>position(p)==="QB"&&p!==qb&&!UNAVAILABLE.has(health(p)))
    .sort((a,b)=>(Number(a?.depth_rank??a?.depthRank) || 99)-(Number(b?.depth_rank??b?.depthRank) || 99));
  return replacements.length?{name:name(replacements[0]),role:role(replacements[0])}:null;
}
export function nflInjuryScoreIntegrity(game={}){
  if(normalized(game.sport)!=="NFL")return null;
  const state=game.nflPersistentProfile||{};
  if(!state.configured||!state.home||!state.away){
    return {kind:"NO_PERSONNEL_STATE",critical:false,scoreUsesPersistentInjuries:false,
      researchOnly:true,canQualify:false,canAuthorizeWager:false,players:[]};
  }
  const teamNodes=[
    {team:String(game.home?.abbr||"HOME"),node:state.home},
    {team:String(game.away?.abbr||"AWAY"),node:state.away}
  ];
  const reported=[],outQbs=[];
  for(const {team,node} of teamNodes){
    const players=teamPlayers(node);
    for(const player of players){
      if(source(player)!=="nfl-official")continue;
      if(!UNAVAILABLE.has(health(player))&&!["DOUBTFUL","QUESTIONABLE"].includes(health(player)))continue;
      const item={team,name:name(player),role:role(player),position:position(player),
        status:health(player),injury:String(player?.injury_detail??player?.injuryDetail??""),
        observedAt:playerStamp(player)};
      reported.push(item);
      if(item.position==="QB"&&(item.role==="QB1"||Number(player?.depth_rank??player?.depthRank)===1)&&UNAVAILABLE.has(item.status)){
        outQbs.push({...item,replacement:replacementFor(player,players)});
      }
    }
  }
  const latest=reported.map(p=>p.observedAt).filter(Boolean).sort().at(-1)||null;
  const qbShadow=game.nflQbPersonnelShadow;
  return {
    kind:outQbs.length?"CONFIRMED_QB_OUT":reported.length?"INJURIES_OBSERVED":"NO_CRITICAL_REPORT",
    critical:outQbs.length>0,
    scoreUsesPersistentInjuries:false,
    availabilityAttachedBeforeScoring:Boolean(state.attachedBeforeScoring),
    scoreContext:"Verified availability is attached before scoring for SHADOW use only; displayed NFL-PRO-v1.2 research score does not consume persistent player status",
    confirmedQbOut:outQbs,
    reportedCount:reported.length,
    latestObservedAt:latest,
    qbPersonnelShadow: qbShadow?.ok ? {
      gateFired:Boolean(qbShadow.gate?.fired),
      combinedQbBurden:qbShadow.gate?.combinedQbBurden??null,
      marginCorrection:qbShadow.marginCorrection??0,
      altersDisplayedScore:false,
    } : null,
    researchOnly:true,
    canQualify:false,
    canAuthorizeWager:false,
    players:reported,
  };
}
