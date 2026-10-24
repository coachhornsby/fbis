#!/usr/bin/env node
/** nflfastR source-quality gate for verified possession transitions. */
import fs from "node:fs";
import path from "node:path";
const dir=process.argv[2]||"artifacts/football-sdv";
const file=path.join(dir,"normalized-research-games.jsonl");
const data=fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map(JSON.parse)
 .filter(g=>g.sport==="nfl"&&g.source==="NFL_PBP_VERIFIED_POSSESSIONS"&&
  g.regulationOnly===true&&g.officialScoreMatched===true);
const groups=new Map(),bySeason={};
for(const g of data){
 const key=String(g.gameId);
 if(!groups.has(key))groups.set(key,g);
 else if(Date.parse(g.observedAt)>Date.parse(groups.get(key).observedAt))
  groups.set(key,g);
}
const unique=[...groups.values()],drives=unique.flatMap(x=>x.drives);
const valid=d=>Number.isInteger(d.officialDurationSeconds)&&d.officialDurationSeconds>=0&&
 d.officialDurationSeconds<=1800&&typeof d.startTransition==="string"&&
 typeof d.endTransition==="string";
const source=drives.filter(valid),linked=source.filter(d=>
 Number.isInteger(d.observedNextStartYardsToGoal)&&d.observedNextStartYardsToGoal>=0&&
 d.observedNextStartYardsToGoal<=100&&
 ["home","away"].includes(d.observedNextOffense)&&
 typeof d.observedNextStartTransition==="string");
for(const g of unique){
 const key=String(g.season);
 const cohort=bySeason[key]??={games:0,drives:0,sourceReadyDrives:0,linkedNextStarts:0};
 cohort.games++;cohort.drives+=g.drives.length;
 cohort.sourceReadyDrives+=g.drives.filter(valid).length;
 cohort.linkedNextStarts+=g.drives.filter(d=>valid(d)&&
  Number.isInteger(d.observedNextStartYardsToGoal)).length;
}
const summary={at:new Date().toISOString(),sport:"nfl",evidence:"POSTGAME_RECONSTRUCTED_SDV",
 sourceFields:["drive_time_of_possession","drive_start_transition","drive_end_transition",
  "drive_start_yard_line","drive_end_yard_line"],
 uniqueGames:unique.length,drives:drives.length,
 reportedOfficialDurationAndTransitions:source.length,
 observedNextFieldChains:linked.length,
 sourceCoverage:drives.length?source.length/drives.length:0,
 linkedCoverage:source.length?linked.length/source.length:0,
 bySeason,officialEndTimeMode:"NFLFASTR_REPORTED_DRIVE_TOP_NOT_GAME_CLOCK_END",
 canQualify:false,canAuthorizeWager:false};
fs.writeFileSync(path.join(dir,"nfl-sdv-verified-transition-coverage.json"),
 JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
if(source.length<500||linked.length<350||summary.sourceCoverage<.65||summary.linkedCoverage<.60)
 throw Error("NFL_SDV_VERIFIED_TRANSITION_COVERAGE_INSUFFICIENT");
