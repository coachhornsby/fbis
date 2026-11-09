import {buildDetailedFootballPacket,publishStaticReference} from './staticPacket.mjs';
// Source receipt and explicit aliases are trusted local acquisition artifacts.
// Validate each binding against independent ESPN evidence and existing board IDs.
export async function prepareDetailedFootballPublication({raw,receipt,board,espn,bindings,now=Date.now()}){
 const at=Date.parse(espn?.receivedAt);
 if(espn?.httpStatus!==200||espn.league!=='cfb'||!/^202611(10|11|12|13|14)$/.test(espn.date)||espn.sourceUrl!=='https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates='+espn.date+'&limit=1000&groups=80'||!Number.isFinite(at)||at>now||now-at>300000||espn.truncated!==false||!Array.isArray(espn.data?.events)||!Array.isArray(board?.games)||!Array.isArray(bindings)||!bindings.length||bindings.length>100)throw Error('PINNODDS_DETAILED_FIXTURE_PROOF_INVALID');
 const fixtures=bindings.map(b=>{
  const events=espn.data.events.filter(e=>e.id===b.espnEventId),games=board.games.filter(g=>g.id===b.espnEventId&&g.sport==='cfb');
  if(events.length!==1||games.length!==1||b.homeAwayReversed!==false||b.status!=='VERIFIED_EXPLICIT_ALIAS_PAIR_AND_EXACT_START')throw Error('PINNODDS_DETAILED_IDENTITY_INVALID');
  const e=events[0],g=games[0],c=e.competitions?.[0],home=c?.competitors?.find(x=>x.homeAway==='home'),away=c?.competitors?.find(x=>x.homeAway==='away');
  if(e.status?.type?.name!=='STATUS_SCHEDULED'||g.status!=='scheduled'||!home||!away||home.team.id!==b.espnHome.id||away.team.id!==b.espnAway.id||String(g.home?.espnId)!==home.team.id||String(g.away?.espnId)!==away.team.id||Date.parse(e.date)!==Date.parse(b.providerStartUtc)||Date.parse(e.date)!==Date.parse(g.start)||Date.parse(e.date)<=now||!b.aliases?.some(a=>a.providerName===b.providerHomeName&&a.espnTeamId===home.team.id)||!b.aliases?.some(a=>a.providerName===b.providerAwayName&&a.espnTeamId===away.team.id))throw Error('PINNODDS_DETAILED_IDENTITY_INVALID');
  return {id:g.id,sport:'cfb',start:g.start,home_name:g.home.name,away_name:g.away.name,providerHome:b.providerHomeName,providerAway:b.providerAwayName,providerEventId:Number(b.providerEventId)};
 });
 const packet=await buildDetailedFootballPacket({raw,receipt,fixtures,now});
 return {board:publishStaticReference(board,packet,{now}),diagnostics:packet.diagnostics,published:false,canAuthorizeWager:false};
}
// Existing captureScoreboards output, acquired locally with bounded public reads.
export async function prepareCapturedFootballPublication({raw,receipt,board,capture,bindings,now=Date.now()}){
 const source=capture?.boards?.filter(b=>b.date===board?.date);
 if(source?.length!==1||!/^2026-11-(10|11|12|13|14)$/.test(board.date)||!Array.isArray(bindings)||!bindings.length)throw Error('PINNODDS_FOOTBALL_CAPTURE_PROOF_INVALID');
 const canonical=source[0],day=board.date.replaceAll('-','');
 const sources=canonical.sources?.filter(s=>s.sport==='cfb'&&s.ok===true)||[];
 if(!sources.length||sources.some(s=>{const rows=capture.receipts?.filter(r=>r.url===s.url&&r.status===200)||[];return !/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/college-football\/scoreboard\?dates=202611(10|11|12|13|14|15)&limit=500&groups=80$/.test(s.url)||rows.length!==1||!Number.isFinite(Date.parse(rows[0].receivedAt))||Date.parse(rows[0].receivedAt)>now||now-Date.parse(rows[0].receivedAt)>300000;})||!sources.some(s=>s.url.includes('dates='+day+'&')))throw Error('PINNODDS_FOOTBALL_CAPTURE_PROOF_INVALID');
 const fixtures=bindings.map(b=>{
  const candidates=canonical.games.filter(g=>g.id===b.espnEventId&&g.sport==='cfb'),targets=board.games.filter(g=>g.id===b.espnEventId&&g.sport==='cfb');
  if(candidates.length!==1||targets.length!==1)throw Error('PINNODDS_DETAILED_IDENTITY_INVALID');
  const g=candidates[0],t=targets[0];
  if(g.status!=='scheduled'||t.status!=='scheduled'||b.homeAwayReversed!==false||b.status!=='VERIFIED_EXPLICIT_ALIAS_PAIR_AND_EXACT_START'||Date.parse(g.start)!==Date.parse(b.providerStartUtc)||Date.parse(g.start)!==Date.parse(t.start)||Date.parse(g.start)<=now||g.home.espnId!==b.espnHome.id||g.away.espnId!==b.espnAway.id||g.home.espnId!==t.home.espnId||g.away.espnId!==t.away.espnId||g.home.name!==t.home.name||g.away.name!==t.away.name||!b.aliases?.some(a=>a.providerName===b.providerHomeName&&a.espnTeamId===g.home.espnId)||!b.aliases?.some(a=>a.providerName===b.providerAwayName&&a.espnTeamId===g.away.espnId))throw Error('PINNODDS_DETAILED_IDENTITY_INVALID');
  return {id:g.id,sport:'cfb',start:g.start,home_name:g.home.name,away_name:g.away.name,providerHome:b.providerHomeName,providerAway:b.providerAwayName,providerEventId:Number(b.providerEventId)};
 });
 const packet=await buildDetailedFootballPacket({raw,receipt,fixtures,now});
 return {board:publishStaticReference(board,packet,{now}),diagnostics:packet.diagnostics,published:false,canAuthorizeWager:false};
}
