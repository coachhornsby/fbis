// Private, precomputed model-output transport. No inference, provider retrieval, or wagers.
export const PRIVATE_RECOVERY_SPORTS=Object.freeze(['nfl','nba','cfb']);
const validDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
const validTime=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function validateFourSportPacket(packet,{sport,date}={}){
 if(!packet||packet.version!==1||packet.visibility!=='PRIVATE_PERSONAL_ANALYSIS'||packet.canAuthorizeWager!==false||
   !PRIVATE_RECOVERY_SPORTS.includes(packet.sport)||!validDate(packet.date)||
   (sport&&packet.sport!==sport)||(date&&packet.date!==date)||
   !validTime(packet.generatedAt)||!validTime(packet.expiresAt)||
   Date.parse(packet.generatedAt)>Date.parse(packet.expiresAt)||
   !Array.isArray(packet.events)||packet.events.length>250||
   typeof packet.modelAuthority!=='string'||!['FROZEN_RESEARCH','RESEARCH_ONLY'].includes(packet.modelAuthority))
   throw Error('INVALID_PRIVATE_SPORT_PACKET');
 const seen=new Set();
 for(const e of packet.events){
   if(!e||!/^\d+$/.test(String(e.eventId))||e.date!==packet.date||!validTime(e.start)||
     !new RegExp('^'+packet.sport+'-\\d+$').test(e.homeId)||
     !new RegExp('^'+packet.sport+'-\\d+$').test(e.awayId)||
     e.homeId===e.awayId||seen.has(e.eventId)||
     !e.projection||!finite(e.projection.homeScore)||!finite(e.projection.awayScore)||
     !finite(e.projection.margin)||!finite(e.projection.total)||
     Math.abs(e.projection.homeScore-e.projection.awayScore-e.projection.margin)>0.2||
     Math.abs(e.projection.homeScore+e.projection.awayScore-e.projection.total)>0.2||
     !e.projection.modelId||!e.projection.modelVersion||
     e.canAuthorizeWager!==false||!validTime(e.sourceCapturedAt)||
     Date.parse(e.sourceCapturedAt)>Date.parse(packet.generatedAt)||Date.parse(e.sourceCapturedAt)>Date.parse(e.start))
     throw Error('INVALID_PRIVATE_SPORT_FIXTURE');
   seen.add(e.eventId);
 }
 return packet;
}
export function privateFourSportProjectionFor(game,packet,clock=Date.now()){
 if(!game||!packet||packet.sport!==game.sport)return null;
 const e=packet.events.find(x=>x.eventId===String(game.id));
 if(!e||e.date!==game.date||Date.parse(e.start)!==Date.parse(game.start)||
   e.homeId!==game.sport+'-'+game.home?.espnId||e.awayId!==game.sport+'-'+game.away?.espnId)return null;
 const expired=clock>=Date.parse(packet.expiresAt);
 const started=clock>=Date.parse(e.start)||game.status!=='scheduled';
 return {...e,expired,started,historical:expired||started,expiresAt:packet.expiresAt,modelAuthority:packet.modelAuthority};
}
