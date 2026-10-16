#!/usr/bin/env node
/** Fail-closed static source consumer inventory for D1 retention decisions.
 * Scans the whole checked-out repository. Does not connect to Cloudflare or write DB.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const tables=[
  'cfb_roster_observations',
  'cfb_roster_membership',
  'cfb_canonical_players',
  'cfb_team_season_stat_snapshots',
  'cfb_player_season_stat_snapshots',
  'normalized_market_observations',
  'mlb_market_projections'
];
const rx=new RegExp(tables.join('|'),'gi');
const include=['functions','workers','scripts','src','.github','migrations','test','schema.sql'];
const result=[];
const cmd=['grep','-n','-I','-i','-E',tables.join('|'),'--',...include];
let raw='';
try {raw=execFileSync('git',cmd,{encoding:'utf8',maxBuffer:30*1024*1024});}
catch(e){if(e.status!==1)throw e;}
for(const line of raw.split('\n')){
  const match=line.match(/^(.+?):(\d+):(.*)$/);
  if(!match)continue;
  const [,path,lineNumber,body]=match;
  const found=[...new Set((body.match(rx)||[]).map(t=>t.toLowerCase()))];
  const segment=path.startsWith('functions/')||path.startsWith('workers/')?'RUNTIME':
    path.startsWith('.github/')?'WORKFLOW':
    path.startsWith('scripts/')?'SCRIPT':
    path.startsWith('src/')?'UI':
    path.startsWith('migrations/')||path==='schema.sql'?'SCHEMA':
    path.startsWith('test/')?'TEST':'OTHER';
  const op=/\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|INDEX)\b/i.test(body)?'DELETE_OR_DROP':
    /\b(?:INSERT|UPDATE|REPLACE)\b/i.test(body)?'WRITE':
    /\b(?:FROM|JOIN|SELECT)\b/i.test(body)?'READ':
    'REFERENCE';
  result.push({path,line:Number(lineNumber),segment,op,tables:found,excerpt:body.trim().slice(0,320)});
}
const summary={contract:'FBIS-STORAGE-CONSUMER-AUDIT-v1',builtAt:new Date().toISOString(),
  gitSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),matchCount:result.length,
  counts:Object.fromEntries(tables.map(t=>[t,{total:result.filter(x=>x.tables.includes(t)).length,
    runtime:result.filter(x=>x.tables.includes(t)&&x.segment==='RUNTIME').length,
    suspectedWrites:result.filter(x=>x.tables.includes(t)&&x.op==='WRITE').length,
    suspectedDeletes:result.filter(x=>x.tables.includes(t)&&x.op==='DELETE_OR_DROP').length}])),
  productionRetentionDecision:'BLOCKED_UNTIL_FULL_RESTORE_AND_DEPENDENCY_PARITY',
  sourceRowsDeleted:0,
  references:result};
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/cfb-capacity-consumer-audit.json',JSON.stringify(summary,null,2)+'\n');
console.log('CFB_STORAGE_AUDIT_SUMMARY '+JSON.stringify({gitSha:summary.gitSha,matchCount:summary.matchCount,counts:summary.counts,productionRetentionDecision:summary.productionRetentionDecision}));
const operational=result.filter(x=>(x.segment==='RUNTIME'||x.segment==='SCRIPT'||x.segment==='WORKFLOW')&&
  (x.tables.includes('cfb_roster_observations')||x.tables.includes('cfb_roster_membership')));
console.log('CFB_STORAGE_AUDIT_OPERATIONAL_REFERENCES '+JSON.stringify(operational.slice(0,110)));
if(!result.length||!summary.counts.cfb_roster_observations.total)throw Error('AUDIT_NO_SOURCE_COVERAGE');
if(result.length>20000)throw Error('AUDIT_RESULT_TRUNCATION_RISK');
