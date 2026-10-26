#!/usr/bin/env node
/** CFBD historical PBP cross-source coverage audit, without assuming equal event taxonomies.
 * Source dataset is licensed/authenticated. Missing token is explicit UNVERIFIED, never a pass.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.CFB_EVIDENCE_OUT||'artifacts/cfb-2026-weeks05-08';
const audit=JSON.parse(readFileSync(join(root,'phase5-pbp-structural-audit.json'),'utf8'));
const base=new Map(audit.rows.map(x=>[String(x.game_id),x]));
if(base.size!==226)throw Error('PBP_ORIGINAL_226_REQUIRED');
const token=process.env.CFBD_API_KEY||process.env.CFBD_API_TOKEN;
const byGame=new Map();let status='NOT_CONNECTED';const sourceErrors=[];
if(token){
 status='CONNECTED';
 for(const week of [5,6,7,8]){
  const url=`https://api.collegefootballdata.com/plays?year=2026&week=${week}&seasonType=regular`;
  try{
   const res=await fetch(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
   if(!res.ok)throw Error('CFBD_HTTP_'+res.status);
   const rows=await res.json();if(!Array.isArray(rows))throw Error('BAD_CFBD_PAYLOAD');
   for(const p of rows){
    const id=String(p.gameId??p.game_id??'');
    if(!byGame.has(id))byGame.set(id,[]);byGame.get(id).push(p);
   }
   writeFileSync(join(root,`cfbd-week${week}-historical-pbp.json`),JSON.stringify({source:'CFBD_LICENSED_API',year:2026,week,plays:rows}));
  }catch(e){sourceErrors.push({week,error:String(e)});status='PARTIAL_OR_UNAVAILABLE';}
 }
}
const rows=[...base.values()].map(g=>{
 const n=byGame.get(String(g.game_id))?.length||0;
 return {game_id:g.game_id,espn_plays:g.play_count,cfbd_play_count:n,
  cfbd_play_coverage_confirmed:n>0,espn_internal_consistent:g.structurally_consistent,
  missing_independent_completeness_confirmation:true,sourceStatus:status};
});
const output={schema:'fbis.cfb.phase5.cross_provider_pbp.v1',status:status==='NOT_CONNECTED'?'NOT_CONNECTED_CFBD_API_KEY':status,
 games:rows.length,cfbdGamesWithPlays:rows.filter(r=>r.cfbd_play_coverage_confirmed).length,
 primaryEspnGames:rows.length,unresolvedInternalAnomalies:audit.issues,
 independentPbpCompleteVerified:0,sourceErrors,authority:'RESEARCH_ONLY',rows};
writeFileSync(join(root,'phase5-pbp-cross-provider-coverage.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify({status:output.status,cfbdGamesWithPlays:output.cfbdGamesWithPlays,independentlyComplete:0,errors:sourceErrors.length}));
