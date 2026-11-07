// Inactive host contract: no deployment, route, policy, credential setup or recovery unlock.
import {serializeArchive} from './archiveSerialization.mjs';
import {runBoundedArchive} from './unifiedArchiveCaller.mjs';
import {DRIVE_ROOT} from './driveArchiveSink.mjs';
const canonical=value=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export async function runSerializedArchive({storage,...options}){
 // Never persist tokens, raw source records, or arbitrary error messages.
 const plan=JSON.parse(JSON.stringify(options.plan));
 const drive={categoryId:options.drive?.categoryId,archiveFolderId:options.drive?.archiveFolderId,authorization:options.drive?.authorization};
 const intent={plan,destination:{rootId:DRIVE_ROOT,categoryId:drive.categoryId,archiveFolderId:drive.archiveFolderId}};
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(intent))));
 const intentSha256=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 return serializeArchive(storage,{operationId:options.reservationId,intentSha256},()=>runBoundedArchive({...options,plan,drive}));
}
