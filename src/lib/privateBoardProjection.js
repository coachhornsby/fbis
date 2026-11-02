export const PRIVATE_PROJECTION_KEY='fbis.private-projections.v1';
export function validatePrivatePacket(p){
 if(p?.version!==1||p.visibility!=='PRIVATE_PERSONAL_ANALYSIS'||!Array.isArray(p.events)||p.events.length>1000||!Number.isFinite(Date.parse(p.expiresAt)))throw Error('Choose a valid FBIS private projection JSON file.');
 const seen=new Set();
 for(const e of p.events){
  if(!/^\d+$/.test(e.eventId)||seen.has(e.eventId)||!Number.isFinite(Date.parse(e.start))||!/^cbb-\d+$/.test(e.homeId)||!/^cbb-\d+$/.test(e.awayId)||typeof e.neutralSite!=='boolean')throw Error('Invalid or duplicate fixture in projection file.');
  seen.add(e.eventId);
  for(const v of [e.primary,e.comparison])if(v&&!['home','away','margin','total'].every(k=>Number.isFinite(v[k])))throw Error('Projection file contains invalid scores.');
 }
 return p;
}
export function privateProjectionFor(game,packet,clock=Date.now()){
 if(game?.sport!=='cbb'||!packet)return null;
 const e=packet.events.find(e=>e.eventId===String(game.id));
 if(!e?.primary)return null;
 if(e.date!==game.date||Date.parse(e.start)!==Date.parse(game.start)||e.homeId!==`cbb-${game.home?.espnId}`||e.awayId!==`cbb-${game.away?.espnId}`||e.neutralSite!==game.neutralSite)return null;
 const expired=clock>=Date.parse(packet.expiresAt),started=clock>=Date.parse(e.start)||game.status!=='scheduled';
 return {...e,expired,started,historical:expired||started,expiresAt:packet.expiresAt,captures:packet.captures};
}
