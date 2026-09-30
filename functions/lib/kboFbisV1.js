/**
 * KBO-FBIS-v1 — independent Korean Baseball Organization research model.
 *
 * Uses official English KBO schedule/standings/team statistics only.
 * No sportsbook prices enter the projection.
 * Full-game + F5 are active research outputs. Pitcher props remain blocked
 * until an official probable-starter identity feed is resolved.
 */

export const KBO_FBIS_V1_ID = "KBO-FBIS-v1";
export const KBO_FBIS_V1_VERSION = "research-v1.0-official-kbo";

const TEAM_NAMES = Object.freeze({
  NC:"NC Dinos", DOOSAN:"Doosan Bears", KT:"KT Wiz", KIA:"KIA Tigers",
  HANWHA:"Hanwha Eagles", SAMSUNG:"Samsung Lions", LG:"LG Twins",
  SSG:"SSG Landers", LOTTE:"Lotte Giants", KIWOOM:"Kiwoom Heroes"
});
const LEAGUE_RUNS = 5.0;
const HOME_EDGE = 0.15;

function finite(v){ if(v==null||v==="") return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function r1(v){ return Math.round(Number(v)*10)/10; }
function r2(v){ return Math.round(Number(v)*100)/100; }
function htmlText(s=""){ return String(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?\s*>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g," ").trim(); }
function cells(rowHtml=""){ return [...String(rowHtml).matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>htmlText(m[1])); }
function rows(html=""){ return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>cells(m[1])); }
function kstIso(date,time="18:30"){
  const [y,m,d]=String(date).split("-").map(Number);
  const [hh,mm]=String(time).split(":").map(Number);
  return new Date(Date.UTC(y,m-1,d,hh-9,mm)).toISOString();
}
function normTeam(v=""){
  const s=String(v).toUpperCase().replace(/\s+/g," ").trim();
  for(const key of Object.keys(TEAM_NAMES)){
    if(s===key || s.includes(key)) return key;
  }
  return null;
}

export function parseKboSchedule(html="",date=""){
  const [y,m,d]=String(date).split("-").map(Number);
  const needle=`${String(m).padStart(2,"0")}.${String(d).padStart(2,"0")}`;
  const out=[];
  let active=false;
  for(const c of rows(html)){
    if(!c.length) continue;
    const first=String(c[0]||"");
    const dm=first.match(/(\d{2})\.(\d{2})/);
    if(dm) active=`${dm[1]}.${dm[2]}`===needle;
    if(!active) continue;

    // KBO table rows can collapse columns differently after the first game of a date.
    const text=c.join(" ");
    const teams=Object.keys(TEAM_NAMES).filter(k=>new RegExp(`\\b${k}\\b`,"i").test(text));
    if(teams.length<2) continue;
    const time=(text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)||[])[0]||"18:30";
    const away=teams[0], home=teams[1];
    const score=text.match(/\b(\d{1,2})\s*:\s*(\d{1,2})\b/);
    const venue=c.find(x=>/JAMSIL|DAEGU|SUWON|GWANGJU|MUNHAK|SAJIK|CHANGWON|DAEJEON|GOCHEOK/i.test(String(x)))||"";
    out.push({
      id:`KBO-${String(date).replaceAll("-","")}-${away}-${home}`,
      sport:"kbo",start:kstIso(date,time),
      status:{state:score?"post":"pre",detail:score?"Final":"Scheduled",completed:Boolean(score),live:false},
      away:{abbr:away,name:TEAM_NAMES[away],score:score?finite(score[1]):null,logo:""},
      home:{abbr:home,name:TEAM_NAMES[home],score:score?finite(score[2]):null,logo:""},
      venue,
      odds:{spread:null,total:null,homeMl:null,awayMl:null,book:"MARKET_UNRESOLVED"},
      projectionKind:"UNAVAILABLE",projHomeScore:null,projAwayScore:null,
      source:"KBO_OFFICIAL_SCHEDULE"
    });
  }
  const seen=new Set();
  return out.filter(g=>{if(seen.has(g.id))return false;seen.add(g.id);return true;});
}

export function parseKboStandings(html=""){
  const out={};
  for(const c of rows(html)){
    if(c.length<11) continue;
    const team=normTeam(c[1]);
    if(!team) continue;
    const games=finite(c[2]), wins=finite(c[3]), losses=finite(c[4]), draws=finite(c[5]), pct=finite(c[6]);
    out[team]={team,games,wins,losses,draws,pct,home:c[9]||null,away:c[10]||null};
  }
  // The official standings page also contains team AVG/ERA/RUNS/RUNS ALLOWED/HR.
  for(const c of rows(html)){
    if(c.length<7) continue;
    const team=normTeam(c[1]);
    if(!team||!out[team]) continue;
    const avg=finite(c[2]), era=finite(c[3]), runs=finite(c[4]), runsAllowed=finite(c[5]), hr=finite(c[6]);
    if(avg!=null && era!=null && runs!=null){
      Object.assign(out[team],{
        avg,era,runs,runsAllowed,hr,
        runsPerGame:out[team].games>0?runs/out[team].games:null,
        runsAllowedPerGame:out[team].games>0?runsAllowed/out[team].games:null
      });
    }
  }
  return out;
}

