// Offline-tested callable contract only: no route, schedule, credentials or job certification.
import {archiveKnownKeys} from './knownKeyArchive.mjs';
import {createDriveArchiveSink,DRIVE_LIMITS} from './driveArchiveSink.mjs';

export async function runBoundedArchive({env,plan,reservationId,drive,fetchImpl}){
 // The future approved host supplies one already-authorized short-lived bearer.
 // No refresh, hidden auth client, secret lookup, token persistence or retry here.
 // Any acquisition/refresh outside this module requires separate reviewed admission.
 if(typeof fetchImpl!=='function'||!env?.FBIS_ARCHIVE)throw Error('ARCHIVE_RUNTIME_BINDINGS_REQUIRED');
 if(typeof drive?.authorization!=='string'||!/^Bearer [A-Za-z0-9._~+\/-]+=*$/.test(drive.authorization))throw Error('ARCHIVE_AUTHORIZATION_REQUIRED');
 const sourcePlan=JSON.parse(JSON.stringify(plan));
 const item=sourcePlan?.objects?.[0];
 if(sourcePlan?.objects?.length!==1||!item||item.bytes>4096||item.format!=='json-document'||item.records!==0)throw Error('ARCHIVE_FIRST_RUN_SCOPE');
 // Snapshot configuration before any await; no plan/credential/folder mutation
 // can alter an already-admitted invocation.
 const categoryId=drive.categoryId,archiveFolderId=drive.archiveFolderId,authorization=drive.authorization;
 let sink;
 const result=await archiveKnownKeys({env,bucket:env.FBIS_ARCHIVE,plan:sourcePlan,reservationId,
  sinkFactory:lease=>{
   const limits=lease.snapshot().limits;
   if(limits.requests!==DRIVE_LIMITS.requests||limits.responseBytes!==DRIVE_LIMITS.totalBytes)lease.stop('ARCHIVE_EXACT_DRIVE_BUDGET_REQUIRED');
   sink=createDriveArchiveSink({categoryId,archiveFolderId,executionLease:lease,
    authenticatedFetch:(url,init)=>{
     // Exactly one underlying request. No authentication callback can issue
     // uncharged refresh/subrequests. Network destinations are adapter-generated.
     const headers=new Headers(init.headers);headers.set('Authorization',authorization);
     return fetchImpl(url,{...init,headers});
    }});
   return sink;
  }});
 return {...result,driveBudget:sink.snapshot()};
}
