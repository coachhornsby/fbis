import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acquireTmlCanonical, classifyTmlFile } from '../tennis/sources/tennismylifeRemote.js';
import { reconcileObservations } from '../tennis/tennisObservationReconcile.js';
import { canonicalToMeltedRows } from '../tennis/canonicalMatchObservation.js';
import { buildIndex } from '../tennis/tennisFeatureBuilder.js';

const outDir=process.env.TENNIS_REFRESH_OUT||'artifacts/tennis-refresh';
const scope=(process.argv.find(x=>x.startsWith('--scope='))||'--scope=current').split('=')[1];
if(!['current','full'].includes(scope)) throw new Error(`unsupported Tennis refresh scope ${scope}`);
const startedAt=new Date().toISOString(),year=Number(startedAt.slice(0,4));
const include=(f)=>{
  const kind=classifyTmlFile(f.name),n=f.name.toLowerCase();
  if(kind==='OTHER') return false;
  if(scope==='full') {
    const y=Number((n.match(/20\d{2}/)||[])[0]||0);
    if(kind==='ATP_TOUR') return y>=2015&&y<=year;
    if(kind==='CHALLENGER') return y>=2020&&y<=year;
    return true;
  }
  if(kind==='ATP_ONGOING'||kind==='CHALLENGER_ONGOING') return true;
  return n.includes(String(year));
};
const {observations,manifest,retrievedAt}=await acquireTmlCanonical({include});
const {observations:canonical,audit}=reconcileObservations(observations,{authority:{tennismylife:100}});
if(!canonical.length) throw new Error('Tennis refresh produced zero canonical matches');
const rows=canonical.flatMap(canonicalToMeltedRows),index=buildIndex(rows,{note:`autonomous TML ${scope} refresh ${startedAt}`});
if(!index?.meta?.players) throw new Error('Tennis refresh produced zero players');
const latestByKind={};
for(const m of manifest) if(!latestByKind[m.kind]||m.latest>latestByKind[m.kind]) latestByKind[m.kind]=m.latest;
const latest=canonical.reduce((m,o)=>(o.matchDate||'')>m?(o.matchDate||''):m,'');
const completedAt=new Date().toISOString();
const health={ok:true,scope,refreshStartedAt:startedAt,refreshCompletedAt:completedAt,manifestRetrievedAt:retrievedAt,
  workflowSha:process.env.GITHUB_SHA||null,workflowRunId:process.env.GITHUB_RUN_ID||null,source:'TennisMyLife',files:manifest.length,
  rawObservations:observations.length,canonicalMatches:canonical.length,duplicatesRemoved:audit.duplicateObservations,
  identityCollisions:audit.identityCollisions,disagreementRate:audit.disagreementRate,playerRows:rows.length,players:index.meta.players,
  latestObservation:latest,latestByKind,reconciliation:audit,bet:false};
mkdirSync(outDir,{recursive:true});
writeFileSync(join(outDir,'source-manifest.json'),JSON.stringify({scope,refreshStartedAt:startedAt,refreshCompletedAt:completedAt,manifestRetrievedAt:retrievedAt,files:manifest},null,2));
writeFileSync(join(outDir,'refresh-health.json'),JSON.stringify(health,null,2));
writeFileSync(join(outDir,'canonical-matches.ndjson'),canonical.map(x=>JSON.stringify(x)).join('\n')+'\n');
writeFileSync(join(outDir,'tennis_serve_index.json'),JSON.stringify({...index,canonicalRefresh:{scope,refreshStartedAt:startedAt,refreshCompletedAt:completedAt,latestObservation:latest,latestByKind,workflowSha:process.env.GITHUB_SHA||null,bet:false}}));
console.log(JSON.stringify(health,null,2));
