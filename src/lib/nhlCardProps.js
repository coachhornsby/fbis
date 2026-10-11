/**
 * Select two independently calculated, game-bound NHL skater projections.
 * No inferred market lines or odds, no edge/EV claims. For games already
 * started, require independently verified pregame locks (the active research
 * feed has none today, so it correctly returns an empty pair).
 */
const teamKey = value => {
  const key=String(value||"").trim().toUpperCase();
  return ({LA:"LAK",SJ:"SJS",TB:"TBL",NJ:"NJD"})[key]||key;
};
const finite = value => value==null||value===""?null:Number.isFinite(Number(value))?Number(value):null;
function lockedBeforeStart(row,startMs){
  const lock=Date.parse(row?.projectionLockAt||row?.frozenAt||row?.lockedAt||"");
  return Number.isFinite(lock)&&lock<startMs&&row?.pointInTimeVerified===true;
}
export function selectNhlCardProps(game={}, {now=Date.now(),live=false,final=false}={}) {
  if(String(game?.sport||"").toLowerCase()!=="nhl"||game?.durableFallback||game?.nhlProV2?.ok!==true)return [];
  const id=String(game.id||"");
  const home=teamKey(game?.home?.abbr),away=teamKey(game?.away?.abbr);
  const start=Date.parse(game.start||"");
  if(!id||!home||!away||!Number.isFinite(start))return [];
  const started=live||final||Boolean(game.live||game.final)||now>=start;
  const good=(Array.isArray(game.playerProjectionRows)?game.playerProjectionRows:[])
    .filter(row=>{
      if(!row||String(row.eventId||"")!==id)return false;
      if(!row.playerName||!["shots_on_goal","points"].includes(row.market))return false;
      if(![home,away].includes(teamKey(row.team))||finite(row.fbisProjection)==null)return false;
      if(row.independent!==true||row.marketInformed===true||row.canAuthorizeWager===true)return false;
      if(row.propGate==="BLOCKED"||["OUT","IR","CONFIRMED_SCRATCH"].includes(String(row.availabilityStatus||"").toUpperCase()))return false;
      if(started&&!lockedBeforeStart(row,start))return false;
      return true;
    })
    .sort((a,b)=>((a.market==="shots_on_goal"?1:0)-(b.market==="shots_on_goal"?1:0)) || Number(b.fbisProjection)-Number(a.fbisProjection));
  // One SOG leader from each team where possible; two different skaters.
  const pick=[],seen=new Set();
  for(const key of [away,home]){
    const candidate=good.find(r=>teamKey(r.team)===key&&!seen.has(String(r.playerId||r.playerName).toLowerCase()));
    if(candidate){pick.push(candidate);seen.add(String(candidate.playerId||candidate.playerName).toLowerCase());}
  }
  for(const r of good){
    if(pick.length>=2)break;
    const k=String(r.playerId||r.playerName).toLowerCase();
    if(!seen.has(k)){pick.push(r);seen.add(k);}
  }
  return pick.slice(0,2).map(r=>({
    player:r.playerName,team:r.team,market:r.market,
    projection:Math.round(Number(r.fbisProjection)*10)/10,
    source:r.source||"NHL-PLAYER-PRO-v2",
    gate:String(r.propGate||"HOLD"),
    historical:started,
    researchOnly:true,qualified:false
  }));
}
