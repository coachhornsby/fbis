// Ephemeral same-job input reuse. Never upload this licensed input as an artifact.
import {readFile,writeFile} from 'node:fs/promises';
import {CBB_INPUT_TTL_MS} from '../../functions/lib/cbbProjectionPacket.js';
export function validateCbbRecoveryInput(value,{now=Date.now(),season=2027}={}){
 const captured=Date.parse(value?.capturedAt);
 if(value?.version!==1||value.season!==season||!Number.isFinite(captured)||captured>now||now-captured>=CBB_INPUT_TTL_MS||
  !Array.isArray(value.rows)||value.rows.length<300||value.rows.length>500||
  value.rows.some(row=>Number(row.Season??row.season)!==season))throw Error('INVALID_CBB_REUSED_INPUT');
 return value;
}
export async function obtainCbbRecoveryInput({inputPath,outputPath,fetchRatings,now=Date.now(),season=2027}){
 // An explicitly supplied input must validate; never fall through to another paid call.
 if(inputPath){
  const raw=await readFile(inputPath,'utf8');if(Buffer.byteLength(raw)>3000000)throw Error('CBB_INPUT_TOO_LARGE');
  return validateCbbRecoveryInput(JSON.parse(raw),{now,season});
 }
 const rows=await fetchRatings();
 const value=validateCbbRecoveryInput({version:1,season,capturedAt:new Date().toISOString(),rows},{now:Date.now(),season});
 if(outputPath)await writeFile(outputPath,JSON.stringify(value),{mode:0o600});
 return value;
}
