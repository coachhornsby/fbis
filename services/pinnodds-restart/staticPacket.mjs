import {PINNODDS_REFERENCE_CONTRACT,stripLegacyPinnodds} from '../../src/lib/pinnoddsStaticReference.js';
import {normalizePinnoddsMarkets,pinnoddsSport} from '../../functions/lib/pinnoddsMarkets.js';
import {sha256,SOURCE,ATTEMPT,ROOT} from './once.mjs';
const MAX_AGE=45*60*1000;
const verifiedPackets=new WeakSet();
function deepFreeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))deepFreeze(child);
  Object.freeze(value);
 }
 return value;
}
// Pure local transformation. No database, provider request, or publishing side effect.
export async function buildStaticPacket({raw,receipt,fixtures,now=Date.now()}){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>2097152)throw Error('PINNODDS_PACKET_RAW_LIMIT');
 if(receipt?.ok!==true||receipt.snapshotId!==ATTEMPT||receipt.sportId!==5||receipt.feed!=='prematch'||receipt.sourceUrl!==SOURCE||receipt.rawKey!==ROOT+'/raw-'+receipt.rawHash+'.json'||await sha256(raw)!==receipt.rawHash)throw Error('PINNODDS_PACKET_RECEIPT_MISMATCH');
 return buildValidatedPacket({raw,receipt,fixtures,now});
}
// Local direct acquisition receipt only. It cannot impersonate an R2 archive
// receipt and never causes a source call, archive access or publication.
function approvedDirectSource(value){
 try{const u=new URL(value);if(u.origin!=='https://pinnodds.com'||u.username||u.password||u.hash)return false;
 const allowed=u.pathname==='/kit/v1/prematch/fixtures'?['sport_id','include_specials']:u.pathname==='/kit/v1/markets'?['sport_id','event_type','include_specials']:[];
 return allowed.length>0&&[...u.searchParams.keys()].every(k=>allowed.includes(k)&&u.searchParams.getAll(k).length===1)&&u.searchParams.get('sport_id')==='5'&&(u.pathname!=='/kit/v1/markets'||u.searchParams.get('event_type')==='prematch')&&(!u.searchParams.has('include_specials')||u.searchParams.get('include_specials')==='0');
 }catch{return false;}
}
export async function buildDirectStaticPacket({raw,receipt,fixtures,now=Date.now()}){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>2097152)throw Error('PINNODDS_PACKET_RAW_LIMIT');
 if(receipt?.ok!==true||receipt.acquisition!=='direct'||typeof receipt.completeFeed!=='boolean'||receipt.sportId!==5||receipt.feed!=='prematch'||!approvedDirectSource(receipt.sourceUrl)||receipt.rawKey!=null||receipt.snapshotId!=='pinnodds-direct-'+receipt.rawHash||await sha256(raw)!==receipt.rawHash)throw Error('PINNODDS_DIRECT_RECEIPT_MISMATCH');
 return buildValidatedPacket({raw,receipt,fixtures,now});
}
function buildValidatedPacket({raw,receipt,fixtures,now}){
 if(receipt.providerStatus!=null&&receipt.providerStatus!=='fresh')throw Error('PINNODDS_PACKET_PROVIDER_NOT_FRESH');
 const captured=Date.parse(receipt.collectedAt),started=Date.parse(receipt.captureStartedAt);
 if(!Number.isFinite(now)||!Number.isFinite(captured)||!Number.isFinite(started)||started>captured||captured-started>110000||captured>now||now-captured>MAX_AGE)throw Error('PINNODDS_PACKET_STALE_OR_INVALID_CLOCK');
 if(!Array.isArray(fixtures)||fixtures.length>100||fixtures.some(g=>!g||!['nfl','cfb'].includes(g.sport)||typeof g.id!=='string'||!g.id||!g.home_name||!g.away_name||!Number.isFinite(Date.parse(g.start))))throw Error('PINNODDS_PACKET_FIXTURE_CONTRACT');
 if(new Set(fixtures.map(g=>g.sport+'|'+g.id)).size!==fixtures.length)throw Error('PINNODDS_PACKET_DUPLICATE_FIXTURE');
 const body=JSON.parse(raw);if(!Array.isArray(body.events)||body.events.length>2000||body.events.length!==receipt.providerEventCount)throw Error('PINNODDS_PACKET_EVENTS_CONTRACT');
 // Preselect strict independently supplied fixture identities, never use a
 // model forecast to infer identity, and do not tolerate fuzzy/time-shift matches.
 const scoped=body.events.filter(e=>!e.special&&!e.special_category&&fixtures.some(g=>g.sport===pinnoddsSport(5,e.league_name)&&g.home_name===e.home&&g.away_name===e.away&&Date.parse(g.start)===Date.parse(e.starts)&&Date.parse(g.start)>now)).map(e=>({...e,specials:undefined}));
 const result=normalizePinnoddsMarkets({...body,events:scoped},{sportId:5,feed:'prematch',capturedAt:receipt.collectedAt,games:fixtures,snapshotId:receipt.snapshotId,rawKey:receipt.rawKey});
 const offers=result.rows.filter(r=>r.eventId&&['moneyline','spread','total','team_total'].includes(r.marketFamily)&&fixtures.some(g=>g.id===r.eventId&&g.sport===r.sport&&g.home_name===r.homeTeam&&g.away_name===r.awayTeam&&Date.parse(g.start)===Date.parse(r.eventStart)&&Date.parse(g.start)>now));
 const packet={contract:'fbis-pinnodds-static-reference-v1',snapshotId:receipt.snapshotId,captureCompleteness:receipt.acquisition==='direct'?(receipt.completeFeed?'complete':'partial'):'unknown',rawHash:receipt.rawHash,capturedAt:receipt.collectedAt,expiresAt:new Date(captured+MAX_AGE).toISOString(),providerQuoteClockVerified:false,canAuthorizeWager:false,
 games:fixtures.map(g=>({id:g.id,sport:g.sport,start:g.start,home_name:g.home_name,away_name:g.away_name,pinnoddsResearch:{source:'PinnOdds',researchOnly:true,canAuthorizeWager:false,matchedCanonicalEventId:g.id,latestCapturedAt:receipt.collectedAt,offers:offers.filter(r=>r.sport===g.sport&&r.eventId===g.id).map(r=>({...r,capturedAt:receipt.collectedAt,collectedAt:receipt.collectedAt}))}})),
 diagnostics:{providerEventCount:body.events.length,selectedProviderEvents:scoped.length,offers:offers.length,fullMarketCoverageVerified:false}};
 deepFreeze(packet);verifiedPackets.add(packet);return packet;
}
export function applyStaticPacket(board,packet,{now=Date.now()}={}){
 if(!verifiedPackets.has(packet)||packet?.contract!=='fbis-pinnodds-static-reference-v1'||!Array.isArray(packet.games)||!Array.isArray(board?.games)||!Number.isFinite(now)||now<Date.parse(packet.capturedAt)||!Number.isFinite(Date.parse(packet.expiresAt))||now>=Date.parse(packet.expiresAt))throw Error('PINNODDS_PACKET_UNUSABLE');
 // Packet must come directly from buildStaticPacket in this offline process;
 // this is not a trusted-data verification boundary for uploaded JSON.
 const byId=new Map(packet.games.map(g=>[g.sport+'|'+g.id,g]));
 return {...board,games:board.games.map(g=>{const p=byId.get(g.sport+'|'+g.id);if(!p)return g;
 if(Date.parse(p.start)<=now)throw Error('PINNODDS_PACKET_EVENT_STARTED');
 if(Date.parse(g.start)!==Date.parse(p.start)||(g.home_name??g.home?.name)!==p.home_name||(g.away_name??g.away?.name)!==p.away_name)throw Error('PINNODDS_PACKET_BOARD_IDENTITY_MISMATCH');
 return {...g,pinnoddsResearch:p.pinnoddsResearch};})};
}

