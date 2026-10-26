#!/usr/bin/env node
/** Research-only CFB game archive collector. No DB writes or wagering/model authority.
 * Usage: node scripts/cfb-game-evidence-archive.mjs training_data_2026_week09.csv --out-dir artifacts/cfb/week09
 * Queries ESPN public scoreboard/summary, which is SECONDARY reporting (NOT official NCAA verification).
 * Network failures and absent plays leave explicit incomplete receipts.
 */
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {parseCsv} from "./cfb-weekly-input-guard.mjs";
export const sha256 = x=>createHash("sha256").update(x).digest("hex");
export function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
export function csvGames(csv){
 const [h,...rows]=parseCsv(csv.replace(/^\uFEFF/,""));
 for(const key of ["id","start_date","season","week","home_team","away_team"])if(!h.includes(key))throw Error("MISSING:"+key);
 const ids=new Set();
 return rows.map((v,i)=>{
  if(v.length!==h.length)throw Error("WIDTH:"+i);
  const g=Object.fromEntries(h.map((k,j)=>[k,v[j]]));
  if(ids.has(g.id))throw Error("DUPLICATE:"+g.id);ids.add(g.id);
  return g;
 });
}
export function matchEvent(g,events){
 const same=(a,b)=>slug(a)===slug(b);
 const candidates=events.filter(e=>{
  const teams=e.competitions?.[0]?.competitors||[];
  const home=teams.find(t=>t.homeAway==="home"),away=teams.find(t=>t.homeAway==="away");
  return home&&away&&same(home.team?.displayName,g.home_team)&&same(away.team?.displayName,g.away_team);
 });
 if(candidates.length!==1)return null;
 const e=candidates[0];
 const original=Date.parse(g.start_date.replace(" ","T")+"Z"),actual=Date.parse(e.date);
 if(!Number.isFinite(original)||!Number.isFinite(actual)||Math.abs(actual-original)>36*3600000)return null;
 return e;
}
export function outcome(event,summary){
 const teams=event?.competitions?.[0]?.competitors||[];
 const home=teams.find(t=>t.homeAway==="home"),away=teams.find(t=>t.homeAway==="away");
 const finished=event?.status?.type?.completed===true;
 const hs=Number(home?.score),as=Number(away?.score);
 const plays=summary?.drives?.previous?.flatMap(d=>d.plays||[])||[];
 const all=summary?.drives?.current?.plays||[];
 const pbp=Array.isArray(summary?.plays)?summary.plays:[...plays,...all];
 return {eventStatus:event?.status?.type?.name||null,
  finalReported:finished&&home?.score!=null&&away?.score!=null&&Number.isFinite(hs)&&Number.isFinite(as),
  homeScore:finished&&Number.isFinite(hs)?hs:null,awayScore:finished&&Number.isFinite(as)?as:null,
  reportingSource:"ESPN_SECONDARY",officialVerified:false,
  plays:pbp,playCount:pbp.length,driveCount:summary?.drives?.previous?.length||0,
  pbpComplete:false,possessionsVerified:false};
}
export async function collect(games,{outDir,fetcher=fetch}){
 mkdirSync(outDir,{recursive:true});
 const dateSet=new Set(games.map(g=>g.start_date.slice(0,10).replaceAll("-","")));
 const events=[];
 for(const date of dateSet){
  const url="https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates="+date+"&limit=500&groups=80";
  try {const res=await fetcher(url);if(!res.ok)throw Error("HTTP_"+res.status);events.push(...(await res.json()).events||[]);}
  catch(e){console.error("SCOREBOARD_FAILED",date,String(e));}
 }
 const manifest=[];
 for(const g of games){
  const id=String(g.id),dir=join(outDir,id+"-"+slug(g.away_team)+"-at-"+slug(g.home_team));
  mkdirSync(dir,{recursive:true});
  const pregame=JSON.stringify(g,null,2)+"\n";
  writeFileSync(join(dir,"pregame-source-row.json"),pregame);
  const event=matchEvent(g,events);
  const summaryUrl=event?"https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event="+event.id:null;
  let summary=null,error=null;
  if(summaryUrl)try{const r=await fetcher(summaryUrl);if(!r.ok)throw Error("HTTP_"+r.status);summary=await r.json();}
  catch(e){error=String(e);}
  const result=event?outcome(event,summary):null;
  if(event)writeFileSync(join(dir,"espn-event.json"),JSON.stringify(event,null,2)+"\n");
  if(summary)writeFileSync(join(dir,"espn-summary.json"),JSON.stringify(summary,null,2)+"\n");
  const receipt={schema:"fbis.cfb.game_evidence.v1",season:Number(g.season),week:Number(g.week),sourceGameId:id,
   csvRowSha256:sha256(JSON.stringify(g)),pregameOriginalPublicationVerified:false,
   retrospectiveBackfill:true,prospectiveEligible:false,
   espnEventId:event?.id||null,espnSummaryUrl:summaryUrl,
   espnFetchError:error,sourceMatch:!!event,
   ...(result?{reportedFinal:result.finalReported,homeScore:result.homeScore,awayScore:result.awayScore,playCount:result.playCount,driveCount:result.driveCount,
    officialFinalVerified:false,playByPlayComplete:false,possessionsVerified:false}:
    {reportedFinal:false,homeScore:null,awayScore:null,playCount:0,driveCount:0,officialFinalVerified:false,playByPlayComplete:false,possessionsVerified:false}),
   officialSourceUrl:null,officialVerificationTimestamp:null,
   modelGradeEligible:false,economicGradeEligible:false,wagerAuthority:false,championChanged:false,
   status:!event?"UNMATCHED":error?"FETCH_FAILED":result?.finalReported?"SECONDARY_RESULT_REQUIRES_OFFICIAL_RECONCILIATION":"AWAITING_FINAL_OR_DATA"};
  writeFileSync(join(dir,"evidence-receipt.json"),JSON.stringify(receipt,null,2)+"\n");
  manifest.push(receipt);
 }
 writeFileSync(join(outDir,"manifest.json"),JSON.stringify({schema:"fbis.cfb.game_archive_manifest.v1",
  gameCount:games.length,matched:manifest.filter(x=>x.sourceMatch).length,secondaryFinals:manifest.filter(x=>x.reportedFinal).length,
  officialVerified:0,verifiedPossessions:0,records:manifest},null,2)+"\n");
 return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [csv,flag,outDir]=process.argv.slice(2);
 if(!csv||flag!=="--out-dir"||!outDir)throw Error("Usage: CSV --out-dir DIR");
 await collect(csvGames(readFileSync(csv,"utf8")),{outDir});
}
