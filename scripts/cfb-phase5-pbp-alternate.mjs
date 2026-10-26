#!/usr/bin/env node
/** Fetch independent ESPN CDN representation for anomalous NCAA/PBP terminal scores.
 * Preserves ORIGINAL Site v2 event and PBP payload; never overwrites raw evidence.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.CFB_EVIDENCE_OUT||'artifacts/cfb-2026-weeks05-08';
const structural=JSON.parse(readFileSync(join(root,'phase5-pbp-structural-audit.json'),'utf8'));
const finals=JSON.parse(readFileSync(join(root,'ncaa-official-reconciliation-summary.json'),'utf8'));
const indexed=new Map(finals.rows.map(x=>[String(x.game_id),x]));
const anomalies=structural.issues.filter(x=>x.issues.includes('LAST_PLAY_SCORE_DISAGREES_NCAA_FINAL'));
const results=[];
for(const {game_id} of anomalies){
 const f=indexed.get(game_id),g=structural.rows.find(x=>x.game_id===game_id);
 const dir=join(root,'week'+String(f.week).padStart(2,'0'),game_id);
 const url='https://cdn.espn.com/core/college-football/playbyplay?xhr=1&gameId='+encodeURIComponent(game_id);
 let record={game_id,original_last_score_mismatch:true,alternate_source:'ESPN_CDN_PBP',independent_provider:false,
  corrected_terminal_score:false,alternate_play_count:0,fetch_status:'UNKNOWN'};
 try{
  const res=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw Error('HTTP_'+res.status);
  const doc=await res.json();
  writeFileSync(join(dir,'espn-cdn-alternate-pbp.json'),JSON.stringify(doc));
  const pkg=doc.gamepackageJSON||doc,plays=Array.isArray(pkg.plays)?pkg.plays:pkg?.playByPlay?.plays||[];
  const last=plays.at(-1);
  record.alternate_play_count=plays.length;
  record.corrected_terminal_score=Number(last?.homeScore)===Number(f.ncaa_home)&&Number(last?.awayScore)===Number(f.ncaa_away);
  record.fetch_status='RETRIEVED';
 }catch(e){record.fetch_status='ERROR';record.error=String(e);}
 record.independent_complete_pbp_verified=false;
 results.push(record);
 writeFileSync(join(dir,'alternate-pbp-reconciliation.json'),JSON.stringify(record,null,2));
}
const result={schema:'fbis.cfb.phase5.alternate_pbp.v1',anomalies:results.length,
 alternateMatchesFinal:results.filter(x=>x.corrected_terminal_score).length,
 independentCompleteCertified:0,rows:results};
writeFileSync(join(root,'phase5-alternate-pbp-reconciliation.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({anomalies:result.anomalies,alternateMatchesFinal:result.alternateMatchesFinal,independentlyComplete:0}));