export function publicReferencePacket(packet){
 if(!verifiedPackets.has(packet))throw Error('PINNODDS_PACKET_UNUSABLE');
 return deepFreeze({contract:PINNODDS_REFERENCE_CONTRACT,captureCompleteness:packet.captureCompleteness,capturedAt:packet.capturedAt,expiresAt:packet.expiresAt,providerQuoteClockVerified:false,canAuthorizeWager:false,
 games:packet.games.map(g=>({id:g.id,sport:g.sport,start:g.start,home_name:g.home_name,away_name:g.away_name,offers:g.pinnoddsResearch.offers.map(q=>({source:'PinnOdds',marketFamily:q.marketFamily,team:q.team??null,side:q.side,line:q.line,decimalOdds:q.decimalOdds,period:q.period,sourceMarketId:q.sourceMarketId,standardOrAlt:q.standardOrAlt,capturedAt:packet.capturedAt}))}))});
}
export function publishStaticReference(board,packet,{now=Date.now()}={}){
 // Validates board identity and kickoff before producing the static snapshot.
 applyStaticPacket(board,packet,{now});
 const clean={...board};for(const key of Object.keys(clean))if(/^pinn(?:acle|odds)/i.test(key))delete clean[key];
 return {...clean,games:board.games.map(stripLegacyPinnodds),pinnoddsStaticReference:publicReferencePacket(packet)};
}
