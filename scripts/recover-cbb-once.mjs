#!/usr/bin/env node
/**
 * One controlled CBB refresh on the existing GitHub runner. Zero D1 access.
 * Current ESPN fixtures, one licensed KenPom call, optional Torvik CSV.
 * A shared daily R2 budget gate prevents duplicate GitHub/manual attempts.
 * This action never schedules another run, publishes odds, or authorizes bets.
 */
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {boardDate} from '../functions/lib/publicBoardSnapshot.js';
import {buildFreshCbbResearch} from '../functions/lib/cbbPrivateOperatorRefresh.js';
import {validatePrivatePacket} from '../src/lib/privateBoardProjection.js';

const date=boardDate(),startedAt=new Date().toISOString();
const receipt={date,startedAt,state:'NOT_STARTED',method:'GITHUB_SINGLE_RUN',
 noD1:true,providerBudget:{espnMax:2,kenpomMax:1,torvikMax:1,cbbdMax:0},
 canQualify:false,canAuthorizeWager:false,rawProviderDataPublished:false,
 privateR2Object:null,sourceReceipts:[],error:null};
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const kenpomKey=String(process.env.KENPOM_API_KEY||'').trim();
const base=account?'https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/r2/buckets/fbis-archive/objects/':null;
const sha=s=>createHash('sha256').update(s).digest('hex');
const urlFor=key=>base+key.split('/').map(encodeURIComponent).join('/');
async function remoteGet(key){
 const res=await fetch(urlFor(key),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 if(res.status===404)return null;
 if(!res.ok)throw Error('R2_GET_FAILED_'+res.status);
 const body=await res.text();
 if(Buffer.byteLength(body)>1024*1024)throw Error('R2_OBJECT_TOO_LARGE');
 return body;
}
async function remotePut(key,body,{onlyIfAbsent=false}={}){
 if(Buffer.byteLength(body)>1024*1024)throw Error('R2_PACKET_TOO_LARGE');
 const res=await fetch(urlFor(key),{method:'PUT',headers:{
   Authorization:'Bearer '+token,'Content-Type':'application/octet-stream',
   ...(onlyIfAbsent?{'If-None-Match':'*'}:{})
 },body,signal:AbortSignal.timeout(30000)});
 if(res.status===412&&onlyIfAbsent)return false;
 if(!res.ok)throw Error('R2_PUT_FAILED_'+res.status);
 return true;
}
async function main(){
 if(!account||!token){receipt.state='BLOCKED_R2_CREDENTIALS';return;}
 if(!kenpomKey){receipt.state='BLOCKED_EXISTING_KENPOM_SECRET_NOT_CONNECTED_TO_GITHUB';return;}
 const packetKey='private/cbb/projections/'+date+'.json';
 const existing=await remoteGet(packetKey);
 if(existing){
  let parsed=null;try{parsed=validatePrivatePacket(JSON.parse(existing));}catch{}
  if(parsed&&parsed.events?.every(e=>e.date===date)&&Date.parse(parsed.expiresAt)>Date.now()+15*60*1000){
   receipt.state='ALREADY_FRESH';receipt.privateR2Object=packetKey;receipt.expiresAt=parsed.expiresAt;return;
  }
 }
 // Shared claim scheme with the site's manual button, with an R2 precondition.
 // An existing manual claim means zero duplicate provider requests from GitHub.
 const gatePrefix='private/cbb/refresh-budget/'+date+'/';
 for(const slot of [1,2])if(await remoteGet(gatePrefix+'attempt-'+slot+'.json')){
  receipt.state='BLOCKED_EXISTING_MANUAL_REFRESH_ATTEMPT';return;
 }
 const lockKey=gatePrefix+'attempt-1.json';
 const claimed=await remotePut(lockKey,JSON.stringify({date,slot:1,startedAt,status:'ATTEMPT_RESERVED',source:'github-single-run'}),{onlyIfAbsent:true});
 if(!claimed){receipt.state='BLOCKED_CONCURRENT_REFRESH';return;}
 receipt.state='RUNNING_AUTHORIZED_SOURCES';
 const {packet,evidence}=await buildFreshCbbResearch(date,{key:kenpomKey});
 validatePrivatePacket(packet);
 if(packet.summary.primaryProjections<1||packet.events.some(e=>e.date!==date))throw Error('NO_PREGAME_PRIVATE_PROJECTIONS');
 const body=JSON.stringify(packet);
 await remotePut(packetKey,body);
 const readback=await remoteGet(packetKey);
 if(!readback||sha(readback)!==sha(body))throw Error('PRIVATE_R2_SHA256_MISMATCH');
 const receiptKey='private/cbb/refresh-receipts/'+date+'.json';
 await remotePut(receiptKey,JSON.stringify({...evidence,status:'SUCCESS',source:'github-single-run',sha256:sha(body)}));
 receipt.state='VERIFIED_PRIVATE_R2_PUBLISHED';
 receipt.privateR2Object=packetKey;receipt.packetSha256=sha(body);
 receipt.primaryProjections=packet.summary.primaryProjections;
 receipt.torvikComparisons=packet.summary.torvikComparisons;
 receipt.cbddConfirmations=packet.summary.currentCbbdConfirmations;
 receipt.expiresAt=packet.expiresAt;
 receipt.sourceReceipts=evidence.sources;
}
try{await main();}catch(error){
 receipt.state='BLOCKED_OR_FAILED';
 receipt.error=String(error?.message||error).slice(0,170);
}
receipt.finishedAt=new Date().toISOString();
await mkdir('artifacts/cbb-single-run',{recursive:true});
await writeFile('artifacts/cbb-single-run/receipt.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({date:receipt.date,state:receipt.state,primaryProjections:receipt.primaryProjections||0,
 torvikComparisons:receipt.torvikComparisons||0,cbddConfirmations:receipt.cbddConfirmations||0,
 privateObject:receipt.privateR2Object,sourceCounts:receipt.sourceReceipts.map(s=>({provider:s.provider,status:s.status,rows:s.rows??s.matched??null})),
 error:receipt.error}));
if(receipt.state!=='VERIFIED_PRIVATE_R2_PUBLISHED'&&receipt.state!=='ALREADY_FRESH')process.exitCode=1;
