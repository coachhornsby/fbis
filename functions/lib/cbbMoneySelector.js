import { fbisCbbV2MarginCorrection, FBIS_CBB_V2_MARGIN_ID } from "./cbbFbisV2Margin.js";

export const CBB_SIDE_DISLOCATION_ID="CBB-SIDE-DISLOCATION-v1";
export const CBB_MONEY_SELECTOR_ID="CBB-MONEY-SELECTOR-v1";
export const SIDE_DISLOCATION_THRESHOLD=10;

const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const r2=v=>v==null?null:Number(Number(v).toFixed(2));
function marketSpread(game){return n(game?.odds?.pinSpread??game?.odds?.spread)}
function sideName(game,home){return home?(game?.home?.abbr||game?.home?.school||game?.home?.name||"HOME"):(game?.away?.abbr||game?.away?.school||game?.away?.name||"AWAY")}

export function buildCbbMoneyResearch(game){
  const fbis=game?.cbbFbisNative||game?.challengers?.["FBIS-CBB-RATINGS-v2"]||null;
  const corrected=fbisCbbV2MarginCorrection(fbis);
  const spread=marketSpread(game);
  const marketMargin=spread==null?null:-spread;
  const edge=corrected.ok&&marketMargin!=null?corrected.margin-marketMargin:null;
  const triggered=edge!=null&&Math.abs(edge)>=SIDE_DISLOCATION_THRESHOLD;
  const home=edge!=null?edge>0:null;
  const pick=triggered?sideName(game,home):null;
  return {
    ok:Boolean(corrected.ok&&spread!=null),
    modelId:CBB_MONEY_SELECTOR_ID,
    sideDislocation:{
      modelId:CBB_SIDE_DISLOCATION_ID,
      status:triggered?"PROSPECTIVE_CHALLENGER":"PASS",
      triggered,
      pick,
      direction:home==null?null:(home?"HOME":"AWAY"),
      marketSpread:spread,
      marketImpliedHomeMargin:marketMargin,
      fbisBaseMargin:corrected.baseMargin??null,
      fbisCorrectedMargin:r2(corrected.margin),
      residualCorrection:r2(corrected.residual),
      dislocation:r2(edge),
      threshold:SIDE_DISLOCATION_THRESHOLD,
      projectionModel:FBIS_CBB_V2_MARGIN_ID,
      authority:{
        canQualify:false,
        canAuthorizeWager:false,
        prospectiveOnly:true,
        reason:"Threshold was identified after historical subset inspection; requires clean 2026-27 prospective ROI and true CLV before promotion."
      },
      evidence:{
        discovery2018_22:{n:686,winPct:57.8,roiPct:10.1},
        validation2023_24:{n:276,winPct:58.7,roiPct:12.06},
        secondary2025:{n:170,winPct:58.0,roiPct:10.64},
        secondary2025Untouched:false
      }
    },
    governance:{
      objective:"expected units per wager",
      marketResidualModels:"research artifact only until frozen prospective validation",
      noAutoWager:true,
      requirePositiveProspectiveRoi:true,
      requirePositiveTrueClv:true
    }
  };
}
