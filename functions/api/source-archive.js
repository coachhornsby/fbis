import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const safe=v=>String(v||"").toLowerCase().replace(/[^a-z0-9_-]/g,"");
const dateParts=v=>{
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v||""));
  return m?{date:m[0],y:m[1],m:m[2],d:m[3]}:null;
};

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  const bucket=context.env?.ARCHIVE;
  if(!bucket)return json({ok:false,error:"archive-binding-missing"},500);

  const url=new URL(context.request.url);
  const source=safe(url.searchParams.get("source"));
  const parts=dateParts(url.searchParams.get("date"));
  const runId=String(url.searchParams.get("runId")||"").replace(/[^a-zA-Z0-9._-]/g,"");
  if(!["action","prizepicks"].includes(source))return json({ok:false,error:"source-must-be-action-or-prizepicks"},400);
  if(!parts)return json({ok:false,error:"date-must-be-yyyy-mm-dd"},400);

  const prefix=`raw/${source}/${parts.y}/${parts.m}/${parts.d}/`;
  if(runId){
    const key=`${prefix}${runId}.json`;
    const obj=await bucket.get(key);
    if(!obj)return json({ok:false,error:"not-found",source,date:parts.date,runId,key},404);
    const headers=new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag",obj.httpEtag);
    headers.set("cache-control","private, no-store");
    headers.set("content-disposition",`attachment; filename="${source}-${parts.date}-${runId}.json"`);
    headers.set("x-r2-key",key);
    return new Response(obj.body,{headers});
  }

  const listed=await bucket.list({prefix,limit:1000});
  return json({
    ok:true,
    source,
    date:parts.date,
    count:listed.objects.length,
    pulls:listed.objects.map(o=>({
      key:o.key,
      runId:o.key.slice(prefix.length).replace(/\.json$/,""),
      size:o.size,
      uploaded:o.uploaded,
      etag:o.etag,
      customMetadata:o.customMetadata||null
    }))
  });
}


export async function onRequestPut(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  const bucket=context.env?.ARCHIVE;
  if(!bucket)return json({ok:false,error:"archive-binding-missing"},500);

  const url=new URL(context.request.url);
  const source=safe(url.searchParams.get("source"));
  const parts=dateParts(url.searchParams.get("date"));
  const runId=String(url.searchParams.get("runId")||"").replace(/[^a-zA-Z0-9._-]/g,"");
  if(!["action","prizepicks"].includes(source))return json({ok:false,error:"source-must-be-action-or-prizepicks"},400);
  if(!parts)return json({ok:false,error:"date-must-be-yyyy-mm-dd"},400);
  if(!runId)return json({ok:false,error:"runId-required"},400);

  const key=`raw/${source}/${parts.y}/${parts.m}/${parts.d}/${runId}.json`;
  const existing=await bucket.head(key);
  if(existing)return json({ok:true,alreadyArchived:true,key,source,date:parts.date,runId,size:existing.size});

  const bytes=await context.request.arrayBuffer();
  if(!bytes.byteLength)return json({ok:false,error:"empty-body"},400);
  const archivedAt=new Date().toISOString();
  await bucket.put(key,bytes,{
    httpMetadata:{contentType:context.request.headers.get("content-type")||"application/json; charset=utf-8"},
    customMetadata:{source,date:parts.date,runId,immutable:"true",archivedAt}
  });
  return json({ok:true,archived:true,key,source,date:parts.date,runId,bytes:bytes.byteLength},201);
}
