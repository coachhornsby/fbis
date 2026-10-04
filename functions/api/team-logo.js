const ESPN_TEAM_ENDPOINTS = {
  soccer: [
    "eng.1","eng.2","esp.1","esp.2","ger.1","ger.2","ita.1","ita.2","fra.1","fra.2","usa.1","mex.1",
    "uefa.champions","uefa.europa","uefa.europa.conf","eng.fa","eng.league_cup",
    "arg.1","bra.1","ned.1","por.1","sco.1","bel.1","tur.1",
    "eng.w.1","usa.nwsl","uefa.wchampions"
  ],
  nhl: ["nhl"],
};

const WIKI_TEAM_TITLES = {
  npb: {
    "hanshin":"Hanshin Tigers","hanshin tigers":"Hanshin Tigers",
    "yokohama dena":"Yokohama DeNA BayStars","yokohama dena baystars":"Yokohama DeNA BayStars","dena":"Yokohama DeNA BayStars",
    "yomiuri":"Yomiuri Giants","yomiuri giants":"Yomiuri Giants","giants":"Yomiuri Giants",
    "chunichi":"Chunichi Dragons","chunichi dragons":"Chunichi Dragons",
    "hiroshima":"Hiroshima Toyo Carp","hiroshima carp":"Hiroshima Toyo Carp","hiroshima toyo carp":"Hiroshima Toyo Carp",
    "yakult":"Tokyo Yakult Swallows","tokyo yakult":"Tokyo Yakult Swallows","tokyo yakult swallows":"Tokyo Yakult Swallows",
    "softbank":"Fukuoka SoftBank Hawks","fukuoka softbank":"Fukuoka SoftBank Hawks","fukuoka softbank hawks":"Fukuoka SoftBank Hawks",
    "nippon ham":"Hokkaido Nippon-Ham Fighters","nippon ham fighters":"Hokkaido Nippon-Ham Fighters","hokkaido nippon ham fighters":"Hokkaido Nippon-Ham Fighters",
    "orix":"Orix Buffaloes","orix buffaloes":"Orix Buffaloes",
    "rakuten":"Tohoku Rakuten Golden Eagles","rakuten golden eagles":"Tohoku Rakuten Golden Eagles","tohoku rakuten golden eagles":"Tohoku Rakuten Golden Eagles",
    "seibu":"Saitama Seibu Lions","seibu lions":"Saitama Seibu Lions","saitama seibu lions":"Saitama Seibu Lions",
    "chiba lotte":"Chiba Lotte Marines","lotte marines":"Chiba Lotte Marines","chiba lotte marines":"Chiba Lotte Marines"
  },
  kbo: {
    "lg":"LG Twins","lg twins":"LG Twins","hanwha":"Hanwha Eagles","hanwha eagles":"Hanwha Eagles",
    "ssg":"SSG Landers","ssg landers":"SSG Landers","samsung":"Samsung Lions","samsung lions":"Samsung Lions",
    "kt":"KT Wiz","kt wiz":"KT Wiz","lotte":"Lotte Giants","lotte giants":"Lotte Giants",
    "doosan":"Doosan Bears","doosan bears":"Doosan Bears","nc":"NC Dinos","nc dinos":"NC Dinos",
    "kia":"Kia Tigers","kia tigers":"Kia Tigers","kiwoom":"Kiwoom Heroes","kiwoom heroes":"Kiwoom Heroes"
  }
};

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
  return String(v||"")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|club|football club)\b/g," ")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function namesFor(team={}){
  return [
    team.displayName,team.name,team.shortDisplayName,team.location,team.nickname,
    team.slug,team.abbreviation
  ].filter(Boolean);
}

function scoreMatch(query,team={}){
  const q=norm(query);
  if(!q) return 0;
  let best=0;
  for(const raw of namesFor(team)){
    const n=norm(raw);
    if(!n) continue;
    if(n===q) best=Math.max(best,100);
    else if(n.startsWith(q+" ")||q.startsWith(n+" ")) best=Math.max(best,90);
    else if(n.includes(q)||q.includes(n)) best=Math.max(best,75);
  }
  return best;
}


async function wikipediaTeamLogo(sport,name){
  const map=WIKI_TEAM_TITLES[sport]||{};
  const title=map[norm(name)]||name;
  const endpoint="https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&piprop=thumbnail&pithumbsize=256&redirects=1&titles="+encodeURIComponent(title);
  const res=await fetch(endpoint,{headers:{accept:"application/json"}});
  if(!res.ok) return null;
  const body=await res.json().catch(()=>({}));
  const pages=Object.values(body?.query?.pages||{});
  const page=pages.find(p=>p?.thumbnail?.source)||null;
  if(!page) return null;
  return {name:page.title||title,abbr:null,logo:page.thumbnail.source,wikipediaTitle:page.title||title};
}

async function espnTeams(sport,league){
  const path=sport==="nhl"
    ? "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams?limit=100"
    : `https://site.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(league)}/teams?limit=200`;
  const res=await fetch(path,{headers:{accept:"application/json"}});
  if(!res.ok) return [];
  const body=await res.json().catch(()=>({}));
  return (body?.sports?.[0]?.leagues?.[0]?.teams||[]).map(x=>x.team).filter(Boolean);
}

export async function onRequestGet(context){
  const url=new URL(context.request.url);
  const sport=String(url.searchParams.get("sport")||"").toLowerCase();
  const name=String(url.searchParams.get("name")||"").trim();
  if(!name) return json({ok:false,error:"name required"},400);
  if(sport==="npb"||sport==="kbo"){
    const team=await wikipediaTeamLogo(sport,name).catch(()=>null);
    return team ? json({ok:true,found:true,sport,team}) : json({ok:true,found:false,sport,name});
  }
  if(!ESPN_TEAM_ENDPOINTS[sport]) return json({ok:false,error:"unsupported team lookup"},400);

  let best=null,bestScore=0,bestLeague=null;
  for(const league of ESPN_TEAM_ENDPOINTS[sport]){
    try{
      const rows=await espnTeams(sport,league);
      for(const team of rows){
        const score=scoreMatch(name,team);
        if(score>bestScore){
          best=team;bestScore=score;bestLeague=league;
          if(score>=100) break;
        }
      }
      if(bestScore>=100) break;
    }catch{}
  }
  if(!best||bestScore<75) return json({ok:true,found:false,sport,name});
  const logo=best.logos?.find(x=>x?.href)?.href||best.logos?.[0]?.href||null;
  return json({
    ok:true,found:true,sport,league:bestLeague,score:bestScore,
    team:{
      name:best.displayName||best.name||name,
      abbr:best.abbreviation||null,
      logo,
      espnId:best.id||null,
    },
  });
}
