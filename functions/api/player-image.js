function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"public, max-age=86400, stale-while-revalidate=604800",
      "access-control-allow-origin":"*",
    },
  });
}
function norm(v){
  return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
export async function onRequestGet(context){
  if(!context.env?.DB) return json({ok:false,error:"database unavailable"},503);
  const url=new URL(context.request.url);
  const name=String(url.searchParams.get("name")||"").trim();
  const sport=String(url.searchParams.get("sport")||"").toLowerCase();
  if(!name) return json({ok:false,error:"name required"},400);
  let exact=await context.env.DB.prepare(
    `SELECT player_name,player_headshot_url,sport,collected_at
       FROM prizepicks_prop_lines
      WHERE player_headshot_url IS NOT NULL AND player_headshot_url<>''
        AND LOWER(player_name)=LOWER(?)
        AND (?='' OR LOWER(sport)=?)
      ORDER BY collected_at DESC
      LIMIT 1`
  ).bind(name,sport,sport).first();
  if(!exact){
    const rows=(await context.env.DB.prepare(
      `SELECT player_name,player_headshot_url,sport,collected_at
         FROM prizepicks_prop_lines
        WHERE player_headshot_url IS NOT NULL AND player_headshot_url<>''
          AND (?='' OR LOWER(sport)=?)
        ORDER BY collected_at DESC
        LIMIT 1500`
    ).bind(sport,sport).all())?.results||[];
    const needle=norm(name);
    exact=rows.find(r=>norm(r.player_name)===needle)||null;
  }
  if(!exact) return json({ok:true,found:false,name,sport});
  return json({ok:true,found:true,name:exact.player_name,sport:exact.sport,imageUrl:exact.player_headshot_url});
}
