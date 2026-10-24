// WTA official completed-match evidence only. No winner from schedule status,
// player name order, market settlement, simulation, or untrusted user submissions.
const num=v=>{
 if(v==null||String(v).trim()===''||!/^[0-9]+$/.test(String(v).trim()))return null;
 return Number(v);
};
const safeId=v=>/^[A-Za-z0-9_-]+$/.test(String(v||''))?String(v):null;
const scoreDisqualification=/\b(?:RET|RETIRED|W\/O|WALKOVER|DEF|DEFAULT|ABD|ABANDONED|CANCELLED|SUSPENDED)\b/i;
function standardSet(a,b){
 if(a===b||a==null||b==null)return false;
 const hi=Math.max(a,b),lo=Math.min(a,b);
 return (hi===6&&lo<=4)||(hi===7&&(lo===5||lo===6));
}
export function verifyWtaOfficialFinal(m, tournament){
 const fail=reason=>({verified:false,reason});
 if(m?.MatchState!=='F'||m?.DrawMatchType!=='S'||m?.PlayerIDA2||m?.PlayerIDB2)
  return fail('NOT_COMPLETED_SINGLES');
 const group=String(tournament?.tournamentGroup?.id||''),year=Number(tournament?.year);
 if(!/^\d+$/.test(group)||!Number.isInteger(year)||String(m.EventID)!==group||
    Number(m.EventYear)!==year)return fail('TOURNAMENT_IDENTITY_MISMATCH');
 const id=safeId(m.MatchID),a=String(m.PlayerIDA||''),b=String(m.PlayerIDB||'');
 if(!id||!/^[0-9]+$/.test(a)||!/^[0-9]+$/.test(b)||a===b)
  return fail('SOURCE_PLAYER_IDENTITY_UNVERIFIED');
 const text=String(m.ScoreString||'').trim();
 if(!text||scoreDisqualification.test(text))return fail('SCORE_OR_RETIREMENT_UNVERIFIED');
 const sets=[];let blankSeen=false;
 for(let n=1;n<=5;n++){
  const aa=num(m['ScoreSet'+n+'A']),bb=num(m['ScoreSet'+n+'B']);
  if((aa===null&&bb===null)||(aa===0&&bb===0)){blankSeen=true;continue}
  if(blankSeen||!standardSet(aa,bb))return fail('INVALID_SET_SCORE');
  sets.push([aa,bb]);
 }
 if(sets.length<2||sets.length>3)return fail('INCOMPLETE_OR_UNKNOWN_FORMAT');
 const aSets=sets.filter(([aa,bb])=>aa>bb).length,bSets=sets.length-aSets;
 if(!((aSets===2&&bSets<=1)||(bSets===2&&aSets<=1)))
  return fail('NO_UNAMBIGUOUS_MATCH_WINNER');
 const sourceWinner=aSets===2?a:b;
 for(const field of ['WinnerID','WinnerPlayerID','WinningPlayerID']){
  if(m[field]!=null&&String(m[field])!==''&&String(m[field])!==sourceWinner)
   return fail('EXPLICIT_OFFICIAL_WINNER_CONFLICT');
 }
 return {verified:true,reason:null,sourceWinnerId:sourceWinner,
  sourceMatchId:year+'|'+group+'|'+id,sourceA:a,sourceB:b,
  scoreText:text,sets,setsA:aSets,setsB:bSets,
  researchOnly:true,canAuthorizeWager:false};
}
const sha=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))]
 .map(v=>v.toString(16).padStart(2,'0')).join('');
