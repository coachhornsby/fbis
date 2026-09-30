import { loadKboAdvancedContext } from "./kboAdvanced.js";

/**
 * KBO-FBIS-v1 — independent Korean Baseball Organization research model.
 *
 * Uses official English KBO schedule/standings/team statistics only.
 * No sportsbook prices enter the projection.
 * Full-game + F5 are active research outputs. Pitcher props remain blocked
 * until an official probable-starter identity feed is resolved.
 */

export const KBO_FBIS_V1_ID = "KBO-FBIS-v1";
export const KBO_FBIS_V1_VERSION = "research-v1.1-official-kbo-advanced-starter";

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
    const teams=Object.keys(TEAM_NAMES)
      .map(k=>({k,pos:text.toUpperCase().indexOf(k)}))
      .filter(x=>x.pos>=0)
      .sort((a,b)=>a.pos-b.pos)
      .map(x=>x.k);
    if(teams.length<2) continue;
    const time=(text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)||[])[0]||"18:30";
    const away=teams[0], home=teams[1];
    // Never interpret the scheduled first-pitch time (e.g. 18:30) as a baseball score.
    // KBO result rows expose the score in a separate cell; exclude the time cell and
    // only accept a score-shaped cell that is distinct from the scheduled time.
    const scoreCell=c.find((x)=>{
      const s=String(x||"").trim();
      if(!/^\d{1,2}\s*:\s*\d{1,2}$/.test(s)) return false;
      return s.replace(/\s+/g,"")!==String(time).replace(/\s+/g,"");
    })||null;
    const score=scoreCell?scoreCell.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/):null;
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

function leagueAverages(teams={}){
  const vals=Object.values(teams);
  const avg=(key,def)=>{const xs=vals.map(x=>finite(x?.[key])).filter(x=>x!=null);return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:def;};
  return {
    runsPerGame:avg("runsPerGame",LEAGUE_RUNS),ops:avg("ops",0.75),obp:avg("obp",0.346),slg:avg("slg",0.404),
    kRate:avg("kRate",0.19),bbRate:avg("bbRate",0.09),era:avg("era",4.66),whip:avg("whip",1.43),oppAvg:avg("oppAvg",0.268),
    risp:avg("risp",0.276)
  };
}

function offenseFactor(team,lg){
  const ops=finite(team.ops), obp=finite(team.obp), slg=finite(team.slg), kr=finite(team.kRate), br=finite(team.bbRate), risp=finite(team.risp);
  let z=0,w=0;
  const add=(v,b,weight,scale)=>{if(v==null||b==null||!scale)return;z+=((v-b)/scale)*weight;w+=Math.abs(weight);};
  add(ops,lg.ops,.42,.06); add(obp,lg.obp,.16,.025); add(slg,lg.slg,.18,.045);
  add(kr,lg.kRate,-.10,.03); add(br,lg.bbRate,.06,.02); add(risp,lg.risp,.08,.035);
  return clamp(1+(w?z/w:0)*.10,.88,1.12);
}

function preventionFactor(team,lg){
  let z=0,w=0;
  const add=(v,b,weight,scale)=>{if(v==null||b==null||!scale)return;z+=((v-b)/scale)*weight;w+=Math.abs(weight);};
  add(finite(team.era),lg.era,.46,1.0); add(finite(team.whip),lg.whip,.24,.18); add(finite(team.oppAvg),lg.oppAvg,.18,.025);
  const qsRate=finite(team.qs)!=null&&finite(team.games)>0?team.qs/team.games:null;
  add(qsRate,.36,-.12,.12);
  return clamp(1+(w?z/w:0)*.09,.88,1.12);
}

function starterExpectedIp(starter){
  const pg=finite(starter?.pitchesPerGame), pip=finite(starter?.pitchesPerInning);
  if(pg!=null&&pip!=null&&pip>0) return clamp(pg/pip,3.5,7.2);
  if(finite(starter?.innings)!=null&&finite(starter?.games)>0) return clamp(starter.innings/starter.games,3.5,7.0);
  return null;
}

