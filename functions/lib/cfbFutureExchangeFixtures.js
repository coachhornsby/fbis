import {boardDate} from './publicBoardSnapshot.js';
// Retained, source-authored schedule identities for display references only.
// No fetch, storage, model or wager authority. Never restamp source clocks.
export function retainedCfbExchangeFixtures(packet,{date,now=Date.now()}={}){
 const no=()=>({fixtures:[],state:'UNAVAILABLE'}),at=Date.parse(packet?.generatedAt),expiry=Date.parse(packet?.expiresAt);
 if(!Number.isFinite(now)||packet?.version!==1||packet.date!==date||packet.timezone!=='America/Chicago'||packet.canQualify!==false||packet.canAuthorizeWager!==false||!Number.isFinite(at)||at>now||now-at>7*86400000||!Number.isFinite(expiry)||expiry<=at||expiry-at>300000||!Array.isArray(packet.games)||packet.games.length>100)return no();
 const ids=new Set(),fixtures=[];
 for(const g of packet.games){
  if(g?.sport!=='cfb'||g.date!==date||g.source!=='ESPN_SCOREBOARD'||g.status!=='scheduled'||g.canAuthorizeWager!==false||g.canQualify!==false||g.capturedAt!==packet.generatedAt||!/^\d+$/.test(g.id)||ids.has(g.id)||!Number.isFinite(Date.parse(g.start))||boardDate(g.start)!==date)return no();
  ids.add(g.id);
  const h=g.home,a=g.away;
  if(!h||!a||!/^\d+$/.test(h.espnId)||!/^\d+$/.test(a.espnId)||h.espnId===a.espnId||typeof h.fullName!=='string'||typeof a.fullName!=='string'||!h.fullName.trim()||!a.fullName.trim()||h.fullName===a.fullName||h.fullName.length>160||a.fullName.length>160)return no();
  if(Date.parse(g.start)<=now||Date.parse(g.start)>now+7*86400000)continue;
  fixtures.push({id:g.id,sport:'cfb',start:g.start,home_name:h.fullName,away_name:a.fullName,home_abbr:h.abbr,away_abbr:a.abbr});
 }
 return {fixtures,state:now>=expiry?'RETAINED_OFFICIAL_SCHEDULE':'CAPTURED_OFFICIAL_SCHEDULE',capturedAt:packet.generatedAt,expiresAt:packet.expiresAt,referenceOnly:true,canAuthorizeWager:false};
}
