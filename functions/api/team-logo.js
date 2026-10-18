import { resolveTeam } from "../lib/teams.js";

const ESPN_TEAM_ENDPOINTS = {
  nfl: ["nfl"],
  mlb: ["mlb"],
  nba: ["nba"],
  cfb: ["college-football"],
  cbb: ["mens-college-basketball"],
  soccer: [
    "eng.1","eng.2","esp.1","esp.2","ger.1","ger.2","ita.1","ita.2","fra.1","fra.2","usa.1","mex.1",
    "uefa.champions","uefa.europa","uefa.europa.conf","eng.fa","eng.league_cup",
    "arg.1","bra.1","ned.1","por.1","sco.1","bel.1","tur.1",
    "eng.w.1","usa.nwsl","uefa.wchampions"
  ],
  nhl: ["nhl"],
};

/** PrizePicks / board abbr aliases that must not fuzzy-match unrelated cities. */
const ABBR_ALIASES = Object.freeze({
  nfl: Object.freeze({
    JAC: "JAX", JAX: "JAX", LA: "LAR", LAR: "LAR", STL: "LAR",
    WSH: "WAS", WAS: "WAS", SFO: "SF", SF: "SF",
    OAK: "LV", LV: "LV", SD: "LAC", LAC: "LAC", ARZ: "ARI", ARI: "ARI",
  }),
  nba: Object.freeze({
    BRK: "BKN", BKN: "BKN", PHO: "PHX", PHX: "PHX",
    GS: "GSW", GSW: "GSW", NO: "NOP", NOP: "NOP", SA: "SAS", SAS: "SAS",
    NY: "NYK", NYK: "NYK", WSH: "WAS", WAS: "WAS",
  }),
  mlb: Object.freeze({
    ANA: "LAA", LAA: "LAA", FLOR: "MIA", FLA: "MIA", TAM: "TB", TBA: "TB",
    WAS: "WSH", WSH: "WSH", CHW: "CWS", CWS: "CWS",
  }),
  nhl: Object.freeze({
    LA: "LAK", LAK: "LAK", NJ: "NJD", NJD: "NJD", TB: "TBL", TBL: "TBL",
    WAS: "WSH", WSH: "WSH",
  }),
});

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

export function norm(v){
  return String(v||"")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|club|football club)\b/g," ")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

/** Map PrizePicks-style codes (LA→LAR) before fuzzy matching. */
export function canonicalizeTeamQuery(sport, name){
  const raw=String(name||"").trim();
  if(!raw) return "";
  const compact=raw.toUpperCase().replace(/[^A-Z0-9]/g,"");
  const aliases=ABBR_ALIASES[String(sport||"").toLowerCase()]||{};
  if(aliases[compact]) return aliases[compact];
  return raw;
}

function namesFor(team={}){
  return [
    team.displayName,team.name,team.shortDisplayName,team.location,team.nickname,
    team.slug,team.abbreviation
  ].filter(Boolean);
}

/**
 * Score a query against an ESPN team row.
 * Short codes (≤3 chars) never substring-match city names — that is how
 * "LA" incorrectly beat Rams and matched Atlanta Falcons via "At**la**nta".
 */
export function scoreMatch(query,team={}){
  const q=norm(query);
  if(!q) return 0;
  const abbr=norm(team.abbreviation);
  if(abbr && abbr===q) return 100;

  let best=0;
  const compact=q.replace(/\s+/g,"");
  const shortCode=compact.length>0 && compact.length<=3 && !/\s/.test(q);

  for(const raw of namesFor(team)){
    const n=norm(raw);
    if(!n) continue;
    if(n===q) best=Math.max(best,100);
    else if(n.startsWith(q+" ")||q.startsWith(n+" ")) best=Math.max(best,90);
    else if(shortCode){
      const tokens=n.split(/\s+/);
      if(tokens.includes(q) || tokens.includes(compact)) best=Math.max(best,85);
    }else if(n.includes(q)||q.includes(n)){
      best=Math.max(best,75);
    }
  }
  return best;
}

function fromLocalRegistry(sport, name){
  const lookup=canonicalizeTeamQuery(sport, name);
  const hit=resolveTeam(sport, { abbr: lookup, name: lookup });
  if(!hit || hit.matchStatus === "unresolved") return null;
  const color=String(hit.color||hit.primaryColor||"").replace(/^#/,"");
  const alt=String(hit.altColor||hit.alternateColor||hit.secondaryColor||"").replace(/^#/,"");
  return {
    name: hit.displayName || hit.fullName || hit.name || name,
    abbr: hit.abbr || null,
    logo: hit.logo || null,
    primaryColor: /^[0-9a-f]{6}$/i.test(color) ? "#"+color : null,
    secondaryColor: /^[0-9a-f]{6}$/i.test(alt) ? "#"+alt : null,
    espnId: hit.espnId || hit.sources?.espn?.id || null,
    source: "local-registry",
  };
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
  const sportPath = {
    nfl: "football",
    mlb: "baseball",
    nba: "basketball",
    cfb: "football",
    cbb: "basketball",
    nhl: "hockey",
    soccer: "soccer",
  }[sport] || sport;
  const path=`https://site.api.espn.com/apis/site/v2/sports/${encodeURIComponent(sportPath)}/${encodeURIComponent(league)}/teams?limit=400`;
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

  const local=fromLocalRegistry(sport, name);
  if(local?.logo){
    return json({ok:true,found:true,sport,league:sport,score:100,team:local});
  }

  const lookupName=canonicalizeTeamQuery(sport, name);
  let best=null,bestScore=0,bestLeague=null;
  for(const league of ESPN_TEAM_ENDPOINTS[sport]){
    try{
      const rows=await espnTeams(sport,league);
      for(const team of rows){
        const score=scoreMatch(lookupName,team);
        if(score>bestScore){
          best=team;bestScore=score;bestLeague=league;
          if(score>=100) break;
        }
      }
      if(bestScore>=100) break;
    }catch{}
  }
  if(!best||bestScore<75) return json({ok:true,found:false,sport,name,lookupName});
  const logo=best.logos?.find(x=>x?.href)?.href||best.logos?.[0]?.href||null;
  return json({
    ok:true,found:true,sport,league:bestLeague,score:bestScore,
    team:{
      name:best.displayName||best.name||name,
      abbr:best.abbreviation||null,
      logo,
      primaryColor:/^[0-9a-f]{6}$/i.test(String(best.color||""))?"#"+best.color:null,
      secondaryColor:/^[0-9a-f]{6}$/i.test(String(best.alternateColor||""))?"#"+best.alternateColor:null,
      espnId:best.id||null,
    },
  });
}
