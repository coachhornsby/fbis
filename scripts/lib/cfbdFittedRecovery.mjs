// Frozen CFB A/A consumer: real per-game PPA only. No new coefficients or score fallbacks.
import {createHash} from 'node:crypto';
import {resolveTeamExact} from '../../functions/lib/teams.js';
import {projectCfbFbisV2Production} from '../../functions/lib/cfbFbisV2.js';
import FITTED from '../../data/models/cfb-fbis-v2-fitted-aa.js';
const number=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
export async function captureCfbdPpaGames({key,fetchFn=fetch,now=Date.now,year=2026,reserve}={}){
 if(!key||!Number.isInteger(year)||year<2020||year>2030)throw Error('CFBD_PPA_CONFIG_INVALID');
 reserve?.('CFBD');
 const res=await fetchFn(`https://api.collegefootballdata.com/ppa/games?year=${year}&seasonType=regular`,{redirect:'manual',headers:{Accept:'application/json',Authorization:'Bearer '+key},signal:AbortSignal.timeout(16000)});
 if(res.status>=300&&res.status<400)throw Error('CFBD_PPA_REDIRECT_BLOCKED');
 if(!res.ok)throw Error('CFBD_PPA_HTTP_'+res.status);
 if(Number(res.headers?.get('content-length'))>3000000)throw Error('CFBD_PPA_TOO_LARGE');
 const bytes=Buffer.from(await res.arrayBuffer());if(bytes.length>3000000)throw Error('CFBD_PPA_TOO_LARGE');
 const raw=JSON.parse(bytes.toString('utf8'));if(!Array.isArray(raw)||raw.length>4000)throw Error('CFBD_PPA_SHAPE_INVALID');
 const capturedAt=new Date(typeof now==='function'?now():now).toISOString();
 const rows=[];let rejected=0;
 for(const r of raw){
  const team=resolveTeamExact('cfb',{name:r.team||r.school});
  const rowYear=number(r.year??r.season),gameId=String(r.gameId??r.game_id??'');
  if(!team||!/^\d+$/.test(gameId)||(rowYear!=null&&rowYear!==year)){rejected++;continue;}
  rows.push({canonicalId:team.id,espnId:String(team.espnId),team:r.team||r.school,gameId,year,
   week:number(r.week),startDate:r.startDate||r.start_date||null,
   offensePpa:number(r.offense?.overall??r.offense?.ppa??r.offensePpa),
   defensePpa:number(r.defense?.overall??r.defense?.ppa??r.defensePpa)});
 }
 const packet={version:1,visibility:'PRIVATE_SOURCE_EVIDENCE',provider:'CFBD',endpoint:'/ppa/games',query:{year,seasonType:'regular'},capturedAt,responseSha256:createHash('sha256').update(bytes).digest('hex'),rows,sourceRows:raw.length,rejectedRows:rejected,canAuthorizeWager:false};
 return {packet,receipt:{provider:'CFBD',endpoint:packet.endpoint,year,capturedAt,responseSha256:packet.responseSha256,sourceRows:raw.length,acceptedRows:rows.length,rejectedRows:rejected,requests:1,modelInfluence:'PENDING_FROZEN_CONSUMER_GATES'}};
}
export function projectCfbdFittedRecovery(game,{ppaPacket,priorPacket,now=Date.now()}={}){
 const deny=reason=>({ok:false,reason,modelId:'CFB-FBIS-v2',canQualify:false,canAuthorizeWager:false});
 const start=Date.parse(game?.start),capture=Date.parse(ppaPacket?.capturedAt),year=Number(ppaPacket?.query?.year);
 if(game?.sport!=='cfb'||!Number.isFinite(start)||start<=now||typeof game.neutralSite!=='boolean'||!Number.isFinite(capture)||capture>now||capture>=start||now-capture>6*3600000||ppaPacket?.endpoint!=='/ppa/games')return deny('PPA_OR_FIXTURE_PROVENANCE_UNVERIFIED');
 if(priorPacket?.sourceSeason!==year-1||priorPacket?.frozen!==true||priorPacket?.featureContract!=='ppa-derived-base-v2'||!priorPacket?.rows)return deny('FROZEN_PRIOR_SEASON_INPUT_UNAVAILABLE');
 const sides={};
 for(const side of ['home','away']){
  const id='cfb-'+String(game[side]?.espnId||'');
  const prior=priorPacket.rows.find(r=>r.canonicalId===id);
  if(!prior||number(prior.priorOff)==null||number(prior.priorDef)==null||prior.sourceSeason!==year-1)return deny('FROZEN_TEAM_PRIOR_UNAVAILABLE');
  const rows=(ppaPacket.rows||[]).filter(r=>r.canonicalId===id&&r.year===year);
  if(rows.some(r=>!Number.isFinite(Date.parse(r.startDate))))return deny('PPA_GAME_KICKOFF_EVIDENCE_MISSING');
  if(rows.some(r=>r.completed!==true))return deny('PPA_GAME_COMPLETION_UNVERIFIED');
  const eligible=rows.filter(r=>Date.parse(r.startDate)<capture&&number(r.offensePpa)!=null&&number(r.defensePpa)!=null);
  if(eligible.length<3||new Set(eligible.map(r=>r.gameId)).size!==eligible.length)return deny('PPA_GAME_COVERAGE_UNVERIFIED');
  sides[side]={priorOff:prior.priorOff,priorDef:prior.priorDef,gamesPlayed:eligible.length,
   offensePpa:eligible.reduce((n,r)=>n+r.offensePpa,0)/eligible.length,
   defensePpa:eligible.reduce((n,r)=>n+r.defensePpa,0)/eligible.length,
   priorArtifactHash:prior.artifactHash||null,sourceGameIds:eligible.map(r=>r.gameId)};
 }
 const model=projectCfbFbisV2Production({...game,featureCutoffOk:true,cfbFbisV2Input:sides});
 if(!model.ok||!model.fittedApplied)return deny(model.reason||'FROZEN_MODEL_FAILED');
 return {ok:true,model,provenance:{modelId:'CFB-FBIS-v2',featureContract:FITTED.featureContract,coefficientsSha256:FITTED.sourceArtifacts.fittedCoefficientsFinalSha256,ppaCapturedAt:ppaPacket.capturedAt,ppaResponseSha256:ppaPacket.responseSha256,priorSourceSeason:priorPacket.sourceSeason,priorArtifactHashes:{home:sides.home.priorArtifactHash,away:sides.away.priorArtifactHash},priorSourceProvenance:priorPacket.provenance||null,completionEvidence:ppaPacket.scheduleProvenance||null,homeGameIds:sides.home.sourceGameIds,awayGameIds:sides.away.sourceGameIds},canQualify:false,canAuthorizeWager:false};
}
