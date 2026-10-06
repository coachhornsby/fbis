#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gamesFile=args.games||"artifacts/current/wnba-canonical.jsonl";
const statesFile=args.states||"artifacts/current/wnba-possession-state.jsonl";
const stintsFile=args.stints||"artifacts/current/wnba-lineup-stints.jsonl";
const qaFile=args.qa||"artifacts/frozen/wnba-possession-qa.json";
const out=args.out||"artifacts/wnba-team-possession-features.json";
const sqlOut=args.sql||"artifacts/wnba-team-possession-features.sql";
const asOf=args.asOf||new Date().toISOString();
const version="prospective-shadow-v1";
const read=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=finite(v);return n==null?"NULL":String(n)};
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null};
const sd=xs=>{const a=xs.filter(Number.isFinite);if(a.length<2)return null;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1))};
const weighted=(rows,key,halfLife=8)=>{let n=0,d=0;const a=[...rows].sort((x,y)=>Date.parse(y.date)-Date.parse(x.date));for(let i=0;i<a.length;i++){const v=finite(a[i][key]);if(v==null)continue;const w=Math.pow(.5,i/halfLife);n+=v*w;d+=w}return d?n/d:null};
const games=[...new Map(read(gamesFile).filter(g=>Date.parse(g.start||g.date)<Date.parse(asOf)).map(g=>[String(g.id),g])).values()].sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));
const states=[...new Map(read(statesFile).filter(s=>Date.parse(s.start||s.date)<Date.parse(asOf)).map(s=>[String(s.gameId||s.id),s])).values()];
const rawStints=read(stintsFile).filter(s=>Date.parse(s.date)<Date.parse(asOf));
const stints=[...new Map(rawStints.map(s=>[[s.gameId,s.startElapsed,s.endElapsed,(s.homePlayers||[]).join(","),(s.awayPlayers||[]).join(",")].join("|"),s])).values()];
let qa={};try{qa=JSON.parse(fs.readFileSync(qaFile,"utf8"))}catch{}
const stateBy=new Map(states.map(s=>[String(s.gameId||s.id),s]));
const hist=new Map();
for(const g of games){
  const s=stateBy.get(String(g.id));if(!s)continue;
  for(const [teamId,oppId] of [[String(g.homeId),String(g.awayId)],[String(g.awayId),String(g.homeId)]]){
    const t=s.teams?.[teamId];if(!t)continue;
    const gs=t.gameState||{},closePoss=(finite(gs.close?.possessions)||0)+(finite(gs.clutch?.possessions)||0);
    const closePts=(finite(gs.close?.points)||0)+(finite(gs.clutch?.points)||0);
    const row={date:g.start||g.date,gameId:String(g.id),teamId,oppId,
      closePossessions:closePoss,closeOrtg:closePoss?100*closePts/closePoss:null,
      pace:finite(s.qa?.reconstructedPossessions)};
    if(!hist.has(teamId))hist.set(teamId,[]);hist.get(teamId).push(row);
  }
}
const lineupBy=new Map();
for(const s of stints){
  const poss=finite(s.possessions),diff=finite(s.pointDifferential);if(!poss||diff==null)continue;
  for(const [teamId,sign] of [[String(s.homeTeamId),1],[String(s.awayTeamId),-1]]){
    if(!lineupBy.has(teamId))lineupBy.set(teamId,[]);
    lineupBy.get(teamId).push({date:s.date,poss,net100:sign*100*diff/poss});
  }
}
const leagueClose=mean([...hist.values()].flat().map(r=>finite(r.closeOrtg)))??100;
const durationCoverage=finite(qa?.lineup?.meanDurationCoverage)??0.7247506699464044;
const substitutionResolution=finite(qa?.lineup?.meanSubstitutionResolution)??0.8435033477321806;
const teams={};
for(const [teamId,rows0] of hist){
  const rows=rows0.slice(-14),gamesN=rows.length,closePoss=rows.reduce((s,r)=>s+(finite(r.closePossessions)||0),0);
  const rawClose=closePoss?rows.reduce((s,r)=>s+(finite(r.closeOrtg)||0)*(finite(r.closePossessions)||0),0)/closePoss:null;
  const shrink=closePoss/(closePoss+180),closeShrunk=rawClose==null?leagueClose:rawClose*shrink+leagueClose*(1-shrink);
  const pace=weighted(rows,"pace",8),paceSd=sd(rows.map(r=>finite(r.pace))),paceStability=pace==null||paceSd==null?0.5:Math.max(.25,Math.min(1,1-paceSd/10));
  const ls=(lineupBy.get(teamId)||[]).slice(-120);let ln=0,ld=0;for(const x of ls){const w=x.poss/(x.poss+25);ln+=x.net100*w*x.poss;ld+=w*x.poss}
  const lineupNet=ld?ln/ld:null,lineupPoss=ls.reduce((s,x)=>s+x.poss,0),sampleRel=lineupPoss/(lineupPoss+450);
  const lineupReliability=Math.max(0,Math.min(1,sampleRel*durationCoverage*substitutionResolution));
  teams[teamId]={teamId,asOf,games:gamesN,closePossessions:closePoss,closeOrtg:rawClose,closeOrtgShrunk:closeShrunk,
    reconstructedPace:pace,paceStability,lineupNet100:lineupNet,lineupPossessions:lineupPoss,
    lineupDurationCoverage:durationCoverage,substitutionResolution,lineupReliability,
    feature:{leagueCloseOrtg:leagueClose,closeShrinkage:shrink,lineupSampleReliability:sampleRel,sourceGames:rows.map(r=>r.gameId)}};
}
const createdAt=new Date().toISOString(),sql=[];
for(const x of Object.values(teams)){
  const id=`${x.teamId}:${asOf}:${version}`;
  sql.push(`INSERT OR REPLACE INTO wnba_team_possession_feature_snapshots (id,team_id,as_of,model_version,games,close_possessions,close_ortg,close_ortg_shrunk,reconstructed_pace,pace_stability,lineup_net100,lineup_possessions,lineup_duration_coverage,substitution_resolution,lineup_reliability,feature_json,market_informed,production_eligible,created_at) VALUES (${q(id)},${q(x.teamId)},${q(asOf)},${q(version)},${x.games},${num(x.closePossessions)},${num(x.closeOrtg)},${num(x.closeOrtgShrunk)},${num(x.reconstructedPace)},${num(x.paceStability)},${num(x.lineupNet100)},${num(x.lineupPossessions)},${num(x.lineupDurationCoverage)},${num(x.substitutionResolution)},${num(x.lineupReliability)},${q(JSON.stringify(x.feature))},0,0,${q(createdAt)});`);
}
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify({asOf,version,teams,governance:{marketInformed:false,productionEligible:false}},null,2)+"\n");
fs.writeFileSync(sqlOut,sql.join("\n")+"\n");
console.log(JSON.stringify({ok:true,asOf,teams:Object.keys(teams).length,leagueClose,durationCoverage,substitutionResolution},null,2));
