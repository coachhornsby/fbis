import { loadNflVerseFeatures } from "../lib/nflVerseFeed.js";
import { loadEspnLastFive } from "../lib/playerPropHistory.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"public, max-age=300, stale-while-revalidate=900",
      "access-control-allow-origin":"*",
    },
  });
}
function norm(v){
  return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function n(v){ if(v==null||v==="")return null; const x=Number(v); return Number.isFinite(x)?x:null; }
const NFL_RELEASE="https://github.com/nflverse/nflverse-data/releases/download";
const NFL_ABBR={JAC:"JAX",JAX:"JAX",LA:"LAR",LAR:"LAR",LV:"LV",OAK:"LV",WAS:"WAS",WSH:"WAS",SD:"LAC",LAC:"LAC",STL:"LAR"};
function canonNfl(v){const s=String(v||"").trim().toUpperCase();return NFL_ABBR[s]||s;}
function splitCsvLine(line){
  const out=[]; let cur="",quoted=false;
  for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i+=1;}else quoted=!quoted;}else if(ch===","&&!quoted){out.push(cur);cur="";}else cur+=ch;}
  out.push(cur);return out;
}
function parseCsv(text=""){
  const lines=String(text).replace(/^\uFEFF/,"").trim().split(/\r?\n/).filter(Boolean);
  if(lines.length<2)return[];
  const headers=splitCsvLine(lines[0]);
  return lines.slice(1).map(line=>{const cells=splitCsvLine(line);return Object.fromEntries(headers.map((h,i)=>[h,cells[i]??""]));});
}
async function fetchNflPlayerSeason(year){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort("nfl-player-detail-timeout"),3500);
  try{
    const url=NFL_RELEASE+"/stats_player/stats_player_week_"+year+".csv";
    const res=await fetch(url,{headers:{Accept:"text/csv,*/*","User-Agent":"FBIS/2.0"},signal:controller.signal});
    if(!res.ok)return[];
    return parseCsv(await res.text());
  }catch{return[];}finally{clearTimeout(timer);}
}
async function recentNflGames(name,team,field){
  const y=new Date().getFullYear();
  const data=await Promise.all([fetchNflPlayerSeason(y),fetchNflPlayerSeason(y-1)]);
  const wanted=norm(name),t=canonNfl(team);
  const rows=[...data[0],...data[1]].filter(r=>{
    const nm=norm(r.player_display_name||r.player_name||r.player_name_short||"");
    return nm===wanted&&(!t||canonNfl(r.team)===t)&&String(r.season_type||"REG").toUpperCase()==="REG";
  }).sort((x,y)=>(Number(y.season||0)-Number(x.season||0))||(Number(y.week||0)-Number(x.week||0)));
  return rows.slice(0,5).map(r=>({season:n(r.season),week:n(r.week),date:r.gameday||r.game_date||r.date||null,opponent:canonNfl(r.opponent_team),value:n(r[field])??0}));
}
const NFL_MARKET_FIELD={
  completions:"completions",passing_attempts:"attempts",passing_yards:"passing_yards",
  passing_tds:"passing_tds",interceptions:"interceptions",rushing_attempts:"carries",
  rushing_yards:"rushing_yards",rushing_tds:"rushing_tds",receptions:"receptions",
  receiving_yards:"receiving_yards",receiving_tds:"receiving_tds",rec_targets:"targets",
  total_tds:"total_tds",
};
function nflPlayer(feed,name,team){
  const wanted=norm(name),t=String(team||"").toUpperCase();
  const pool=t&&Array.isArray(feed?.playersByTeam?.[t])?feed.playersByTeam[t]
    :Object.values(feed?.playersByTeam||{}).flat();
  return pool.find(p=>norm(p?.name)===wanted)
    || pool.find(p=>norm(p?.name).includes(wanted)||wanted.includes(norm(p?.name)))
    || null;
}
function gameStat(game,field){
  const v=n(game?.stats?.[field]);
  return v==null?null:v;
}
async function nflDetail(context,{name,team,opponent,market,line}){
  const feed=await loadNflVerseFeatures(context.env||{},{forceNetwork:false});
  const p=nflPlayer(feed,name,team);
  const field=NFL_MARKET_FIELD[market]||null;
  if(!field)return null;
  let last5=(p?.recentGames||[]).slice(0,5).map(g=>({season:g.season??null,week:g.week??null,date:g.date??null,opponent:g.opponent||null,value:gameStat(g,field),hit:line==null?null:gameStat(g,field)>Number(line)})).filter(g=>g.value!=null);
  if(last5.length<3){
    const direct=await recentNflGames(name,team,field);
    if(direct.length)last5=direct.map(g=>({...g,hit:line==null?null:Number(g.value)>Number(line)}));
  }
  const position=String(p?.position||"").toUpperCase();
  const opp=canonNfl(opponent);
  const defense=opp&&position?feed?.byTeam?.[opp]?.positionDefense?.[position]?.[field]:null;
  const league=position?feed?.leaguePositionDefense?.[position]?.[field]:null;
  const currentSeason=last5.filter(g=>Number(g.season)===new Date().getFullYear()).map(g=>Number(g.value)).filter(Number.isFinite);
  const seasonAvg=p?.seasonAvg?.[field]!=null?n(p.seasonAvg[field]):(currentSeason.length?currentSeason.reduce((s,v)=>s+v,0)/currentSeason.length:null);
  const recent5Avg=last5.length?last5.reduce((s,g)=>s+(Number(g.value)||0),0)/last5.length:null;
  return {source:"nflverse",sourceLabel:"nflverse weekly player stats",statField:field,last5,season:{games:n(p?.games)??currentSeason.length,average:seasonAvg,recent5Average:recent5Avg},role:{position:position||null,snapShare:n(p?.snapShare),trackingGames:n(p?.trackingGames),snapGames:n(p?.snapGames)},matchup:{opponent:opp||null,opponentAllowed:defense==null?null:Number(defense),leagueAverageAllowed:league==null?null:Number(league),matchupFactor:defense!=null&&league?Number(defense)/Number(league):null},advanced:p?.ngs||null};
}
async function mlbPerson(name){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort("mlb-player-search-timeout"),3500);
  try{
    const r=await fetch("https://statsapi.mlb.com/api/v1/people/search?active=true&sportIds=1&names="+encodeURIComponent(name),{
      headers:{accept:"application/json","user-agent":"FBIS/1.0"},signal:controller.signal
    });
    if(!r.ok)return null;
    const body=await r.json().catch(()=>({}));
    const wanted=norm(name);
    return (body?.people||[]).find(x=>norm(x?.fullName)===wanted)||(body?.people||[])[0]||null;
  }catch{return null;}finally{clearTimeout(timer);}
}
function mlbGroup(market){
  return ["strikeouts","pitching_outs","earned_runs","walks_allowed","hits_allowed"].includes(market)?"pitching":"hitting";
}
function mlbValue(stats,market){
  const s=stats||{};
  if(market==="strikeouts")return n(s.strikeOuts);
  if(market==="pitching_outs")return n(s.outs);
  if(market==="earned_runs")return n(s.earnedRuns);
  if(market==="walks_allowed")return n(s.baseOnBalls);
  if(market==="hits_allowed")return n(s.hits);
  if(market==="hits")return n(s.hits);
  if(market==="runs")return n(s.runs);
  if(market==="rbis")return n(s.rbi);
  if(market==="total_bases")return n(s.totalBases);
  if(market==="hits_runs_rbis"){
    const h=n(s.hits)||0,r=n(s.runs)||0,rbi=n(s.rbi)||0; return h+r+rbi;
  }
  if(market==="home_runs")return n(s.homeRuns);
  if(market==="doubles")return n(s.doubles);
  if(market==="triples")return n(s.triples);
  if(market==="walks")return n(s.baseOnBalls);
  if(market==="stolen_bases")return n(s.stolenBases);
  if(market==="plate_appearances")return n(s.plateAppearances);
  if(market==="batters_faced")return n(s.battersFaced);
  if(market==="pitches_thrown")return n(s.numberOfPitches ?? s.pitchesThrown);
  if(market==="singles"){
    const h=n(s.hits),d=n(s.doubles)||0,t=n(s.triples)||0,hr=n(s.homeRuns)||0;
    return h==null?null:Math.max(0,h-d-t-hr);
  }
  return null;
}
async function mlbDetail({name,market,line}){
  const person=await mlbPerson(name);
  if(!person?.id)return null;
  const season=new Date().getFullYear();
  const group=mlbGroup(market);
  const qs=new URLSearchParams({stats:"gameLog,season",group,season:String(season)});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort("mlb-player-stats-timeout"),4500);
  let body={};
  try{
    const r=await fetch("https://statsapi.mlb.com/api/v1/people/"+person.id+"/stats?"+qs.toString(),{
      headers:{accept:"application/json","user-agent":"FBIS/1.0"},signal:controller.signal
    });
    if(!r.ok)return null;
    body=await r.json().catch(()=>({}));
  }catch{return null;}finally{clearTimeout(timer);}
  let games=[],seasonStat=null;
  for(const block of body?.stats||[]){
    const type=String(block?.type?.displayName||block?.type||"").toLowerCase();
    const splits=Array.isArray(block?.splits)?block.splits:[];
    if(type.includes("game")) games=splits;
    if(type.includes("season")) seasonStat=splits[0]?.stat||null;
  }
  const last5=games.slice(-5).reverse().map(g=>{
    const value=mlbValue(g?.stat,market);
    return {
      date:g?.date||null,opponent:g?.opponent?.abbreviation||g?.opponent?.name||null,
      value,hit:line==null||value==null?null:value>Number(line),
    };
  });
  const values=games.map(g=>mlbValue(g?.stat,market)).filter(v=>v!=null);
  const avg=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const advanced=group==="pitching"&&seasonStat?{
    era:n(seasonStat.era),
    whip:n(seasonStat.whip),
    strikeoutsPer9:n(seasonStat.strikeoutsPer9Inn),
    walksPer9:n(seasonStat.walksPer9Inn),
    hitsPer9:n(seasonStat.hitsPer9Inn),
    inningsPitched:n(seasonStat.inningsPitched),
    gamesStarted:n(seasonStat.gamesStarted),
    pitchesThrown:n(seasonStat.numberOfPitches ?? seasonStat.pitchesThrown),
  }:null;
  return {
    source:"mlb-stats-api",sourceLabel:"MLB Stats API",
    statField:market,last5,
    season:{games:values.length,average:avg,total:mlbValue(seasonStat,market)},
    role:null,matchup:null,advanced,
  };
}
async function calibration(db,sport,market,modelVersion){
  if(!db)return null;
  try{
    return await db.prepare(
      `SELECT graded,decisions,wins,hit_rate,projection_bias,mae,rmse,avg_projection_edge,avg_line_clv
         FROM player_prop_calibration
        WHERE lower(sport)=? AND market=? AND model_version=?
        ORDER BY graded DESC LIMIT 1`
    ).bind(String(sport||"").toLowerCase(),market,modelVersion||"").first();
  }catch{return null;}
}
export async function onRequestGet(context){
  const url=new URL(context.request.url);
  const sport=String(url.searchParams.get("sport")||"").toLowerCase();
  const name=String(url.searchParams.get("name")||"").trim();
  const team=String(url.searchParams.get("team")||"").trim();
  const opponent=String(url.searchParams.get("opponent")||"").trim();
  const market=String(url.searchParams.get("market")||"").trim().toLowerCase();
  const line=n(url.searchParams.get("line"));
  const modelVersion=String(url.searchParams.get("modelVersion")||"").trim();
  if(!sport||!name||!market)return json({ok:false,error:"sport, name and market required"},400);
  try{
    let detail=null;
    if(sport==="nfl"){
      detail=await nflDetail(context,{name,team,opponent,market,line});
      if(!detail || detail?.unavailable || !detail?.last5?.length) {
        const fallback=await loadEspnLastFive({sport,name,team,market,line});
        if(fallback && !fallback.unavailable) detail=fallback;
      }
    } else if(sport==="mlb") {
      detail=await mlbDetail({name,market,line});
      if(!detail || !detail.last5?.some(x=>x.value!=null)) {
        const fallback=await loadEspnLastFive({sport,name,team,market,line});
        if(fallback && !fallback.unavailable) detail=fallback;
      }
    } else {
      detail=await loadEspnLastFive({sport,name,team,market,line});
    }
    const cal=await calibration(context.env?.DB,sport,market,modelVersion);
    return json({ok:true,sport,name,market,line,detail,calibration:cal||null});
  }catch(error){
    return json({ok:false,error:String(error?.message||error)},500);
  }
}
