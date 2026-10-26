#!/usr/bin/env node
/** Postgame possession and drive audit: descriptive research, not pregame model features.
 * ESPN drive records can omit or group kickoffs, kneels, and overtime; never self-certify complete.
 */
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {join} from "node:path";
const root=process.env.CFB_EVIDENCE_OUT||"artifacts/cfb-2026-weeks05-08";
const roster=JSON.parse(readFileSync("data/cfb/2026/weeks05-08-game-roster.json","utf8"));
const rows=[];
for(const game of roster){
 const dir=join(root,"week"+String(game.week).padStart(2,"0"),String(game.game_id));
 const p=join(dir,"drives-espn.json");
 let drives=[];
 if(existsSync(p)){
  const payload=JSON.parse(readFileSync(p,"utf8"));
  drives=Array.isArray(payload.previous)?payload.previous:[];
 }
 const resultCounts={},teamCounts={},starting=[];
 for(const drive of drives){
  const end=String(drive.displayResult??drive.result??"UNKNOWN");
  resultCounts[end]=(resultCounts[end]||0)+1;
  const team=String(drive.team?.displayName??drive.team?.id??"UNKNOWN");
  teamCounts[team]=(teamCounts[team]||0)+1;
  const y=drive.start?.yardLine;
  if(y!=null&&Number.isFinite(Number(y)))starting.push(Number(y));
 }
 const output={game_id:String(game.game_id),week:game.week,observedDrives:drives.length,
  observedResults:resultCounts,observedTeamDrives:teamCounts,
  observedStartYardlineCount:starting.length,
  observedStartYardlineMean:starting.length?starting.reduce((a,b)=>a+b,0)/starting.length:null,
  completePossessionHistoryVerified:false,source:"ESPN_SECONDARY",researchOnly:true};
 writeFileSync(join(dir,"possession-postgame-research.json"),JSON.stringify(output,null,2)+"\n");
 rows.push(output);
}
const report={schema:"fbis.cfb.phase4.possessions.v1",games:rows.length,
 gamesWithDrives:rows.filter(r=>r.observedDrives>0).length,
 totalObservedDrives:rows.reduce((a,b)=>a+b.observedDrives,0),
 completeHistoryVerified:0, authority:"RESEARCH_ONLY",
 rows};
writeFileSync(join(root,"phase4-possession-research.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({games:report.games,gamesWithDrives:report.gamesWithDrives,totalObservedDrives:report.totalObservedDrives}));
