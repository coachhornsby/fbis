// Strict, private, date-scoped projection contract. No model calculations or price inference.
export const RECOVERY_SPORTS=Object.freeze(['nfl','cfb','nba','cbb']);
export const RECOVERY_PRIVATE_SPORTS=Object.freeze(['nfl','cfb','nba']);
export function validRecoveryDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const d=new Date(value+'T12:00:00Z');return !Number.isNaN(+d)&&d.toISOString().slice(0,10)===value;
}
const iso=x=>typeof x==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x));
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
export function validateRecoveryPacket(packet,sport,date){
 if(!RECOVERY_PRIVATE_SPORTS.includes(sport)||!validRecoveryDate(date))throw Error('UNSUPPORTED_SPORT_DATE');
 if(!packet||packet.version!==1||packet.visibility!=='PRIVATE_PERSONAL_ANALYSIS'||packet.sport!==sport||packet.date!==date||
  !iso(packet.generatedAt)||!iso(packet.expiresAt)||Date.parse(packet.expiresAt)<Date.parse(packet.generatedAt)||
  !Array.isArray(packet.events)||packet.events.length>500||!Array.isArray(packet.sources)||!packet.sources.length||
  packet.sources.length>12||packet.sources.some(s=>typeof s!=='string'||!s.trim()||s.length>120)||
  packet.canAuthorizeWager!==false)throw Error('INVALID_RECOVERY_PACKET');
 const seen=new Set();
 for(const event of packet.events){
  if(!event||event.date!==date||!/^[0-9]+$/.test(String(event.eventId||''))||
    !/^[0-9]+$/.test(String(event.homeId||''))||!/^[0-9]+$/.test(String(event.awayId||''))||
    event.homeId===event.awayId||!iso(event.start)||seen.has(String(event.eventId))||
    (event.neutralSite!==null&&typeof event.neutralSite!=='boolean'))throw Error('INVALID_RECOVERY_FIXTURE');
  seen.add(String(event.eventId));
  const p=event.primary;
  if(p!==null&&p!==undefined&&(
   typeof p.modelId!=='string'||!p.modelId.trim()||p.modelId.length>120||
   !numeric(p.home)||!numeric(p.away)||p.home<0||p.away<0||
   !numeric(p.margin)||!numeric(p.total)||
   Math.abs(p.margin-(p.home-p.away))>0.16||Math.abs(p.total-(p.home+p.away))>0.16||
   p.canAuthorizeWager!==false
  ))throw Error('INVALID_RECOVERY_PROJECTION');
 }
 return packet;
}
export function projectRecoveryGame(game,packet,clock=Date.now()){
 if(!game||!packet||game.sport!==packet.sport||game.date!==packet.date)return null;
 const e=packet.events.find(x=>String(x.eventId)===String(game.id));
 if(!e?.primary||String(e.homeId)!==String(game.home?.espnId)||String(e.awayId)!==String(game.away?.espnId)||
  Date.parse(e.start)!==Date.parse(game.start)|| (e.neutralSite!==null&&e.neutralSite!==game.neutralSite))return null;
 return {...e,expired:clock>=Date.parse(packet.expiresAt),started:clock>=Date.parse(e.start)||game.status!=='scheduled',expiresAt:packet.expiresAt,generatedAt:packet.generatedAt,sources:packet.sources};
}
export async function loadRecoverySnapshot(sport,date,{fetchFn=fetch}={}){
 if(!RECOVERY_PRIVATE_SPORTS.includes(sport)||!validRecoveryDate(date))throw Error('UNSUPPORTED_SPORT_DATE');
 const res=await fetchFn('/api/private/projections/'+sport+'/'+date,{credentials:'same-origin',cache:'no-store'});
 if(!res.ok)throw Error([401,403].includes(res.status)?'PRIVATE_SIGN_IN_REQUIRED':res.status===404?'NO_SNAPSHOT':'PRIVATE_DATA_UNAVAILABLE');
 const payload=await res.json();
 if(payload.state!=='PRIVATE_RESEARCH_ONLY'||payload.date!==date||payload.sport!==sport)throw Error('INVALID_PRIVATE_RESPONSE');
 return validateRecoveryPacket(payload.packet,sport,date);
}
