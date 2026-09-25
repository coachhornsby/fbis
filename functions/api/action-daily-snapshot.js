const json=(body,status=503)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

export async function onRequestGet(){
  return json({ok:false,executed:false,status:"action_paused",reason:"ACTION/Apify collection is administratively paused."},503);
}

export async function onRequestPost(){
  return json({ok:false,executed:false,status:"action_paused",reason:"ACTION/Apify collection is administratively paused."},503);
}
