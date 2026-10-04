#!/usr/bin/env node
import fs from "node:fs";
import { projectNbaGame, calibrateNbaProjection } from "../functions/lib/nbaModel.js";
import { projectNbaPlayer } from "../functions/lib/nbaPlayerPropModel.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const date=args.date||new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const checkpoint=args.checkpoint||"SHADOW";
const priorFile=args.prior||"artifacts/frozen/nba-canonical.jsonl";
const currentFile=args.current||"artifacts/current/nba-canonical.jsonl";
const fitFile=args.fit||"data/models/nba-fbis-v1-fit.json";
const out=args.out||"artifacts/nba-shadow.json";
const sqlOut=args.sql||"artifacts/nba-shadow.sql";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const readJsonl=p=>{
  if(!fs.existsSync(p)||!fs.statSync(p).size)return[];
  return fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse);
};
const fit=JSON.parse(fs.readFileSync(fitFile,"utf8"));
const prior=readJsonl(priorFile),current=readJsonl(currentFile);
const all=[...new Map([...prior,...current].map(g=>[String(g.id),g])).values()]
  .sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));

function teamRows(games){
  const by=new Map();
  const push=(id,row)=>{if(!id)return;if(!by.has(id))by.set(id,[]);by.get(id).push(row);};
  for(const g of games){
    const hp={gameId:g.id,date:g.start||g.date,pointsFor:g.homeScore,pointsAgainst:g.awayScore,possessions:g.possessions,
      fga:g.home?.fga,orb:g.home?.orb,tov:g.home?.tov,fta:g.home?.fta,efg:g.home?.efg,tovPct:g.home?.tovPct,orbPct:g.home?.orbPct,ftRate:g.home?.ftRate};
    const ap={gameId:g.id,date:g.start||g.date,pointsFor:g.awayScore,pointsAgainst:g.homeScore,possessions:g.possessions,
      fga:g.away?.fga,orb:g.away?.orb,tov:g.away?.tov,fta:g.away?.fta,efg:g.away?.efg,tovPct:g.away?.tovPct,orbPct:g.away?.orbPct,ftRate:g.away?.ftRate};
    push(String(g.homeId||g.home?.id||""),hp); push(String(g.awayId||g.away?.id||""),ap);
  }
  return by;
}
function playerRows(games){
  const byId=new Map(),byTeam=new Map();
  for(const g of games){
    for(const p of g.players||[]){
      const id=String(p.id||p.name||"");if(!id)continue;
      const row={...p,date:g.start||g.date,gameId:g.id};
      if(!byId.has(id))byId.set(id,[]);byId.get(id).push(row);
      const team=String(p.teamId||"");if(team){if(!byTeam.has(team))byTeam.set(team,new Map());byTeam.get(team).set(id,p);}
    }
  }
  return {byId,byTeam};
}
function restContext(rows=[]){
  const sorted=[...rows].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  if(!sorted.length)return{daysRest:3};
  const target=Date.parse(date+"T18:00:00Z"),last=Date.parse(sorted[0].date);
  const daysRest=Math.max(0,Math.floor((target-last)/86400000)-1);
  const threeInFour=sorted.filter(r=>target-Date.parse(r.date)<=4*86400000).length>=2;
  const fourInSix=sorted.filter(r=>target-Date.parse(r.date)<=6*86400000).length>=3;
  return{daysRest,threeInFour,fourInSix};
}
async function fetchBoard(){
  const stamp=date.replaceAll("-","");
  const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${stamp}&limit=100`,{headers:{"user-agent":"FBIS-NBA-Shadow/1.0",accept:"application/json"}});
  if(!r.ok)throw new Error(`NBA scoreboard HTTP ${r.status}`);
  return r.json();
}
function q(v){return v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";}
function num(v){const n=finite(v);return n==null?"NULL":String(n);}
function insertGame(r){
  return `INSERT OR IGNORE INTO nba_game_projections (id,game_id,tipoff_timestamp,model_id,model_version,feature_cutoff_timestamp,projected_home,projected_away,projected_margin,projected_total,expected_possessions,p_home_win,sigma_margin,sigma_total,maturity,can_qualify,can_authorize,provenance_json,created_at) VALUES (${q(r.id)},${q(r.gameId)},${q(r.tipoff)},${q("NBA-FBIS-v1")},${q(r.modelVersion)},${q(r.featureCutoff)},${num(r.home)},${num(r.away)},${num(r.margin)},${num(r.total)},${num(r.expectedPossessions)},${num(r.pHomeWin)},${num(r.sigmaMargin)},${num(r.sigmaTotal)},'VALIDATION',1,0,${q(JSON.stringify(r.provenance))},${q(r.createdAt)});`;
}
function insertProp(r){
  return `INSERT OR IGNORE INTO nba_player_prop_projections (id,game_id,player_id,player_name,team,market_type,projection,sigma,projected_minutes,availability_status,model_id,model_version,feature_cutoff_timestamp,maturity,can_qualify,can_authorize,provenance_json,created_at) VALUES (${q(r.id)},${q(r.gameId)},${q(r.playerId)},${q(r.playerName)},${q(r.team)},${q(r.market)},${num(r.projection)},${num(r.sigma)},${num(r.minutes)},'UNKNOWN','NBA-PLAYER-PROP-v1','research-v1',${q(r.featureCutoff)},'VALIDATION',1,0,${q(JSON.stringify(r.provenance))},${q(r.createdAt)});`;
}

const teamHist=teamRows(all);
const currentPlayers=playerRows(current);
const board=await fetchBoard();
const createdAt=new Date().toISOString(),games=[],props=[];
for(const ev of board.events||[]){
  const comp=ev.competitions?.[0],cs=comp?.competitors||[];
  const h=cs.find(x=>x.homeAway==="home"),a=cs.find(x=>x.homeAway==="away");
  if(!h||!a)continue;
  const gameId=String(ev.id),homeId=String(h.team?.id||h.id||""),awayId=String(a.team?.id||a.id||"");
  const hh=teamHist.get(homeId)||[],ah=teamHist.get(awayId)||[];
  const raw=projectNbaGame({id:gameId,neutralSite:Boolean(comp?.neutralSite),featureCutoff:createdAt},{
    homeHistory:hh,awayHistory:ah,homeContext:restContext(hh),awayContext:restContext(ah)
  });
  if(!raw.ok)continue;
  const p=calibrateNbaProjection(raw,fit);
  const gameRow={id:`${date}:${gameId}:${checkpoint}:${p.modelVersion}`,gameId,tipoff:ev.date||null,featureCutoff:createdAt,
    createdAt,checkpoint,modelVersion:p.modelVersion,homeTeam:h.team?.abbreviation||h.team?.displayName,awayTeam:a.team?.abbreviation||a.team?.displayName,
    home:p.home,away:p.away,margin:p.margin,total:p.total,expectedPossessions:p.expectedPossessions,pHomeWin:p.pHomeWin,
    sigmaMargin:p.sigmaMargin,sigmaTotal:p.sigmaTotal,provenance:{checkpoint,independent:true,marketUsed:false,historyRows:{home:hh.length,away:ah.length},fit:fit.version,decomposition:p.decomposition}};
  games.push(gameRow);

  for(const [teamId,teamAbbr,sideScore] of [[homeId,h.team?.abbreviation||"",p.home],[awayId,a.team?.abbreviation||"",p.away]]){
    const roster=currentPlayers.byTeam.get(teamId);
    if(!roster)continue;
    for(const [playerId,latest] of roster){
      const hist=currentPlayers.byId.get(playerId)||[];
      if(hist.length<5)continue;
      const pp=projectNbaPlayer({id:playerId,name:latest.name},{history:hist,teamProjection:sideScore,gamePossessions:p.expectedPossessions,status:"UNKNOWN"});
      if(!pp.ok)continue;
      for(const [market,m] of Object.entries(pp.markets||{})){
        props.push({id:`${date}:${gameId}:${checkpoint}:${playerId}:${market}`,gameId,playerId,playerName:latest.name,team:teamAbbr,market,
          projection:m.projection,sigma:m.sigma,minutes:pp.minutes,featureCutoff:createdAt,createdAt,
          provenance:{checkpoint,currentSeasonGames:hist.length,independent:true,marketUsed:false,gameModelVersion:p.modelVersion}});
      }
    }
  }
}
const payload={date,checkpoint,createdAt,gameModel:"NBA-FBIS-v1",gameVersion:fit.version,propModel:"NBA-PLAYER-PROP-v1",games,props,
  governance:{maturity:"VALIDATION",canQualify:true,canAuthorize:false,marketUsedAsFeature:false}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");
fs.writeFileSync(sqlOut,[...games.map(insertGame),...props.map(insertProp)].join("\n")+"\n");
console.log(JSON.stringify({ok:true,date,checkpoint,games:games.length,props:props.length,out,sqlOut},null,2));
