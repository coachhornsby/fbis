#!/usr/bin/env node
// Read only official ATP rankings HTML and preserve official player-link IDs.
// Records identity and candidate headshot URLs; NO image GET/download/authorization.
import {createHash} from 'node:crypto';
const origin='https://www.atptour.com',app='https://fbis-myz.pages.dev';
const token=process.env.HARVEST_SECRET||'',apify=process.env.APIFY_TOKEN||'';
if(token.length<24)throw Error('HARVEST_SECRET_MISSING');
const api=app+'/api/tennis-private-portrait-atp-source';
const auth={'x-harvest-secret':token};
const timeout=ms=>AbortSignal.timeout(ms);
async function rawHtml(url){
 const direct=await fetch(url,{headers:{accept:'text/html','user-agent':'FBIS-private-tennis-source-audit/1.0'},signal:timeout(18000)}).catch(()=>null);
 if(direct?.ok){const raw=await direct.text();if(raw.length>350000&&raw.length<3000000)return raw;}
 if(!apify)throw Error('ATP_OFFICIAL_SOURCE_UNAVAILABLE_NO_RELAY');
 const endpoint='https://api.apify.com/v2/acts/apify~web-fetch/run-sync-get-dataset-items?format=json&timeout=90';
 const relay=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+apify,'content-type':'application/json'},
   body:JSON.stringify({url,formats:['raw']}),signal:timeout(110000)});
 if(!relay.ok)throw Error('ATP_WEB_FETCH_HTTP_'+relay.status);
 const j=await relay.json(),item=j?.[0];
 if(!Array.isArray(j)||j.length!==1||item?.fetch?.httpStatusCode!==200||
  item?.fetch?.loadedUrl!==url||typeof item?.raw!=='string'||item.raw.length<350000||
  item.raw.length>3000000)throw Error('ATP_OFFICIAL_RAW_SOURCE_EVIDENCE_INVALID');
 return item.raw;
}
const response=await fetch(api,{headers:auth,signal:timeout(15000)});
if(!response.ok)throw Error('ATP_MANIFEST_HTTP_'+response.status);
const manifest=await response.json();
if(!manifest.ok||manifest.cohortId!=='tennis-elo-private-20261019-1074'||manifest.players?.length!==559)
 throw Error('ATP_COHORT_CONTRACT_UNVERIFIED');
const target=new Map(manifest.players.map(p=>[p.key,p]));
const ranges=['0-100','101-200','201-300','301-400','401-500','501-600',
 '601-700','701-800','801-900','901-1000','1001-1100','1101-1200',
 '1201-1300','1301-1400','1401-1500'];
const found=new Map(),idUse=new Set();let pages=0,sourceLinks=0;
for(const rankingRange of ranges){
 const url=origin+'/en/rankings/singles?rankRange='+rankingRange;
 const html=await rawHtml(url);
 if(!/ATP Rankings|PIF ATP Rankings/i.test(html))throw Error('ATP_RANKINGS_PAGE_MISMATCH');
 const sha=createHash('sha256').update(html).digest('hex');
 const links=[...html.matchAll(/href="(\/en\/players\/([a-z0-9-]{3,90})\/([a-z0-9]{3,6})\/overview)"/gi)];
 const unique=new Map(links.map(x=>[x[3].toLowerCase(),{slug:x[2].toLowerCase(),atpId:x[3].toLowerCase(),href:x[1]}]));
 if(unique.size<15)throw Error('ATP_RANKINGS_PAGE_INSUFFICIENT_'+rankingRange);
 sourceLinks+=unique.size;pages++;
 for(const player of unique.values()){
  const key=player.slug.replaceAll('-',' ');
  if(!target.has(key))continue;
  if(found.has(key)&&found.get(key).atpId!==player.atpId)throw Error('ATP_CONFLICTING_OFFICIAL_PLAYER_ID');
  if(idUse.has(player.atpId)&&!found.has(key))throw Error('ATP_DUPLICATE_PLAYER_ID');
  idUse.add(player.atpId);
  found.set(key,{playerKey:key,playerName:target.get(key).key,slug:player.slug,
    atpId:player.atpId,profileUrl:origin+player.href,rankingRange,sourceSha256:sha});
 }
}
let linked=0,rejected=0;
const all=[...found.values()];
for(let i=0;i<all.length;i+=60){
 const rows=all.slice(i,i+60);
 const r=await fetch(api,{method:'POST',headers:{...auth,'content-type':'application/json'},
  body:JSON.stringify({rows}),signal:timeout(45000)});
 const j=await r.json();
 if(![200,207].includes(r.status)||j.received!==rows.length)throw Error('ATP_ID_RECEIPT_UNVERIFIED_'+r.status);
 linked+=Number(j.linked||0);rejected+=Number(j.rejected||0);
 if(j.rejected>0)throw Error('ATP_ID_SOURCE_CONFLICTS_'+j.rejected);
}
console.log(JSON.stringify({source:'ATP_OFFICIAL',cohort:559,pages,rankingLinks:sourceLinks,
 matched:found.size,ingested:linked,rejected,remainingWithoutRankingLinks:559-found.size,
 officialHeadshotsVerified:0,photoBytesDownloaded:0,canAuthorizeWager:false}));
if(found.size<200)throw Error('ATP_OFFICIAL_SOURCE_COVERAGE_TOO_LOW');
