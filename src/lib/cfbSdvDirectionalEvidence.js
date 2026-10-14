/**
 * Render-only comparison of current-season SDV evidence. NEVER a model
 * feature, wager edge, frozen historical PIT substitute, or qualification.
 */
import {cfbBoardEspnId} from "./cfbBoardSeasonJoin.js";
const finite=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
const PAIRS=[
 {id:"away-run-defense",off:"home",kind:"rush"},
 {id:"away-run-offense",off:"away",kind:"rush"},
 {id:"away-pass-defense",off:"home",kind:"pass"},
 {id:"away-pass-offense",off:"away",kind:"pass"},
];
export function cfbSdvDirectionalEvidence(game){
 const evidence=game?.cfbSeasonEvidence;
 if(evidence?.state!=="SOURCE_OBSERVED"||evidence?.canQualify!==false||
    evidence?.canAuthorizeWager!==false||evidence?.canInfluenceProjection!==false||
    !/^[0-9a-f]{64}$/i.test(String(evidence.source?.sha256||""))) return null;
 if(evidence.home?.teamId!==`cfb:espn:${cfbBoardEspnId(game.home)}`||
    evidence.away?.teamId!==`cfb:espn:${cfbBoardEspnId(game.away)}`)return null;
 const sourceAt=Date.parse(String(evidence.source?.observedAt||""));
 const kickoff=Date.parse(String(game.start||game.startTime||game.startDate||""));
 if(!Number.isFinite(sourceAt)||!Number.isFinite(kickoff)||sourceAt>=kickoff)return null;
 return PAIRS.map(pair=>{
  const opponent=pair.off==="home"?"away":"home";
  const offense=evidence[pair.off]||{},defense=evidence[opponent]||{};
  const off=finite(pair.kind==="pass"?offense.passingOffenseEpa:offense.rushingOffenseEpa);
  const def=finite(pair.kind==="pass"?defense.passingDefenseEpa:defense.rushingDefenseEpa);
  const available=off!==null&&def!==null&&offense.games>0&&defense.games>0;
  const delta=available?Number((off-def).toFixed(3)):null;
  const defending=opponent;
  const winner=available&&Math.abs(delta)>=.05?(delta>0?pair.off:defending):null;
  return {...pair,available,value:delta,winner,status:!available?"SOURCE GAP":winner?"SDV TREND":"EVEN",
    sourceType:"SDV_SOURCE_OBSERVED_RESEARCH",offenseEpa:off,defenseEpaAllowed:def,
    historicalPitVerified:false,canQualify:false,canAuthorizeWager:false,
    attribution:"SportsDataverse current-season team summaries; provider publication time unverified"};
 });
}
