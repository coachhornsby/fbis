#!/usr/bin/env node
/** Structural play-by-play audit of separately persisted raw game package.
 * Failing internal identity/score checks is NOT an independent PBP completeness certificate.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
export function auditGame({plays,drives,official,gameId}){
 if(!Array.isArray(plays)||!Array.isArray(drives))throw Error('ARRAYS_REQUIRED');
 const ids=plays.map(p=>String(p.id??''));
 const missingIds=ids.filter(x=>!x),dupIds=ids.length-new Set(ids).size;
 const inDrive=drives.flatMap(d=>(d.plays||[]).map(p=>String(p.id)));
 const orphanDrivePlayIds=[...new Set(inDrive.filter(id=>!new Set(ids).has(id)))];
 const last=plays.at(-1),matchesLast=Number(last?.homeScore)===Number(official?.ncaa_home)&&Number(last?.awayScore)===Number(official?.ncaa_away);
 const officialConfirmed=official?.independent_ncaa_verified===true;
 const issues=[];
 if(!plays.length)issues.push('NO_PLAYS');
 if(!drives.length)issues.push('NO_DRIVES');
 if(missingIds.length)issues.push('BLANK_PLAY_IDS');
 if(dupIds)issues.push('DUPLICATE_PLAY_IDS');
 if(orphanDrivePlayIds.length)issues.push('DRIVE_REFERENCES_MISSING_PLAY');
 if(!officialConfirmed)issues.push('UNVERIFIED_FINAL');
 if(!matchesLast)issues.push('LAST_PLAY_SCORE_DISAGREES_NCAA_FINAL');
 return {game_id:String(gameId),play_count:plays.length,drive_count:drives.length,duplicated_play_ids:dupIds,
  missing_drive_references:orphanDrivePlayIds,independent_final_verified:officialConfirmed,
  terminal_score_agrees:matchesLast,issues,structurally_consistent:issues.length===0,
  cross_provider_pbp_complete:false,provenance:'ESPN_PLAY_BY_PLAY_PLUS_NCAA_FINAL',wagerAuthority:false,modelPromotion:false};
}
if(process.argv[1]?.endsWith('cfb-phase5-pbp-integrity.mjs')){
 const root=process.env.CFB_EVIDENCE_OUT||'artifacts/cfb-2026-weeks05-08';
 const roster=JSON.parse(readFileSync('data/cfb/2026/weeks05-08-game-roster.json','utf8'));
 const summary=JSON.parse(readFileSync(join(root,'ncaa-official-reconciliation-summary.json'),'utf8'));
 const byId=new Map(summary.rows.map(x=>[String(x.game_id),x]));
 const rows=[];
 for(const g of roster){
  const dir=join(root,'week'+String(g.week).padStart(2,'0'),String(g.game_id));
  const plays=JSON.parse(readFileSync(join(dir,'plays-espn.json'),'utf8'));
  const drives=JSON.parse(readFileSync(join(dir,'drives-espn.json'),'utf8')).previous||[];
  const receipt=auditGame({plays,drives,official:byId.get(String(g.game_id)),gameId:g.game_id});
  rows.push(receipt);writeFileSync(join(dir,'pbp-integrity-audit.json'),JSON.stringify(receipt,null,2));
 }
 if(rows.length!==226)throw Error('EXPECTED_226');
 const report={schema:'fbis.cfb.phase5.pbp_structural.v1',games:rows.length,
  playCount:rows.reduce((s,r)=>s+r.play_count,0),driveCount:rows.reduce((s,r)=>s+r.drive_count,0),
  structurallyConsistent:rows.filter(r=>r.structurally_consistent).length,
  issues:rows.filter(r=>r.issues.length).map(r=>({game_id:r.game_id,issues:r.issues})),
  independentlyCompletePossessions:0,authority:'RESEARCH_ONLY',rows};
 writeFileSync(join(root,'phase5-pbp-structural-audit.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({games:report.games,plays:report.playCount,drives:report.driveCount,consistent:report.structurallyConsistent,anomalies:report.issues}));
}
