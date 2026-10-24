/** In-house tennis Elo, derived solely from permitted, identity-verified official final results.
 * Chronological state builder; never accepts Sackmann/Tennis Abstract snapshots.
 * This is research state, NOT calibrated probability or wagering authority.
 */
export const INHOUSE_TENNIS_ELO_VERSION='FBIS-TENNIS-INHOUSE-ELO-v1';
const source=t=>t==='wta'?'WTA_OFFICIAL':t==='atp'?'ATP_OFFICIAL':null;
const surfaces=new Set(['hard','clay','grass']);
const ms=x=>Date.parse(x||'');
const base=1500;
export function calculateInhouseTennisElo(matches,{asOf=new Date(),k=24}={}){
 if(!Number.isFinite(+asOf)||!(k>0&&k<=64))throw Error('RATING_CLOCK_OR_K_INVALID');
 const rating=new Map(),skipped={};let accepted=0;
 const skip=x=>skipped[x]=(skipped[x]||0)+1;
 const ordered=[...matches].sort((a,b)=>ms(a.match_time)-ms(b.match_time)||String(a.match_id).localeCompare(String(b.match_id)));
 const seen=new Set();
 for(const row of ordered){
  if(!source(row.tour)||row.source!==source(row.tour)||row.completion_state!=='FINAL'||
    row.result_reason!=='OFFICIAL_COMPLETED_SETS'||!row.source_winner_id||
    !String(row.raw_artifact_key||'').startsWith('tennis/'+row.tour+'/official-results/raw/')){
    skip('UNVERIFIED_OFFICIAL_RESULT');continue;
  }
  const start=ms(row.match_time),observed=ms(row.observed_at);
  if(!Number.isFinite(start)||!Number.isFinite(observed)||start>+asOf||
     observed>+asOf||observed<start){skip('TEMPORAL_EVIDENCE_INVALID');continue;}
  if(!row.match_id||seen.has(row.match_id)){skip('DUPLICATE_EVENT');continue;}
  const p1=row.player1_id,p2=row.player2_id;
  if(!p1||!p2||p1===p2||![p1,p2].includes(row.winner_id)){
   skip('PLAYER_WINNER_IDENTITY_INVALID');continue;
  }
  seen.add(row.match_id);
  const scope=(player,surface)=>row.tour+'|'+player+'|'+surface;
  const apply=(surface)=>{
   const a=scope(p1,surface),b=scope(p2,surface),ra=rating.get(a)||{elo:base,n:0},
    rb=rating.get(b)||{elo:base,n:0};
   const expected=1/(1+10**((rb.elo-ra.elo)/400)),actual=Number(row.winner_id===p1);
   rating.set(a,{elo:ra.elo+k*(actual-expected),n:ra.n+1,lastMatch:row.match_time});
   rating.set(b,{elo:rb.elo+k*((1-actual)-(1-expected)),n:rb.n+1,lastMatch:row.match_time});
  };
  apply('overall');
  const surf=String(row.surface||'').toLowerCase();
  if(surfaces.has(surf))apply(surf);else skip('SURFACE_UNVERIFIED_OVERALL_ONLY');
  accepted++;
 }
 return {modelId:INHOUSE_TENNIS_ELO_VERSION,asOf:asOf.toISOString(),accepted,skipped,
  ratings:[...rating].map(([key,value])=>({key,...value})),source:'OFFICIAL_FINALS_ONLY',
  marketInformed:false,usesSackmann:false,canQualify:false,canAuthorizeWager:false};
}
export function inhouseEloMatchProbability(state,{tour,player1,player2,surface}={}){
 if(!source(tour)||!player1||!player2||player1===player2)return null;
 const s=String(surface||'').toLowerCase();
 const context=surfaces.has(s)?s:'overall';
 const byKey=new Map(state.ratings.map(x=>[x.key,x]));
 let a=byKey.get(tour+'|'+player1+'|'+context),
     b=byKey.get(tour+'|'+player2+'|'+context);
 if(!a||!b||a.n<5||b.n<5)return null;
 const p=1/(1+10**((b.elo-a.elo)/400));
 return {p1:p,p2:1-p,context,player1Matches:a.n,player2Matches:b.n,
  modelId:INHOUSE_TENNIS_ELO_VERSION,canQualify:false,canAuthorizeWager:false};
}
