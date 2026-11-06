// Owner-authorized board output: derived scores only, never raw ratings or credentials.
const model='CBB-KENPOM-RATINGS-v1';
export function cbbCardSummary(p,{date,now=Date.now()}={}){
 if(p?.version!==1||!Number.isFinite(Date.parse(p.generatedAt))||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.generatedAt)>now||Date.parse(p.expiresAt)<=now||!Array.isArray(p.events)||p.events.length>1000)throw Error('INVALID_OR_EXPIRED_CBB_PACKET');
 const events=[],seen=new Set();
 for(const e of p.events){if(!e.primary)continue;const q=e.primary;
  if(e.date!==date||!/^\d+$/.test(e.eventId)||seen.has(e.eventId)||!/^cbb-\d+$/.test(e.homeId)||!/^cbb-\d+$/.test(e.awayId)||e.homeId===e.awayId||typeof e.neutralSite!=='boolean'||!Number.isFinite(Date.parse(e.start))||q.modelId!==model||!['home','away','margin','total'].every(k=>Number.isFinite(q[k]))||Math.abs(q.home-q.away-q.margin)>.21||Math.abs(q.home+q.away-q.total)>.21)throw Error('INVALID_CBB_SUMMARY_EVENT');
  seen.add(e.eventId);events.push({eventId:e.eventId,date,start:e.start,homeId:e.homeId,awayId:e.awayId,neutralSite:e.neutralSite,canAuthorizeWager:false,primary:{home:q.home,away:q.away,margin:q.margin,total:q.total,modelId:model,attribution:'KenPom ratings · FBIS formula · provisional research'}});
 }
 return {version:1,visibility:'CBB_CARD_SUMMARY',generatedAt:p.generatedAt,expiresAt:p.expiresAt,captures:{kenpom:p.captures?.kenpom||null},events,canAuthorizeWager:false};
}
export function validateCbbCardSummary(p,{date,now=Date.now()}={}){
 if(p?.visibility!=='CBB_CARD_SUMMARY'||p.canAuthorizeWager!==false)throw Error('INVALID_CBB_SUMMARY');
 return cbbCardSummary(p,{date,now});
}
