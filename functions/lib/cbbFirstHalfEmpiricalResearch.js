/**
 * CBB first-half points-only baseline, research-only.
 * Uses completed pre-tip 1H scoring records, never full-game score or market lines.
 * NOT fitted/calibrated for wagering. Independent 1H dataset needed before use.
 */
export const MODEL_ID = "CBB-1H-EMPIRICAL-RESEARCH-v0";
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const date=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const avg=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const r=x=>Math.round(x*10)/10;
export function buildFirstHalfEvidence(rows=[],game={},opts={}) {
  const tip=Date.parse(game.tipAt);
  if (!date(game.tipAt)||!game.homeId||!game.awayId||game.homeId===game.awayId) {
    return {ok:false,reason:"INVALID_TARGET_IDENTITY"};
  }
  if (!["Home","Neutral"].includes(game.venue)) return {ok:false,reason:"MISSING_VERIFIED_VENUE"};
  const accepted=[], seen=new Set();let rejected=0;
  for(const row of rows){
    const t=Date.parse(row.tipAt);
    const valid=date(row.tipAt)&&t<tip&&!row.invalidated&&row.gameId&&
      row.homeId&&row.awayId&&row.homeId!==row.awayId&&
      finite(row.homeFirstHalfPoints)&&finite(row.awayFirstHalfPoints)&&
      Number.isInteger(row.homeFirstHalfPoints)&&Number.isInteger(row.awayFirstHalfPoints)&&
      row.homeFirstHalfPoints>=0&&row.awayFirstHalfPoints>=0&&
      row.homeFirstHalfPoints<=120&&row.awayFirstHalfPoints<=120&&
      row.period==="1H"&&row.final===true&&row.sourceVerified===true &&
      (!opts.season||row.season===opts.season) && !seen.has(row.gameId) &&
      date(row.capturedAt)&&Date.parse(row.capturedAt)<tip;
    if(valid){accepted.push(row);seen.add(row.gameId)}else rejected++;
  }
  const stats=id=>{
    const scored=[],allowed=[];
    for(const x of accepted){
      if(x.homeId===id){scored.push(x.homeFirstHalfPoints);allowed.push(x.awayFirstHalfPoints)}
      if(x.awayId===id){scored.push(x.awayFirstHalfPoints);allowed.push(x.homeFirstHalfPoints)}
    }
    return {games:scored.length,scored:avg(scored),allowed:avg(allowed)};
  };
  const h=stats(game.homeId),a=stats(game.awayId);
  const min=opts.minTeamGames??8;
  if(h.games<min||a.games<min) return {ok:false,reason:"INSUFFICIENT_1H_SAMPLES",samples:{home:h.games,away:a.games},accepted:accepted.length,rejected};
  // Transparent seed baseline. Venue/strength adjustments must be independently fitted;
  // do not inject the full-game model's home advantage.
  const homePoints=(h.scored+a.allowed)/2;
  const awayPoints=(a.scored+h.allowed)/2;
  return {ok:true,modelId:MODEL_ID,method:"independent_first_half",firstHalfTotal:r(homePoints+awayPoints),
    homeFirstHalf:r(homePoints),awayFirstHalf:r(awayPoints),samples:{home:h.games,away:a.games},
    accepted:accepted.length,rejected,inputsEndBefore:game.tipAt,
    validated:false,canQualify:false,canAuthorizeWager:false,
    limitations:["Unadjusted opponent strength and venue","Not price calibrated","Not prospectively validated"]};
}
