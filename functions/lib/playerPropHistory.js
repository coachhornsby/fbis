const SPORT_CONFIG = Object.freeze({
  nfl: { searchSport: "football", sportPath: "football", leagues: ["nfl"] },
  cfb: { searchSport: "football", sportPath: "football", leagues: ["college-football"] },
  nba: { searchSport: "basketball", sportPath: "basketball", leagues: ["nba"] },
  wnba: { searchSport: "basketball", sportPath: "basketball", leagues: ["wnba"] },
  nhl: { searchSport: "hockey", sportPath: "hockey", leagues: ["nhl"] },
  cbb: { searchSport: "basketball", sportPath: "basketball", leagues: ["mens-college-basketball"] },
  soccer: {
    searchSport: "soccer",
    sportPath: "soccer",
    leagues: [
      "eng.1","esp.1","ger.1","ita.1","fra.1","usa.1","mex.1",
      "uefa.champions","uefa.europa","uefa.nations","arg.1","bra.1","usa.nwsl","eng.w.1"
    ],
  },
  tennis: { searchSport: "tennis", sportPath: "tennis", leagues: ["atp","wta"] },
});

const META_FIELDS = new Set(["date","opponent","gameresult","result","team","athlete","name"]);

function norm(v){
  return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function key(v){ return norm(v).replace(/ /g,""); }
function finite(v){
  if(v==null||v==="") return null;
  if(typeof v==="number") return Number.isFinite(v)?v:null;
  const s=String(v).trim();
  if(!s) return null;
  const m=s.match(/-?\d+(?:\.\d+)?/);
  if(!m) return null;
  const n=Number(m[0]);
  return Number.isFinite(n)?n:null;
}
function mean(xs=[]){
  const a=xs.map(finite).filter(v=>v!=null);
  return a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
}
function walk(v,out=[]){
  if(!v||typeof v!=="object") return out;
  if(Array.isArray(v)){ for(const x of v) walk(x,out); return out; }
  out.push(v);
  for(const x of Object.values(v)) walk(x,out);
  return out;
}
function eventStatMap(payload,event){
  const names=Array.isArray(payload?.names)?payload.names:[];
  const stats=Array.isArray(event?.stats)?event.stats:[];
  const statNames=names.filter(n=>!META_FIELDS.has(key(n)));
  const aligned=statNames.length===stats.length?statNames:names.slice(Math.max(0,names.length-stats.length));
  const out={};
  for(let i=0;i<stats.length;i++){
    const k=key(aligned[i]||"");
    if(k) out[k]=stats[i];
  }
  for(const [k0,v] of Object.entries(event||{})){
    if(k0==="stats"||v==null||typeof v==="object") continue;
    out[key(k0)]=v;
  }
  return out;
}
function first(map,aliases=[]){
  for(const a of aliases){
    const v=map[key(a)];
    if(v!=null&&v!=="") return finite(v);
  }
  return null;
}

const MARKET_ALIASES = Object.freeze({
  points:["points","pts"],
  rebounds:["rebounds","reb"],
  assists:["assists","ast"],
  "3_pt_made":["threePointsMade","threePointFieldGoalsMade","3PT","3PM","3FGM"],
  three_pointers_made:["threePointsMade","threePointFieldGoalsMade","3PT","3PM","3FGM"],
  passing_yards:["passingYards","passYards","yards"],
  pass_yards:["passingYards","passYards"],
  rushing_yards:["rushingYards","rushYards"],
  rush_yards:["rushingYards","rushYards"],
  receiving_yards:["receivingYards","recYards"],
  receptions:["receptions","rec"],
  completions:["completions","cmp"],
  passing_attempts:["passingAttempts","attempts","att"],
  rushing_attempts:["rushingAttempts","carries","rushAttempts"],
  pass_tds:["passingTouchdowns","passingTDs","passTD"],
  int:["interceptions","interceptionsThrown","int"],
  rec_targets:["receivingTargets","targets"],
  shots_on_goal:["shotsOnGoal","shots","sog"],
  saves:["saves","sv"],
  goalie_saves:["saves","goalieSaves","sv"],
  goals:["goals","g"],
  shots:["shots","totalShots"],
  shots_on_target:["shotsOnTarget","shotsOnGoal","sot"],
  fouls:["fouls","foulsCommitted"],
  tackles:["tackles","totalTackles"],
  clearances:["clearances"],
  goal_assist:["goalAssists","goalsAssists","goalsPlusAssists"],
  passes_attempted:["passesAttempted","passes","passAttempts"],
  total_games_won:["gamesWon","games"],
  total_games:["totalGames","gamesPlayed"],
});

function scoreLines(event){
  const comps=event?.competitors||event?.competition?.competitors||event?.competitions?.[0]?.competitors||[];
  if(!Array.isArray(comps)||!comps.length) return [];
  return comps.map(c=>({
    name:c?.athlete?.displayName||c?.team?.displayName||c?.displayName||c?.name||"",
    score:finite(c?.score),
    sets:(c?.linescores||[]).map(x=>finite(x?.value??x?.displayValue)).filter(x=>x!=null),
  }));
}
function tennisScoreValue(event,market,name){
  const rows=scoreLines(event);
  if(rows.length<2) return null;
  const needle=norm(String(name||"").split("/")[0]);
  let own=rows.find(r=>norm(r.name).includes(needle)||needle.includes(norm(r.name)));
  if(!own) own=rows[0];
  const ownGames=own.sets.length?own.sets.reduce((a,b)=>a+b,0):own.score;
  const total=rows.reduce((sum,r)=>sum+(r.sets.length?r.sets.reduce((a,b)=>a+b,0):(r.score||0)),0);
  if(market==="total_games_won") return ownGames;
  if(market==="total_games") return total;
  return null;
}

export function valueForEspnEvent(payload,event,market,sport,name){
  const m=String(market||"").toLowerCase().replace(/_combo$/,"");
  const map=eventStatMap(payload,event);
  if(m==="points_rebounds_assists"){
    const vals=["points","rebounds","assists"].map(k=>first(map,MARKET_ALIASES[k]));
    return vals.every(v=>v!=null)?vals.reduce((a,b)=>a+b,0):null;
  }
  if(m==="points_rebounds"){
    const vals=["points","rebounds"].map(k=>first(map,MARKET_ALIASES[k]));
    return vals.every(v=>v!=null)?vals.reduce((a,b)=>a+b,0):null;
  }
  if(m==="points_assists"){
    const vals=["points","assists"].map(k=>first(map,MARKET_ALIASES[k]));
    return vals.every(v=>v!=null)?vals.reduce((a,b)=>a+b,0):null;
  }
  if(m==="rebounds_assists"){
    const vals=["rebounds","assists"].map(k=>first(map,MARKET_ALIASES[k]));
    return vals.every(v=>v!=null)?vals.reduce((a,b)=>a+b,0):null;
  }
  if(m==="goal_assist"){
    const g=first(map,MARKET_ALIASES.goals),a=first(map,MARKET_ALIASES.assists);
    if(g!=null&&a!=null) return g+a;
  }
  if(m==="points"){
    const g=first(map,MARKET_ALIASES.goals),a=first(map,MARKET_ALIASES.assists);
    if(String(sport)==="nhl"&&g!=null&&a!=null) return g+a;
  }
  const direct=first(map,MARKET_ALIASES[m]||[m]);
  if(direct!=null) return direct;
  if(String(sport)==="tennis") return tennisScoreValue(event,m,name);
  return null;
}

function candidateId(body,name,team){
  const needle=norm(name), teamNeedle=norm(team);
  const candidates=walk(body,[]).filter(o=>{
    const id=String(o?.id||o?.uid||"").match(/(\d+)$/)?.[1];
    const n=norm(o?.displayName||o?.fullName||o?.name||"");
    return id&&n&&(n===needle||n.includes(needle)||needle.includes(n));
  });
  if(!candidates.length) return null;
  const scored=candidates.map(o=>{
    const n=norm(o?.displayName||o?.fullName||o?.name||"");
    const blob=norm([o?.team?.abbreviation,o?.team?.displayName,o?.team?.name,o?.description].filter(Boolean).join(" "));
    let score=n===needle?100:80;
    if(teamNeedle&&(blob.includes(teamNeedle)||teamNeedle.includes(blob))) score+=20;
    return {o,score};
  }).sort((a,b)=>b.score-a.score);
  return String(scored[0].o.id||scored[0].o.uid||"").match(/(\d+)$/)?.[1]||null;
}

async function fetchJson(url,{timeoutMs=6000}={}){
  const c=new AbortController();
  const t=setTimeout(()=>c.abort("timeout"),timeoutMs);
  try{
    const r=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS/1.0"},signal:c.signal});
    if(!r.ok) return null;
    return await r.json().catch(()=>null);
  }catch{return null;}finally{clearTimeout(t);}
}

async function athleteId(name,sport,team){
  const cfg=SPORT_CONFIG[sport];
  if(!cfg) return null;
  const queryName=String(name||"").split("/")[0].trim();
  const u="https://site.web.api.espn.com/apis/search/v2?limit=30&query="+encodeURIComponent(queryName)+"&sport="+encodeURIComponent(cfg.searchSport);
  return candidateId(await fetchJson(u),queryName,team);
}

function seasonCandidates(sport){
  const now=new Date(), y=now.getFullYear(), month=now.getMonth()+1;
  // ESPN keys fall/winter leagues by the season ending year in many feeds.
  if(["nba","nhl","cbb"].includes(sport) && month>=7) return [y+1,y,y-1];
  if(["nba","nhl","cbb"].includes(sport)) return [y,y-1];
  return [y,y-1];
}
async function gamelogFor(id,sport){
  const cfg=SPORT_CONFIG[sport];
  if(!cfg||!id) return null;
  const attempts=[];
  for(const league of cfg.leagues){
    for(const season of seasonCandidates(sport)) attempts.push({league,season});
  }
  const results=await Promise.all(attempts.map(async ({league,season})=>{
    const u="https://site.web.api.espn.com/apis/common/v3/sports/"+encodeURIComponent(cfg.sportPath)+"/"+encodeURIComponent(league)+"/athletes/"+encodeURIComponent(id)+"/gamelog?season="+season;
    const body=await fetchJson(u,{timeoutMs:4000});
    return body&&Array.isArray(body.events)&&body.events.length?{body,league,season}:null;
  }));
  return results.find(Boolean)||null;
}

export async function loadEspnLastFive({sport,name,team,market,line}){
  const cfg=SPORT_CONFIG[sport];
  if(!cfg) return null;
  const id=await athleteId(name,sport,team);
  if(!id) return {unavailable:true,reason:"athlete-not-found",source:"espn"};
  const log=await gamelogFor(id,sport);
  if(!log) return {unavailable:true,reason:"gamelog-not-found",source:"espn",espnId:id};
  const rows=(log.body.events||[]).map(e=>{
    const value=valueForEspnEvent(log.body,e,market,sport,name);
    return {
      date:e?.date||e?.gameDate||null,
      opponent:e?.opponent?.abbreviation||e?.opponent?.shortDisplayName||e?.opponent?.displayName||null,
      value,
      hit:value==null||line==null?null:value>Number(line),
    };
  }).filter(x=>x.value!=null).slice(0,5);
  if(!rows.length) return {unavailable:true,reason:"market-stat-not-found",source:"espn",espnId:id,league:log.league};
  return {
    source:"espn-gamelog",
    sourceLabel:"ESPN player gamelog",
    espnId:id,
    league:log.league,seasonKey:log.season,
    statField:market,
    last5:rows,
    season:{games:(log.body.events||[]).length,average:mean((log.body.events||[]).map(e=>valueForEspnEvent(log.body,e,market,sport,name))),recent5Average:mean(rows.map(r=>r.value))},
    role:null,matchup:null,advanced:null,
  };
}
