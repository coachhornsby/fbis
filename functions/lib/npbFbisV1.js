/**
 * NPB-FBIS-v1 — independent Nippon Professional Baseball research model.
 *
 * Official NPB sources only. No sportsbook input enters projections.
 * Outputs full-game score, F5 score and probable-starter strikeout projections.
 * Research-only until true walk-forward validation earns authority.
 */

export const NPB_FBIS_V1_ID = "NPB-FBIS-v1";
export const NPB_FBIS_V1_VERSION = "research-v1.0.1-official-npb-datafix";

const TEAM = Object.freeze({
  t:{abbr:"HAN",name:"Hanshin Tigers",ja:["阪神","阪神タイガース"],stats:"t"},
  db:{abbr:"DEN",name:"YOKOHAMA DeNA BAYSTARS",ja:["DeNA","横浜DeNA","横浜ＤｅＮＡ"],stats:"db"},
  g:{abbr:"YOM",name:"Yomiuri Giants",ja:["巨人","読売"],stats:"g"},
  d:{abbr:"CHU",name:"Chunichi Dragons",ja:["中日","中日ドラゴンズ"],stats:"d"},
  c:{abbr:"HIR",name:"Hiroshima Toyo Carp",ja:["広島","広島東洋"],stats:"c"},
  s:{abbr:"YAK",name:"Tokyo Yakult Swallows",ja:["ヤクルト","東京ヤクルト"],stats:"s"},
  h:{abbr:"SBH",name:"Fukuoka SoftBank Hawks",ja:["ソフトバンク","福岡ソフトバンク"],stats:"h"},
  f:{abbr:"HAM",name:"Hokkaido Nippon-Ham Fighters",ja:["日本ハム","北海道日本ハム"],stats:"f"},
  b:{abbr:"ORI",name:"ORIX Buffaloes",ja:["オリックス"],stats:"b"},
  e:{abbr:"RAK",name:"Tohoku Rakuten Golden Eagles",ja:["楽天","東北楽天"],stats:"e"},
  l:{abbr:"SEI",name:"Saitama Seibu Lions",ja:["西武","埼玉西武"],stats:"l"},
  m:{abbr:"LOT",name:"Chiba Lotte Marines",ja:["ロッテ","千葉ロッテ"],stats:"m"},
});
const BY_ABBR = Object.fromEntries(Object.values(TEAM).map(x=>[x.abbr,x]));
const LEAGUE_RUNS = 3.55;
const HOME_EDGE = 0.10;

function finite(v){ if(v==null||v==="") return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function r1(v){ return Math.round(Number(v)*10)/10; }
function r2(v){ return Math.round(Number(v)*100)/100; }
function htmlText(s=""){ return String(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?\s*>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g," ").trim(); }
function cells(rowHtml=""){ return [...String(rowHtml).matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>htmlText(m[1])); }
function rows(html=""){ return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>({html:m[1],cells:cells(m[1])})); }
function ip(v){
  const s=String(v??"").trim(); if(!s) return null;
  if(!s.includes(".")) return finite(s);
  const [a,b]=s.split("."); const frac=b==="1"?1/3:b==="2"?2/3:finite("0."+b)||0;
  return finite(a)+frac;
}
function seasonFromDate(date){ return Number(String(date||"").slice(0,4)) || new Date().getUTCFullYear(); }

export function parseNpbPitchingPage(html=""){
  const out=[];
  for(const row of rows(html)){
    const c=row.cells;
    if(c.length<24 || !c[0] || c[0]==="Pitcher") continue;
    const playerHref=[...row.html.matchAll(/href=["'][^"']*\/players\/(\d+)\.html["']/gi)][0]?.[1]||null;
    const innings=ip(c[12]);
    const so=finite(c[18]), bb=finite(c[15]), hr=finite(c[14]), er=finite(c[22]), g=finite(c[1]);
    if(innings==null||g==null) continue;
    out.push({
      playerId:playerHref,name:c[0].replace(/^\*|^\+/,"").trim(),games:g,
      innings,so,bb,hr,er,era:finite(c[23]),
      kPer9:innings>0&&so!=null?so*9/innings:null,
      bbPer9:innings>0&&bb!=null?bb*9/innings:null,
      hrPer9:innings>0&&hr!=null?hr*9/innings:null,
      ipPerGame:g>0?innings/g:null,
    });
  }
  return out;
}

