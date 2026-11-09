// Bounded current-input integration proof, not a new recurring collection policy.
import{mkdir,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
import{boardDate,shiftBoardDate}from'../functions/lib/publicBoardSnapshot.js';
import{validatePrivatePacket}from'../src/lib/privateBoardProjection.js';
import{captureCfbdPpaGames}from'./lib/cfbdFittedRecovery.mjs';
import{captureCbbdNativeInputs,buildCurrentCbbNativeEvidence}from'./lib/cbbdNativeSource.mjs';
const key=process.env.CFBD_CBBD_KEY,account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const counts={CFBD:0,CBBD:0},caps={CFBD:1,CBBD:2};
const reserve=p=>{if(!Object.hasOwn(counts,p)||counts[p]>=caps[p])throw Error('COLLEGE_MODEL_INPUT_BUDGET_EXCEEDED');counts[p]++;};
const receipt={generatedAt:new Date().toISOString(),providerCalls:counts,maxSharedProviderCalls:3,sources:[],comparisons:[],errors:[],primaryModelInfluence:0,canAuthorizeWager:false};
const sha=x=>createHash('sha256').update(x).digest('hex');
const url=path=>'https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/r2/buckets/fbis-archive/objects/'+path.split('/').map(encodeURIComponent).join('/');
async function read(path){const r=await fetch(url(path),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(r.status===404)return null;if(!r.ok)throw Error('R2_GET_'+r.status);const s=await r.text();if(Buffer.byteLength(s)>18000000)throw Error('R2_OVERSIZE');return s;}
async function persist(path,packet){const body=JSON.stringify(packet);if(Buffer.byteLength(body)>18000000)throw Error('R2_PACKET_OVERSIZE');const r=await fetch(url(path),{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('R2_PUT_'+r.status);const again=await read(path);if(!again||sha(again)!==sha(body))throw Error('R2_HASH_MISMATCH');return{key:path,stored:true,sha256:sha(body)};}
try{
 if(!key||!account||!token)throw Error('EXISTING_CREDENTIALS_MISSING');
 try{const x=await captureCfbdPpaGames({key,reserve});receipt.sources.push({...x.receipt,storage:await persist('private/college-sources/cfbd/ppa-games/2026/latest.json',x.packet)});receipt.cfbdServing={state:'BLOCKED_VERIFIED_PRIOR_AND_COMPLETION_JOIN_REQUIRED',primaryModelInfluence:0,model:'CFB-FBIS-v2 frozen A/A'};}catch(e){receipt.errors.push({provider:'CFBD',reason:String(e.message||e).replaceAll(key,'[redacted]')});}
 try{
  const x=await captureCbbdNativeInputs({key,reserve});receipt.sources.push({...x.receipt,storage:await persist('private/college-sources/cbbd/current-boxes/2027/latest.json',x.packet)});
  const current=boardDate();
  for(const date of [current,shiftBoardDate(current,1)]){
   const raw=await read('private/cbb/projections/'+date+'.json');if(!raw){receipt.comparisons.push({date,state:'NO_VERIFIED_TARGET_FIXTURES'});continue;}
   const primary=validatePrivatePacket(JSON.parse(raw));if(Date.parse(primary.expiresAt)<=Date.now()||primary.events.some(e=>e.date!==date)){receipt.comparisons.push({date,state:'TARGET_FIXTURE_PACKET_EXPIRED_OR_MISMATCHED'});continue;}const fixtures=primary.events||[];
   const proof=buildCurrentCbbNativeEvidence({games:x.packet.games,boxes:x.packet.boxes,fixtures,asOf:x.packet.generatedAt});
   const storage=await persist('private/cbb/native-comparison/'+date+'.json',proof);
   receipt.comparisons.push({date,storage,completedGames:proof.completedGames,pairedD1Games:proof.pairedD1Games,modelTeams:proof.modelTeams,projectionCount:proof.projections.length,missing:proof.unavailable.length,comparisonModelInfluence:proof.comparisonModelInfluence,lowSampleCount:proof.projections.filter(p=>p.lowSample).length,samples:proof.projections.slice(0,3),primaryModelInfluence:0});
  }
 }catch(e){receipt.errors.push({provider:'CBBD',reason:String(e.message||e).replaceAll(key,'[redacted]')});}
}catch(e){receipt.errors.push({reason:String(e.message||e)});}
await mkdir('artifacts/college-model-inputs',{recursive:true});await writeFile('artifacts/college-model-inputs/receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));if(receipt.errors.length)process.exitCode=1;