export function projectKboGame(game,ctx={}){
  const h=ctx.teams?.[game.home.abbr], a=ctx.teams?.[game.away.abbr];
  if(!h||!a) return {ok:false,reason:"kbo-team-context-missing"};
  const hOff=finite(h.runsPerGame)??LEAGUE_RUNS;
  const aOff=finite(a.runsPerGame)??LEAGUE_RUNS;
  const hDef=finite(h.runsAllowedPerGame)??LEAGUE_RUNS;
  const aDef=finite(a.runsAllowedPerGame)??LEAGUE_RUNS;
  const hForm=finite(h.pct)!=null?clamp((h.pct-.5)*0.55,-.18,.18):0;
  const aForm=finite(a.pct)!=null?clamp((a.pct-.5)*0.55,-.18,.18):0;
  const homeRuns=clamp(hOff*.58+aDef*.42+HOME_EDGE+hForm,2.1,8.5);
  const awayRuns=clamp(aOff*.58+hDef*.42+aForm,2.1,8.5);
  const f5Home=clamp(homeRuns*5/9,1.0,5.0);
  const f5Away=clamp(awayRuns*5/9,1.0,5.0);
  return {
    ok:true,modelId:KBO_FBIS_V1_ID,modelVersion:KBO_FBIS_V1_VERSION,maturity:"RESEARCH",
    independent:true,marketInformed:false,canQualify:false,canAuthorize:false,
    home:r2(homeRuns),away:r2(awayRuns),margin:r2(homeRuns-awayRuns),total:r2(homeRuns+awayRuns),
    f5:{home:r2(f5Home),away:r2(f5Away),margin:r2(f5Home-f5Away),total:r2(f5Home+f5Away),source:"KBO_FBIS_F5"},
    pitcherKs:{home:null,away:null},
    starterState:"BLOCKED_OFFICIAL_PROBABLE_STARTER_FEED",
    inputs:{home:h,away:a,source:"Official KBO standings/team run environment"},
    note:"Independent KBO research projection from official current-season team runs, runs allowed, record and home edge. Starter/prop layer remains blocked until official starter identity is resolved."
  };
}

async function fetchText(url,fetcher=fetch){
  const res=await fetcher(url,{headers:{"user-agent":"FBIS/1.0","accept":"text/html,*/*"}});
  if(!res.ok) throw new Error(`KBO_HTTP_${res.status}`);
  return res.text();
}

export async function loadKboContext(date,{fetcher=fetch}={}){
  const [scheduleHtml,standingsHtml]=await Promise.all([
    fetchText("https://eng.koreabaseball.com/Schedule/DailySchedule.aspx",fetcher),
    fetchText("https://eng.koreabaseball.com/Standings/TeamStandings.aspx",fetcher)
  ]);
  const games=parseKboSchedule(scheduleHtml,date);
  const teams=parseKboStandings(standingsHtml);
  return {
    ok:games.length>0,games,teams,source:"KBO official English site",
    marketInformed:false,canQualify:false,canAuthorize:false,
    timezone:"Asia/Seoul"
  };
}

export function attachKboFbisV1(games=[],ctx={}){
  let projected=0,missing=0;
  const next=(games||[]).map(game=>{
    const p=projectKboGame(game,ctx);
    if(p.ok) projected++; else missing++;
    if(!p.ok) return {...game,kboV1:p};
    return {
      ...game,kboV1:p,
      researchProjection:{...p,projectionKind:"FBIS",generatedAt:new Date().toISOString()},
      projectionKind:"FBIS",projHomeScore:p.home,projAwayScore:p.away,
      model:{...(game.model||{}),projectionKind:"FBIS",maturity:"RESEARCH",projHome:p.home,projAway:p.away,projMargin:p.margin,projTotal:p.total,canQualify:false,canAuthorize:false},
      modelVersion:`${KBO_FBIS_V1_ID}@${KBO_FBIS_V1_VERSION}`,
      challengers:{...(game.challengers||{}),[KBO_FBIS_V1_ID]:p},
      quality:{...(game.quality||{}),score:72,state:"PROVISIONAL",flags:[...new Set([...(game.quality?.flags||[]),"kbo_starter_feed_unresolved"])]}
    };
  });
  return {games:next,meta:{modelId:KBO_FBIS_V1_ID,modelVersion:KBO_FBIS_V1_VERSION,projected,missing,maturity:"RESEARCH",independent:true,marketInformed:false,canQualify:false,canAuthorize:false}};
}
