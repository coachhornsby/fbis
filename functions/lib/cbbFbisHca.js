/**
 * FBIS-CBB-HCA-v1
 * Completely independent home-court model.
 * No KenPom, Torvik, sportsbook, or market inputs.
 *
 * Hierarchical structure:
 *   historical global prior -> season-wide FBIS residual HCA -> team residual HCA
 * Team effects are aggressively shrunk to avoid converting rating error into HCA.
 */
export const FBIS_CBB_HCA_MODEL_ID = "FBIS-CBB-HCA-v1";
export const FBIS_CBB_HCA_VERSION = "v1.0.0";
export const FBIS_CBB_HISTORICAL_GLOBAL_HCA = 4.4096;

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const weightedMean=(rows,fn,prior,priorWeight)=>{
  let sw=priorWeight,sx=prior*priorWeight;
  for(const r of rows){const x=fn(r);if(!Number.isFinite(x))continue;const w=Number(r.weight)||1;sw+=w;sx+=w*x}
  return sw>0?sx/sw:prior;
};

export function buildIndependentHca(obs=[], ratings, {
  nationalEff,
  nationalTempo,
  historicalGlobalHca=FBIS_CBB_HISTORICAL_GLOBAL_HCA,
  globalPriorGames=250,
  teamPriorGames=30,
  minHca=1.5,
  maxHca=7.5,
}={}) {
  const residuals=[];
  for(const g of obs){
    if(g.neutral||!g.isHome) continue;
    const team=ratings.get(g.teamId),opp=ratings.get(g.opponentId);
    if(!team||!opp) continue;
    const poss=(team.tempo*opp.tempo)/nationalTempo;
    const neutralMargin=((team.adjOe*opp.adjDe/nationalEff)-(opp.adjOe*team.adjDe/nationalEff))*poss/100;
    residuals.push({...g,hcaResidual:g.margin-neutralMargin});
  }
  const globalHca=clamp(
    weightedMean(residuals,r=>r.hcaResidual,historicalGlobalHca,globalPriorGames),
    minHca,maxHca
  );
  const byTeam=new Map();
  for(const r of residuals){
    if(!byTeam.has(r.teamId))byTeam.set(r.teamId,[]);
    byTeam.get(r.teamId).push(r);
  }
  const teams={};
  for(const [id,rows] of byTeam){
    const hca=clamp(weightedMean(rows,r=>r.hcaResidual,globalHca,teamPriorGames),minHca,maxHca);
    teams[id]={hca,games:rows.length};
  }
  return {
    id:FBIS_CBB_HCA_MODEL_ID,
    version:FBIS_CBB_HCA_VERSION,
    independent:true,marketInformed:false,kenpomInput:false,torvikInput:false,
    historicalGlobalHca,globalHca,globalGames:residuals.length,teamPriorGames,globalPriorGames,teams,
  };
}

export function hcaForTeam(hcaCatalog,teamId){
  return hcaCatalog?.teams?.[teamId]?.hca ?? hcaCatalog?.globalHca ?? FBIS_CBB_HISTORICAL_GLOBAL_HCA;
}
