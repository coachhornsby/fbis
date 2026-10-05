#!/usr/bin/env node
import fs from "node:fs";
import { combinePlayerImpact } from "../functions/lib/nbaPlayerImpact.js";
import { buildRoleRedistribution, lineupOpportunityModifier } from "../functions/lib/nbaRoleRedistribution.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const frozen=args.frozen||"artifacts/frozen/nba-canonical.jsonl";
const current=args.current||"artifacts/current/nba-canonical.jsonl";
const historicalImpact=args.historicalImpact||"artifacts/frozen/nba-player-impact-v1.json";
const availabilityFile=args.availability||"artifacts/nba-availability.json";
const coverageFile=args.coverage||"artifacts/nba-availability-coverage.json";
const lineupFile=args.lineups||"artifacts/frozen/nba-lineup-effects.json";
const out=args.out||"artifacts/nba-player-impact-live.json";
const sqlOut=args.sql||"artifacts/nba-player-impact-live.sql";
const asOf=args.asOf||new Date().toISOString();
const readJsonl=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const readJson=p=>{if(!fs.existsSync(p)||!fs.statSync(p).size)return null;try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return null}};
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=finite(v);return n==null?"NULL":String(n)};
const games=[...new Map([...readJsonl(frozen),...readJsonl(current)].map(g=>[String(g.id),g])).values()].sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));
const currentGames=readJsonl(current);
const histArtifact=readJson(historicalImpact)||{players:{}};
const lineupArtifact=readJson(lineupFile)||{effects:[]};
const availRaw=readJson(availabilityFile);
const flattenRows=x=>Array.isArray(x)
  ? (x.every(r=>Array.isArray(r?.results)) ? x.flatMap(r=>r.results||[]) : x)
  : (Array.isArray(x?.results) ? x.results : Array.isArray(x?.result) ? x.result.flatMap(r=>r?.results||[]) : []);
const availability=flattenRows(availRaw);
const coverage=flattenRows(readJson(coverageFile));
const hist=new Map(),latest=new Map(),teamAbbrById=new Map();
for(const g of games){
  if(g.homeId)teamAbbrById.set(String(g.homeId),g.home?.abbr||teamAbbrById.get(String(g.homeId))||null);
  if(g.awayId)teamAbbrById.set(String(g.awayId),g.away?.abbr||teamAbbrById.get(String(g.awayId))||null);
}
for(const g of games)for(const p of g.players||[]){
  const id=String(p.id||p.name||"");if(!id)continue;
  if(!hist.has(id))hist.set(id,[]);
  hist.get(id).push({...p,date:g.start||g.date,teamPossessions:g.possessions});
}
for(const g of currentGames)for(const p of g.players||[])latest.set(String(p.id||p.name||""),p);

