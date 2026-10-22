#!/usr/bin/env node
// Only HEAD official ATP-player-id-based image URLs. Never GET/store/serve restricted image bytes.
const base='https://fbis-myz.pages.dev',token=process.env.HARVEST_SECRET||'';
if(token.length<24)throw Error('HARVEST_SECRET_MISSING');
const endpoint=base+'/api/tennis-private-portrait-headshot-check';
const timeout=ms=>AbortSignal.timeout(ms);
const headers={'x-harvest-secret':token};
let cursor='',pages=0,observed=0,verified=0,notVerified=0,rejected=0;
const seen=new Set();
for(let p=0;p<16;p++){
 const uri=new URL(endpoint);uri.searchParams.set('tour','atp');uri.searchParams.set('limit','40');
 if(cursor)uri.searchParams.set('after',cursor);
 const res=await fetch(uri,{headers,signal:timeout(15000)});
 if(!res.ok)throw Error('ATP_HEADSHOT_MANIFEST_HTTP_'+res.status);
 const j=await res.json();
 if(!j.ok||j.tour!=='atp'||j.cohortId!=='tennis-elo-private-20261019-1074')throw Error('ATP_SOURCE_MANIFEST_INVALID');
 const items=j.items||[],results=[];
 for(let i=0;i<items.length;i+=5){
  results.push(...await Promise.all(items.slice(i,i+5).map(async row=>{
   const url='https://www.atptour.com/-/media/alias/player-headshot/'+String(row.sourceId||'').toLowerCase();
   if(row.candidateUrl!==url||!/^https:\/\/www\.atptour\.com\/-\/media\/alias\/player-headshot\/[a-z0-9]{3,6}$/.test(url)
      ||seen.has(row.playerKey))throw Error('ATP_IMAGE_TARGET_INVALID');
   seen.add(row.playerKey);
   let status=0,type='';
   try{const r=await fetch(url,{method:'HEAD',redirect:'manual',headers:{accept:'image/*'},signal:timeout(12000)});
    status=r.status;type=r.headers.get('content-type')||'';
   }catch{status=0;}
   return {tour:'atp',playerKey:row.playerKey,sourceId:row.sourceId,candidateUrl:url,
     httpStatus:status,contentType:type,observedAt:new Date().toISOString()};
  })));
 }
 if(results.length){
  const r=await fetch(endpoint,{method:'POST',headers:{...headers,'content-type':'application/json'},
    body:JSON.stringify({observations:results}),signal:timeout(30000)});
  const b=await r.json();
  if(![200,207].includes(r.status)||b.received!==results.length||Number(b.rejected||0)>0)
    throw Error('ATP_HEADSHOT_RECEIPTS_NOT_ACCEPTED');
  observed+=results.length;verified+=Number(b.verified||0);
  notVerified+=Number(b.notVerified||0);rejected+=Number(b.rejected||0);
 }
 pages++;
 if(!j.nextCursor)break;
 if(cursor&&j.nextCursor<=cursor)throw Error('ATP_CURSOR_INVALID');
 cursor=j.nextCursor;
}
console.log(JSON.stringify({tour:'atp',pages,observed,verified,notVerified,rejected,
  imageBytesDownloaded:0,privateUseActivated:false,publicDisplayAllowed:false}));
if(observed<100)throw Error('ATP_HEADSHOT_CANDIDATE_VOLUME_TOO_LOW');
