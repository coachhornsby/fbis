#!/usr/bin/env node
/** Dynamic weekly postgame evidence: ONLY originally saved pregame CFB-v2 projections,
 * ESPN reported finals and independently matched NCAA finals.
 * Read-only collector; D1 research writes occur only after R2 SHA-256 readback.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {compare} from './cfb-phase4-ncaa-verify.mjs';
const root=process.env.CFB_POSTGAME_OUT||'artifacts/cfb-live-postgame';
const NCAA_HASH='7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c';
export function unwrapD1(content){return Array.isArray(content)&&Array.isArray(content[0]?.results)?content[0].results:Array.isArray(content)?content:null;}
export function originalSnapshot(rows,kickoff){
 return rows.filter(p=>p.frozen_at&&Date.parse(p.frozen_at)<Date.parse(kickoff)
  &&p.model_version==='CFB-FBIS-v2'&&p.proj_home!=null&&p.proj_away!=null&&Number.isFinite(Number(p.proj_home))&&Number.isFinite(Number(p.proj_away)))
 .sort((a,b)=>Date.parse(a.frozen_at)-Date.parse(b.frozen_at))[0]||null;
}
export function gradeOnce({source,original,espn,verifiedOfficial}){
 if(!original)return {game_id:String(source.game_id),status:'MISSING_ORIGINAL_PREGAME_PROJECTION',officialVerified:false};
 if(!verifiedOfficial?.independent_ncaa_verified)return {game_id:String(source.game_id),status:'NCAA_FINAL_NOT_VERIFIED',officialVerified:false};
 const home=Number(verifiedOfficial.ncaa_home),away=Number(verifiedOfficial.ncaa_away);
 if(!Number.isFinite(home)||!Number.isFinite(away)||!espn?.reportedFinal)return {game_id:String(source.game_id),status:'MISSING_VALID_FINAL',officialVerified:false};
 const ph=Number(original.proj_home),pa=Number(original.proj_away);
 return {game_id:String(source.game_id),week:Number(source.week),status:'OFFICIAL_GRADED_RESEARCH_ONLY',
  originalFrozenAt:original.frozen_at,originalModelVersion:original.model_version,
  projectedHome:ph,projectedAway:pa,officialHome:home,officialAway:away,
  marginError:(ph-pa)-(home-away),totalError:(ph+pa)-(home+away),
  correctWinner:Math.sign(ph-pa)===Math.sign(home-away),
  ncaaContestId:verifiedOfficial.ncaa_contest_id,ncaaScoreboardUrl:verifiedOfficial.ncaa_scoreboard_url,
  officialVerified:true,prospectiveChallengerQualifier:false,wagerAuthority:false,modelPromotion:false,canAuthorizeWager:false,canPromoteModel:false};
}
async function fetchJson(url){
 const res=await fetch(url,{signal:AbortSignal.timeout(25000)});
 if(!res.ok)throw Error('HTTP_'+res.status);
 return res.json();
}
const input=process.argv[2];
if(input&&process.argv[1]?.endsWith('cfb-weekly-postgame-settle.mjs')){
 const data=JSON.parse(readFileSync(input,'utf8'));
 const rows=unwrapD1(data);
 if(!Array.isArray(rows)||!rows.length)throw Error('NO_WEEKLY_SOURCE_RECEIPTS');
 const chosen=rows.filter(x=>x.source_sha===rows[0].source_sha),games=new Map();
 for(const row of chosen){const id=String(row.game_id);if(!games.has(id))games.set(id,[]);games.get(id).push(row);}
 const week=Number(chosen[0].week);
 const url=new URL('https://sdataprod.ncaa.com/');
 url.searchParams.set('extensions',JSON.stringify({persistedQuery:{version:1,sha256Hash:NCAA_HASH}}));
 url.searchParams.set('variables',JSON.stringify({sportCode:'MFB',division:11,seasonYear:2026,week}));
 const source=await fetchJson(url);
 const contests=source.data?.contests;
 if(!Array.isArray(contests))throw Error('OFFICIAL_NCAA_WEEK_SCOREBOARD_UNAVAILABLE');
 mkdirSync(root,{recursive:true});
 writeFileSync(join(root,'ncaa-week-scoreboard.json'),JSON.stringify(source));
 const used=new Set(),results=[];
 for(const [id,records] of games){
  const r=records[0],feature=JSON.parse(r.features_json),g={...feature,home_team_source:feature.home_team,away_team_source:feature.away_team,week};
  const dir=join(root,id);mkdirSync(dir,{recursive:true});
  const earliest=originalSnapshot(records, r.kickoff_utc);
  const receipt={game_id:id,season:2026,week,kickoff:r.kickoff_utc,sourceSha:r.source_sha,
    originalSaved:!!earliest,officialVerified:false,canAuthorizeWager:false};
  let summary=null,report=null,official=null;
  try{
   summary=await fetchJson('https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event='+id);
   writeFileSync(join(dir,'espn-original-summary.json'),JSON.stringify(summary));
   const competition=summary.header?.competitions?.[0],teams=competition?.competitors||[];
   const home=teams.find(x=>x.homeAway==='home'),away=teams.find(x=>x.homeAway==='away');
   const final=competition?.status?.type?.completed===true||competition?.status?.type?.name==='STATUS_FINAL';
   report={reportedFinal:!!(final&&home?.score!=null&&away?.score!=null),secondary_home_score:home?.score??null,secondary_away_score:away?.score??null};
   if(report.reportedFinal){
    official=compare(g,report,contests,used);
    if(official.independent_ncaa_verified)used.add(String(official.ncaa_contest_id));
    writeFileSync(join(dir,'ncaa-final-verification.json'),JSON.stringify(official));
   }
  }catch(e){receipt.sourceError=String(e);}
  const grade=gradeOnce({source:r,original:earliest,espn:report,verifiedOfficial:official});
  receipt.status=grade.status;
  writeFileSync(join(dir,'source-identity-and-freeze.json'),JSON.stringify({game_id:id,week,kickoff:r.kickoff_utc,sourceSha:r.source_sha,modelFrozenAt:earliest?.frozen_at??null},null,2));
  writeFileSync(join(dir,'postgame-grade.json'),JSON.stringify(grade,null,2));
  results.push({...receipt,...grade});
 }
 const officialGames=results.filter(x=>x.officialVerified);
 const result={schema:'fbis.cfb.weekly_postgame_settlement.v1',season:2026,week,sourceSha:chosen[0].source_sha,
  sourceGames:games.size,officialSettled:officialGames.length,unsettled:results.filter(x=>!x.officialVerified).length,
  winnerAccuracy:officialGames.length?officialGames.filter(x=>x.correctWinner).length/officialGames.length:null,
  marginMAE:officialGames.length?officialGames.reduce((a,x)=>a+Math.abs(x.marginError),0)/officialGames.length:null,
  records:results,canPromoteModel:false,canAuthorizeWager:false,productionChampionChanged:false};
 writeFileSync(join(root,'manifest.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({season:2026,week,games:result.sourceGames,settled:result.officialSettled,unsettled:result.unsettled}));
}