export function parseNpbBattingPage(html=""){
  const out=[];
  for(const row of rows(html)){
    const c=row.cells;
    if(c.length<23 || !c[0] || c[0]==="Player") continue;
    const playerHref=[...row.html.matchAll(/href=["'][^"']*\/players\/(\d+)\.html["']/gi)][0]?.[1]||null;
    const games=finite(c[1]), pa=finite(c[2]), runs=finite(c[4]), hr=finite(c[8]), bb=finite(c[15]), so=finite(c[18]);
    if(pa==null) continue;
    out.push({playerId:playerHref,name:c[0].replace(/^\*|^\+/,"").trim(),games,pa,runs,hr,bb,so,avg:finite(c[20]),slg:finite(c[21]),obp:finite(c[22])});
  }
  return out;
}

function teamFromJa(text){
  for(const t of Object.values(TEAM)){
    if(t.ja.some(a=>String(text).includes(a))) return t;
  }
  return null;
}

export function parseNpbScheduleMonth(html="",date=""){
  const [y,m,d]=String(date).split("-").map(Number);
  const needle=`${m}/${d}`;
  const out=[];
  let active=false;
  for(const row of rows(html)){
    const txt=row.cells.join(" ");
    const dateMatch=txt.match(/(\d{1,2})\/(\d{1,2})/);
    if(dateMatch){
      const rowNeedle=`${Number(dateMatch[1])}/${Number(dateMatch[2])}`;
      active=rowNeedle===needle;
    }
    if(!active) continue;
    const found=Object.values(TEAM)
      .map(t=>({t,pos:Math.min(...t.ja.map(a=>txt.indexOf(a)).filter(x=>x>=0))}))
      .filter(x=>Number.isFinite(x.pos))
      .sort((a,b)=>a.pos-b.pos)
      .map(x=>x.t);
    if(found.length<2) continue;
    const hrefPlayers=[...row.html.matchAll(/href=["'][^"']*\/players\/(\d+)\.html["']/gi)].map(x=>x[1]);
    const time=(txt.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)||[])[0]||"18:00";
    const score=txt.match(/(\d+)\s*[-－]\s*(\d+)/);
    const venue=row.cells.find(x=>/ドーム|球場|甲子園|神宮|横浜|マツダ|エスコン|ZOZO|楽天|ベルーナ|PayPay|京セラ|ほっと/.test(x))||"";
    const start=new Date(Date.UTC(y,m-1,d,Number(time.split(":")[0])-9,Number(time.split(":")[1]))).toISOString();
    const home=found[0], away=found[1];
    out.push({
      id:`NPB-${String(date).replaceAll("-","")}-${away.abbr}-${home.abbr}`,
      sport:"npb",start,
      status:{state:score?"post":"pre",detail:score?"Final":"Scheduled",completed:Boolean(score),live:false},
      home:{name:home.name,abbr:home.abbr,score:score?finite(score[1]):null,logo:""},
      away:{name:away.name,abbr:away.abbr,score:score?finite(score[2]):null,logo:""},
      venue,
      probableStarterIds:{home:hrefPlayers[0]||null,away:hrefPlayers[1]||null},
      odds:{spread:null,total:null,homeMl:null,awayMl:null,book:"MARKET_UNRESOLVED"},
      projectionKind:"UNAVAILABLE",projHomeScore:null,projAwayScore:null,
      source:"NPB_OFFICIAL_SCHEDULE"
    });
  }
  const seen=new Set();
  return out.filter(g=>{const k=g.id;if(seen.has(k))return false;seen.add(k);return true;});
}

