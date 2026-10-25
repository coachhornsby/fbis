#!/usr/bin/env node
// NBA current-season grading only; never changes wagering permissions.
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {pathToFileURL} from "node:url";
const safeId=x=>typeof x==="string"&&x.length>0&&x.length<256;
const number=x=>x!==null&&x!==""&&Number.isFinite(Number(x))?Number(x):null;
const esc=x=>"'"+String(x).replaceAll("'","''")+"'";
const parseD1=x=>Array.isArray(x)?x.flatMap(a=>a?.results||[]):Array.isArray(x?.results)?x.results:[];
const statValue=(p,m)=>m==="three_pointers_made"?number(p.threes):m==="pra"?
  [p.points,p.rebounds,p.assists].every(x=>number(x)!==null)?
  number(p.points)+number(p.rebounds)+number(p.assists):null:number(p[m]);
export function buildNbaCurrentGrade({canonical=[],projections=[],props=[],gradedAt=new Date().toISOString()}={}){
 const final=new Map();
 for(const g of canonical){
  const h=number(g.homeScore),a=number(g.awayScore);
  const start=Date.parse(g.start);
  if(!safeId(String(g.id||""))||!Number.isInteger(h)||!Number.isInteger(a)||h<0||a<0||h>250||a>250||!Number.isFinite(start))continue;
  final.set(String(g.id),g);
 }
 const sql=[],stats={canonicalFinalGames:final.size,gameGraded:0,propGraded:0,
  gamePreTipoffExcluded:0,propPreTipoffExcluded:0,unmatchedGame:0,unmatchedPlayer:0,unverifiedStat:0};
 const validTime=(row,g)=>Number.isFinite(Date.parse(row.feature_cutoff_timestamp))&&
  Date.parse(row.feature_cutoff_timestamp)<Date.parse(g.start);
 const validRow=(row)=>safeId(row.id)&&safeId(String(row.game_id||""))&&row.graded_at==null;
 for(const row of projections){
  if(!validRow(row))continue;
  const g=final.get(String(row.game_id));
  if(!g){stats.unmatchedGame++;continue}
  if(!validTime(row,g)){stats.gamePreTipoffExcluded++;continue}
  const h=number(g.homeScore),a=number(g.awayScore);
  sql.push(`UPDATE nba_game_projections SET actual_home=${h},actual_away=${a},graded_at=${esc(gradedAt)} WHERE id=${esc(row.id)} AND graded_at IS NULL AND datetime(feature_cutoff_timestamp)<datetime(${esc(g.start)});`);
  stats.gameGraded++;
 }
 const playerIndexes=new Map();
 for(const [gameId,g] of final){
  const players=new Map();
  for(const p of g.players||[])if(safeId(String(p.id||""))&&!players.has(String(p.id)))players.set(String(p.id),p);
  playerIndexes.set(gameId,players);
 }
 for(const row of props){
  if(!validRow(row))continue;
  const g=final.get(String(row.game_id));
  if(!g){stats.unmatchedGame++;continue}
  if(!validTime(row,g)){stats.propPreTipoffExcluded++;continue}
  const p=playerIndexes.get(String(row.game_id))?.get(String(row.player_id));
  if(!p){stats.unmatchedPlayer++;continue}
  if(!["points","rebounds","assists","three_pointers_made","pra"].includes(row.market_type)){stats.unverifiedStat++;continue}
  const v=statValue(p,row.market_type);
  if(v===null||v<0||!Number.isInteger(v)){stats.unverifiedStat++;continue}
  sql.push(`UPDATE nba_player_prop_projections SET actual_value=${v},graded_at=${esc(gradedAt)} WHERE id=${esc(row.id)} AND graded_at IS NULL AND datetime(feature_cutoff_timestamp)<datetime(${esc(g.start)});`);
  stats.propGraded++;
 }
 return {sql,stats,canAuthorize:false};
}
async function main(){
 const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
 const canonical=(await readFile(args.canonical||"artifacts/current/nba-canonical.jsonl","utf8")).split("\n").filter(Boolean).map(JSON.parse);
 const games=parseD1(JSON.parse(await readFile(args.games||"artifacts/nba-ungraded-games.json","utf8")));
 const props=parseD1(JSON.parse(await readFile(args.props||"artifacts/nba-ungraded-props.json","utf8")));
 const receipt=buildNbaCurrentGrade({canonical,projections:games,props});
 const file=args.sql||"artifacts/nba-current-grades.sql",summary=args.out||"artifacts/nba-current-grades.json";
 await mkdir("artifacts",{recursive:true});
 await writeFile(file,receipt.sql.join("\n")+(receipt.sql.length?"\n":""));
 await writeFile(summary,JSON.stringify({ok:true,generatedAt:new Date().toISOString(),...receipt.stats,statements:receipt.sql.length,canAuthorize:false},null,2)+"\n");
 console.log(JSON.stringify(receipt.stats));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(e=>{console.error(e.message);process.exitCode=1});
