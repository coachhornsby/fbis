import { buildStateObservation } from "./canonical/persistentState.js";
import { STATE_OVERLAY_GOVERNANCE_VERSION } from "./stateOverlayGovernance.js";

export const CBB_DIRECTORY_VERSION="cbb-directory-phase-a-v1";
export const CBB_DIRECTORY_SNAPSHOT="CBB-PIT-RESEARCH-v1-37411381038";

export function normalizeCbbIdentity(v){
  return String(v||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
}
export function buildCbbPlayerId({providerPlayerId=null,teamId=null,name=null}={}){
  if(providerPlayerId!=null&&String(providerPlayerId).trim()) return `cbb:provider-player:${String(providerPlayerId).trim()}`;
  const n=normalizeCbbIdentity(name);
  if(!teamId||!n) throw new Error("cbb_player_identity_incomplete");
  return `cbb:provisional:${String(teamId)}:${n.replace(/\s+/g,"-")}`;
}
export function unknownAvailability(){
  return Object.freeze({status:"UNKNOWN",injuryStatus:"UNKNOWN",verified:false});
}
export function directoryPermission(){
  return Object.freeze({overlayVersion:STATE_OVERLAY_GOVERNANCE_VERSION,mode:"RESEARCH",researchOnly:true,canInfluenceProjection:false,canQualify:false,canAuthorizeWager:false});
}
export function buildCbbStateEvent({id,entityType,entityId,teamId=null,gameId=null,season=null,stateFamily,value,observedAt,effectiveAt,ingestedAt,source,provenance,confidence=null,supersedesObservationId=null}={}){
  const o=buildStateObservation({observationId:id,sport:"cbb",entityType,entityId,stateFamily,value,source,observedAt,effectiveAt,ingestedAt,supersedesObservationId,provenance,confidence});
  return {...o,teamId,gameId,season,stale:false,pitEligible:true,researchOnly:true,canInfluenceProjection:false};
}
