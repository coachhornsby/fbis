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
function isRealHeadshot(url){
  const u=String(url||"").trim();
  if(!u) return false;
  // PrizePicks /images/teams/... assets are jersey-number/team tiles, not player headshots.
  if(/\/images\/teams\//i.test(u)) return false;
  return /^https?:\/\//i.test(u);
}

async function candidateResponse(imageUrl,meta,mode){
  if(!isRealHeadshot(imageUrl)) return null;
  if(mode!=="image") return json({ok:true,found:true,...meta,imageUrl});
  try{
    const upstream=await fetch(imageUrl,{headers:{accept:"image/*","user-agent":"FBIS/1.0"}});
    if(!upstream.ok) return null;
    const type=upstream.headers.get("content-type")||"";
    if(!type.toLowerCase().startsWith("image/")) return null;
    return new Response(upstream.body,{
      status:200,
      headers:{
        "content-type":type,
        "cache-control":"public, max-age=86400, stale-while-revalidate=604800",
        "access-control-allow-origin":"*",
      },
    });
  }catch{
    return null;
  }
}

function norm(v){
  return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}

function slugify(v){
  return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}


function walkObjects(value,out=[]){
  if(!value||typeof value!=="object") return out;
  if(Array.isArray(value)){
    for(const v of value) walkObjects(v,out);
    return out;
  }
  out.push(value);
  for(const v of Object.values(value)) walkObjects(v,out);
  return out;
}



function htmlImageMeta(html){
  const text=String(html||"");
  const patterns=[
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i
  ];
  for(const re of patterns){
    const m=text.match(re);
    if(m?.[1]&&/^https?:\/\//i.test(m[1])) return m[1].replace(/&amp;/g,"&");
  }
  return null;
}

async function nflOfficialHeadshot(name){
  const slug=slugify(name);
  if(!slug) return null;
  const url="https://www.nfl.com/players/"+encodeURIComponent(slug)+"/";
  const res=await fetch(url,{headers:{"user-agent":"Mozilla/5.0","accept":"text/html"}});
  if(!res.ok) return null;
  const html=await res.text();
  const meta=htmlImageMeta(html);
  if(meta) return meta;
  const candidates=[...html.matchAll(/https?:\\?\/\\?\/[^"'<> ]+(?:headshot|player)[^"'<> ]+\.(?:png|jpg|jpeg|webp)/ig)]
    .map(m=>m[0].replace(/\\\//g,"/"));
  return candidates[0]||null;
}


function decodeHtml(v){
  return String(v||"")
    .replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"')
    .replace(/&lt;/g,"<").replace(/&gt;/g,">");
}

async function atpOfficialHeadshot(name){
  const searchUrl="https://www.atptour.com/en/players?search="+encodeURIComponent(name);
  const res=await fetch(searchUrl,{headers:{"user-agent":"Mozilla/5.0","accept":"text/html"}});
  if(!res.ok) return null;
  const html=await res.text();
  const needle=norm(name);
  const candidates=[];
  const re=/href=["']([^"']*\/en\/players\/([^/"']+)\/([a-z0-9]{4,})\/(?:overview|bio|player-stats|rankings-breakdown)[^"']*)["']/ig;
  let m;
  while((m=re.exec(html))){
    const href=decodeHtml(m[1]);
    const slug=decodeHtml(m[2]);
    const id=String(m[3]||"").toLowerCase();
    const start=Math.max(0,m.index-500);
    const end=Math.min(html.length,re.lastIndex+500);
    const nearby=norm(decodeHtml(html.slice(start,end).replace(/<[^>]+>/g," ")));
    let score=0;
    if(norm(slug)===needle) score=100;
    else if(norm(slug).includes(needle)||needle.includes(norm(slug))) score=92;
    if(nearby.includes(needle)) score=Math.max(score,96);
    if(score>0) candidates.push({id,slug,href,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const hit=candidates[0]||null;
  if(!hit?.id) return null;

  const ids=[hit.id.toUpperCase(),hit.id.toLowerCase()];
  for(const id of ids){
    const url="https://www.atptour.com/-/media/alias/player-headshot/"+encodeURIComponent(id);
    try{
      const r=await fetch(url,{headers:{accept:"image/*","user-agent":"Mozilla/5.0"}});
      const type=r.headers.get("content-type")||"";
      if(r.ok&&type.toLowerCase().startsWith("image/")) return url;
    }catch{}
  }

  const profile=hit.href.startsWith("http")?hit.href:"https://www.atptour.com"+hit.href;
  try{
    const pr=await fetch(profile,{headers:{"user-agent":"Mozilla/5.0","accept":"text/html"}});
    if(pr.ok){
      const ph=await pr.text();
      const media=[...ph.matchAll(/https?:\/\/[^"'<> ]*atptour[^"'<> ]*(?:player-headshot|headshot)[^"'<> ]*/ig)]
        .map(x=>decodeHtml(x[0]));
      if(media[0]) return media[0];
      const meta=htmlImageMeta(ph);
      if(meta&&/atptour|akamaized|cloudfront/i.test(meta)) return meta;
    }
  }catch{}
  return null;
}

async function wtaOfficialHeadshot(name){
  const q="https://api.wtatennis.com/tennis/players?name="+encodeURIComponent(name)+"&page=0&pageSize=20";
  const res=await fetch(q,{headers:{accept:"application/json","user-agent":"FBIS/1.0"}});
  if(!res.ok) return null;
  const body=await res.json().catch(()=>({}));
  const rows=Array.isArray(body?.content)?body.content:Array.isArray(body)?body:[];
  const needle=norm(name);
  const player=rows.find(p=>norm(p?.fullName||p?.name||"")===needle)
    || rows.find(p=>norm(p?.fullName||p?.name||"").includes(needle)||needle.includes(norm(p?.fullName||p?.name||"")))
    || null;
  const id=player?.id||player?.playerId||null;
  const full=player?.fullName||player?.name||name;
  if(!id) return null;
  const page="https://www.wtatennis.com/players/"+encodeURIComponent(String(id))+"/"+slugify(full);
  const pr=await fetch(page,{headers:{"user-agent":"Mozilla/5.0","accept":"text/html"}});
  if(!pr.ok) return null;
  const html=await pr.text();
  const meta=htmlImageMeta(html);
  if(meta&&/wtatennis|photoresources/i.test(meta)) return meta;
  const photo=html.match(/https:\/\/photoresources\.wtatennis\.com\/[^"'<> ]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'<> ]*)?/i);
  return photo?.[0]?.replace(/&amp;/g,"&")||null;
}

async function mlbPlayerHeadshot(name){
  const search="https://statsapi.mlb.com/api/v1/people/search?active=true&sportIds=1&names="+encodeURIComponent(name);
  const res=await fetch(search,{headers:{accept:"application/json","user-agent":"FBIS/1.0"}});
  if(!res.ok) return null;
  const body=await res.json().catch(()=>({}));
  const needle=norm(name);
  const people=(body?.people||[]).filter(Boolean);
  const exact=people.find(p=>norm(p.fullName)===needle) || people[0] || null;
  const id=exact?.id;
  if(!id) return null;
  return "https://img.mlbstatic.com/mlb-photos/image/upload/w_320,q_auto:best/v1/people/"+id+"/headshot/67/current";
}

async function espnPlayerHeadshot(name,sport){
  const map={
    nfl:{searchSport:"football",league:"nfl",cdn:"nfl"},
    cfb:{searchSport:"football",league:"college-football",cdn:"college-football"},
    mlb:{searchSport:"baseball",league:"mlb",cdn:"mlb"},
    nba:{searchSport:"basketball",league:"nba",cdn:"nba"},
    wnba:{searchSport:"basketball",league:"wnba",cdn:"wnba"},
    nhl:{searchSport:"hockey",league:"nhl",cdn:"nhl"}
  };
  const cfg=map[String(sport||"").toLowerCase()];
  if(!cfg) return null;
  const url="https://site.web.api.espn.com/apis/search/v2?limit=20&query="+encodeURIComponent(name)+"&sport="+encodeURIComponent(cfg.searchSport);
  const res=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS/1.0"}});
  if(!res.ok) return null;
  const body=await res.json().catch(()=>null);
  const needle=norm(name);
  const objs=walkObjects(body,[]);
  const hit=objs.find(o=>{
    const n=norm(o?.displayName||o?.fullName||o?.name||"");
    const id=String(o?.id||o?.uid||"");
    return n===needle && /\d+/.test(id);
  });
  if(!hit) return null;
  const idMatch=String(hit.id||hit.uid||"").match(/(\d+)$/);
  const id=idMatch?.[1]||null;
  if(!id) return null;
  return "https://a.espncdn.com/i/headshots/"+cfg.cdn+"/players/full/"+id+".png";
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


async function wikidataPlayerImage(name,sport){
  const searchUrl="https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&language=en&limit=8&search="+encodeURIComponent(name);
  const res=await fetch(searchUrl,{headers:{accept:"application/json","user-agent":"FBIS/1.0"}});
  if(!res.ok) return null;
  const body=await res.json().catch(()=>({}));
  const wanted=String(sport||"").toLowerCase();
  const candidates=(body?.search||[]).filter(x=>{
    const d=String(x?.description||"").toLowerCase();
    if(wanted==="tennis") return d.includes("tennis");
    if(["nfl","cfb"].includes(wanted)) return d.includes("football");
    if(["mlb","npb","kbo"].includes(wanted)) return d.includes("baseball");
    if(["nba","wnba"].includes(wanted)) return d.includes("basketball");
    if(wanted==="nhl") return d.includes("hockey");
    if(wanted==="soccer") return d.includes("football")||d.includes("soccer");
    return true;
  });
  for(const hit of candidates.slice(0,4)){
    const entUrl="https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims&ids="+encodeURIComponent(hit.id);
    const er=await fetch(entUrl,{headers:{accept:"application/json","user-agent":"FBIS/1.0"}});
    if(!er.ok) continue;
    const eb=await er.json().catch(()=>({}));
    const file=eb?.entities?.[hit.id]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value||null;
    if(file){
      return "https://commons.wikimedia.org/wiki/Special:FilePath/"+encodeURIComponent(file)+"?width=320";
    }
  }
  return null;
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
  const mode=String(url.searchParams.get("mode")||"json").toLowerCase();
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
  if(exact && isRealHeadshot(exact.player_headshot_url)) {
    const out=await candidateResponse(exact.player_headshot_url,{name:exact.player_name,sport:exact.sport,source:"PRIZEPICKS_FEED"},mode);
    if(out) return out;
  }

  if(String(sport||"").toLowerCase()==="mlb"){
    const mlbImage=await mlbPlayerHeadshot(name).catch(()=>null);
    if(mlbImage){
      const out=await candidateResponse(mlbImage,{name,sport,source:"MLB_HEADSHOT"},mode);
      if(out) return out;
    }
  }

  if(String(sport||"").toLowerCase()==="nfl"){
    const nflImage=await nflOfficialHeadshot(name).catch(()=>null);
    if(nflImage){
      const out=await candidateResponse(nflImage,{name,sport,source:"NFL_OFFICIAL"},mode);
      if(out) return out;
    }
  }

  if(String(sport||"").toLowerCase()==="tennis"){
    const atpImage=await atpOfficialHeadshot(name).catch(()=>null);
    if(atpImage){
      const out=await candidateResponse(atpImage,{name,sport,source:"ATP_OFFICIAL"},mode);
      if(out) return out;
    }

    const wtaImage=await wtaOfficialHeadshot(name).catch(()=>null);
    if(wtaImage){
      const out=await candidateResponse(wtaImage,{name,sport,source:"WTA_OFFICIAL"},mode);
      if(out) return out;
    }
  }

  const espnImage=await espnPlayerHeadshot(name,sport).catch(()=>null);
  if(espnImage){
    const out=await candidateResponse(espnImage,{name,sport,source:"ESPN_HEADSHOT"},mode);
    if(out) return out;
  }

  const prizeImage=await prizePicksResearchImage(name,sport).catch(()=>null);
  if(prizeImage){
    const out=await candidateResponse(prizeImage,{name,sport,source:"PRIZEPICKS_RESEARCH"},mode);
    if(out) return out;
  }

  const wikidataImage=await wikidataPlayerImage(name,sport).catch(()=>null);
  if(wikidataImage){
    const out=await candidateResponse(wikidataImage,{name,sport,source:"WIKIDATA"},mode);
    if(out) return out;
  }

  const wikiImage=await wikipediaPlayerImage(name).catch(()=>null);
  if(wikiImage){
    const out=await candidateResponse(wikiImage,{name,sport,source:"WIKIPEDIA"},mode);
    if(out) return out;
  }

  if(mode==="image") return new Response(null,{status:404,headers:{"cache-control":"no-store"}});
  return json({ok:true,found:false,name,sport});
}
