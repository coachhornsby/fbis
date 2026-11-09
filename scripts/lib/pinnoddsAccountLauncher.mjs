import {open,realpath,stat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {PINNODDS_ACCOUNT_ATTEMPT} from '../../services/pinnodds-restart/accountContract.mjs';
// Approved operators MUST use the same persistent, private directory for this
// fixed operation. This bounds this launcher, not arbitrary direct HTTP callers.
// Never use ephemeral CI directories or change/delete its marker to retry.
export async function launchPinnoddsAccountOnce({attemptDirectory,invoke,now=()=>new Date()}={}){
 if(typeof attemptDirectory!=='string'||!isAbsolute(attemptDirectory)||typeof invoke!=='function')throw Error('PINNODDS_ACCOUNT_LAUNCH_CONFIG_REQUIRED');
 const directory=await realpath(attemptDirectory),info=await stat(directory);
 if(!info.isDirectory()||(info.mode&0o022)!==0)throw Error('PINNODDS_ACCOUNT_PRIVATE_DIRECTORY_REQUIRED');
 const marker=await open(join(directory,PINNODDS_ACCOUNT_ATTEMPT+'.attempt.json'),'wx',0o600);
 try{await marker.writeFile(JSON.stringify({operation:PINNODDS_ACCOUNT_ATTEMPT,status:'reserved-before-invocation',attemptedAt:now().toISOString()})+'\n');await marker.sync();}
 finally{await marker.close();}
 const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}
 // No credentials are read here. Existing approved transport owns authentication.
 // Marker survives every error, timeout and uncertain result. Never retry here.
 return await invoke();
}
