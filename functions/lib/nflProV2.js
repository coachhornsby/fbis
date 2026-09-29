/**
 * NFL-PRO-v2 research challenger.
 * Same structural scoring model as v1, but requires the PBP-derived feature
 * families that v1's weekly-summary feed cannot supply. No market inputs.
 */
import { projectNflProV1 } from "./nflProModel.js";

export const NFL_PRO_V2_ID = "NFL-PRO-v2";
const REQUIRED = [
  "successRate","successRateAllowed","earlyDownEpa","earlyDownEpaAllowed",
  "explosiveRate","explosiveRateAllowed","pressureRate","pressureRateAllowed",
  "lineYards","lineYardsAllowed"
];

export function projectNflProV2(game = {}) {
  const home=game?.nflFeatures?.home||{};
  const away=game?.nflFeatures?.away||{};
  const missing=[];
  for(const side of [["home",home],["away",away]]) for(const f of REQUIRED) {
    if(!Number.isFinite(Number(side[1]?.[f]))) missing.push(`${side[0]}.${f}`);
  }
  if(missing.length) return {modelId:NFL_PRO_V2_ID,version:"v2-pbp-derived",ok:false,reason:"required-pbp-features-missing",missing,independent:true,marketInformed:false,canQualify:false};
  const base=projectNflProV1(game);
  return {
    ...base,
    modelId:NFL_PRO_V2_ID,
    version:"v2-pbp-derived",
    role:"research",
    canQualify:false,
    provenance:{...(base.provenance||{}),pbpDerivedFeatures:true,missingFeaturesRemainMissing:false,marketUsed:false}
  };
}