function starterRunAdjustment(starter,lg){
  if(!starter) return {runs:0,quality:null,expectedInnings:null};
  const expIp=starterExpectedIp(starter);
  let z=0,w=0;
  const add=(v,b,weight,scale)=>{if(v==null||b==null||!scale)return;z+=((v-b)/scale)*weight;w+=Math.abs(weight);};
  add(finite(starter.era),lg.era,.42,1.25);
  add(finite(starter.oppOps),.750,.24,.09);
  add(finite(starter.kPer9),7.6,-.18,2.0);
  add(finite(starter.bbPer9),3.0,.10,1.2);
  add(finite(starter.babip),.315,.06,.045);
  const quality=w?z/w:0;
  const workload=expIp==null?.58:clamp(expIp/6,.55,1.08);
  return {runs:clamp(quality*.55*workload,-.65,.65),quality:r2(quality),expectedInnings:expIp==null?null:r2(expIp)};
}

function pitcherK(starter,opp,lg){
  if(!starter) return null;
  const k9=finite(starter.kPer9), expIp=starterExpectedIp(starter);
  if(k9==null||expIp==null) return null;
  const oppK=finite(opp?.kRate), baseK=finite(lg?.kRate)??.19;
  const oppFactor=oppK!=null&&baseK>0?clamp(oppK/baseK,.82,1.18):1;
  return {
    projection:r1(k9/9*expIp*oppFactor),
    expectedInnings:r1(expIp),kPer9:r1(k9),opponentKRate:oppK,
    source:"KBO_OFFICIAL_K9_X_EXPECTED_IP_X_OPPONENT_K_RATE"
  };
}

