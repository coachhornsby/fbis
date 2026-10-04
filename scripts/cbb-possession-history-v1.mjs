import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { mkdirSync, writeFileSync } from "node:fs";
import { reconstructCbbGame, cbbPossessionGameFeatures, CBB_POSSESSION_MODEL_ID, CBB_POSSESSION_MODEL_VERSION } from "../functions/lib/cbbPossessionModel.js";

const seasonStart = Number(process.env.FBIS_SEASON || process.argv[2]);
if (!Number.isFinite(seasonStart)) throw new Error("FBIS_SEASON or starting season arg required");
const endingYear = seasonStart + 1;
const RELEASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download";
const PBP = RELEASE + "/espn_mens_college_basketball_pbp/play_by_play_" + endingYear + ".csv";
const BOX = RELEASE + "/espn_mens_college_basketball_player_boxscores/player_box_" + endingYear + ".csv";

function parseCsvLine(line) {
  const out=[]; let cur="", q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(q && line[i+1]==='"'){cur+='"';i++;}
      else q=!q;
    } else if(ch==="," && !q){out.push(cur);cur="";}
    else cur+=ch;
  }
  out.push(cur);
  return out;
}
function rowFrom(header, cols) {
  const r={};
  for(let i=0;i<header.length;i++) r[header[i]]=cols[i] ?? "";
  return r;
}
function truthy(v){return v===true||["1","true","t","yes"].includes(String(v||"").toLowerCase());}
function n(v){if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function compactTeam(s={}) {
  return {
    possessions:s.possessions??0,pointsFor:s.pointsFor??0,pointsAgainst:s.pointsAgainst??0,
    offensiveRating:s.offensiveRating??null,defensiveRating:s.defensiveRating??null,netRating:s.netRating??null,
    efgPct:s.efgPct??null,tovPct:s.tovPct??null,ftr:s.ftr??null,orbPctProxy:s.orbPctProxy??null,
    threePointRate:s.threePointRate??null,
    earlyEfgPct:s.earlyEfgPct??null,middleEfgPct:s.middleEfgPct??null,lateEfgPct:s.lateEfgPct??null,
    earlyTovPct:s.earlyTovPct??null,middleTovPct:s.middleTovPct??null,lateTovPct:s.lateTovPct??null,
    topFiveLineups:(s.topFiveLineups||[]).slice(0,8),
  };
}

async function streamCsv(url, onRow) {
  const res=await fetch(url,{headers:{"User-Agent":"FBIS-CBB-POSSESSION-v1/1.0"},redirect:"follow"});
  if(!res.ok) throw new Error("HTTP "+res.status+" "+url);
  const rl=createInterface({input:Readable.fromWeb(res.body),crlfDelay:Infinity});
  let header=null, lineNo=0;
  for await(const line of rl){
    lineNo++;
    if(!line)continue;
    const cols=parseCsvLine(line);
    if(!header){header=cols.map(x=>x.trim());continue;}
    if(cols.length!==header.length){
      throw new Error("CSV column mismatch line="+lineNo+" expected="+header.length+" got="+cols.length+" url="+url);
    }
    await onRow(rowFrom(header,cols),lineNo);
  }
  return {header,lineNo};
}

const startersByGame=new Map();
let playerRows=0,starterRows=0;
await streamCsv(BOX,(r)=>{
  playerRows++;
  if(!truthy(r.starter)||!r.game_id||!r.team_id||!r.athlete_id)return;
  starterRows++;
  const gid=String(r.game_id),tid=String(r.team_id);
  if(!startersByGame.has(gid))startersByGame.set(gid,new Map());
  const gm=startersByGame.get(gid);
  if(!gm.has(tid))gm.set(tid,[]);
  gm.get(tid).push(String(r.athlete_id));
});

const games=[];
let currentId=null,currentRows=[],pbpRows=0,repeatedGames=0;
const seen=new Set();
function processGame(rows){
  if(!rows.length)return;
  const gid=String(rows[0].game_id||"");
  if(!gid)return;
  if(seen.has(gid)){repeatedGames++;return;}
  seen.add(gid);
  const gm=startersByGame.get(gid)||new Map();
  const starters=Object.fromEntries([...gm.entries()]);
  const out=reconstructCbbGame(rows,starters);
  if(!out.ok){
    games.push({gameId:gid,ok:false,reason:out.reason||"reconstruct-failed"});
    return;
  }
  const first=rows[0],last=rows[rows.length-1];
  const home=out.homeTeamId,away=out.awayTeamId;
  const h=compactTeam(out.teams[home]),a=compactTeam(out.teams[away]);
  const homeScore=n(last.home_score)??n(first.home_score);
  const awayScore=n(last.away_score)??n(first.away_score);
  games.push({
    gameId:gid,season:seasonStart,endingYear,date:String(first.game_date||first.game_date_time||"").slice(0,10),
    homeTeamId:home,awayTeamId:away,homeTeamName:out.homeTeamName,awayTeamName:out.awayTeamName,
    homeScore,awayScore,
    lineupReliable:out.lineupReliable,qa:out.qa,features:cbbPossessionGameFeatures(out),
    home:h,away:a,
  });
}

await streamCsv(PBP,(r)=>{
  pbpRows++;
  const gid=String(r.game_id||"");
  if(!gid)return;
  if(currentId==null)currentId=gid;
  if(gid!==currentId){
    processGame(currentRows);
    currentRows=[];currentId=gid;
  }
  currentRows.push(r);
});
processGame(currentRows);

if(repeatedGames>0)throw new Error("PBP game rows were not contiguous; repeatedGames="+repeatedGames);

const valid=games.filter(g=>g.ok!==false);
const reliable=valid.filter(g=>g.lineupReliable);
const avg=(xs)=>{const a=xs.map(Number).filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;};
const report={
  ok:true,id:"CBB-POSSESSION-HISTORY-v1",modelId:CBB_POSSESSION_MODEL_ID,modelVersion:CBB_POSSESSION_MODEL_VERSION,
  season:seasonStart,endingYear,
  source:{pbp:PBP,playerBox:BOX,marketInformed:false},
  counts:{playerRows,starterRows,pbpRows,games:valid.length,lineupReliableGames:reliable.length,repeatedGames},
  qa:{
    lineupReliableRate:valid.length?reliable.length/valid.length:null,
    meanLineupCoverage:avg(valid.map(g=>g.qa?.lineupCoverage)),
    meanSubResolution:avg(valid.map(g=>g.qa?.subResolution)),
    totalSubEvents:valid.reduce((s,g)=>s+(g.qa?.subEvents||0),0),
    totalSubResolved:valid.reduce((s,g)=>s+(g.qa?.subResolved||0),0),
    totalSubUnresolved:valid.reduce((s,g)=>s+(g.qa?.subUnresolved||0),0),
  },
  governance:{independent:true,canQualify:false,canAuthorizeWager:false},
  games,
};
mkdirSync("artifacts",{recursive:true});
const path="artifacts/cbb-possession-history-"+seasonStart+".json";
writeFileSync(path,JSON.stringify(report));
console.log(JSON.stringify({ok:true,path,season:seasonStart,endingYear,counts:report.counts,qa:report.qa},null,2));
