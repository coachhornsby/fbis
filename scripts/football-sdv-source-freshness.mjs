#!/usr/bin/env node
/** Fail closed when the football SDV release lags completed games.
 * This is a health gate, not an alternate scoreboard-to-grade path.
 */
import fs from "node:fs";
const dir=process.env.SDV_OUT||"artifacts/football-sdv";
const now=new Date(process.env.SDV_AUDIT_NOW||Date.now());
const year=now.getUTCFullYear();
const month=now.getUTCMonth()+1;
const liveSeason=month>=9&&month<=12;
const data=fs.readFileSync(dir+"/normalized-research-games.jsonl","utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
const report={checkedAt:now.toISOString(),liveSeason,canAuthorizeWager:false,sports:{}};
let failure=false;
for(const sport of ["nfl","cfb"]){
 const games=data.filter(g=>g.sport===sport&&g.season===year);
 const last=games.reduce((v,g)=>Math.max(v,Date.parse(g.kickoff)||0),0);
 const lagHours=last?Math.round((now.getTime()-last)/3600000):null;
 // Three days accommodates sportsdata release latency and bye-week gaps,
 // while detecting a source frozen for more than a game week.
 const stale=liveSeason && (last===0||lagHours>168);
 report.sports[sport]={games:games.length,latestKickoff:last?new Date(last).toISOString():null,lagHours,stale};
 if(stale)failure=true;
}
fs.writeFileSync(dir+"/source-freshness-audit.json",JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(failure){console.error("FOOTBALL_SDV_SOURCE_STALE: official PBP is not current; do not infer valid outcomes from scoreboard alone");process.exitCode=1}