function latestAvailability(player){
  const rows=availability.filter(a=>(a.player_id&&String(a.player_id)===String(player.id))||String(a.player_name||"").toLowerCase()===String(player.name||"").toLowerCase())
    .filter(a=>!a.observed_at||Date.parse(a.observed_at)<=Date.parse(asOf))
    .sort((a,b)=>Date.parse(b.observed_at||0)-Date.parse(a.observed_at||0));
  return rows[0]||null;
}
const impacts={};
for(const [id,rows] of hist){
  const currentImpact=combinePlayerImpact({playerId:id,history:rows,asOf});
  if(!currentImpact.ok)continue;
  const h=histArtifact.players?.[id]||null;
  const currentN=(currentGames.flatMap(g=>g.players||[]).filter(p=>String(p.id||p.name)===id)).length;
  const w=currentN/(currentN+8);
  const blend=(a,b)=>a==null?b:b==null?a:a*w+b*(1-w);
  impacts[id]={...currentImpact,
    offense:blend(currentImpact.offense,finite(h?.offense)),
    defense:blend(currentImpact.defense,finite(h?.defense)),
    net:blend(currentImpact.net,finite(h?.net)),
    name:latest.get(id)?.name||h?.name||id,
    teamId:String(latest.get(id)?.teamId||h?.teamId||""),
    team:latest.get(id)?.team||h?.team||teamAbbrById.get(String(latest.get(id)?.teamId||h?.teamId||""))||null,
    position:latest.get(id)?.position||h?.position||null,
    sourceBlend:{currentGames:currentN,currentWeight:w,historicalArtifact:Boolean(h)}
  };
}
const teams=new Map();
for(const [id,p] of Object.entries(impacts)){if(!p.teamId)continue;if(!teams.has(p.teamId))teams.set(p.teamId,{});teams.get(p.teamId)[id]=p}
function officialCoverageForRoster(roster){
  const teamAbbr=Object.values(roster).map(p=>String(p.team||"").toUpperCase()).find(Boolean);
  if(!teamAbbr)return null;
  const cutoff=Date.parse(asOf),maxAge=18*3600000;
  return coverage.filter(r=>String(r.team_key||"").toUpperCase()===teamAbbr)
    .filter(r=>!r.report_timestamp||Date.parse(r.report_timestamp)<=cutoff)
    .filter(r=>!r.report_timestamp||cutoff-Date.parse(r.report_timestamp)<=maxAge)
    .sort((a,b)=>Date.parse(b.report_timestamp||0)-Date.parse(a.report_timestamp||0))[0]||null;
}
const roleContexts={};
for(const [teamId,roster] of teams){
  const unavailable=[];
  for(const [id,p] of Object.entries(roster)){
    const a=latestAvailability({id,name:p.name});
    if(a&&["OUT","DOUBTFUL","QUESTIONABLE","PROBABLE"].includes(String(a.status||"").toUpperCase()))unavailable.push({playerId:id,status:a.status,source:a.source,observedAt:a.observed_at});
  }
  const coverageRow=officialCoverageForRoster(roster);
  const officialSubmitted=String(coverageRow?.submission_status||"").toUpperCase()==="SUBMITTED";
  const verified=officialSubmitted||(unavailable.length>0&&unavailable.every(u=>u.source&&u.observedAt));
  for(const id of Object.keys(roster)){
    const role=buildRoleRedistribution({targetPlayerId:id,rosterImpacts:roster,unavailablePlayers:unavailable});
    const expectedMates=Object.keys(roster).filter(x=>x!==id&&!unavailable.some(u=>u.playerId===x&&String(u.status).toUpperCase()==="OUT"));
    const lineup=lineupOpportunityModifier({playerId:id,lineupEffects:lineupArtifact.effects||[],expectedTeammates:expectedMates});
    roleContexts[id]={role,lineup,availabilityVerified:verified,unavailable,officialCoverage:coverageRow||null};
  }
}
const createdAt=new Date().toISOString(),sql=[];
for(const [id,p] of Object.entries(impacts)){
  const diag=p.diagnostics||{};
  sql.push(`INSERT OR REPLACE INTO nba_player_impact_snapshots (id,player_id,player_name,team_id,position,as_of,model_id,model_version,offense_impact,defense_impact,net_impact,rapm_net,raw_on_off,bpm_style,vorp_style,ws48_style,dynamic_skill_json,provenance_json,production_eligible,created_at) VALUES (${q(id+":"+asOf)},${q(id)},${q(p.name)},${q(p.teamId)},${q(p.position)},${q(asOf)},'NBA-FBIS-PLAYER-IMPACT-v1','research-v1',${num(p.offense)},${num(p.defense)},${num(p.net)},${num(p.rapm?.net)},${num(p.onOff?.onOff100)},${num(diag.bpmStyle)},${num(diag.vorpStylePerGame)},${num(diag.ws48Style)},${q(JSON.stringify(p.skill||{}))},${q(JSON.stringify(p.sourceBlend||{}))},0,${q(createdAt)});`);
}
for(const [id,x] of Object.entries(roleContexts)){
  const p=impacts[id],r=x.role||{},l=x.lineup||{};
  sql.push(`INSERT OR REPLACE INTO nba_player_role_contexts (id,game_id,player_id,player_name,team_id,feature_cutoff_timestamp,minutes_delta,usage_multiplier,points_multiplier,rebounds_multiplier,assists_multiplier,threes_multiplier,lineup_multiplier,unavailable_count,availability_verified,context_json,created_at) VALUES (${q(id+":"+asOf)},NULL,${q(id)},${q(p?.name)},${q(p?.teamId)},${q(asOf)},${num(r.minutesDelta)},${num(r.usageMultiplier)},${num(r.pointsMultiplier)},${num(r.reboundsMultiplier)},${num(r.assistsMultiplier)},${num(r.threesMultiplier)},${num(l.multiplier)},${Number(r.unavailableCount||0)},${x.availabilityVerified?1:0},${q(JSON.stringify(x))},${q(createdAt)});`);
}
const payload={asOf,modelId:"NBA-FBIS-PLAYER-IMPACT-v1",players:impacts,roleContexts,
  governance:{marketUsed:false,availabilityPointInTime:true,proprietaryMetricRequired:false,productionEligible:false}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");
fs.writeFileSync(sqlOut,sql.join("\n")+"\n");
console.log(JSON.stringify({ok:true,asOf,players:Object.keys(impacts).length,roleContexts:Object.keys(roleContexts).length,verifiedRoleContexts:Object.values(roleContexts).filter(x=>x.availabilityVerified).length},null,2));
