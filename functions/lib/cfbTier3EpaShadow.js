/** Read-only point-in-time Tier3 EPA shadow. Hypothesis coefficients are NOT fitted. */
const number=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const clock=s=>Date.parse(String(s||""));
export const TIER3_SHADOW_VERSION="CFB-TIER3-EPA-SENSITIVITY-v0.1";
export function tier3ShadowProjection(row) {
 const kickoff=clock(row.kickoff),receipt=clock(row.receivedAt),frozen=clock(row.baselineFrozenAt);
 if(![kickoff,receipt,frozen].every(Number.isFinite)||!(receipt<kickoff&&frozen<kickoff))
   return {ok:false,reason:"PREGAME_RECEIPT_OR_BASELINE_MISSING"};
 if(!["matched","matched_unique_active_fbs"].includes(row.identityStatus)||
    !/^cfb-\d+$/.test(String(row.homeCanonicalId||""))||
    !/^cfb-\d+$/.test(String(row.awayCanonicalId||""))||
    row.homeCanonicalId===row.awayCanonicalId)
   return {ok:false,reason:"UNVERIFIED_MATCHUP_IDENTITY"};
 const h=number(row.baselineHome),a=number(row.baselineAway);
 const features=["homePassOff","homeRushOff","awayPassOff","awayRushOff",
   "homePassDef","homeRushDef","awayPassDef","awayRushDef"].map(k=>number(row[k]));
 if(h===null||a===null||features.some(x=>x===null)||h<0||a<0)
   return {ok:false,reason:"MISSING_BASELINE_OR_EPA_FAMILY"};
 const [hpo,hro,apo,aro,hpd,hrd,apd,ard]=features;
 // Four pre-registered sensitivity ablations, not fitted coefficients.
 const pass=(hpo-apd)-(apo-hpd),rush=(hro-ard)-(aro-hrd);
 const baseMargin=h-a,baseTotal=h+a;
 const variants={pass:baseMargin+3*pass,rush:baseMargin+3*rush,
   combined:baseMargin+1.5*(pass+rush)};
 const predictions=Object.fromEntries(Object.entries(variants).map(([key,margin])=>
   [key,{home:(baseTotal+margin)/2,away:(baseTotal-margin)/2,margin,total:baseTotal}]));
 return {ok:true,gameId:row.gameId,version:TIER3_SHADOW_VERSION,
  kickoff:row.kickoff,receiptAt:row.receivedAt,sourceSnapshotId:row.snapshotId,
  baselineSnapshotId:row.baselineSnapshotId,
  clockEvidence:"FBIS_RECEIPT_ONLY",trained:false,
  baseline:{home:h,away:a,margin:baseMargin,total:baseTotal},
  predictions,canQualify:false,canAuthorizeWager:false,changesProductionChampion:false};
}
export function pairedTier3ShadowAudit(projected,verified=[]) {
 const finals=new Map(verified.filter(x=>x.verified===true&&Number.isFinite(x.home)&&Number.isFinite(x.away))
   .map(x=>[String(x.gameId),x]));
 const pairs=projected.filter(x=>x.ok&&finals.has(String(x.gameId)));
 const mae=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 const err=(p,g)=>Math.abs(p-(g.home-g.away));
 const variants=["baseline","pass","rush","combined"];
 return {pairedGames:pairs.length,metrics:Object.fromEntries(variants.map(k=>[k,{
  marginMAE:mae(pairs.map(p=>err(k==="baseline"?p.baseline.margin:p.predictions[k].margin,finals.get(String(p.gameId))))),
  totalMAE:mae(pairs.map(p=>Math.abs(p.baseline.total-(finals.get(String(p.gameId)).home+finals.get(String(p.gameId)).away))))
 }])),trained:false,promotionEligible:false,canAuthorizeWager:false};
}
