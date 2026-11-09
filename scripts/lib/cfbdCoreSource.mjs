// One admitted source read. No D1, score generation, market access or model promotion.
import {createHash} from 'node:crypto';
import {normalizeCoreRating} from '../../functions/lib/cfbdCanonical.js';
import {resolveTeamExact} from '../../functions/lib/teams.js';
const MAX_BYTES=3000000,MAX_ROWS=500;
const iso=value=>Number.isFinite(Date.parse(value));
export function normalizeCfbdCorePacket(rows,{year=2026,capturedAt,responseSha256}={}){
 if(!Number.isInteger(year)||year<2020||year>2030||!iso(capturedAt)||!Array.isArray(rows)||rows.length>MAX_ROWS||!/^[a-f0-9]{64}$/.test(responseSha256||''))throw Error('CFBD_CORE_INVALID_ENVELOPE');
 const accepted=[],rejected=[],seen=new Set();
 for(const raw of rows){
  const row=normalizeCoreRating(raw);
  // A query-scoped year is allowed only when the provider omits its year.
  if(row.season!=null&&row.season!==year){rejected.push({reason:'CONTRADICTORY_SEASON'});continue;}
  const identity=resolveTeamExact('cfb',{name:row.team});
  if(!identity){rejected.push({reason:'TEAM_IDENTITY_UNVERIFIED'});continue;}
  if(seen.has(identity.id))throw Error('CFBD_CORE_DUPLICATE_TEAM');
  seen.add(identity.id);
  if([row.rating,row.offense,row.defense,row.specialTeams].every(v=>v==null)){
   rejected.push({reason:'NO_NUMERIC_CORE_FIELDS'});continue;
  }
  const throughWeek=Number.isInteger(row.throughWeek)&&row.throughWeek>=1&&row.throughWeek<=20?row.throughWeek:null;
  accepted.push({canonicalId:identity.id,espnId:String(identity.espnId),team:row.team,
   season:year,seasonEvidence:row.season==null?'REQUEST_SCOPED':'PROVIDER_ROW',
   rating:row.rating,offense:row.offense,defense:row.defense,specialTeams:row.specialTeams,
   throughWeek,throughSeasonType:row.throughSeasonType,
   sourceCapturedAt:capturedAt,providerUpdatedAt:null,
   modelEligible:false,canInfluenceProduction:false,
   blockers:[...(!throughWeek?['THROUGH_WEEK_UNVERIFIED']:[]),
    ...(row.offense==null||row.defense==null?['CORE_COMPONENTS_UNAVAILABLE']:[]),
    'MATCHUP_PIT_AND_FITTED_ARTIFACT_NOT_EVALUATED']});
 }
 return {version:1,sport:'cfb',provider:'CFBD',endpoint:'/ratings/core',query:{year},
  visibility:'PRIVATE_SOURCE_EVIDENCE',capturedAt,providerUpdatedAt:null,responseSha256,
  state:rows.length===0?'EMPTY_NOT_ZERO':accepted.length?'SOURCE_CAPTURED':'NO_VERIFIED_ROWS',
  sourceRows:rows.length,acceptedRows:accepted.length,rejectedRows:rejected.length,
  rejectionCounts:Object.fromEntries([...new Set(rejected.map(x=>x.reason))].map(reason=>[reason,rejected.filter(x=>x.reason===reason).length])),
  rows:accepted,modelInfluence:'NONE_SOURCE_ONLY',canQualify:false,canAuthorizeWager:false};
}
export async function captureCfbdCore({key,fetchFn=fetch,now=()=>Date.now(),year=2026,reserve}={}){
 if(!key)throw Error('CFBD_EXISTING_KEY_MISSING');
 if(!Number.isInteger(year)||year<2020||year>2030)throw Error('CFBD_YEAR_INVALID');
 reserve?.('CFBD');
 const url='https://api.collegefootballdata.com/ratings/core?year='+year;
 const response=await fetchFn(url,{method:'GET',redirect:'manual',headers:{Accept:'application/json',Authorization:'Bearer '+key},signal:AbortSignal.timeout(16000)});
 if(response.status>=300&&response.status<400)throw Error('CFBD_REDIRECT_BLOCKED');
 if(!response.ok)throw Error('CFBD_HTTP_'+response.status);
 if(Number(response.headers?.get('content-length')||0)>MAX_BYTES)throw Error('CFBD_RESPONSE_TOO_LARGE');
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.byteLength>MAX_BYTES)throw Error('CFBD_RESPONSE_TOO_LARGE');
 let rows;try{rows=JSON.parse(bytes.toString('utf8'));}catch{throw Error('CFBD_JSON_INVALID');}
 const capturedAt=new Date(typeof now==='function'?now():now).toISOString();
 const packet=normalizeCfbdCorePacket(rows,{year,capturedAt,responseSha256:createHash('sha256').update(bytes).digest('hex')});
 const {rows:privateRows,...receipt}=packet;
 return {packet,receipt:{...receipt,httpStatus:response.status,requests:1,rawProviderDataPublished:false}};
}
