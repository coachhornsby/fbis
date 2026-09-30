/**
 * Official KBO advanced-stat and probable-starter ingestion.
 * Market-blind. All model inputs originate from KBO-operated sites.
 */

const TEAM_KO = Object.freeze({
  "두산":"DOOSAN","삼성":"SAMSUNG","KIA":"KIA","KT":"KT","NC":"NC",
  "롯데":"LOTTE","LG":"LG","SSG":"SSG","한화":"HANWHA","키움":"KIWOOM",
});
const GAME_CODE = Object.freeze({
  DOOSAN:"OB", SAMSUNG:"SS", KIA:"HT", KT:"KT", NC:"NC",
  LOTTE:"LT", LG:"LG", SSG:"SK", HANWHA:"HH", KIWOOM:"WO",
});

function finite(v){ if(v==null||v==="") return null; const n=Number(String(v).replace(/,/g,"")); return Number.isFinite(n)?n:null; }
function htmlText(s=""){ return String(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?\s*>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g," ").trim(); }
function cells(rowHtml=""){ return [...String(rowHtml).matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>htmlText(m[1])); }
function rowObjects(html=""){ return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>({html:m[1],cells:cells(m[1])})); }
function teamKey(v=""){ const s=String(v).trim(); return TEAM_KO[s] || (Object.values(GAME_CODE).includes(s.toUpperCase()) ? s.toUpperCase() : null); }
function ip(v){
  const s=String(v??"").trim();
  const m=s.match(/^(\d+)\s+(\d)\/(\d)$/); if(m) return Number(m[1])+Number(m[2])/Number(m[3]);
  return finite(s);
}
function mergeByTeam(target, rows){ for(const row of rows){ if(!row?.team) continue; target[row.team]={...(target[row.team]||{}),...row}; } return target; }

export function parseKboTeamHitterBasic1(html=""){
  const out=[];
  for(const r of rowObjects(html)){
    const c=r.cells; if(c.length<15) continue;
    const team=teamKey(c[1]); if(!team) continue;
    const games=finite(c[3]), pa=finite(c[4]), runs=finite(c[6]), hr=finite(c[10]);
    if(games==null||pa==null) continue;
    out.push({team,games,pa,avg:finite(c[2]),runs,hr,totalBases:finite(c[11]),runsPerGame:games>0&&runs!=null?runs/games:null});
  }
  return out;
}

export function parseKboTeamHitterBasic2(html=""){
  const out=[];
  for(const r of rowObjects(html)){
    const c=r.cells; if(c.length<13) continue;
    const team=teamKey(c[1]); if(!team) continue;
    const avg=finite(c[2]), bb=finite(c[3]), so=finite(c[6]), slg=finite(c[8]), obp=finite(c[9]), ops=finite(c[10]);
    if(avg==null||ops==null) continue;
    out.push({team,avg,bb,so,slg,obp,ops,risp:finite(c[12]),isop:slg!=null&&avg!=null?slg-avg:null});
  }
  return out;
}

export function parseKboTeamPitcherBasic1(html=""){
  const out=[];
  for(const r of rowObjects(html)){
    const c=r.cells; if(c.length<19) continue;
    const team=teamKey(c[1]); if(!team) continue;
    const innings=ip(c[10]), so=finite(c[15]), bb=finite(c[13]);
    if(innings==null) continue;
    out.push({
      team,era:finite(c[2]),games:finite(c[3]),innings,hrAllowed:finite(c[12]),bbAllowed:bb,so,
      whip:finite(c[18]),kPer9:so!=null&&innings>0?so*9/innings:null,bbPer9:bb!=null&&innings>0?bb*9/innings:null
    });
  }
  return out;
}

export function parseKboTeamPitcherBasic2(html=""){
  const out=[];
  for(const r of rowObjects(html)){
    const c=r.cells; if(c.length<17) continue;
    const team=teamKey(c[1]); if(!team) continue;
    if(finite(c[2])==null) continue;
    out.push({team,era:finite(c[2]),qs:finite(c[5]),blownSaves:finite(c[6]),tbf:finite(c[7]),pitches:finite(c[8]),oppAvg:finite(c[9])});
  }
  return out;
}

export function parseKboPitcherBasic1(html=""){
  const out=[];
  for(const r of rowObjects(html)){
    const c=r.cells; if(c.length<19) continue;
    const team=teamKey(c[2]); if(!team) continue;
    const innings=ip(c[10]), so=finite(c[15]), bb=finite(c[13]), g=finite(c[4]);
    if(!c[1]||innings==null) continue;
    const playerId=(r.html.match(/playerId=(\d+)/i)||[])[1]||null;
    out.push({
      playerId,name:c[1],team,era:finite(c[3]),games:g,innings,hr:finite(c[12]),bb,so,whip:finite(c[18]),
      kPer9:so!=null&&innings>0?so*9/innings:null,bbPer9:bb!=null&&innings>0?bb*9/innings:null
    });
  }
  return out;
}

export function parseKboPitcherAdvanced(html=""){
  const out=[];
  for(const r of rowObjects(html)){
    const c=r.cells; if(c.length<13) continue;
    const team=teamKey(c[2]); if(!team) continue;
    const era=finite(c[3]); if(era==null) continue;
    const playerId=(r.html.match(/playerId=(\d+)/i)||[])[1]||null;
    out.push({
      playerId,name:c[1],team,era,babip:finite(c[4]),pitchesPerGame:finite(c[5]),pitchesPerInning:finite(c[6]),
      kPer9:finite(c[7]),bbPer9:finite(c[8]),kBb:finite(c[9]),oppObp:finite(c[10]),oppSlg:finite(c[11]),oppOps:finite(c[12])
    });
  }
  return out;
}

