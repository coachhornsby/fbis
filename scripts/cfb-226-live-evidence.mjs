#!/usr/bin/env node
/** Collect raw ESPN event summary, secondary finals, boxscore and drives for all 226 source game IDs.
 * Research-only, read-only network client. Evidence never self-attests official NCAA verification.
 */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const roster=JSON.parse(readFileSync('data/cfb/2026/weeks05-08-game-roster.json','utf8'));
if(roster.length!==226||new Set(roster.map(g=>String(g.game_id))).size!==226)throw Error('INVALID_SOURCE_ROSTER');
const root=process.env.CFB_EVIDENCE_OUT||'artifacts/cfb-2026-weeks05-08';
mkdirSync(root,{recursive:true});
const sleep=n=>new Promise(r=>setTimeout(r,n));
async function get(url){
 let last;
 for(let n=0;n<4;n++){
  try{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
   try{const r=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'FBIS-Research-Evidence/1.0'}});
    if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);}
  }catch(e){last=String(e);await sleep((n+1)*1300);}
 }
 throw Error(last);
}
async function capture(g){
 const id=String(g.game_id);
 const dir=join(root,'week'+String(g.week).padStart(2,'0'),id);
 mkdirSync(dir,{recursive:true});
 const receipt={game_id:id,week:g.week,home_team:g.home_team_source,away_team:g.away_team_source,
  kickoff:g.kickoff_literal,operator_source_publication:'PRE_KICKOFF_ATTESTED',collected_at:new Date().toISOString(),
  official_source_verified:false,complete_pbp_verified:false,possession_boundaries_verified:false,
  wager_authorized:false,model_promotion_authorized:false};
 writeFileSync(join(dir,'source-identity.json'),JSON.stringify(g,null,2));
 try {
  const summary=await get('https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event='+encodeURIComponent(id));
  const header=summary.header?.competitions?.[0];
  const participants=header?.competitors||[];
  const home=participants.find(p=>p.homeAway==='home'),away=participants.find(p=>p.homeAway==='away');
  const completed=summary.header?.competitions?.[0]?.status?.type?.completed===true||summary.header?.competitions?.[0]?.status?.type?.name==='STATUS_FINAL';
  receipt.reported_final=completed&&home?.score!==undefined&&away?.score!==undefined;
  receipt.secondary_home_score=receipt.reported_final?Number(home.score):null;
  receipt.secondary_away_score=receipt.reported_final?Number(away.score):null;
  receipt.secondary_source='ESPN_GAME_SUMMARY';
  receipt.secondary_url='https://www.espn.com/college-football/game/_/gameId/'+id;
  const playSet=summary.plays||summary.drives?.previous?.flatMap(d=>d.plays||[])||[];
  receipt.retrieved_play_count=playSet.length;
  receipt.retrieved_drive_count=summary.drives?.previous?.length||0;
  receipt.boxscore_present=!!summary.boxscore;
  receipt.summary_sha256=hash(summary);
  writeFileSync(join(dir,'raw-espn-summary.json'),JSON.stringify(summary,null,2));
  if(summary.boxscore)writeFileSync(join(dir,'boxscore-espn.json'),JSON.stringify(summary.boxscore,null,2));
  if(summary.drives)writeFileSync(join(dir,'drives-espn.json'),JSON.stringify(summary.drives,null,2));
  if(playSet.length)writeFileSync(join(dir,'plays-espn.json'),JSON.stringify(playSet,null,2));
 } catch(e){receipt.collection_error=String(e);}
 writeFileSync(join(dir,'evidence-receipt.json'),JSON.stringify(receipt,null,2));
 return receipt;
}
const receipts=[];
for(let offset=0;offset<roster.length;offset+=6){
 const batch=roster.slice(offset,offset+6);
 receipts.push(...await Promise.all(batch.map(capture)));
 console.log('processed',Math.min(roster.length,offset+6),'of',roster.length);
}
const manifest={schema:'fbis.cfb.week05-08_live_collection.v1',collected_at:new Date().toISOString(),
 games:receipts.length,reported_final:receipts.filter(r=>r.reported_final).length,
 network_errors:receipts.filter(r=>r.collection_error).length,
 pbp_available:receipts.filter(r=>r.retrieved_play_count>0).length,
 official_verified:0,report_status:'SECONDARY_EVIDENCE_PENDING_OFFICIAL_RECONCILIATION',
 receipts};
writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({games:manifest.games,reported_final:manifest.reported_final,network_errors:manifest.network_errors,pbp_available:manifest.pbp_available}));
if(manifest.network_errors>0)process.exitCode=1;