export async function reconcileWtaOfficialResults(db,bucket,t,payload,{
 now=new Date(),rawText=JSON.stringify(payload)
}={}){
 if(!db?.prepare||!bucket?.put||!Array.isArray(payload?.matches)||
  String(payload.tournament?.tournamentGroup?.id)!==String(t?.tournamentGroup?.id)||
  Number(payload.tournament?.year)!==Number(t?.year))
  throw Error('OFFICIAL_RESULT_SOURCE_CONTRACT_MISSING');
 if(rawText.length>2000000)throw Error('OFFICIAL_RESULT_SOURCE_TOO_LARGE');
 const rawHash=await sha(rawText);
 const rawKey='tennis/wta/official-results/raw/'+rawHash+'.json';
 await bucket.put(rawKey,rawText,{httpMetadata:{contentType:'application/json'}});
 const status={reviewed:0,verifiedFinals:0,existingMatched:0,resultsWritten:0,
  pureDecisionsGraded:0,blocked:{},rawHash,rawKey};
 const blocked=reason=>{status.blocked[reason]=(status.blocked[reason]||0)+1};
 for(const row of payload.matches){
  const result=verifyWtaOfficialFinal(row,t);
  if(!result.verified){if(row?.MatchState==='F'){status.reviewed++;blocked(result.reason)}continue}
  status.reviewed++;status.verifiedFinals++;
  const sourceMatchId=result.sourceMatchId;
  const existing=(await db.prepare(`SELECT m.match_id,m.winner_id,m.source_winner_id,m.player1_id,m.player2_id,
    m.source_player1_id,m.source_player2_id,m.match_time,m.completion_state,
    a.canonical_name AS player_a,b.canonical_name AS player_b
    FROM tennis_official_matches m
    JOIN tennis_players a ON a.fbis_player_id=m.player1_id
    JOIN tennis_players b ON b.fbis_player_id=m.player2_id
    WHERE m.source='WTA_OFFICIAL' AND m.tour='wta' AND m.source_match_id=?`)
    .bind(sourceMatchId).all()).results||[];
  if(existing.length!==1){blocked('EXACT_EXISTING_OFFICIAL_EVENT_REQUIRED');continue}
  const found=existing[0];
  if(found.source_player1_id!==result.sourceA||found.source_player2_id!==result.sourceB||
     found.player1_id===found.player2_id||!found.player1_id||!found.player2_id){
   blocked('CANONICAL_SOURCE_ID_CONFLICT');continue
  }
  const winnerId=result.sourceWinnerId===result.sourceA?found.player1_id:found.player2_id;
  const winnerName=result.sourceWinnerId===result.sourceA?found.player_a:found.player_b;
  if((found.winner_id&&found.winner_id!==winnerId)||
     (found.source_winner_id&&found.source_winner_id!==result.sourceWinnerId)){
   blocked('PRIOR_WINNER_CONFLICT');continue
  }
  // This source previously appeared as a verified official single. Its immutable
  // R2 raw payload is written before grading; no price data enter this path.
  const provenance=JSON.stringify({source:'WTA_OFFICIAL',tournamentGroupId:String(t.tournamentGroup.id),
   sourceMatchId,rawHash,rawKey,observedAt:now.toISOString(),resolution:'VERIFIED_SETS_A_B'});
  if(!found.winner_id){
   const updated=await db.prepare(`UPDATE tennis_official_matches SET
    winner_id=?,source_winner_id=?,score_text=?,sets_json=?,
    player1_sets=?,player2_sets=?,result_reason='OFFICIAL_COMPLETED_SETS',
    provenance_json=?,raw_artifact_key=?,source_updated_at=?,observed_at=?
    WHERE match_id=? AND source='WTA_OFFICIAL' AND winner_id IS NULL
      AND source_player1_id=? AND source_player2_id=?`)
    .bind(winnerId,result.sourceWinnerId,result.scoreText,JSON.stringify(result.sets),
      result.setsA,result.setsB,provenance,rawKey,row.LastUpdated||now.toISOString(),
      now.toISOString(),found.match_id,result.sourceA,result.sourceB).run();
   if(!Number(updated?.meta?.changes||updated?.changes||0)){
    blocked('RESULT_UPDATE_NOT_APPLIED');continue
   }
   status.resultsWritten++;
  }
  status.existingMatched++;
  const grade=await db.prepare(`UPDATE tennis_v2_research_decisions
   SET result_winner=?,graded_at=?
   WHERE canonical_event_id=? AND snapshot_type='PURE_FIXTURE'
     AND pure_model_id='TENNIS-FBIS-v2-CONTEXT' AND graded_at IS NULL
     AND result_winner IS NULL AND pure_p1>0 AND pure_p1<1
     AND julianday(decision_timestamp)<julianday(event_start_time)
     AND julianday(event_start_time)<=julianday(?)
     AND (player1=? AND player2=?)`)
    .bind(winnerName,now.toISOString(),found.match_id,now.toISOString(),
      found.player_a,found.player_b).run();
  status.pureDecisionsGraded+=Number(grade?.meta?.changes||grade?.changes||0);
 }
 return {...status,source:'WTA_OFFICIAL',researchOnly:true,canQualify:false,
  canAuthorizeWager:false,marketIndependent:true};
}
export async function captureWtaOfficialResults(env,{
 now=new Date(),fetchImpl=fetch,daysBack=30,maxTournaments=12
}={}){
 if(!env.DB?.prepare||!env.ARCHIVE?.put)throw Error('RESULT_CAPTURE_STORAGE_REQUIRED');
 const read=async path=>{
  const resp=await fetchImpl('https://api.wtatennis.com/tennis'+path,{
   headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!resp.ok)throw Error('WTA_OFFICIAL_RESULT_HTTP_'+resp.status);
  const raw=await resp.text();
  if(raw.length>2000000)throw Error('WTA_OFFICIAL_RESULT_TOO_LARGE');
  return {body:JSON.parse(raw),raw};
 };
 const start=new Date(+now-daysBack*86400000).toISOString().slice(0,10),
 end=now.toISOString().slice(0,10);
 const list=await read('/tournaments/?page=0&pageSize=100&excludeLevels=ITF&from='+start+'&to='+end);
 if(!Array.isArray(list.body?.content))throw Error('WTA_RESULT_TOURNAMENT_LIST_UNVERIFIED');
 const selected=list.body.content.filter(t=>Number(t.year)===now.getUTCFullYear()&&
   /^\d+$/.test(String(t.tournamentGroup?.id||''))&&t.endDate>=start&&t.startDate<=end)
  .sort((a,b)=>String(b.endDate).localeCompare(String(a.endDate))).slice(0,maxTournaments);
 const receipts=[],errors=[];
 for(const t of selected){
  try{
   const got=await read('/tournaments/'+t.tournamentGroup.id+'/'+t.year+'/matches');
   receipts.push({group:t.tournamentGroup.id,...await reconcileWtaOfficialResults(
    env.DB,env.ARCHIVE,t,got.body,{now,rawText:got.raw})});
  }catch(e){errors.push({group:t.tournamentGroup.id,reason:String(e.message||e)})}
 }
 return {ok:errors.length===0,asOf:now.toISOString(),source:'WTA_OFFICIAL',
  tournamentsExamined:receipts.length,receipts,errors,
  resultsWritten:receipts.reduce((n,x)=>n+x.resultsWritten,0),
  graded:receipts.reduce((n,x)=>n+x.pureDecisionsGraded,0),
  researchOnly:true,canQualify:false,canAuthorizeWager:false};
}
