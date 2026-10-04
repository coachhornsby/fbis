#!/usr/bin/env node
import fs from "node:fs";
import { combineWnbaPlayerImpact } from "../functions/lib/wnbaPlayerImpact.js";
import { buildWnbaRoleRedistribution, wnbaLineupModifier } from "../functions/lib/wnbaRoleRedistribution.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const frozen=args.frozen||"artifacts/frozen/wnba-canonical.jsonl";
const current=args.current||"artifacts/current/wnba-canonical.jsonl";
const historicalImpact=args.historicalImpact||"artifacts/frozen/wnba-player-impact-v1.json";
const availabilityFile=args.availability||"artifacts/wnba-availability.json";
const lineupFile=args.lineups||"artifacts/frozen/wnba-lineup-effects.json";
const out=args.out||"artifacts/wnba-player-impact-live.json";
const sqlOut=args.sql||"artifacts/wnba-player-impact-live.sql";
const asOf=args.asOf||new Date().toISOString();
const readJsonl=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const readJson=p=>{if(!fs.existsSync(p)||!fs.statSync(p).size)return null;try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return null}};
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=finite(v);return n==null?"NULL":String(n)};
const frozenGames=readJsonl(frozen);
const currentGames=readJsonl(current);
const games=[...new Map([...frozenGames,...currentGames].map(g=>[String(g.id),g])).values()].sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));
const playerIds=gs=>new Set(gs.flatMap(g=>g.players||[]).map(p=>String(p.id||p.name||"")).filter(Boolean));
const frozenPlayerIds=playerIds(frozenGames),currentPlayerIds=playerIds(currentGames),unionPlayerIds=playerIds(games);
const newCurrentPlayerIds=[...currentPlayerIds].filter(id=>!frozenPlayerIds.has(id));
const histArtifact=readJson(historicalImpact)||{players:{}};
const lineupArtifact=readJson(lineupFile)||{effects:[]};
const rawAvail=readJson(availabilityFile);
const availability=Array.isArray(rawAvail)
  ? (rawAvail.every(x=>Array.isArray(x?.results))?rawAvail.flatMap(x=>x.results||[]):rawAvail)
  : (Array.isArray(rawAvail?.results)?rawAvail.results:Array.isArray(rawAvail?.result)?rawAvail.result.flatMap(x=>x?.results||[]):[]);
