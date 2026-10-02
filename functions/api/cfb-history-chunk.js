import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { cfbdGet } from "../lib/collegeApi.js";

const ALLOWED_SEASON_TYPES=new Set(["regular","postseason"]);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const num=(v)=>{const n=Number(v);return Number.isFinite(n)?n:null;};
const text=(v)=>v==null?null:String(v);
const gameId=(r)=>String(r?.gameId??r?.game_id??r?.id??"");
const teamName=(r)=>r?.team??r?.offense??r?.school??null;

function envFrom(context){
  return {CFBD_API_KEY:context.env.CFBD_API_KEY,caches:caches.default,DB:context.env.DB};
}
async function get(path,env,query){
  const r=await cfbdGet(path,env,{query,skipCache:true});
  await sleep(30);
  return r.ok?(Array.isArray(r.data)?r.data:(r.data?[r.data]:[])):[];
}
function mean(xs){const a=xs.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;}
function add(map,key,seed){if(!map.has(key))map.set(key,seed());return map.get(key);}
function classifyPlay(r){
  const s=String(r?.playType||r?.play_type||r?.playText||"").toLowerCase();
  if(/pass|sack/.test(s))return "pass";
  if(/rush|run/.test(s)&&!/punt|return/.test(s))return "rush";
  return "other";
}
function aggregatePlays(rows=[]){
  const m=new Map();
  for(const r of rows){
    const gid=gameId(r),team=r.offense||r.posteam||null;if(!gid||!team)continue;
    const x=add(m,gid+"|"+team,()=>({gameId:gid,team,plays:0,ppa:[],earlyPpa:[],passPpa:[],rushPpa:[],explosive:0,scoring:0}));
    const p=num(r.ppa),down=num(r.down),yg=num(r.yardsGained??r.yards_gained),kind=classifyPlay(r);
    x.plays++; if(p!=null)x.ppa.push(p);if(p!=null&&down!=null&&down<=2)x.earlyPpa.push(p);
    if(kind==="pass"&&p!=null)x.passPpa.push(p);if(kind==="rush"&&p!=null)x.rushPpa.push(p);
    if((kind==="pass"&&yg!=null&&yg>=20)||(kind==="rush"&&yg!=null&&yg>=10))x.explosive++;
    if(r.scoring===true||r.scoring===1)x.scoring++;
  }
  return [...m.values()].map(x=>({gameId:x.gameId,team:x.team,plays:x.plays,ppaPerPlay:mean(x.ppa),earlyDownPpa:mean(x.earlyPpa),passPpa:mean(x.passPpa),rushPpa:mean(x.rushPpa),explosiveRate:x.plays?x.explosive/x.plays:null,scoringPlayRate:x.plays?x.scoring/x.plays:null}));
}
function aggregateDrives(rows=[]){
  const m=new Map();
  for(const r of rows){
    const gid=gameId(r),team=r.offense||r.offenseTeam||r.team||null;if(!gid||!team)continue;
    const x=add(m,gid+"|"+team,()=>({gameId:gid,team,drives:0,yards:0,plays:0,points:0,scoringOpps:0}));
    x.drives++;x.yards+=num(r.yards)||0;x.plays+=num(r.plays??r.playCount)||0;
    x.points+=num(r.points??r.pointsGained)||0;
    if(r.scoringOpportunity===true||r.scoring_opportunity===true)x.scoringOpps++;
  }
  return [...m.values()].map(x=>({...x,yardsPerDrive:x.drives?x.yards/x.drives:null,playsPerDrive:x.drives?x.plays/x.drives:null,pointsPerDrive:x.drives?x.points/x.drives:null}));
}
function compactPpa(rows=[]){return rows.map(r=>({gameId:gameId(r),team:teamName(r),opponent:r.opponent||null,offense:r.offense||null,defense:r.defense||null,season:r.season??null,week:r.week??null,seasonType:r.seasonType??r.season_type??null})).map((x,i)=>({...x,raw:rows[i]}));}
function compactAdvanced(rows=[]){return rows.map(r=>({gameId:gameId(r),team:teamName(r),opponent:r.opponent||null,season:r.season??null,week:r.week??null,seasonType:r.seasonType??r.season_type??null,raw:r}));}
function flattenLines(rows=[]){
  const out=[];
  for(const g of rows){
    const gid=gameId(g);
    const nested=Array.isArray(g.lines)?g.lines:[g];
    for(const l of nested){
      const provider=l.provider?.name??l.provider??l.book??l.sportsbook??null;
      out.push({
        gameId:gid||gameId(l),
        provider,
        spread:num(l.spread??l.pointSpread??l.line),
        overUnder:num(l.overUnder??l.total??l.over_under),
        homeMoneyline:num(l.homeMoneyline??l.homeMoneyLine??l.home_ml),
        awayMoneyline:num(l.awayMoneyline??l.awayMoneyLine??l.away_ml),
        openingSpread:num(l.openingSpread??l.openSpread),
        openingOverUnder:num(l.openingOverUnder??l.openingTotal??l.openTotal),
        formattedSpread:text(l.formattedSpread),
        homeTeam:g.homeTeam??g.home_team??l.homeTeam??null,
        awayTeam:g.awayTeam??g.away_team??l.awayTeam??null,
        raw:l,
      });
    }
  }
  return out.filter(x=>x.gameId);
}
function compactGames(rows=[]){return rows.map(g=>({
  gameId:gameId(g),season:g.season??null,week:g.week??null,seasonType:g.seasonType??g.season_type??null,
  startDate:g.startDate??g.start_date??g.startTime??null,neutralSite:Boolean(g.neutralSite??g.neutral_site),
  conferenceGame:Boolean(g.conferenceGame??g.conference_game),
  homeTeam:g.homeTeam??g.home_team??null,awayTeam:g.awayTeam??g.away_team??null,
  homeConference:g.homeConference??g.home_conference??null,awayConference:g.awayConference??g.away_conference??null,
  homeClassification:g.homeClassification??g.home_classification??null,awayClassification:g.awayClassification??g.away_classification??null,
  homePoints:num(g.homePoints??g.home_points??g.homeScore),awayPoints:num(g.awayPoints??g.away_points??g.awayScore),
  venue:g.venue??null,venueId:g.venueId??g.venue_id??null
}));}

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return new Response(JSON.stringify(unauthorizedBody()),{status:401,headers:{"content-type":"application/json"}});
  const u=new URL(context.request.url);
  const year=Number(u.searchParams.get("year"));
  const weekStart=Math.max(0,Number(u.searchParams.get("weekStart")??1));
  const weekEnd=Math.min(25,Number(u.searchParams.get("weekEnd")??weekStart));
  const seasonType=String(u.searchParams.get("seasonType")||"regular");
  if(!Number.isFinite(year)||year<1900||year>2100||weekEnd<weekStart||!ALLOWED_SEASON_TYPES.has(seasonType)){
    return new Response(JSON.stringify({ok:false,error:"invalid-parameters"}),{status:400,headers:{"content-type":"application/json"}});
  }
  const env=envFrom(context);
  try{
    const [allGames,allLines,core,sp,fpi,srs,talent,returning,recruiting,weather]=await Promise.all([
      get("/games",env,{year,seasonType}),
      get("/lines",env,{year,seasonType}),
      get("/ratings/core",env,{year}),
      get("/ratings/sp",env,{year:year-1}),
      get("/ratings/fpi",env,{year:year-1}),
      get("/ratings/srs/expanded",env,{year:year-1}),
      get("/talent",env,{year}),
      get("/player/returning",env,{year}),
      get("/recruiting/teams",env,{year:year-1}),
      get("/games/weather",env,{year,seasonType}),
    ]);
    const games=compactGames(allGames).filter(g=>Number(g.week)>=weekStart&&Number(g.week)<=weekEnd);
    const ids=new Set(games.map(g=>g.gameId));
    const lines=flattenLines(allLines).filter(x=>ids.has(x.gameId));
    const weekRows={ppa:[],advanced:[],plays:[],drives:[],players:[],elo:[]};
    for(let week=weekStart;week<=weekEnd;week++){
      const [ppa,advanced,plays,drives,players,elo]=await Promise.all([
        get("/ppa/games",env,{year,week,seasonType}),
        get("/stats/game/advanced",env,{year,week,seasonType}),
        get("/plays",env,{year,week,seasonType,classification:"fbs"}),
        get("/drives",env,{year,week,seasonType}),
        get("/games/players",env,{year,week,seasonType}),
        get("/ratings/elo",env,{year,week:Math.max(1,week-1),seasonType:"regular"}),
      ]);
      weekRows.ppa.push(...ppa);weekRows.advanced.push(...advanced);weekRows.plays.push(...plays);weekRows.drives.push(...drives);weekRows.players.push(...players);weekRows.elo.push(...elo.map(x=>({...x,sourceWeek:Math.max(1,week-1),targetWeek:week})));
    }
    const payload={ok:true,generatedAt:new Date().toISOString(),year,weekStart,weekEnd,seasonType,
      games,lines,ppa:compactPpa(weekRows.ppa),advanced:compactAdvanced(weekRows.advanced),
      playAggregates:aggregatePlays(weekRows.plays),driveAggregates:aggregateDrives(weekRows.drives),
      players:weekRows.players,elo:weekRows.elo,core,
      prior:{sp,fpi,srs,recruiting},preseason:{talent,returning},weather,
      counts:{games:games.length,lines:lines.length,ppa:weekRows.ppa.length,advanced:weekRows.advanced.length,plays:weekRows.plays.length,drives:weekRows.drives.length,players:weekRows.players.length,elo:weekRows.elo.length,core:core.length,priorSp:sp.length,priorFpi:fpi.length,priorSrs:srs.length,talent:talent.length,returning:returning.length,recruiting:recruiting.length,weather:weather.length}};
    return new Response(JSON.stringify(payload),{status:200,headers:{"content-type":"application/json","cache-control":"no-store"}});
  }catch(err){
    return new Response(JSON.stringify({ok:false,error:String(err?.message||err),year,weekStart,weekEnd,seasonType}),{status:502,headers:{"content-type":"application/json"}});
  }
}