function aggregateTeam(batters,pitchers,games){
  const sum=(arr,key)=>arr.reduce((s,x)=>s+(finite(x[key])||0),0);
  const pa=sum(batters,"pa"), runs=sum(batters,"runs"), so=sum(batters,"so"), hr=sum(batters,"hr"), bb=sum(batters,"bb");
  const innings=sum(pitchers,"innings"), er=sum(pitchers,"er");
  return {
    games, runsPerGame:games>0?runs/games:null,
    kRate:pa>0?so/pa:null, hrRate:pa>0?hr/pa:null, bbRate:pa>0?bb/pa:null,
    staffEra:innings>0?er*9/innings:null,
    pa,innings
  };
}

function projectStarterK(starter,opp){
  if(!starter||starter.kPer9==null) return null;
  const ipExp=clamp(starter.ipPerGame??5.4,3.5,7.2);
  const leagueK=.205;
  const oppFactor=opp?.kRate?clamp(opp.kRate/leagueK,.78,1.22):1;
  return {
    projection:r1(starter.kPer9/9*ipExp*oppFactor),
    kPer9:r1(starter.kPer9),expectedInnings:r1(ipExp),opponentKRate:opp?.kRate??null,
    source:"NPB_OFFICIAL_PITCHER_K_RATE_X_WORKLOAD_X_OPPONENT_K_RATE"
  };
}

export function projectNpbGame(game,ctx={}){
  const home=ctx.teams?.[game.home.abbr], away=ctx.teams?.[game.away.abbr];
  if(!home||!away) return {ok:false,reason:"npb-team-context-missing"};
  const hs=ctx.pitchersByTeam?.[game.home.abbr]?.find(p=>String(p.playerId||"")===String(game.probableStarterIds?.home||""))||null;
  const as=ctx.pitchersByTeam?.[game.away.abbr]?.find(p=>String(p.playerId||"")===String(game.probableStarterIds?.away||""))||null;
  const hOff=finite(home.runsPerGame)??LEAGUE_RUNS, aOff=finite(away.runsPerGame)??LEAGUE_RUNS;
  const hOppEra=finite(away.staffEra)??3.40, aOppEra=finite(home.staffEra)??3.40;
  const hStarterAdj=as?.era!=null?clamp((as.era-hOppEra)*0.17,-0.55,0.55):0;
  const aStarterAdj=hs?.era!=null?clamp((hs.era-aOppEra)*0.17,-0.55,0.55):0;
  const homeRuns=clamp((hOff*0.62 + (hOppEra/9*LEAGUE_RUNS/3.40)*9*0.38)+hStarterAdj+HOME_EDGE,1.2,7.2);
  const awayRuns=clamp((aOff*0.62 + (aOppEra/9*LEAGUE_RUNS/3.40)*9*0.38)+aStarterAdj,1.2,7.2);
  const f5Home=clamp(homeRuns*5/9 + hStarterAdj*0.30,0.6,4.5);
  const f5Away=clamp(awayRuns*5/9 + aStarterAdj*0.30,0.6,4.5);
  return {
    ok:true,modelId:NPB_FBIS_V1_ID,modelVersion:NPB_FBIS_V1_VERSION,maturity:"RESEARCH",
    independent:true,marketInformed:false,canQualify:false,canAuthorize:false,
    home:r2(homeRuns),away:r2(awayRuns),margin:r2(homeRuns-awayRuns),total:r2(homeRuns+awayRuns),
    f5:{home:r2(f5Home),away:r2(f5Away),margin:r2(f5Home-f5Away),total:r2(f5Home+f5Away),source:"NPB_FBIS_F5"},
    pitcherKs:{home:projectStarterK(hs,away),away:projectStarterK(as,home)},
    starters:{
      home:hs?{playerId:hs.playerId,name:hs.name,era:hs.era,kPer9:r1(hs.kPer9),expectedInnings:r1(clamp(hs.ipPerGame??5.4,3.5,7.2))}:null,
      away:as?{playerId:as.playerId,name:as.name,era:as.era,kPer9:r1(as.kPer9),expectedInnings:r1(clamp(as.ipPerGame??5.4,3.5,7.2))}:null,
    },
    inputs:{home,away,source:"NPB.jp official schedule + player batting/pitching"},
    note:"Independent NPB research projection using official NPB season offense, staff run prevention, probable-starter quality, F5 allocation and starter K rates. No sportsbook inputs."
  };
}

