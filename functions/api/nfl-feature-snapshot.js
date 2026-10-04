import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";

const KEY = "nfl/features/latest.json";
const json = (body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});

export async function onRequest(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  const bucket=context.env.ARCHIVE;
  if(!bucket)return json({ok:false,error:"archive-binding-missing"},500);

  if(context.request.method==="GET"){
    const obj=await bucket.get(KEY);
    if(!obj)return json({ok:false,error:"not-found",key:KEY},404);
    return new Response(obj.body,{headers:{"content-type":"application/json","cache-control":"no-store","x-r2-key":KEY}});
  }

  if(context.request.method==="PUT"){
    const bytes=await context.request.arrayBuffer();
    if(bytes.byteLength<1000)return json({ok:false,error:"snapshot-too-small"},400);
    let parsed;
    try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({ok:false,error:"invalid-json"},400);}
    if(!parsed?.meta||!parsed?.byTeam||!parsed?.playersByTeam)return json({ok:false,error:"invalid-snapshot-shape"},400);
    await bucket.put(KEY,bytes,{httpMetadata:{contentType:"application/json"},customMetadata:{
      schema:String(parsed.meta.snapshotSchema||"unknown"),
      season:String(parsed.season||""),
      builtAt:String(parsed.meta.builtAt||new Date().toISOString()),
      source:"github-actions-offline-builder"
    }});
    return json({ok:true,key:KEY,bytes:bytes.byteLength,season:parsed.season||null,builtAt:parsed.meta.builtAt||null},201);
  }

  return json({ok:false,error:"method-not-allowed"},405);
}