export function projectKboGame(game,ctx={}){
  const h=ctx.teams?.[game.home.abbr], a=ctx.teams?.[game.away.abbr];
  if(!h||!a) return {ok:false,reason:"kbo-team-context-missing"};
  const lg=leagueAverages(ctx.teams);
  const advanced=ctx.advancedTeams||{};
  const ha={...h,...(advanced[game.home.abbr]||{})}, aa={...a,...(advanced[game.away.abbr]||{})};
  const starters=ctx.startersByGame?.[game.id]||null;
  const hs=starters?.home||null, as=starters?.away||null;

  const hBase=(finite(ha.runsPerGame)??lg.runsPerGame)*.58+(finite(aa.runsAllowedPerGame)??lg.runsPerGame)*.42;
  const aBase=(finite(aa.runsPerGame)??lg.runsPerGame)*.58+(finite(ha.runsAllowedPerGame)??lg.runsPerGame)*.42;
  const hForm=finite(ha.pct)!=null?clamp((ha.pct-.5)*.45,-.15,.15):0;
  const aForm=finite(aa.pct)!=null?clamp((aa.pct-.5)*.45,-.15,.15):0;
  const hAdv=offenseFactor(ha,lg)*preventionFactor(aa,lg);
  const aAdv=offenseFactor(aa,lg)*preventionFactor(ha,lg);
  const awayStarterAdj=starterRunAdjustment(as,lg); // affects home offense
  const homeStarterAdj=starterRunAdjustment(hs,lg); // affects away offense

  const homeRuns=clamp(hBase*hAdv+HOME_EDGE+hForm+awayStarterAdj.runs,1.8,8.8);
  const awayRuns=clamp(aBase*aAdv+aForm+homeStarterAdj.runs,1.8,8.8);
  // F5 emphasizes starter quality more heavily than the full-game projection.
  const f5Home=clamp(homeRuns*5/9+awayStarterAdj.runs*.42,0.8,5.4);
  const f5Away=clamp(awayRuns*5/9+homeStarterAdj.runs*.42,0.8,5.4);
  const starterResolved=Boolean(hs&&as);

  return {
    ok:true,modelId:KBO_FBIS_V1_ID,modelVersion:KBO_FBIS_V1_VERSION,maturity:"RESEARCH",
    independent:true,marketInformed:false,canQualify:false,canAuthorize:false,
    home:r2(homeRuns),away:r2(awayRuns),margin:r2(homeRuns-awayRuns),total:r2(homeRuns+awayRuns),
    f5:{home:r2(f5Home),away:r2(f5Away),margin:r2(f5Home-f5Away),total:r2(f5Home+f5Away),source:"KBO_FBIS_F5_ADVANCED_STARTER"},
    pitcherKs:{home:pitcherK(hs,aa,lg),away:pitcherK(as,ha,lg)},
    starters:{
      home:hs?{playerId:hs.playerId||null,name:hs.name||null,era:finite(hs.era),whip:finite(hs.whip),babip:finite(hs.babip),kPer9:finite(hs.kPer9),bbPer9:finite(hs.bbPer9),kBb:finite(hs.kBb),oppOps:finite(hs.oppOps),expectedInnings:homeStarterAdj.expectedInnings}:null,
      away:as?{playerId:as.playerId||null,name:as.name||null,era:finite(as.era),whip:finite(as.whip),babip:finite(as.babip),kPer9:finite(as.kPer9),bbPer9:finite(as.bbPer9),kBb:finite(as.kBb),oppOps:finite(as.oppOps),expectedInnings:awayStarterAdj.expectedInnings}:null,
      source:starters?.source||null
    },
    starterState:starterResolved?"OFFICIAL_KBO_STARTERS_RESOLVED":"PROVISIONAL_OFFICIAL_STARTER_UNRESOLVED",
    advanced:{
      home:{ops:finite(ha.ops),obp:finite(ha.obp),slg:finite(ha.slg),isop:finite(ha.isop),kRate:finite(ha.kRate),bbRate:finite(ha.bbRate),risp:finite(ha.risp),era:finite(ha.era),whip:finite(ha.whip),oppAvg:finite(ha.oppAvg)},
      away:{ops:finite(aa.ops),obp:finite(aa.obp),slg:finite(aa.slg),isop:finite(aa.isop),kRate:finite(aa.kRate),bbRate:finite(aa.bbRate),risp:finite(aa.risp),era:finite(aa.era),whip:finite(aa.whip),oppAvg:finite(aa.oppAvg)}
    },
    inputs:{home:ha,away:aa,league:lg,source:"Official KBO standings + team advanced batting/pitching + official GameCenter starter context"},
    note:"Independent KBO advanced research projection. Team OPS/OBP/SLG/K/BB/RISP and pitching ERA/WHIP/oppAVG/QS feed the score; official probable starters add ERA/OPS-against/K-BB/BABIP/workload. Sportsbook inputs are excluded."
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
  const advanced=await loadKboAdvancedContext(date,games,{fetcher}).catch(err=>({
    teams:{},pitchers:[],startersByGame:{},statsOk:false,starterGames:0,error:String(err?.message||err),marketInformed:false
  }));
  return {
    ok:games.length>0,games,teams,advancedTeams:advanced.teams||{},pitchers:advanced.pitchers||[],startersByGame:advanced.startersByGame||{},
    source:"KBO official English + Korean record/GameCenter",
    advancedMeta:{statsOk:Boolean(advanced.statsOk),starterGames:Number(advanced.starterGames||0),featureVersion:advanced.featureVersion||"kbo-advanced-v1",error:advanced.error||null},
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
      quality:{...(game.quality||{}),score:p.starterState==="OFFICIAL_KBO_STARTERS_RESOLVED"?86:78,state:p.starterState==="OFFICIAL_KBO_STARTERS_RESOLVED"?"COMPLETE":"PROVISIONAL",flags:[...new Set([...(game.quality?.flags||[]),...(p.starterState==="OFFICIAL_KBO_STARTERS_RESOLVED"?[]:["kbo_starter_feed_unresolved"])])]}
    };
  });
  return {games:next,meta:{modelId:KBO_FBIS_V1_ID,modelVersion:KBO_FBIS_V1_VERSION,projected,missing,advancedStats:Boolean(ctx.advancedMeta?.statsOk),starterGames:Number(ctx.advancedMeta?.starterGames||0),maturity:"RESEARCH",independent:true,marketInformed:false,canQualify:false,canAuthorize:false}};
}
