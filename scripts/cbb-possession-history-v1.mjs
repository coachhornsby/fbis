import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { aggregateNcaaCbbGame, cbbNcaaPossessionFeatures, CBB_NCAA_POSSESSION_MODEL_ID, CBB_NCAA_POSSESSION_MODEL_VERSION } from "../functions/lib/cbbNcaaPossessionModel.js";

const seasonStart=Number(process.env.FBIS_SEASON||process.argv[2]);
if(!Number.isFinite(seasonStart))throw new Error("FBIS_SEASON or starting season arg required");
const endingYear=seasonStart+1;
const URL="https://github.com/sportsdataverse/sportsdataverse-data/releases/download/ncaa_mbb_pbp/ncaa_mbb_pbp_"+endingYear+".csv.gz";

function parseCsvLine(line){
  const out=[];let cur="",q=false;
  for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===","&&!q){out.push(cur);cur="";}else cur+=ch;}out.push(cur);return out;
}
function rowFrom(h,c){const r={};for(let i=0;i<h.length;i++)r[h[i]]=c[i]??"";return r;}
const n=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};

async function streamGzipCsv(url,onRow){
  const res=await fetch(url,{headers:{"User-Agent":"FBIS-CBB-NCAA-POSSESSION-v1/1.0"},redirect:"follow"});
  if(!res.ok)throw new Error("HTTP "+res.status+" "+url);
  const gunzip=createGunzip();
  Readable.fromWeb(res.body).pipe(gunzip);
  const rl=createInterface({input:gunzip,crlfDelay:Infinity});
  let header=null,lineNo=0;
  for await(const line of rl){
    lineNo++;if(!line)continue;
    const cols=parseCsvLine(line);
    if(!header){header=cols.map(x=>x.trim());continue;}
    if(cols.length!==header.length)throw new Error("CSV column mismatch line="+lineNo+" expected="+header.length+" got="+cols.length);
    await onRow(rowFrom(header,cols),lineNo);
  }
  return{header,lineNo};
}
function compactTeam(s={}){
  return {
    possessions:s.possessions??0,pointsFor:s.pointsFor??0,pointsAgainst:s.pointsAgainst??0,
    offensiveRating:s.offensiveRating??null,defensiveRating:s.defensiveRating??null,netRating:s.netRating??null,
    efgPct:s.efgPct??null,tovPct:s.tovPct??null,ftr:s.ftr??null,orbPctProxy:s.orbPctProxy??null,
    threePointRate:s.threePointRate??null,rimRate:s.rimRate??null,rimFgPct:s.rimFgPct??null,midRate:s.midRate??null,midFgPct:s.midFgPct??null,
    transitionRate:s.transitionRate??null,earlyEfgPct:s.earlyEfgPct??null,middleEfgPct:s.middleEfgPct??null,lateEfgPct:s.lateEfgPct??null,
    earlyTovPct:s.earlyTovPct??null,middleTovPct:s.middleTovPct??null,lateTovPct:s.lateTovPct??null,
    topFiveLineups:(s.topFiveLineups||[]).slice(0,8),
  };
}

const games=[];let currentKey=null,currentRows=[],pbpRows=0,repeatedGames=0;const seen=new Set();
function processGame(rows){
  if(!rows.length)return;
  const out=aggregateNcaaCbbGame(rows);
  const gameKey=String(out?.gameId||rows[0]?.espn_game_id||rows[0]?.contest_id||"");
  if(!gameKey)return;
  if(seen.has(gameKey)){repeatedGames++;return;}
  seen.add(gameKey);
  if(!out.ok){games.push({gameId:gameKey,ok:false,reason:out.reason||"aggregate-failed"});return;}
  const h=compactTeam(out.teams[out.homeTeamId]),a=compactTeam(out.teams[out.awayTeamId]);
  const last=rows[rows.length-1];
  games.push({
    gameId:String(out.gameId),contestId:out.contestId,season:seasonStart,endingYear,
    date:String(rows[0].game_date||"").slice(0,10),
    homeTeamId:out.homeTeamId,awayTeamId:out.awayTeamId,homeTeamName:out.homeTeamName,awayTeamName:out.awayTeamName,
    homeScore:n(last.home_score),awayScore:n(last.away_score),
    lineupReliable:out.lineupReliable,qa:out.qa,features:cbbNcaaPossessionFeatures(out),home:h,away:a,
  });
}

await streamGzipCsv(URL,(r)=>{
  pbpRows++;
  const gid=String(r.espn_game_id||r.contest_id||"");
  if(!gid)return;
  if(currentKey==null)currentKey=gid;
  if(gid!==currentKey){processGame(currentRows);currentRows=[];currentKey=gid;}
  currentRows.push(r);
});
processGame(currentRows);
if(repeatedGames>0)throw new Error("NCAA PBP game rows were not contiguous; repeatedGames="+repeatedGames);

const valid=games.filter(g=>g.ok!==false),reliable=valid.filter(g=>g.lineupReliable);
const avg=xs=>{const a=xs.map(Number).filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null};
const report={
  ok:true,id:"CBB-POSSESSION-HISTORY-v2-NCAA",modelId:CBB_NCAA_POSSESSION_MODEL_ID,modelVersion:CBB_NCAA_POSSESSION_MODEL_VERSION,
  season:seasonStart,endingYear,source:{name:"SportsDataverse ncaa_mbb_pbp / stats.ncaa.org",url:URL,marketInformed:false},
  counts:{pbpRows,games:valid.length,lineupReliableGames:reliable.length,repeatedGames},
  qa:{lineupReliableRate:valid.length?reliable.length/valid.length:null,meanLineupCoverage:avg(valid.map(g=>g.qa?.lineupCoverage)),gamesWithSubDeviation:valid.filter(g=>(g.qa?.subDeviate||0)>0).length,maxSubDeviation:Math.max(0,...valid.map(g=>g.qa?.subDeviate||0))},
  governance:{independent:true,canQualify:false,canAuthorizeWager:false,espnStarterReconstructionDisabled:true},
  games,
};
mkdirSync("artifacts",{recursive:true});
const path="artifacts/cbb-possession-history-"+seasonStart+".json";
writeFileSync(path,JSON.stringify(report));
console.log(JSON.stringify({ok:true,path,season:seasonStart,endingYear,counts:report.counts,qa:report.qa,source:report.source.name},null,2));
