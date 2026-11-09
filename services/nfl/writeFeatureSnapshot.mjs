// Inactive internal writer. No route, credentials, scheduler or policy activation.
import {requireJobAdmission} from '../account-budget/admission.mjs';
import {createExecutionLease,executionR2} from '../account-budget/execution.mjs';
import {NFL_SNAPSHOT_WRITE_JOB as JOB,CERTIFIED_EXECUTION_JOBS} from '../account-budget/executionJobs.mjs';
import {NFL_FEATURE_KEY} from './inspectFeatureSnapshot.mjs';
import {validateNflFeatureSnapshot} from '../../functions/lib/nflVerseFeed.js';
export const NFL_WRITE_ID='fbis-nfl-feature-write-v1';
const teams='ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');
const fields=['offenseEpa','defenseEpa','passEpa','rushEpa','qbEpa','qbCpoe','successRate','earlyDownEpa','explosiveRate'];
function stamp(value,season,now){value=typeof value==='string'?value.replace(/(\.\d{3})\d+(?=Z|[+-])/,'$1'):value;const result=validateNflFeatureSnapshot({season,byTeam:{},playersByTeam:{},meta:{builtAt:value}},season,now);return result.ok?result.builtAt:null;}
export async function validateNflWriteInput({snapshotText,receipt,season,now=Date.now()}){
 if(typeof snapshotText!=='string'||!Number.isInteger(season)||!Number.isFinite(now))throw Error('NFL_WRITE_INPUT_INVALID');
 const bytes=new TextEncoder().encode(snapshotText);if(bytes.length<2||bytes.length>8388608)throw Error('NFL_WRITE_SIZE_INVALID');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(receipt?.source!=='nflverse'||receipt.snapshotSha256!==hash||receipt.season!==season||receipt.sport!=='nfl')throw Error('NFL_WRITE_RECEIPT_MISMATCH');
 // A checked flag is NOT evidence. Gateway must obtain an independent reviewer
 // receipt, including concrete completed-game IDs for BOTH sides of each game.
 if(!Array.isArray(receipt.completedGameIds)||!receipt.completedGameIds.length||receipt.completedGameIds.length>300||new Set(receipt.completedGameIds).size!==receipt.completedGameIds.length||receipt.completedGameIds.some(id=>typeof id!=='string'||!/^20\d\d_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(id)||!id.startsWith(`${season}_`)))throw Error('NFL_WRITE_GAME_COVERAGE_MISSING');
 const observed=stamp(receipt.observedAt,season,now);
 if(observed===null)throw Error('NFL_WRITE_SOURCE_STALE');
 const root='https://github.com/nflverse/nflverse-data/releases/download';
 const requiredUrls=[...['stats_team','stats_player'].flatMap(type=>[season,season-1].map(y=>`${root}/${type}/${type}_week_${y}.csv`)),...[season,season-1].map(y=>`${root}/snap_counts/snap_counts_${y}.csv`),...['passing','rushing','receiving'].map(type=>`${root}/nextgen_stats/ngs_${type}.csv.gz`),`${root}/pbp/play_by_play_${season}.csv.gz`];
 const sources=receipt.sourceObservations;
 if(!Array.isArray(sources)||sources.length!==requiredUrls.length||new Set(sources.map(x=>x?.url)).size!==requiredUrls.length||requiredUrls.some(url=>!sources.some(x=>x?.url===url)))throw Error('NFL_WRITE_SOURCE_OBSERVATIONS_MISSING');
 for(const source of sources){const at=stamp(source.observedAt,season,now),modified=Date.parse(source.lastModified);if(source.status!==200||at===null||at>observed||!Number.isFinite(modified)||modified>at)throw Error('NFL_WRITE_SOURCE_OBSERVATION_INVALID');}

 const payload=JSON.parse(snapshotText),valid=validateNflFeatureSnapshot(payload,season,now);
 if(typeof payload.meta?.builtAt!=='string'||!valid.ok||valid.builtAt>observed)throw Error('NFL_WRITE_SNAPSHOT_INVALID');
 const through=Date.parse(receipt.dataThrough);
 const throughValid=validateNflFeatureSnapshot({season,byTeam:{},playersByTeam:{},meta:{builtAt:receipt.dataThrough}},season,now);
 if(!(throughValid.ok||throughValid.reason==='snapshot-expired')||!Number.isFinite(through)||through>observed||through>valid.builtAt)throw Error('NFL_WRITE_DATA_THROUGH_INVALID');
 if(!Number.isInteger(receipt.completedWeek)||receipt.completedWeek<1||receipt.completedWeek>22)throw Error('NFL_WRITE_COMPLETED_WEEK_INVALID');
 if(Object.keys(payload.byTeam).length!==32||teams.some(t=>!payload.byTeam[t]||!Array.isArray(payload.playersByTeam[t])||!payload.playersByTeam[t].length||fields.some(f=>typeof payload.byTeam[t][f]!=='number'||!Number.isFinite(payload.byTeam[t][f]))))throw Error('NFL_WRITE_TEAM_COVERAGE_INVALID');
 if(receipt.expectedEtag!==null&&(typeof receipt.expectedEtag!=='string'||!receipt.expectedEtag||receipt.expectedEtag.length>128))throw Error('NFL_WRITE_PREDECESSOR_REQUIRED');
 const publicationText=JSON.stringify({schema:'nfl-feature-publication-v1',snapshotText,receipt});
 const publicationBytes=new TextEncoder().encode(publicationText);if(publicationBytes.length>8388608)throw Error('NFL_WRITE_ENVELOPE_TOO_LARGE');
 const storedSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',publicationBytes)),x=>x.toString(16).padStart(2,'0')).join('');
 return {bytes,hash,payload,observed,through,publicationBytes,storedSha256};
}
export async function writeNflFeatureSnapshot(env,input){
 // Validate all local evidence before spending or touching storage.
 const now=Date.now(),date=new Date(now),currentSeason=date.getUTCMonth()>=7?date.getUTCFullYear():date.getUTCFullYear()-1;
 if(input?.season!==currentSeason)throw Error('NFL_WRITE_CURRENT_SEASON_REQUIRED');
 const checked=await validateNflWriteInput({...input,now});
 if(!env?.R2_ARCHIVE?.head||!env?.R2_ARCHIVE?.put)throw Error('NFL_WRITE_BINDING_REQUIRED');
 const grant=await requireJobAdmission(env,JOB,NFL_WRITE_ID),caps=CERTIFIED_EXECUTION_JOBS[JOB].units;
 if(grant.id!==NFL_WRITE_ID||grant.job!==JOB||Object.keys(grant.maxUnits||{}).length!==Object.keys(caps).length||Object.entries(caps).some(([k,v])=>grant.maxUnits[k]!==v))throw Error('NFL_WRITE_ADMISSION_INVALID');
 const lease=createExecutionLease(grant);lease.spend({snapshotWriteAttempts:1,coordinatorCalls:1,coordinatorStorageGets:2,coordinatorStoragePuts:2});
 const store=executionR2(env.R2_ARCHIVE,lease),head=await store.head(NFL_FEATURE_KEY);lease.live();
 const expected=input.receipt.expectedEtag;
 if((head?.etag??null)!==expected)lease.stop('NFL_WRITE_PREDECESSOR_CHANGED');
 if(head&&(!head.customMetadata?.builtAt||!Number.isFinite(Date.parse(head.customMetadata.builtAt))||Date.parse(head.customMetadata.builtAt)>=Date.parse(checked.payload.meta.builtAt)))lease.stop('NFL_WRITE_PREDECESSOR_TIME_UNKNOWN_OR_NEWER');
 const receipt=input.receipt;
 const result=await store.put(NFL_FEATURE_KEY,checked.publicationBytes,{onlyIf:expected===null?{etagDoesNotMatch:'*'}:{etagMatches:expected},httpMetadata:{contentType:'application/json'},customMetadata:{publicationSchema:'nfl-feature-publication-v1',storedSha256:checked.storedSha256,snapshotSha256:checked.hash,builtAt:checked.payload.meta.builtAt,source:'nflverse',observedAt:receipt.observedAt,dataThrough:receipt.dataThrough,completedWeek:String(receipt.completedWeek),season:String(input.season)}});
 lease.live();if(!result)lease.stop('NFL_WRITE_CONDITIONAL_CONFLICT');
 // No post-write read and no retry: uncertain outcomes need a separately admitted inspection.
 return {key:NFL_FEATURE_KEY,snapshotSha256:checked.hash,storedSha256:checked.storedSha256,etag:result.etag,bytes:checked.publicationBytes.length,budget:lease.snapshot(),modelPromoted:false,canAuthorizeWager:false};
}
