import {createHash} from 'node:crypto';
import {validateNflFeatureSnapshot} from '../../functions/lib/nflVerseFeed.js';
import {projectNflProV1} from '../../functions/lib/nflProModel.js';

// Reuse strict calendar/timezone validation; a source time is not a build time.
function timestamp(value,season,now){
 const v=validateNflFeatureSnapshot({season,byTeam:{},playersByTeam:{},meta:{builtAt:value}},season,now);
 return v.ok ? v.builtAt : null;
}
export function auditNflShadow({snapshotText,evidence,games,season,now=Date.now()}){
 if(typeof snapshotText!=='string'||Buffer.byteLength(snapshotText)>8*1024*1024)throw Error('SNAPSHOT_SIZE_INVALID');
 if(!Array.isArray(games)||games.length<1||games.length>32)throw Error('SLATE_SIZE_INVALID');
 if(!Number.isInteger(season)||!Number.isFinite(now))throw Error('AUDIT_CONTEXT_INVALID');
 const snapshot=JSON.parse(snapshotText),hash=createHash('sha256').update(snapshotText).digest('hex');
 const validation=validateNflFeatureSnapshot(snapshot,season,now),reasons=[];
 if(!validation.ok)reasons.push(validation.reason);
 if(evidence?.snapshotSha256!==hash)reasons.push('source-evidence-hash-mismatch');
 if(evidence?.source!=='nflverse')reasons.push('source-evidence-unverified');
 // Evidence is a separate reviewed source receipt, never inferred from file mtime.
 const observed=timestamp(evidence?.observedAt,season,now);
 if(observed===null)reasons.push('source-observation-missing-or-stale');
 // Weekly NFL data may end before the 36h observation window. Validate syntax and
 // ordering separately, without imposing 36h on the last completed football game.
 const throughCheck=validateNflFeatureSnapshot({season,byTeam:{},playersByTeam:{},meta:{builtAt:evidence?.dataThrough}},season,now);
 const throughMs=throughCheck.ok||throughCheck.reason==='snapshot-expired'?Date.parse(evidence?.dataThrough):null;
 if(throughMs===null||observed===null||throughMs>observed)reasons.push('source-data-through-invalid');
 if(!Number.isInteger(evidence?.completedWeek)||evidence.completedWeek<1||evidence.completedWeek>22)reasons.push('completed-week-missing');
 const ids=new Set();
 const teams=new Set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '));
 const rows=games.map(game=>{
  const blocked=[...reasons],start=Date.parse(game.start);
  if(typeof game.id!=='string'||!game.id||ids.has(game.id)||!teams.has(game.home)||!teams.has(game.away)||game.home===game.away)blocked.push('game-identity-invalid');
  ids.add(game.id);
  const strictStart=validateNflFeatureSnapshot({season,byTeam:{},playersByTeam:{},meta:{builtAt:game.start}},season,start);
  if(!strictStart.ok||!Number.isFinite(start)||start<=now)blocked.push('game-not-future');
  if(Number.isFinite(start)&&throughMs!==null&&throughMs>=start)blocked.push('postgame-data-leakage');
  if(!Number.isInteger(game.requiredCompletedWeek)||game.requiredCompletedWeek<1||game.requiredCompletedWeek>22||evidence?.completedWeek<game.requiredCompletedWeek)blocked.push('completed-week-coverage-unverified');
  const home=snapshot.byTeam?.[game.home],away=snapshot.byTeam?.[game.away];
  if(!home||!away)blocked.push('team-feature-match-missing');
  // Explicit finite numeric fields only. Do not turn numeric strings/booleans into evidence.
  const clean=f=>Object.fromEntries(Object.entries(f||{}).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)));
  let shadow=null;
  if(!blocked.length){
   const candidate=projectNflProV1({neutralSite:game.neutralSite===true,nflFeatures:{home:clean(home),away:clean(away)}});
   if(!candidate.ok)blocked.push(candidate.reason);
   else shadow={...candidate,canQualify:false,canAuthorizeWager:false};
  }
  return {id:game.id??null,home:game.home??null,away:game.away??null,blocked,shadow,
   personnelConsumed:false,opponentAdjusted:false,edgeEligible:false};
 });
 return {schema:'nfl-offline-shadow-audit-v1',snapshotSha256:hash,season,generatedAt:new Date(now).toISOString(),
  sourceEvidence:evidence??null,blocked:reasons,rows,networkCalls:0,storageCalls:0,productionChanged:false,canAuthorizeWager:false,
  limitation:'Shadow diagnostics only. Personnel is not consumed by this model; opponent adjustment is not established. No published projection or edge authority.'};
}
