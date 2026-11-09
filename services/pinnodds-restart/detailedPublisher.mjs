import {buildDetailedBasketballPacket,publishStaticReference} from './staticPacket.mjs';
// Source receipt and explicit aliases are trusted local acquisition artifacts.
// Validate each binding against independent ESPN evidence and existing board IDs.
export async function prepareDetailedBasketballPublication({raw,receipt,board,espn,bindings,now=Date.now()}){
 const at=Date.parse(espn?.receivedAt);
 if(espn?.httpStatus!==200||espn.league!=='cbb'||espn.date!=='20261109'||espn.sourceUrl!=='https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261109&limit=1000&groups=50'||!Number.isFinite(at)||at>now||now-at>300000||espn.truncated!==false||!Array.isArray(espn.data?.events)||!Array.isArray(board?.games)||!Array.isArray(bindings)||!bindings.length||bindings.length>100)throw Error('PINNODDS_DETAILED_FIXTURE_PROOF_INVALID');
 const fixtures=bindings.map(b=>{
  const events=espn.data.events.filter(e=>e.id===b.espnEventId),games=board.games.filter(g=>g.id===b.espnEventId&&g.sport==='cbb');
  if(events.length!==1||games.length!==1||b.homeAwayReversed!==false||b.status!=='VERIFIED_EXPLICIT_ALIAS_PAIR_AND_EXACT_START')throw Error('PINNODDS_DETAILED_IDENTITY_INVALID');
  const e=events[0],g=games[0],c=e.competitions?.[0],home=c?.competitors?.find(x=>x.homeAway==='home'),away=c?.competitors?.find(x=>x.homeAway==='away');
  if(e.status?.type?.name!=='STATUS_SCHEDULED'||g.status!=='scheduled'||!home||!away||home.team.id!==b.espnHome.id||away.team.id!==b.espnAway.id||String(g.home?.espnId)!==home.team.id||String(g.away?.espnId)!==away.team.id||Date.parse(e.date)!==Date.parse(b.providerStartUtc)||Date.parse(e.date)!==Date.parse(g.start)||Date.parse(e.date)<=now||!b.aliases?.some(a=>a.providerName===b.providerHomeName&&a.espnTeamId===home.team.id)||!b.aliases?.some(a=>a.providerName===b.providerAwayName&&a.espnTeamId===away.team.id))throw Error('PINNODDS_DETAILED_IDENTITY_INVALID');
  return {id:g.id,sport:'cbb',start:g.start,home_name:g.home.name,away_name:g.away.name,providerHome:b.providerHomeName,providerAway:b.providerAwayName,providerEventId:Number(b.providerEventId)};
 });
 const packet=await buildDetailedBasketballPacket({raw,receipt,fixtures,now});
 return {board:publishStaticReference(board,packet,{now}),diagnostics:packet.diagnostics,published:false,canAuthorizeWager:false};
}
