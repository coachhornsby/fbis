// Fixed private archive read, disabled and uncertified until separately approved.
import {requireJobAdmission} from '../account-budget/admission.mjs';
import {createExecutionLease,executionR2} from '../account-budget/execution.mjs';
import {ROOT} from './once.mjs';
import {buildStaticPacket} from './staticPacket.mjs';
export const LOAD_JOB='services/pinnodds-restart/loadArchive.mjs';
export const LOAD_ID='pinnodds-restart-load-v1';
export const LOAD_CAPS=Object.freeze({requests:0,responseBytes:0,r2Reads:2,r2Writes:0,r2Bytes:2113536,r2Lists:0,d1Queries:0,reads:0,writes:0});
export async function loadTrustedArchive(env,{fixtures,now=Date.now(),admit=requireJobAdmission}={}){
 if(env?.PINNODDS_ARCHIVE_READ_ENABLED!=='true')throw Error('PINNODDS_ARCHIVE_READ_DISABLED');
 if(!env.R2_ARCHIVE?.get)throw Error('PINNODDS_ARCHIVE_BINDING_REQUIRED');
 const grant=await admit(env,LOAD_JOB,LOAD_ID);
 if(grant.id!==LOAD_ID||grant.job!==LOAD_JOB||Object.keys(grant.maxUnits||{}).length!==Object.keys(LOAD_CAPS).length||Object.entries(LOAD_CAPS).some(([k,v])=>grant.maxUnits[k]!==v))throw Error('PINNODDS_ARCHIVE_ADMISSION_MISMATCH');
 const lease=createExecutionLease(grant),archive=executionR2(env.R2_ARCHIVE,lease);
 async function read(key,max){const object=await archive.get(key);lease.live();if(!object||!Number.isSafeInteger(object.size)||object.size>max||!object.body){await object?.body?.cancel().catch(()=>{});throw Error('PINNODDS_ARCHIVE_OBJECT_INVALID');}const raw=await object.text();lease.live();if(new TextEncoder().encode(raw).length!==object.size)throw Error('PINNODDS_ARCHIVE_SIZE_MISMATCH');return raw;}
 const receipt=JSON.parse(await read(ROOT+'/receipt.json',16384));
 // No user-controlled archive keys, prefix listing, fallbacks or network fetch.
 if(!/^[a-f0-9]{64}$/.test(receipt.rawHash||'')||receipt.rawKey!==ROOT+'/raw-'+receipt.rawHash+'.json')throw Error('PINNODDS_ARCHIVE_RAW_KEY_REJECTED');
 const raw=await read(receipt.rawKey,2097152);
 const packet=await buildStaticPacket({raw,receipt,fixtures,now});lease.live();
 return {packet,budget:lease.snapshot()};
}
