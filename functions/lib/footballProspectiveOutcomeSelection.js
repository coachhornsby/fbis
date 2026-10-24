/**
 * Source-verified regulation outcome selection for an actual prospective
 * receipt. Only accepts official reconstructed finals observed after kickoff
 * and the specific pregame capture. Source revisions must agree on scores.
 * No unobserved result can be synthesized.
 */
const timestamp=x=>typeof x==="string"?Date.parse(x):NaN;
const validId=x=>typeof x==="string"&&x.length>0;
const fingerprint=x=>typeof x==="string"&&/^[a-f0-9]{64}$/i.test(x);
const allowedModel=Object.freeze({
 nfl:"NFL_PBP_VERIFIED_POSSESSIONS",
 cfb:"SDV_ESPN_CFB_PBP_DRIVES"
});
export const KICKOFF_MATCH_TOLERANCE_MS=30*60*1000;
export function selectProspectiveRegulationOutcome(receipt,sources,{asOf}={}){
 if(!allowedModel[receipt?.sport]||!validId(receipt.receiptId)||
   !validId(receipt.homeTeamId)||!validId(receipt.awayTeamId)||
   ![timestamp(receipt.capturedAt),timestamp(receipt.kickoff),timestamp(asOf)]
     .every(Number.isFinite)||timestamp(receipt.capturedAt)>=timestamp(receipt.kickoff))
  throw Error("INVALID_PROSPECTIVE_RECEIPT_SCOPE");
 const eligible=[];
 let conflicting=0,invalid=0;
 for(const s of sources||[]){
  if(s.sport!==receipt.sport||
     s.homeTeamId!==receipt.homeTeamId||s.awayTeamId!==receipt.awayTeamId||
     !Number.isFinite(timestamp(s.kickoff))||Math.abs(timestamp(s.kickoff)-timestamp(receipt.kickoff))>KICKOFF_MATCH_TOLERANCE_MS)
   continue;
  if(!fingerprint(s.sourceFingerprint)||!validId(s.sourceGameId)||
    s.sourceModel!==allowedModel[receipt.sport]||
    !Number.isFinite(timestamp(s.observedAt))||
    timestamp(s.observedAt)<=timestamp(receipt.kickoff)||
    timestamp(s.observedAt)<=timestamp(receipt.capturedAt)||
    timestamp(s.observedAt)>timestamp(asOf)||
    !Number.isInteger(s.homeScore)||!Number.isInteger(s.awayScore)||
    s.homeScore<0||s.awayScore<0||s.homeScore>100||s.awayScore>100){
    invalid++;continue;
  }
  eligible.push(s);
 }
 if(!eligible.length)return {status:"AWAITING_VERIFIED_OUTCOME",invalidSourceCount:invalid,
  conflictCount:0,outcome:null};
 const reference=eligible[0];
 for(const s of eligible){
  if(s.homeScore!==reference.homeScore||s.awayScore!==reference.awayScore)conflicting++;
 }
 if(conflicting)return {status:"CONFLICTING_VERIFIED_SCORES",invalidSourceCount:invalid,
  conflictCount:conflicting,outcome:null};
 eligible.sort((a,b)=>timestamp(b.observedAt)-timestamp(a.observedAt)||
   sCompare(a.sourceFingerprint,b.sourceFingerprint));
 const winning=eligible[0];
 return {status:"VERIFIED_REGULATION_RESULT",invalidSourceCount:invalid,
  conflictCount:0,sourceRevisionCount:eligible.length,
  outcome:{sourceGameId:winning.sourceGameId,
   sourceFingerprint:winning.sourceFingerprint,
   observedAt:winning.observedAt,
   homeScore:winning.homeScore,awayScore:winning.awayScore}};
}
function sCompare(a,b){return a<b?-1:a>b?1:0}
