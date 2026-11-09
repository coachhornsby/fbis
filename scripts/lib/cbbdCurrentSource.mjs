import {createHash} from 'node:crypto';
import {mapSourceTeam} from '../../functions/lib/collegeIdentity.js';
const finite=v=>v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
export function normalizeCbbdCurrent(rows,{season=2027}={}){
 if(!Array.isArray(rows)||rows.length>500)throw Error('INVALID_CBBD_CURRENT_ROWS');
 const normalized=[],rejected=[];const seen=new Set();
 for(const row of rows){
  const identity=mapSourceTeam('cbb',{name:row.team||row.school},season);
  const adjOe=finite(row.offensiveRating??row.offense?.rating??row.adjOe);
  const adjDe=finite(row.defensiveRating??row.defense?.rating??row.adjDe);
  const tempo=finite(row.tempo??row.adjTempo);
  const valid=Number(row.season)===season&&identity.ok&&[adjOe,adjDe].every(v=>v!==null&&v>=70&&v<=140)&&tempo!==null&&tempo>=40&&tempo<=100&&!seen.has(identity.canonicalId);
  if(!valid){rejected.push({reason:'CURRENT_SEASON_IDENTITY_OR_FEATURES_UNVERIFIED'});continue;}
  seen.add(identity.canonicalId);normalized.push({canonicalId:identity.canonicalId,espnId:identity.espnId,season,adjOe,adjDe,tempo});
 }
 return {normalized,rejected};
}
export async function captureCbbdCurrentSource({key,season=2027,fetchFn=fetch,reserve,now=Date.now}={}){
 if(!key)throw Error('COLLEGE_SOURCE_KEY_MISSING');if(typeof reserve!=='function')throw Error('COLLEGE_BUDGET_REQUIRED');
 const url=`https://api.collegebasketballdata.com/ratings/adjusted?season=${season}`;
 reserve('CBBD');const response=await fetchFn(url,{redirect:'error',headers:{Accept:'application/json',Authorization:'Bearer '+key},signal:AbortSignal.timeout(16000)});
 if(!response.ok)throw Error('CBBD_HTTP_'+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>3000000)throw Error('CBBD_RESPONSE_TOO_LARGE');
 const raw=JSON.parse(bytes.toString('utf8')),observedAt=new Date(now()).toISOString();
 const {normalized,rejected}=normalizeCbbdCurrent(raw,{season});
 const state=raw.length===0?'CURRENT_RATINGS_NOT_PUBLISHED':normalized.length===raw.length?'CURRENT_INPUT_VERIFIED':'PARTIAL_INPUT_UNVERIFIED';
 const receipt={provider:'CBBD',endpoint:'/ratings/adjusted',season,observedAt,providerUpdatedAt:null,status:response.status,state,records:raw.length,usableRows:normalized.length,rejectedRows:rejected.length,sha256:createHash('sha256').update(bytes).digest('hex'),primaryModelInfluence:0,canAuthorizeWager:false};
 return {packet:{version:1,visibility:'PRIVATE_SOURCE_EVIDENCE',...receipt,expiresAt:new Date(Date.parse(observedAt)+6*3600000).toISOString(),rows:normalized,rawRecords:raw,canQualify:false},receipt};
}
