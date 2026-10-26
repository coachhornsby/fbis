#!/usr/bin/env node
/** Read-only static ownership register; unresolved candidates block certification. */
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {SPORT_PREFIX_TABLES} from '../functions/lib/sportWorkingCopy.js';
const out=process.argv[2]||'artifacts/cbb-cutover';
const sources=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
 const path=`${dir}/${e.name}`;if(e.isDirectory())await walk(path);
 else if(/\.(js|mjs|ts|tsx|jsx|yml|yaml)$/.test(e.name))sources.push({path,source:await readFile(path,'utf8')});
}}
for(const root of ['functions','services','scripts','src','.github/workflows'])await walk(root);
const prefixes=SPORT_PREFIX_TABLES.cbb;
const shared=['games','predictions','prediction_snapshots','published_projections','odds_snapshots','team_form','team_form_games'];
const tables=[...prefixes.map(table=>({table,scope:'all rows',currentOwner:'PRIMARY',proposedOwner:'CBB_DB',classification:'sport-owned research',modelAuthority:false})),
 ...shared.map(table=>({table,scope:"sport='cbb' only",currentOwner:'PRIMARY',proposedOwner:'CBB_DB',classification:'sport-scoped shared working table',modelAuthority:false})),
 {table:'cbb_player_prop_signals',scope:'all rows',currentOwner:'PRIMARY',proposedOwner:'separately governed props',classification:'deferred',excluded:true}];
const candidates=sources.filter(x=>/\bcbb\b|cbb_|CBB_DB/i.test(x.source)||/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:games|predictions|prediction_snapshots|published_projections|odds_snapshots|team_form|team_form_games)\b/i.test(x.source)).map(({path,source})=>({
 path,primaryReferences:source.split('\n').flatMap((line,i)=>/\benv(?:\?\.)?\.DB\b|\benv\?\.DB\b|context\.env\.DB|wrangler d1 execute fbis\b/.test(line)?[{line:i+1,text:line.trim()}]:[]),
 declaredTables:tables.filter(t=>source.includes(t.table)).map(t=>t.table),
 routing:/cbbResearchOwner|productSportDbHandle|sportDbContext/.test(source),
 classification:path.includes('prop')?'separately governed player props':path.includes('.github')?'scheduled workflow':path.includes('store')||path.includes('projLedger')?'shared/canonical owner review required':'CBB consumer owner review required',
 reviewStatus:'REQUIRES_MANUAL_CALL_GRAPH_REVIEW',
}));
const workflows=sources.filter(x=>x.path.startsWith('.github/')&&/\bcbb\b|sport-delta-sync/i.test(x.source)).map(x=>({path:x.path,
 scheduleLines:x.source.split('\n').filter(l=>/cron:|schedule:|workflow_dispatch:/.test(l)),
 primaryCommands:x.source.split('\n').filter(l=>/wrangler d1 execute fbis\b/.test(l)),latestRun:'NOT_VERIFIED'}));
const report={contract:'FBIS-CBB-OWNERSHIP-AUDIT-v1',at:new Date().toISOString(),
 commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tables,candidates,workflows,
 phaseA:'INCOMPLETE',readyForCutover:false,authorityActivated:false,canAuthorizeWager:false,
 blockers:['Manual call-graph review of every candidate remains required','Latest scheduled run receipts remain required','Live exhaustive field and key parity remains required']};
await mkdir(out,{recursive:true});await writeFile(`${out}/ownership-manifest.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({tables:tables.length,candidates:candidates.length,primaryCandidates:candidates.filter(x=>x.primaryReferences.length).length,workflows:workflows.length,readyForCutover:false}));
