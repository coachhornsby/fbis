import {retiredOddsCollectorResponse} from "../lib/activeOddsPolicy.js";
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {FREE_PROP_MIRROR_URL,FREE_PROP_MIRROR_SOURCE,normalizeMirrorProps} from '../lib/freePrizePicksMirror.js';
import {persistNormalizedMarketBatch} from '../lib/marketObservationLedger.js';
const PAGE_SIZE=150;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
async function digest(value){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
const path=id=>`market-sources/free-prizepicks/${id}`;
async function snapshot(env,id){
 if(!/^[a-f0-9]{64}$/.test(id||''))throw Error('INVALID_SNAPSHOT_ID');
 const [document,receipt]=await Promise.all([env.ARCHIVE.get(path(id)+'.json'),env.ARCHIVE.get(path(id)+'-receipt.json')]);
 if(!document||!receipt)throw Error('SNAPSHOT_NOT_FOUND');
 return{feed:await document.json(),receipt:await receipt.json()};
}
export async function captureFreeMirror(env,{fetchImpl=fetch,now=new Date()}={}){
 if(!env.ARCHIVE?.put||!env.DB?.prepare)throw Error('DURABLE_STORAGE_REQUIRED');
 const response=await fetchImpl(FREE_PROP_MIRROR_URL,{signal:AbortSignal.timeout(20000),headers:{accept:'application/json'}});
 if(!response.ok)throw Error('MIRROR_HTTP_'+response.status);
 const raw=await response.text(),feed=JSON.parse(raw),id=await digest(raw);
 const validated=normalizeMirrorProps(feed,{snapshotId:id,now});
 const previous=await env.ARCHIVE.get(path(id)+'-receipt.json');
 let receipt=previous?await previous.json():null;
 if(!receipt){
  receipt={snapshotId:id,collectedAt:now.toISOString(),publishedAt:feed.scrapedAt,
   sourceUrl:FREE_PROP_MIRROR_URL,etag:response.headers.get('etag'),rows:feed.props.length,
   pageSize:PAGE_SIZE,pages:Math.ceil(feed.props.length/PAGE_SIZE),sourceSports:validated.sourceSports};
  await env.ARCHIVE.put(path(id)+'.json',raw,{httpMetadata:{contentType:'application/json'}});
  await env.ARCHIVE.put(path(id)+'-receipt.json',JSON.stringify(receipt),{httpMetadata:{contentType:'application/json'}});
 }
 return{ok:true,...receipt,researchOnly:true,canQualify:false,canAuthorizeWager:false};
}
export async function consumeFreeMirror(env,{snapshotId,batchIndex,now=new Date()}={}){
 if(!Number.isInteger(batchIndex)||batchIndex<0)throw Error('INVALID_BATCH_INDEX');
 const {feed,receipt}=await snapshot(env,snapshotId);
 if(batchIndex>=receipt.pages)throw Error('BATCH_OUT_OF_RANGE');
 const page=feed.props.slice(batchIndex*PAGE_SIZE,(batchIndex+1)*PAGE_SIZE);
 const validStarts=page.map(p=>Date.parse(p.startTimeIso)).filter(Number.isFinite);
 const games=validStarts.length?(await env.DB.prepare(`SELECT id,sport,start,home_name,away_name,home_abbr,away_abbr FROM games
   WHERE sport IN ('nfl','cfb','nba','mlb') AND julianday(start) BETWEEN julianday(?) AND julianday(?)`)
   .bind(new Date(Math.min(...validStarts)-2*3600000).toISOString(),new Date(Math.max(...validStarts)+2*3600000).toISOString()).all())?.results||[]:[];
 const normalized=normalizeMirrorProps({...feed,props:page},{games,snapshotId,collectedAt:receipt.collectedAt,now});
 const saved=await persistNormalizedMarketBatch(env.DB,normalized.rows,{collectedAt:receipt.collectedAt,snapshotType:'RESEARCH',modelProbability:null});
 return{ok:true,snapshotId,batchIndex,inputRows:page.length,acceptedRows:normalized.rows.length,inserted:saved.inserted,
  matchedRows:normalized.rows.filter(r=>r.eventId).length,unmatchedRows:normalized.rows.filter(r=>!r.eventId).length,
  rejectionReasons:normalized.reasons,researchOnly:true,canQualify:false,canAuthorizeWager:false};
}
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  return json(retiredOddsCollectorResponse("PRIZEPICKS_FREE_MIRROR"),410);
 if(!env.ARCHIVE?.get||!env.DB?.prepare)return json({ok:false,error:'DURABLE_STORAGE_REQUIRED'},503);
 try{
  const body=await request.json();
  if(body.operation==='capture')return json(await captureFreeMirror(env));
  if(body.operation==='consume')return json(await consumeFreeMirror(env,{snapshotId:body.snapshotId,batchIndex:body.batchIndex}));
  if(body.operation==='complete'){
   const {feed,receipt}=await snapshot(env,body.snapshotId);
   const expected=normalizeMirrorProps(feed,{snapshotId:body.snapshotId,collectedAt:receipt.collectedAt}).acceptedRows;
   const read=await env.DB.prepare(`SELECT COUNT(*) n,COUNT(DISTINCT sport||'|'||source_market_id) distinct_props,
    SUM(CASE WHEN canonical_event_id IS NOT NULL THEN 1 ELSE 0 END) matched FROM normalized_market_observations
    WHERE source=? AND json_valid(raw_payload_json) AND json_extract(raw_payload_json,'$.snapshotId')=?`)
    .bind(FREE_PROP_MIRROR_SOURCE,body.snapshotId).first();
   const ok=Number(read?.distinct_props||0)===expected;
   const events=await env.DB.prepare(`SELECT sport,canonical_event_id eventId,COUNT(*) observations FROM normalized_market_observations WHERE source=? AND json_valid(raw_payload_json) AND json_extract(raw_payload_json,'$.snapshotId')=? AND canonical_event_id IS NOT NULL GROUP BY sport,canonical_event_id ORDER BY sport,canonical_event_id LIMIT 8`).bind(FREE_PROP_MIRROR_SOURCE,body.snapshotId).all();
   const status={ok,snapshotId:body.snapshotId,publishedAt:receipt.publishedAt,collectedAt:receipt.collectedAt,
    expectedRows:expected,persistedRows:Number(read?.n||0),distinctProps:Number(read?.distinct_props||0),matchedRows:Number(read?.matched||0),
    sampleEvents:events?.results||[],sourceSports:receipt.sourceSports,researchOnly:true,canQualify:false,canAuthorizeWager:false};
   await env.ARCHIVE.put(path(body.snapshotId)+'-status.json',JSON.stringify(status),{httpMetadata:{contentType:'application/json'}});
   return json(status,ok?200:409);
  }
  return json({ok:false,error:'INVALID_OPERATION'},400);
 }catch(error){return json({ok:false,error:String(error?.message||error)},502);}
}
export async function onRequestGet(){return json({ok:false,error:'method-not-allowed'},405);}
