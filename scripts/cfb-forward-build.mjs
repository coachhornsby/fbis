#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {sha256Hex} from '../functions/lib/sha256Hex.js';
import {materializeResearchCards,recoverLegacyPregameCapture,buildForwardSnapshot} from '../functions/lib/cfbForwardEvidence.js';
const root=resolve(process.argv[2]||''),out=resolve(process.argv[3]||root+'/built');await mkdir(out,{recursive:true});
const json=async name=>JSON.parse(await readFile(root+'/'+name,'utf8'));
const lines=async name=>(await readFile(root+'/'+name,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const save=async(name,data)=>writeFile(out+'/'+name,JSON.stringify(data,null,2)+'\n');
const saveLines=async(name,data)=>writeFile(out+'/'+name,data.map(x=>JSON.stringify(x)).join('\n')+'\n');
const capture=await json('capture-receipts.json');
for(const r of capture.receipts){if(basename(r.file)!==r.file)throw Error('Invalid receipt path');if(await sha256Hex(await readFile(root+'/'+r.file))!==r.sha256)throw Error('Source receipt mismatch');}
const manifest=await json('fbs-2026-ledger.manifest.json');
for(const name of ['team-game','player-game']){const bytes=await readFile(root+'/fbs-2026-ledger.'+name+'.jsonl');if(await sha256Hex(bytes)!==manifest.files[name].sha256)throw Error('Ledger manifest mismatch');}
const registry=await json('canonical-teams.json'),teams=registry.filter(t=>t.active===1&&String(t.subdivision).trim().toUpperCase()==='FBS');
if(teams.length!==138)throw Error('Active canonical directory drift requires review');
const memberships=new Set((await json('memberships.json')).map(r=>r.team_id+'|'+r.player_id));
const teamRows=await lines('fbs-2026-ledger.team-game.jsonl'),allPlayers=await lines('fbs-2026-ledger.player-game.jsonl');
const quarantined=allPlayers.filter(r=>!memberships.has(r.team_id+'|'+r.player_id));
const playerRows=allPlayers.filter(r=>memberships.has(r.team_id+'|'+r.player_id));
const legacy=(await json('legacy-captures.json')).map(recoverLegacyPregameCapture),accepted=legacy.filter(r=>r.accepted);
const priorByTeam={};
for(const row of accepted.sort((a,b)=>Date.parse(a.feature_capture_at)-Date.parse(b.feature_capture_at)))for(const key of ['home','away']){
 const p=row.captured_priors[key];priorByTeam[row.team_ids[key]]={off:p.off??null,def:p.def??null,observed_at:capture.capture_finished_at,legacy_capture_id:row.id};
}
const decisionAt=new Date().toISOString();
const cards=await materializeResearchCards({teams,teamRows,playerRows,decisionAt,quarantined});
const observedSchedule=await json('schedule.json');
const observedTeamGames=new Set(teamRows.map(r=>r.team_id+'|'+r.game_id));
const activeIds=new Set(teams.map(t=>t.team_id));
const postgameGaps=[];
for(const f of observedSchedule.filter(f=>f.status==='STATUS_FINAL'))for(const key of ['home','away']){const teamId='cfb:espn:'+f[key+'_id'];if(activeIds.has(teamId)&&!observedTeamGames.has(teamId+'|'+f.game_id))postgameGaps.push({game_id:f.game_id,team_id:teamId,game_at:f.game_date,state:'SOURCE_PENDING',reason:'FINAL_ON_ESPN_WITHOUT_SDV_TEAM_BOX_VERSION'});}
await save('completed-game-source-gaps.json',postgameGaps);
const fixtures=observedSchedule.filter(f=>Number(f.season)===2026&&f.status==='STATUS_SCHEDULED'&&Date.parse(f.game_date)>Date.parse(decisionAt)&&Date.parse(f.game_date)<Date.parse(decisionAt)+14*86400000);
const prospective=[],pending=[];
for(const f of fixtures){try{prospective.push(await buildForwardSnapshot({fixture:f,cards,priorByTeam,receipts:capture.receipts,decisionAt,codeSha:capture.code_sha}));}catch(e){pending.push({game_id:f.game_id,reason:e.message});}}
await saveLines('team-cards.jsonl',cards);await saveLines('historical-captured-features.jsonl',accepted);await saveLines('prospective-snapshots.jsonl',prospective);await save('quarantined-player-rows.json',quarantined);await save('source-pending-games.json',pending);
await save('report.json',{generated_at:new Date().toISOString(),decision_at:decisionAt,code_sha:capture.code_sha,production_mutation:false,production_upcoming_fixtures:(await json('production-upcoming.json')).length,active_fbs_cards:cards.length,cards_with_team_statistics:cards.filter(c=>c.games).length,team_game_versions:teamRows.length,accepted_player_game_records:playerRows.length,quarantined_player_game_records:quarantined.length,recent_final_team_sides_missing_stats:postgameGaps.length,legacy_captures_accepted:accepted.length,legacy_captures_rejected:legacy.filter(r=>!r.accepted).reduce((a,r)=>(a[r.reason]=(a[r.reason]||0)+1,a),{}),fully_qualified_historical_pit_samples:0,prospective_snapshots:prospective.length,shadow_projected:prospective.filter(p=>p.projection_state==='SHADOW_PROJECTED').length,source_pending_games:pending.length,bet_eligible:0,prospective_economic_observations:0,roi:null,clv:null,continuous_schedule_active:false,can_authorize_wager:false,limitations:['Research cards are not published production state','Legacy captured features lack complete upstream provenance','Player roster membership does not prove all participants are covered','New card inputs with incumbent coefficients remain a shadow experiment','Kickoff/venue and source licensing qualification pending']});
console.log(JSON.stringify(await JSON.parse(await readFile(out+'/report.json','utf8'))));
