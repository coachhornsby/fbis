/**
 * ATP singles-result admission contract. This does not declare an arbitrary
 * third-party API "official": caller must supply pre-approved source authority.
 * No endpoint is inferred, scraped, or contacted by this library.
 */
const allowedSets=(a,b)=>{
 if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a===b)return false;
 const hi=Math.max(a,b),lo=Math.min(a,b);
 return (hi===6&&lo<=4)||(hi===7&&(lo===5||lo===6));
};
const id=x=>typeof x==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(x);
const date=x=>Date.parse(x||'');
export function verifyAtpCompletedSingles(row,{observedAt=new Date(),sourceApproved=false}={}){
 const fail=reason=>({verified:false,reason,canAuthorizeWager:false});
 if(!sourceApproved)return fail('ATP_SOURCE_AUTHORITY_NOT_APPROVED');
 if(row?.source!=='ATP_OFFICIAL')return fail('SOURCE_NOT_ATP_OFFICIAL');
 if(!id(row.matchId)||!id(row.player1Id)||!id(row.player2Id)||
    row.player1Id===row.player2Id||!id(row.winnerId)||
    ![row.player1Id,row.player2Id].includes(row.winnerId))
   return fail('MATCH_PLAYER_WINNER_IDENTITY_INVALID');
 if(row.matchType!=='SINGLES'||row.status!=='FINAL'||
    row.retired||row.walkover||row.defaulted||row.abandoned)
   return fail('NOT_COMPLETED_NORMAL_SINGLES');
 const start=date(row.startAt),observed=+observedAt;
 if(!Number.isFinite(start)||!Number.isFinite(observed)||start>=observed)
   return fail('TEMPORAL_CONTRACT_INVALID');
 if(!['hard','clay','grass'].includes(String(row.surface).toLowerCase()))
   return fail('SURFACE_UNVERIFIED');
 if(!Array.isArray(row.sets)||![2,3,4,5].includes(row.sets.length))
   return fail('SET_COUNT_UNVERIFIED');
 const format=row.bestOf;
 if(![3,5].includes(format)||row.sets.length>format)return fail('FORMAT_UNVERIFIED');
 let a=0,b=0;
 for(const s of row.sets){
  if(!Array.isArray(s)||s.length!==2||!allowedSets(s[0],s[1]))
   return fail('INVALID_COMPLETED_SET');
  if(s[0]>s[1])a++;else b++;
 }
 const target=format===3?2:3;
 if(!(a===target&&b<target||b===target&&a<target))
   return fail('NO_UNAMBIGUOUS_WINNER');
 const derived=a===target?row.player1Id:row.player2Id;
 if(derived!==row.winnerId)return fail('OFFICIAL_WINNER_SCORE_CONFLICT');
 return {verified:true,reason:null,matchId:row.matchId,winnerId:derived,
  completedSets:row.sets.length,surface:String(row.surface).toLowerCase(),
  resultReason:'OFFICIAL_COMPLETED_SETS',source:'ATP_OFFICIAL',
  canQualify:false,canAuthorizeWager:false};
}
