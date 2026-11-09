// Public static-price boundary: reconstruct only display fields, never authority.
export const PINNODDS_REFERENCE_CONTRACT='fbis-pinnodds-public-reference-v1';
export const PINNODDS_REFERENCE_MAX_AGE=45*60*1000;
const ms=v=>typeof v==='string'?Date.parse(v):NaN;
const name=(g,side)=>g?.[side+'_name']??g?.[side]?.name;
function validPacket(p,now){const at=ms(p?.capturedAt),end=ms(p?.expiresAt);return p?.contract===PINNODDS_REFERENCE_CONTRACT&&Number.isFinite(now)&&Number.isFinite(at)&&Number.isFinite(end)&&at<=now&&now<end&&end-at===PINNODDS_REFERENCE_MAX_AGE&&p.canAuthorizeWager===false&&p.providerQuoteClockVerified===false&&Array.isArray(p.games)&&p.games.length<=100&&p.games.every(g=>g&&typeof g==='object'&&typeof g.id==='string'&&g.id.length<=100&&['nfl','cfb'].includes(g.sport)&&Number.isFinite(ms(g.start))&&typeof g.home_name==='string'&&typeof g.away_name==='string'&&Array.isArray(g.offers)&&g.offers.length<=1000);}
export function nextPinnoddsDeadline(packet,now=Date.now()){
 if(!validPacket(packet,now))return null;
 return Math.min(ms(packet.expiresAt),...packet.games.map(g=>ms(g.start)).filter(t=>Number.isFinite(t)&&t>now));
}
const pin=v=>typeof v==='string'&&/pinn(?:acle|odds)/i.test(v);
const branded=v=>v&&typeof v==='object'&&[v.source,v.provider,v.book,v.bookmaker,v.softSource].some(pin);
const removePin=value=>Array.isArray(value)?value.filter(v=>!branded(v)).map(removePin):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k,v])=>!/^pin(?:nacle|nodds|Present|Spread|Total|HomeMl|AwayMl)/i.test(k)&&!branded(v)).map(([k,v])=>[k,removePin(v)])):value;
export function stripLegacyPinnodds(game){
 const clean={...game};
 for(const key of Object.keys(clean))if(/^pinn(?:acle|odds)/i.test(key))delete clean[key];
 clean.pinnoddsResearch=null;
 if(game.market){
  // Preserve explicitly unrelated venues while discarding a Pinnacle headline.
  const market=branded(game.market)?{venueOffers:game.market.venueOffers,reference:game.market.reference}:game.market;
  clean.market=removePin(market);
  if(market.reference&&(!market.reference.provider&&!market.reference.source||branded(market.reference)))delete clean.market.reference;
 }
 for(const key of ['odds','cbbVerifiedOffers','recoveryVerifiedOffers','exchangeReferenceQuotes','alternateLines','cfbMarketShopping'])if(game[key])clean[key]=branded(game[key])?{}:removePin(game[key]);
 const odds=game.odds;
 if(odds&&(odds.pinPresent||odds.pinSpread!=null||odds.pinTotal!=null||odds.pinHomeMl!=null||odds.pinAwayMl!=null||branded(game.market))&&!odds.heritageListed&&!odds.softPresent&&!odds.softSource)clean.odds={};
 return clean;
}
export function renderPinnoddsReference(game,packet,{now=Date.now()}={}){
 const clean=stripLegacyPinnodds(game);
 if(!validPacket(packet,now)||!['nfl','cfb'].includes(game.sport)||ms(game.start)<=now||!Number.isFinite(ms(game.start))||['live','final','cancelled','postponed'].includes(game.status))return clean;
 const rows=packet.games.filter(p=>p.id===game.id&&p.sport===game.sport&&ms(p.start)===ms(game.start)&&p.home_name===name(game,'home')&&p.away_name===name(game,'away'));
 if(rows.length!==1||!Array.isArray(rows[0].offers)||rows[0].offers.length>1000)return clean;
 const offers=[];
 for(const q of rows[0].offers){
  if(!q||q.source!=='PinnOdds'||!['moneyline','spread','total','team_total'].includes(q.marketFamily)||!(q.marketFamily==='moneyline'?['home','away','draw']:q.marketFamily==='spread'?['home','away']:['over','under']).includes(q.side)||typeof q.decimalOdds!=='number'||!Number.isFinite(q.decimalOdds)||q.decimalOdds<=1||typeof q.period!=='string'||q.period.length>64||typeof q.sourceMarketId!=='string'||q.sourceMarketId.length>200||q.capturedAt!==packet.capturedAt||(q.marketFamily==='team_total'&&!['home','away'].includes(q.team))||(q.line!==null&&(typeof q.line!=='number'||!Number.isFinite(q.line))))return clean;
  offers.push({source:'PinnOdds',sourceType:'sportsbook',eventId:game.id,sport:game.sport,marketFamily:q.marketFamily,team:q.marketFamily==='team_total'?q.team:null,side:q.side,line:q.line,decimalOdds:q.decimalOdds,period:q.period,sourceMarketId:q.sourceMarketId,standardOrAlt:['standard','alternate'].includes(q.standardOrAlt)?q.standardOrAlt:'unknown',capturedAt:packet.capturedAt,collectedAt:packet.capturedAt,sourceObservedAt:null,executionEligible:false,canQualify:false,canAuthorizeWager:false});
 }
 clean.pinnoddsResearch={source:'PinnOdds',researchOnly:true,canAuthorizeWager:false,matchedCanonicalEventId:game.id,latestCapturedAt:packet.capturedAt,offers};return clean;
}