const hist=new Map(),latest=new Map();
for(const g of games)for(const p of g.players||[]){
  const id=String(p.id||p.name||"");if(!id)continue;
  if(!hist.has(id))hist.set(id,[]);
  hist.get(id).push({...p,date:g.start||g.date,teamPossessions:g.possessions});
}
for(const g of currentGames)for(const p of g.players||[])latest.set(String(p.id||p.name||""),p);
function latestAvailability(id,name){
  return availability.filter(a=>(a.player_id&&String(a.player_id)===String(id))||String(a.player_name||"").toLowerCase()===String(name||"").toLowerCase())
    .filter(a=>!a.observed_at||Date.parse(a.observed_at)<=Date.parse(asOf))
    .sort((a,b)=>Date.parse(b.observed_at||0)-Date.parse(a.observed_at||0))[0]||null;
}
const impacts={};
for(const [id,rows] of hist){
  const cur=combineWnbaPlayerImpact({playerId:id,history:rows,asOf});if(!cur.ok)continue;
  const h=histArtifact.players?.[id]||null;
  const currentN=currentGames.flatMap(g=>g.players||[]).filter(p=>String(p.id||p.name)===id).length;
  const w=currentN/(currentN+6),blend=(a,b)=>a==null?b:b==null?a:a*w+b*(1-w);
  impacts[id]={...cur,offense:blend(cur.offense,finite(h?.offense)),defense:blend(cur.defense,finite(h?.defense)),net:blend(cur.net,finite(h?.net)),
    name:latest.get(id)?.name||h?.name||id,teamId:String(latest.get(id)?.teamId||h?.teamId||""),position:latest.get(id)?.position||h?.position||null,
    sourceBlend:{currentGames:currentN,currentWeight:w,historical:Boolean(h)}};
}
const teams=new Map();
for(const [id,p] of Object.entries(impacts)){if(!p.teamId)continue;if(!teams.has(p.teamId))teams.set(p.teamId,{});teams.get(p.teamId)[id]=p}
const roles={};
for(const [teamId,roster] of teams){
  const unavailable=[];
  for(const [id,p] of Object.entries(roster)){
    const a=latestAvailability(id,p.name);
    if(a&&["OUT","DOUBTFUL","QUESTIONABLE","PROBABLE"].includes(String(a.status||"").toUpperCase()))
      unavailable.push({playerId:id,status:a.status,source:a.source,observedAt:a.observed_at});
  }
  const verified=unavailable.length>0&&unavailable.every(x=>x.source&&x.observedAt);
  for(const id of Object.keys(roster)){
    const role=buildWnbaRoleRedistribution({targetPlayerId:id,rosterImpacts:roster,unavailablePlayers:unavailable});
    const mates=Object.keys(roster).filter(x=>x!==id&&!unavailable.some(u=>u.playerId===x&&String(u.status).toUpperCase()==="OUT"));
    const lineup=wnbaLineupModifier({playerId:id,lineupEffects:lineupArtifact.effects||[],expectedTeammates:mates});
    roles[id]={role,lineup,availabilityVerified:verified,unavailable};
  }
}
const createdAt=new Date().toISOString(),sql=[];
for(const [id,p] of Object.entries(impacts)){
  sql.push(`INSERT OR REPLACE INTO wnba_player_impact_snapshots (id,player_id,player_name,team_id,position,as_of,model_id,model_version,offense_impact,defense_impact,net_impact,rapm_net,bpm_style,vorp_style,ws48_style,dynamic_skill_json,provenance_json,production_eligible,created_at) VALUES (${q(id+":"+asOf)},${q(id)},${q(p.name)},${q(p.teamId)},${q(p.position)},${q(asOf)},'WNBA-FBIS-PLAYER-IMPACT-v1','research-v1',${num(p.offense)},${num(p.defense)},${num(p.net)},${num(p.rapm?.net)},${num(p.diagnostics?.bpmStyle)},${num(p.diagnostics?.vorpStylePerGame)},${num(p.diagnostics?.ws48Style)},${q(JSON.stringify(p.skill||{}))},${q(JSON.stringify(p.sourceBlend||{}))},0,${q(createdAt)});`);
}
for(const [id,x] of Object.entries(roles)){
  const p=impacts[id],r=x.role||{},l=x.lineup||{};
  sql.push(`INSERT OR REPLACE INTO wnba_player_role_contexts (id,player_id,player_name,team_id,feature_cutoff_timestamp,minutes_delta,usage_multiplier,points_multiplier,rebounds_multiplier,assists_multiplier,threes_multiplier,lineup_multiplier,unavailable_count,availability_verified,context_json,created_at) VALUES (${q(id+":"+asOf)},${q(id)},${q(p?.name)},${q(p?.teamId)},${q(asOf)},${num(r.minutesDelta)},${num(r.usageMultiplier)},${num(r.pointsMultiplier)},${num(r.reboundsMultiplier)},${num(r.assistsMultiplier)},${num(r.threesMultiplier)},${num(l.multiplier)},${Number(r.unavailableCount||0)},${x.availabilityVerified?1:0},${q(JSON.stringify(x))},${q(createdAt)});`);
}
const payload={asOf,modelId:"WNBA-FBIS-PLAYER-IMPACT-v1",players:impacts,roleContexts:roles,
 governance:{marketUsed:false,availabilityPointInTime:true,proprietaryMetricRequired:false,productionEligible:false}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");fs.writeFileSync(sqlOut,sql.join("\n")+"\n");
console.log(JSON.stringify({
  ok:true,
  players:Object.keys(impacts).length,
  roles:Object.keys(roles).length,
  verified:Object.values(roles).filter(x=>x.availabilityVerified).length,
  coverage:{
    frozenGames:frozenGames.length,currentGames:currentGames.length,
    frozenUniquePlayers:frozenPlayerIds.size,currentUniquePlayers:currentPlayerIds.size,
    unionUniquePlayers:unionPlayerIds.size,newCurrentPlayers:newCurrentPlayerIds.length
  }
},null,2));
