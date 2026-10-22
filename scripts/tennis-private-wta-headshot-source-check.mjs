#!/usr/bin/env node
// Phase2 WTA HEAD-only image-source checker. Official WTA source candidate URLs
// are obtained from FBIS, not fabricated from market or third-party feeds.
// NO GET image, storage writes of bytes, or public display.
const host='https://fbis-myz.pages.dev',token=process.env.HARVEST_SECRET||'';
if(token.length<24)throw new Error('HARVEST_SECRET_UNAVAILABLE');
const endpoint=host+'/api/tennis-private-portrait-headshot-check';
const guard={headers:{'x-harvest-secret':token},redirect:'error'};
const timeout=ms=>AbortSignal.timeout(ms);
let cursor='',pages=0,observed=0,verified=0,notVerified=0,rejected=0;
const visited=new Set();
for(let page=0;page<16;page++){
 const url=new URL(endpoint);url.searchParams.set('limit','40');if(cursor)url.searchParams.set('after',cursor);
 const res=await fetch(url,{...guard,signal:timeout(15000)});
 if(!res.ok)throw Error('HEADSHOT_MANIFEST_HTTP_'+res.status);
 const body=await res.json();
 if(!body.ok||body.cohortId!=='tennis-elo-private-20261019-1074'||!Array.isArray(body.items))
  throw Error('MANIFEST_CONTRACT_UNVERIFIED');
 const results=[];
 for(let i=0;i<body.items.length;i+=5){
  const batch=body.items.slice(i,i+5);
  const checks=await Promise.all(batch.map(async item=>{
   const correct=new RegExp('^https://wtafiles\\.blob\\.core\\.windows\\.net/images/headshots/[0-9]+\\.jpg$').test(item.candidateUrl);
   const expected='https://wtafiles.blob.core.windows.net/images/headshots/'+item.sourceId+'.jpg';
   if(!correct||item.candidateUrl!==expected||visited.has(item.playerKey))
    throw Error('IMAGE_PROBE_TARGET_OR_ID_UNVERIFIED');
   visited.add(item.playerKey);
   let status=0,type='';
   try{
    const probe=await fetch(item.candidateUrl,{
     method:'HEAD',redirect:'manual',headers:{accept:'image/jpeg'},signal:timeout(12000)});
    status=probe.status;type=probe.headers.get('content-type')||'';
   }catch{status=0;}
   return {playerKey:item.playerKey,sourceId:item.sourceId,candidateUrl:item.candidateUrl,
    httpStatus:status,contentType:type,observedAt:new Date().toISOString()};
  }));
  results.push(...checks);
 }
 if(results.length){
  const posted=await fetch(endpoint,{method:'POST',redirect:'error',
   headers:{'x-harvest-secret':token,'content-type':'application/json'},
   body:JSON.stringify({observations:results}),signal:timeout(30000)});
  const state=await posted.json();
  if(![200,207].includes(posted.status)||state.received!==results.length)
   throw Error('SOURCE_RECEIPT_UNVERIFIED_'+posted.status);
  observed+=results.length;verified+=Number(state.verified||0);
  notVerified+=Number(state.notVerified||0);rejected+=Number(state.rejected||0);
  if(state.rejected)throw Error('SOURCE_RECEIPTS_REJECTED_'+state.rejected);
 }
 pages++;
 if(!body.nextCursor)break;
 if(cursor && body.nextCursor<=cursor)throw Error('CURSOR_NOT_MONOTONE');
 cursor=body.nextCursor;
}
if(observed>515)throw Error('SOURCE_MANIFEST_OVER_TARGET');
console.log(JSON.stringify({cohortId:'tennis-elo-private-20261019-1074',
 pages,observed,verified,notVerified,rejected,
 imageBytesDownloaded:0,rightsActivated:false,canDisplayImages:false}));
if(observed<400)throw Error('OFFICIAL_WTA_SOURCE_COVERAGE_BELOW_EXPECTED');
