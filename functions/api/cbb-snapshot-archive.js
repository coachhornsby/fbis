import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";

const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const safe=v=>String(v||"").replace(/[^a-zA-Z0-9._-]/g,"");

export async function onRequest(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  const bucket=context.env.ARCHIVE;
  if(!bucket)return json({ok:false,error:"archive-binding-missing"},500);
  const url=new URL(context.request.url),version=safe(url.searchParams.get("version")),kind=safe(url.searchParams.get("kind")||"dataset.json.gz");
  if(!version)return json({ok:false,error:"version-required"},400);
  const key=`cbb/snapshots/${version}/${kind}`;
  if(context.request.method==="GET"){
    const obj=await bucket.get(key);if(!obj)return json({ok:false,error:"not-found",key},404);
    const h=new Headers();obj.writeHttpMetadata(h);h.set("etag",obj.httpEtag);h.set("x-r2-key",key);return new Response(obj.body,{headers:h});
  }
  if(context.request.method==="PUT"){
    if(await bucket.head(key))return json({ok:false,error:"immutable-object-exists",key},409);
    const sha=String(context.request.headers.get("x-dataset-sha256")||"").toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(sha))return json({ok:false,error:"valid-sha256-required"},400);
    const bytes=await context.request.arrayBuffer();
    await bucket.put(key,bytes,{httpMetadata:{contentType:context.request.headers.get("content-type")||"application/octet-stream",contentEncoding:context.request.headers.get("content-encoding")||undefined},customMetadata:{sha256:sha,version,immutable:"true",createdAt:new Date().toISOString()}});
    return json({ok:true,key,version,sha256:sha,bytes:bytes.byteLength,immutable:true},201);
  }
  return json({ok:false,error:"method-not-allowed"},405);
}
