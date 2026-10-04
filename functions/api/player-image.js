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

function slugify(v){
  return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}

async function prizePicksResearchImage(name,sport){
  if(!sport) return null;
  const page=`https://www.prizepicks.com/research/${encodeURIComponent(sport)}/players/${encodeURIComponent(slugify(name))}`;
  const res=await fetch(page,{headers:{"user-agent":"Mozilla/5.0","accept":"text/html"}});
  if(!res.ok) return null;
  const html=await res.text();
  const m=html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const image=m?.[1]||null;
  return image && /^https?:\/\//i.test(image) ? image : null;
}

async function wikipediaPlayerImage(name){
  const endpoint="https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=0&gsrlimit=5&gsrsearch="+
    encodeURIComponent('intitle:"'+name+'"')+
    "&prop=pageimages|info&piprop=thumbnail&pithumbsize=320&inprop=url";
  const res=await fetch(endpoint,{headers:{accept:"application/json"}});
  if(!res.ok) return null;
  const body=await res.json().catch(()=>({}));
  const pages=Object.values(body?.query?.pages||{});
  const needle=norm(name);
  const ranked=pages
    .filter(p=>p?.thumbnail?.source)
    .map(p=>({p,score:norm(p.title)===needle?100:(norm(p.title).includes(needle)||needle.includes(norm(p.title))?80:0)}))
    .sort((a,b)=>b.score-a.score);
  const hit=ranked[0]?.score>=80?ranked[0].p:null;
  return hit?.thumbnail?.source||null;
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
  if(exact) return json({ok:true,found:true,name:exact.player_name,sport:exact.sport,imageUrl:exact.player_headshot_url,source:"PRIZEPICKS_FEED"});

  const prizeImage=await prizePicksResearchImage(name,sport).catch(()=>null);
  if(prizeImage) return json({ok:true,found:true,name,sport,imageUrl:prizeImage,source:"PRIZEPICKS_RESEARCH"});

  const wikiImage=await wikipediaPlayerImage(name).catch(()=>null);
  if(wikiImage) return json({ok:true,found:true,name,sport,imageUrl:wikiImage,source:"WIKIPEDIA"});

  return json({ok:true,found:false,name,sport});
}
