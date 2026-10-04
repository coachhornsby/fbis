import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  const bucket=context.env?.ARCHIVE;
  if(!bucket)return json({ok:false,error:"archive-binding-missing"},500);
  const u=new URL(context.request.url);
  const mode=String(u.searchParams.get("mode")||"list").toLowerCase();
  if(mode==="list"){
    const prefix=String(u.searchParams.get("prefix")||"canonical/cfb/");
    if(!prefix.startsWith("canonical/cfb/"))return json({ok:false,error:"prefix-not-allowed"},400);
    const limit=Math.max(1,Math.min(1000,Number(u.searchParams.get("limit")||1000)));
    const cursor=u.searchParams.get("cursor")||undefined;
    const listed=await bucket.list({prefix,limit,cursor,include:["customMetadata"]});
    return json({ok:true,prefix,count:listed.objects.length,truncated:listed.truncated,cursor:listed.cursor||null,
      objects:listed.objects.map(o=>({key:o.key,size:o.size,uploaded:o.uploaded,etag:o.etag,customMetadata:o.customMetadata||null}))});
  }
  if(mode==="get"){
    const key=String(u.searchParams.get("key")||"");
    if(!key.startsWith("canonical/cfb/"))return json({ok:false,error:"key-not-allowed"},400);
    const obj=await bucket.get(key);
    if(!obj)return json({ok:false,error:"not-found",key},404);
    const h=new Headers();obj.writeHttpMetadata(h);h.set("cache-control","private, no-store");h.set("x-r2-key",key);
    return new Response(obj.body,{headers:h});
  }
  return json({ok:false,error:"mode-must-be-list-or-get"},400);
}
