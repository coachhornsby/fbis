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

/** The owner's FBIS HTML report carries an embedded JSON packet, but its scripts
 * must remain inert. This parser makes no network requests and uses no eval. */
export function readPrivatePacketText(text){
 if(typeof text!=='string'||text.length>2000000)throw Error('Private projection file is too large or invalid.');
 const source=text.trimStart();
 if(source.startsWith('{'))return validatePrivatePacket(JSON.parse(source));
 if(!/^<!doctype html>/i.test(source)||!source.includes('<title>FBIS Private CBB Projections</title>'))throw Error('Choose an FBIS private projections JSON or HTML report.');
 const marker='const packet=',at=source.indexOf(marker);
 if(at<0||source.indexOf(marker,at+marker.length)>=0)throw Error('Private HTML report has no unambiguous projection packet.');
 const raw=source.slice(at+marker.length);
 if(raw[0]!=='{')throw Error('Private HTML projection packet is malformed.');
 let depth=0,quoted=false,escape=false,end=-1;
 for(let i=0;i<raw.length;i++){
  const c=raw[i];
  if(quoted){
   if(escape)escape=false;
   else if(c==='\\')escape=true;
   else if(c==='"')quoted=false;
  }else if(c==='"')quoted=true;
  else if(c==='{')depth++;
  else if(c==='}'){depth--;if(depth===0){end=i;break;}if(depth<0)break;}
 }
 if(end<0||raw[end+1]!==';')throw Error('Private HTML projection packet is incomplete.');
 return validatePrivatePacket(JSON.parse(raw.slice(0,end+1)));
}