export function mergeKboPitchers(basic=[],advanced=[]){
  const map=new Map();
  for(const p of basic){ map.set(`${p.team}|${p.name}`,{...p}); if(p.playerId) map.set(`id:${p.playerId}`,map.get(`${p.team}|${p.name}`)); }
  for(const a of advanced){
    const key=a.playerId&&map.has(`id:${a.playerId}`)?`id:${a.playerId}`:`${a.team}|${a.name}`;
    const prior=map.get(key)||{};
    const merged={...prior,...a};
    map.set(`${a.team}|${a.name}`,merged);
    if(a.playerId) map.set(`id:${a.playerId}`,merged);
  }
  return [...new Map([...map.values()].map(p=>[`${p.team}|${p.name}`,p])).values()];
}

export function buildKboAdvancedTeamContext(parts={}){
  const teams={};
  mergeByTeam(teams,parseKboTeamHitterBasic1(parts.hitter1||""));
  mergeByTeam(teams,parseKboTeamHitterBasic2(parts.hitter2||""));
  mergeByTeam(teams,parseKboTeamPitcherBasic1(parts.pitcher1||""));
  mergeByTeam(teams,parseKboTeamPitcherBasic2(parts.pitcher2||""));
  for(const t of Object.values(teams)){
    t.kRate=t.pa>0&&t.so!=null?t.so/t.pa:null;
    t.bbRate=t.pa>0&&t.bb!=null?t.bb/t.pa:null;
  }
  return teams;
}

export function kboGameId(date,away,home){
  const stamp=String(date).replaceAll("-","");
  const a=GAME_CODE[away], h=GAME_CODE[home];
  return a&&h?`${stamp}${a}${h}0`:null;
}

export function parseOfficialStarterPage(html="",game={}){
  const playerLinks=[...String(html).matchAll(/(?:PitcherDetail\/Basic\.aspx\?playerId=|playerId=)(\d+)[^>]*>([^<]{1,30})</gi)]
    .map(m=>({playerId:m[1],name:htmlText(m[2])})).filter(x=>x.name);
  const unique=[]; const seen=new Set();
  for(const p of playerLinks){ if(!seen.has(p.playerId)){seen.add(p.playerId);unique.push(p);} }
  if(unique.length>=2) return {away:unique[0],home:unique[1],source:"KBO_GAMECENTER_START_PIT"};
  // Fallback: labels around the pregame GameCenter often render as "선 <name>".
  const text=htmlText(html);
  const names=[...text.matchAll(/(?:^|\s)선\s+([^\s]{2,12})/g)].map(m=>m[1]);
  return names.length>=2 ? {away:{name:names[0]},home:{name:names[1]},source:"KBO_GAMECENTER_MAIN"} : null;
}

async function fetchText(url,fetcher=fetch){
  const res=await fetcher(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; FBIS/1.1)","accept":"text/html,*/*","accept-language":"ko-KR,ko;q=0.9,en;q=0.8"}});
  if(!res.ok) throw new Error(`KBO_ADV_HTTP_${res.status}`);
  return res.text();
}

export async function loadKboAdvancedContext(date,games=[],{fetcher=fetch}={}){
  const urls={
    hitter1:"https://www.koreabaseball.com/Record/Team/Hitter/Basic1.aspx",
    hitter2:"https://www.koreabaseball.com/Record/Team/Hitter/Basic2.aspx",
    pitcher1:"https://www.koreabaseball.com/Record/Team/Pitcher/Basic1.aspx",
    pitcher2:"https://www.koreabaseball.com/Record/Team/Pitcher/Basic2.aspx",
    playerPitcher1:"https://www.koreabaseball.com/Record/Player/PitcherBasic/Basic1.aspx",
    playerPitcherAdvanced:"https://www.koreabaseball.com/Record/Player/PitcherBasic/Detail2.aspx",
  };
  const fetched={};
  await Promise.all(Object.entries(urls).map(async([k,u])=>{try{fetched[k]=await fetchText(u,fetcher);}catch{fetched[k]="";}}));
  const teams=buildKboAdvancedTeamContext(fetched);
  const pitchers=mergeKboPitchers(parseKboPitcherBasic1(fetched.playerPitcher1),parseKboPitcherAdvanced(fetched.playerPitcherAdvanced));
  const startersByGame={};
  await Promise.all((games||[]).map(async game=>{
    const gid=kboGameId(date,game.away?.abbr,game.home?.abbr); if(!gid) return;
    const stamp=String(date).replaceAll("-","");
    const candidates=[
      `https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx?gameDate=${stamp}&gameId=${gid}&section=START_PIT`,
      `https://www.koreabaseball.com/Schedule/GameCenter/Preview/StartPitcher.aspx?gameDate=${stamp}&gameId=${gid}`,
    ];
    let parsed=null;
    for(const u of candidates){ try{parsed=parseOfficialStarterPage(await fetchText(u,fetcher),game); if(parsed) break;}catch{} }
    if(!parsed) return;
    const enrich=(side,team)=>{
      const raw=parsed[side]; if(!raw) return null;
      return pitchers.find(p=>(raw.playerId&&p.playerId===raw.playerId)||(p.team===team&&p.name===raw.name))||{...raw,team};
    };
    startersByGame[game.id]={away:enrich("away",game.away.abbr),home:enrich("home",game.home.abbr),source:parsed.source};
  }));
  return {
    teams,pitchers,startersByGame,
    source:"KBO official Korean record/gamecenter",
    featureVersion:"kbo-advanced-v1",
    statsOk:Object.keys(teams).length>=8,
    starterGames:Object.keys(startersByGame).length,
    marketInformed:false
  };
}
