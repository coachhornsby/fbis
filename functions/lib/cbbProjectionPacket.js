/** Offline CBB producer. No network calls, credentials, persistence or wager authority. */
import {cbbKenpomRatingsV1,cbbTorvikRatingsV1,cbbRatingsV1} from './cbbRatings.js';
import {buildCbbPro} from './cbbProModel.js';
import {applyCbbOfficialFixture} from './cbbOfficialFixtures.js';
export const CBB_INPUT_TTL_MS=6*60*60*1000;
export function cbbFixtureKey(g){return [g.id,g.date,g.start,g.home?.espnId,g.away?.espnId,String(g.neutralSite)].join('|');}
/** Evidence is tied to the complete captured fixture, never just a matchup name. */
export function cbbFixtureEvidenceReasons(game,evidence,asOf){
 if(!evidence)return ['FIXTURE_EVIDENCE_MISSING'];
 if(evidence.eventId!==game.id||evidence.fixtureKey!==cbbFixtureKey(game)||evidence.date!==game.date)return ['FIXTURE_EVIDENCE_BINDING_MISMATCH'];
 if(!fresh(evidence.observedAt,Date.parse(asOf)))return ['FIXTURE_EVIDENCE_STALE_OR_FUTURE'];
 if(evidence.blocked!==false)return evidence.reasons?.length?[...evidence.reasons]:['FIXTURE_SOURCE_CONFLICT'];
 if(evidence.reasons?.length)return ['FIXTURE_EVIDENCE_INCONSISTENT'];
 return [];
}
/** Resolve reviewed source conflicts while keeping the old evidence immutable. */
export function resolveCbbOfficialEvidence(game,evidence,record,asOf){
 if(!evidence||evidence.eventId!==game.id||evidence.fixtureKey!==cbbFixtureKey(game)||evidence.date!==game.date)return {game,evidence};
 const corrected=applyCbbOfficialFixture(game,record,Date.parse(asOf));
 if(corrected===game)return {game,evidence};
 const cleared=record.decision==='EARLY_START_CONFIRMED'?['EARLY_START_REQUIRES_OFFICIAL_CONFIRMATION']:record.decision==='OPPONENT_CHANGE_CONFIRMED'?['OPPONENT_CONFLICT']:record.decision==='START_CORRECTED'?['SOURCE_START_DISAGREEMENT']:[];
 const reasons=[...new Set([...(evidence.reasons||[]).filter(x=>!cleared.includes(x)),...record.remainingHolds])];
 return {game:corrected,evidence:{...evidence,fixtureKey:cbbFixtureKey(corrected),observedAt:record.reviewedAt,sourceResolutionUrl:record.sourceUrl,reasons,blocked:reasons.length>0,benchmarkPresent:record.decision==='OPPONENT_CHANGE_CONFIRMED'?false:evidence.benchmarkPresent}};
}
function index(rows,provider,season){
 const map=new Map();
 for(const r of rows||[]){if(r.provider!==provider||r.season!==season)continue;const p=typeof r.payload==='string'?JSON.parse(r.payload):r.payload;
  if(!/^cbb-\d+$/.test(r.teamId)||p.canonicalId!==r.teamId||p.season!==season)throw Error('PROVIDER_IDENTITY_MISMATCH');
  if(map.has(r.teamId))throw Error('DUPLICATE_PROVIDER_TEAM');map.set(r.teamId,p);
 }return map;
}
function ratings(h,a){return {homeAdjOe:h?.adjOe,homeAdjDe:h?.adjDe,homeTempo:h?.tempo,awayAdjOe:a?.adjOe,awayAdjDe:a?.adjDe,awayTempo:a?.tempo};}
function fresh(at,now){return Number.isFinite(Date.parse(at))&&Date.parse(at)<=now&&now-Date.parse(at)<=CBB_INPUT_TTL_MS;}
export function buildCbbProjectionPacket({games,providerRows,captures,asOf,season=2027,fixtureEvidence=null}){
 const now=Date.parse(asOf);if(!Number.isFinite(Date.parse(captures?.kenpom)))throw Error('INVALID_CAPTURE_TIME');if(!Number.isFinite(now))throw Error('INVALID_PROJECTION_TIME');
 const kp=index(providerRows,'kenpom',season),tv=index(providerRows,'torvik',season),cb=index(providerRows,'cbbd',season);
 const out=[];const ids=new Set();
 for(const g of games||[]){if(g.sport!=='cbb')continue;const key=cbbFixtureKey(g);if(ids.has(g.id))throw Error('DUPLICATE_EVENT');ids.add(g.id);
  const reasons=fixtureEvidence?cbbFixtureEvidenceReasons(g,fixtureEvidence[g.id],asOf):[];let primary=null,comparison=null,confirmation=null;
  if(!/^\d+$/.test(String(g.id))||!/^\d+$/.test(g.home?.espnId||'')||!/^\d+$/.test(g.away?.espnId||'')||g.home.espnId===g.away.espnId)reasons.push('IDENTITY_UNRESOLVED');
  if(g.status!=='scheduled'||!Number.isFinite(Date.parse(g.start))||Date.parse(g.start)<=now)reasons.push('NOT_PREGAME');
  if(typeof g.neutralSite!=='boolean')reasons.push('VENUE_UNVERIFIED');
  const home='cbb-'+g.home?.espnId,away='cbb-'+g.away?.espnId;
  if(!kp.has(home)||!kp.has(away))reasons.push('PRIMARY_TEAM_UNAVAILABLE');
  if(!fresh(captures.kenpom,now))reasons.push('PRIMARY_INPUT_EXPIRED');
  if(Date.parse(captures.kenpom)>=Date.parse(g.start))reasons.push('INPUT_AFTER_TIPOFF');
  if(!reasons.length){const p=cbbKenpomRatingsV1(g,ratings(kp.get(home),kp.get(away)));
   if(p.ok)primary={home:p.home,away:p.away,margin:p.margin,total:p.total,possessions:p.possessions,hca:p.hca,modelId:p.modelId,attribution:'kenpom.com adjusted ratings; FBIS formula',independent:false,stage:'PRESEASON_OR_CURRENT_PRIMARY_ONLY'};
   else reasons.push('PRIMARY_FEATURES_INVALID');
  }
  if(primary&&fresh(captures.torvik,now)&&tv.has(home)&&tv.has(away)){
   const p=cbbTorvikRatingsV1(g,ratings(tv.get(home),tv.get(away)));if(p.ok)comparison={home:p.home,away:p.away,margin:p.margin,total:p.total,attribution:'Bart Torvik adjusted ratings; FBIS formula',comparisonOnly:true};
  }
  // No prior-season rating substitution, inferred pace, or missing confirmation converted to zero.
  const ch=cb.get(home)?.adjustedRatings,ca=cb.get(away)?.adjustedRatings;
  if(primary&&fresh(captures.cbbd,now)&&ch&&ca){const p=cbbRatingsV1(g,ratings(ch,ca));if(p.ok)confirmation=p;}
  const pro=buildCbbPro({...g,odds:{},challengers:{'CBB-KENPOM-RATINGS-v1':primary?{...primary,ok:true}:null,'CBB-CBBD-RATINGS-v1':confirmation},cbbFbisNative:null});
  out.push({eventId:g.id,date:g.date,start:g.start,fixtureKey:key,homeId:home,awayId:away,homeName:g.home?.name,awayName:g.away?.name,neutralSite:g.neutralSite,
   primary,comparison,confirmationAvailable:Boolean(confirmation),nativeTotal:null,
   state:primary?'PRIVATE_PRIMARY_UNCONFIRMED':'UNAVAILABLE',reasons:[...reasons,...(!confirmation?['CURRENT_CBBD_CONFIRMATION_UNAVAILABLE']:[]),'NATIVE_TOTAL_UNAVAILABLE','PUBLIC_KENPOM_PERMISSION_UNVERIFIED','MARKETS_PAUSED'],
   contract:{id:pro.modelId,version:pro.modelVersion,sideQualified:false,totalQualified:false},canQualify:false,canAuthorizeWager:false});
 }
 return {version:1,season,generatedAt:asOf,expiresAt:new Date(Date.parse(captures.kenpom)+CBB_INPUT_TTL_MS).toISOString(),visibility:'PRIVATE_PERSONAL_ANALYSIS',sourceAttribution:['kenpom.com','Bart Torvik','CollegeBasketballData.com','ESPN'],
  captures,events:out,summary:{fixtures:out.length,primaryProjections:out.filter(x=>x.primary).length,torvikComparisons:out.filter(x=>x.comparison).length,currentCbbdConfirmations:out.filter(x=>x.confirmationAvailable).length,nativeTotals:0,qualified:0},canAuthorizeWager:false};
}
/** Strict allowlist: public readiness never carries licensed numerical outputs or input ratings. */
export function publicCbbReadiness(packet){
 return {version:1,date:packet.events[0]?.date||null,generatedAt:packet.generatedAt,expiresAt:packet.expiresAt,publicationMode:'READINESS_ONLY',
  states:{pipeline:'PRIVATE_ANALYSIS_BUILT',publicProjection:'BLOCKED',confirmation:'CURRENT_CBBD_INCOMPLETE',nativeTotal:'INSUFFICIENT_CURRENT_HISTORY',kenpomPublicDisplay:'WRITTEN_PERMISSION_UNVERIFIED'},
  canQualify:false,canAuthorizeWager:false};
}
