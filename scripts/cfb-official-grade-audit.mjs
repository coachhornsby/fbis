#!/usr/bin/env node
/** Independent CFB final-score grading. No database writes, no betting authority.
 * Inputs: JSON arrays of game records, frozen prediction snapshots, official results.
 * Usage: node scripts/cfb-official-grade-audit.mjs games.json snapshots.json official.json output.json
 */
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const utc=v=>{if(typeof v!=="string")return NaN;const s=/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v)?v.replace(" ","T")+"Z":v;return /(?:Z|[+-]\d\d:\d\d)$/.test(s)?Date.parse(s):NaN;};
const numeric=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v));
export function grade(games,snapshots,official){
 if(!Array.isArray(games)||!Array.isArray(snapshots)||!Array.isArray(official))throw Error("ARRAY_INPUTS_REQUIRED");
 const byId=new Map(), finals=new Map();
 for(const p of snapshots){const id=String(p.game_id??"");if(!byId.has(id))byId.set(id,[]);byId.get(id).push(p);}
 for(const f of official){const id=String(f.game_id??"");if(!id||finals.has(id))throw Error("DUPLICATE_OR_MISSING_OFFICIAL_ID:"+id);finals.set(id,f);}
 const results=games.map(g=>{
  const id=String(g.game_id??g.id),kickoff=utc(g.kickoff_literal??g.start_date??g.kickoffUtc);
  const snap=(byId.get(id)||[]).filter(p=>utc(p.frozen_at)<kickoff&&p.model_version&&numeric(p.proj_home)&&numeric(p.proj_away))
    .sort((a,b)=>utc(a.frozen_at)-utc(b.frozen_at))[0];
  const f=finals.get(id);
  const officialValid=f?.verified===true&&typeof f.source_url==="string"&&f.source_url.startsWith("https://")&&
    numeric(f.home_score)&&numeric(f.away_score)&&f.home_team===g.home_team_source&&f.away_team===g.away_team;
  let row={game_id:id,week:Number(g.week),savedPregame:!!snap,officialVerified:!!officialValid,
    status:!snap?"NO_ELIGIBLE_PREGAME_PROJECTION":!officialValid?"OFFICIAL_FINAL_UNVERIFIED":"GRADED",
    model:snap?.model_version??null,source:f?.source_url??null,marginError:null,totalError:null,homeError:null,awayError:null};
  if(snap&&officialValid){const ph=Number(snap.proj_home),pa=Number(snap.proj_away),ah=Number(f.home_score),aa=Number(f.away_score);
   row={...row,marginError:(ph-pa)-(ah-aa),totalError:(ph+pa)-(ah+aa),homeError:ph-ah,awayError:pa-aa,
    projectedWinner:Math.sign(ph-pa),actualWinner:Math.sign(ah-aa),winnerCorrect:Math.sign(ph-pa)===Math.sign(ah-aa)};}
  return row;
 });
 const graded=results.filter(r=>r.status==="GRADED"),mean=key=>graded.length?graded.reduce((s,r)=>s+Math.abs(r[key]),0)/graded.length:null;
 return {schema:"fbis.cfb.official_grade_audit.v1",games:results.length,graded:graded.length,
  unresolved:results.length-graded.length,marginMAE:mean("marginError"),totalMAE:mean("totalError"),
  homeMAE:mean("homeError"),awayMAE:mean("awayError"),
  winnerAccuracy:graded.length?graded.filter(x=>x.winnerCorrect).length/graded.length:null,
  cohortAuthority:"RESEARCH_ONLY",modelPromotion:false,wagerAuthority:false,rows:results};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [games,snaps,official,out]=process.argv.slice(2);
 if(!games||!snaps||!official||!out)throw Error("Usage: games.json snapshots.json official.json output.json");
 const report=grade(...[games,snaps,official].map(f=>JSON.parse(readFileSync(f,"utf8"))));
 writeFileSync(out,JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({games:report.games,graded:report.graded,unresolved:report.unresolved,marginMAE:report.marginMAE}));
}
