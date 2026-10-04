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
function walk(value,out=[]){
  if(!value||typeof value!=="object") return out;
  if(Array.isArray(value)){ for(const x of value) walk(x,out); return out; }
  out.push(value);
  for(const x of Object.values(value)) walk(x,out);
  return out;
}
function posOf(o){
  const p=o?.position;
  if(typeof p==="string") return p.trim()||null;
  return String(
    p?.abbreviation||p?.shortName||p?.displayName||p?.name||
    o?.positionAbbreviation||o?.positionName||""
  ).trim()||null;
}
async function espnNflRosterPosition(name,team){
  const t=String(team||"").trim().toLowerCase();
  if(!t) return null;
  const url="https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/"+encodeURIComponent(t)+"/roster";
  const res=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS/1.0"}});
  if(!res.ok) return null;
  const body=await res.json().catch(()=>({}));
  const needle=norm(name);
  const athletes=[];
  for(const group of body?.athletes||[]){
    for(const a of group?.items||[]) athletes.push(a);
  }
  const hit=athletes.find(a=>norm(a?.fullName||a?.displayName||a?.name||"")===needle)
    || athletes.find(a=>{
      const n=norm(a?.fullName||a?.displayName||a?.name||"");
      return n && (n.includes(needle)||needle.includes(n));
    })
    || null;
  return posOf(hit);
}
async function espnPosition(name,sport,team){
  const map={
    nfl:{searchSport:"football",league:"nfl"},
    cfb:{searchSport:"football",league:"college-football"},
    cbb:{searchSport:"basketball",league:"mens-college-basketball"},
    nba:{searchSport:"basketball",league:"nba"},
    wnba:{searchSport:"basketball",league:"wnba"},
    nhl:{searchSport:"hockey",league:"nhl"},
  };
  const cfg=map[sport];
  if(!cfg) return null;
  const url="https://site.web.api.espn.com/apis/search/v2?limit=30&query="+encodeURIComponent(name)+"&sport="+encodeURIComponent(cfg.searchSport);
  const res=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS/1.0"}});
  if(!res.ok) return null;
  const body=await res.json().catch(()=>null);
  const needle=norm(name), teamNeedle=norm(team);
  const candidates=walk(body,[]).filter(o=>{
    const n=norm(o?.displayName||o?.fullName||o?.name||"");
    return n===needle && posOf(o);
  });
  if(!candidates.length) return null;
  const teamMatch=candidates.find(o=>{
    if(!teamNeedle) return false;
    const blob=norm([
      o?.team?.abbreviation,o?.team?.displayName,o?.team?.name,
      o?.teamAbbreviation,o?.teamName,o?.description
    ].filter(Boolean).join(" "));
    return blob.includes(teamNeedle)||teamNeedle.includes(blob);
  });
  return posOf(teamMatch||candidates[0]);
}
async function mlbPosition(name){
  const url="https://statsapi.mlb.com/api/v1/people/search?active=true&sportIds=1&names="+encodeURIComponent(name);
  const res=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS/1.0"}});
  if(!res.ok) return null;
  const body=await res.json().catch(()=>({}));
  const needle=norm(name);
  const p=(body?.people||[]).find(x=>norm(x?.fullName)===needle)||(body?.people||[])[0]||null;
  if(!p?.id) return null;
  const detail=await fetch("https://statsapi.mlb.com/api/v1/people/"+encodeURIComponent(p.id),{
    headers:{accept:"application/json","user-agent":"FBIS/1.0"}
  });
  if(!detail.ok) return null;
  const d=await detail.json().catch(()=>({}));
  const hit=d?.people?.[0]||null;
  return String(hit?.primaryPosition?.abbreviation||hit?.primaryPosition?.name||"").trim()||null;
}
export async function onRequestGet(context){
  const url=new URL(context.request.url);
  const name=String(url.searchParams.get("name")||"").trim();
  const sport=String(url.searchParams.get("sport")||"").trim().toLowerCase();
  const team=String(url.searchParams.get("team")||"").trim();
  if(!name) return json({ok:false,error:"name required"},400);
  if(sport==="tennis") return json({ok:true,position:null});
  try{
    const position=sport==="mlb"
      ? await mlbPosition(name)
      : sport==="nfl"
        ? (await espnNflRosterPosition(name,team)) || (await espnPosition(name,sport,team))
        : await espnPosition(name,sport,team);
    return json({ok:true,position:position||null});
  }catch{
    return json({ok:true,position:null});
  }
}