async function fetchText(url,fetcher=fetch){
  const res=await fetcher(url,{headers:{"user-agent":"FBIS/1.0","accept":"text/html,*/*"}});
  if(!res.ok) throw new Error(`NPB_HTTP_${res.status}`);
  return res.text();
}

export async function loadNpbContext(date,{fetcher=fetch}={}){
  const year=seasonFromDate(date), month=String(Number(String(date).slice(5,7))).padStart(2,"0");
  const scheduleHtml=await fetchText(`https://npb.jp/games/${year}/schedule_${month}_detail.html`,fetcher);
  const games=parseNpbScheduleMonth(scheduleHtml,date);
  const teamAbbrs=[...new Set(games.flatMap(g=>[g.home.abbr,g.away.abbr]))];
  const teams={},pitchersByTeam={};
  await Promise.all(teamAbbrs.map(async abbr=>{
    const meta=BY_ABBR[abbr];
    if(!meta) return;
    const [bat,pit]=await Promise.all([
      fetchText(`https://npb.jp/bis/eng/${year}/stats/idb1_${meta.stats}.html`,fetcher),
      fetchText(`https://npb.jp/bis/eng/${year}/stats/idp1_${meta.stats}.html`,fetcher),
    ]);
    const batters=parseNpbBattingPage(bat), pitchers=parseNpbPitchingPage(pit);
    const gamesPlayed=Math.max(1,...pitchers.map(p=>p.games||0),...batters.map(p=>p.games||0));
    teams[abbr]=aggregateTeam(batters,pitchers,gamesPlayed);
    pitchersByTeam[abbr]=pitchers;
  }));
  return {ok:games.length>0,games,teams,pitchersByTeam,source:"NPB.jp",timezone:"Asia/Tokyo",marketInformed:false,canQualify:false,canAuthorize:false};
}

export function attachNpbFbisV1(games=[],ctx={}){
  let projected=0,missing=0;
  const next=(games||[]).map(game=>{
    const p=projectNpbGame(game,ctx);
    if(p.ok) projected++; else missing++;
    if(!p.ok) return {...game,npbV1:p};
    return {
      ...game,
      npbV1:p,
      researchProjection:{...p,projectionKind:"FBIS",generatedAt:new Date().toISOString()},
      projectionKind:"FBIS",
      projHomeScore:p.home,projAwayScore:p.away,
      model:{
        ...(game.model||{}),projectionKind:"FBIS",maturity:"RESEARCH",
        projHome:p.home,projAway:p.away,projMargin:p.margin,projTotal:p.total,
        canQualify:false,canAuthorize:false
      },
      modelVersion:`${NPB_FBIS_V1_ID}@${NPB_FBIS_V1_VERSION}`,
      challengers:{...(game.challengers||{}),[NPB_FBIS_V1_ID]:p},
      quality:{
        ...(game.quality||{}),
        score:p.starters.home&&p.starters.away?82:68,
        state:p.starters.home&&p.starters.away?"COMPLETE":"PROVISIONAL",
        flags:[...new Set([...(game.quality?.flags||[]),...(p.starters.home&&p.starters.away?[]:["npb_probable_starter_unresolved"])])]
      }
    };
  });
  return {games:next,meta:{modelId:NPB_FBIS_V1_ID,modelVersion:NPB_FBIS_V1_VERSION,projected,missing,maturity:"RESEARCH",independent:true,marketInformed:false,canQualify:false,canAuthorize:false}};
}
