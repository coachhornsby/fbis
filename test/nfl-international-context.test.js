import test from "node:test";
import assert from "node:assert/strict";
import {detectNflInternationalSite,enrichNflInternationalGame,attachNflInternationalContext} from "../functions/lib/nflInternationalContext.js";
import {enrichGameVenue} from "../functions/lib/venues.js";
import {projectNflProV1} from "../functions/lib/nflProModel.js";
import {evaluateNflGameWagers} from "../functions/lib/nflWagerDecision.js";

const kickoff="2026-10-11T13:30:00Z";
function london(overrides={}){
  return {id:"401872981",sport:"nfl",start:kickoff,venue:"Tottenham Hotspur Stadium",
    venueCity:"London",venueCountry:"England",home:{abbr:"JAX"},away:{abbr:"PHI"},
    neutralSite:false,...overrides};
}
function team(){
  return {offenseEpa:.12,defenseEpa:-.03,successRate:.46,successRateAllowed:.4,
    qbEpa:.12,qbCpoe:2,passEpa:.1,passEpaAllowed:.01,rushEpa:.02,rushEpaAllowed:.01};
}
test("London venue is international regardless of designated home team",()=>{
  const c=enrichNflInternationalGame(london());
  assert.equal(c.neutralSite,true);
  assert.equal(c.nflInternationalContext.site.city,"London");
  assert.equal(c.nflInternationalContext.arrivalEvidenceComplete,false);
  assert.deepEqual(c.nflInternationalContext.missingTravelEvidence,["home","away"]);
  assert.equal(c.nflInternationalContext.adjustmentPoints,null);
  assert.equal(c.nflInternationalContext.modelInfluence,"none");
});
test("venue-country works independently; ordinary US games stay unchanged",()=>{
  assert.equal(detectNflInternationalSite({sport:"nfl",venue:"Generic Stadium",venueCountry:"GB"}).country,"GB");
  assert.equal(detectNflInternationalSite({sport:"nfl",venue:"EverBank Stadium",venueCity:"Jacksonville",venueCountry:"US"}),null);
  const domestic={sport:"nfl",venue:"EverBank Stadium",home:{abbr:"JAX"}};
  assert.equal(enrichNflInternationalGame(domestic),domestic);
  assert.equal(attachNflInternationalContext([domestic])[0],domestic);
});
test("international venue never falls back to Jaguars home stadium coordinates",()=>{
  const c=enrichNflInternationalGame(london());
  const filled=enrichGameVenue(c);
  assert.equal(filled.venue,"Tottenham Hotspur Stadium");
  assert.equal(filled.venueLat,undefined);
  assert.equal(filled.venueLon,undefined);
  const domestic=enrichGameVenue({sport:"nfl",home:{abbr:"JAX"}});
  assert.equal(domestic.venue,"EverBank Stadium");
});
test("travel records must be contemporaneously observed and independently sourced",()=>{
  const c=enrichNflInternationalGame(london({nflInternationalTravelEvidence:{
    home:{source:"team-travel-report",arrivalAt:"2026-10-09T08:00:00Z",observedAt:"2026-10-09T12:00:00Z"},
    away:{source:"team-travel-report",arrivalAt:"2026-10-10T08:00:00Z",observedAt:"2026-10-10T12:00:00Z"},
  }}),"2026-10-11T12:00:00Z");
  assert.equal(c.nflInternationalContext.arrivalEvidenceComplete,true);
  assert.ok(c.nflInternationalContext.homeArrival.leadHours>c.nflInternationalContext.awayArrival.leadHours);
  assert.equal(c.nflInternationalContext.adjustmentPoints,null);
  const future=enrichNflInternationalGame(london({nflInternationalTravelEvidence:{
    home:{source:"web",arrivalAt:"2026-10-09T08:00:00Z",observedAt:"2026-10-12T12:00:00Z"},
  }}),"2026-10-11T12:00:00Z");
  assert.equal(future.nflInternationalContext.homeArrival,null);
  assert.equal(future.nflInternationalContext.arrivalEvidenceComplete,false);
});
test("international context cannot create a wager and leaves NFL point estimate unchanged",()=>{
  const g=london({nflFeatures:{home:team(),away:team()},quality:{score:90},
    market:{executionActionable:true,execution:{available:true,actionable:true,book:"Heritage",spread:-8,total:42,
      spreadHomePrice:-110,spreadAwayPrice:-110,overPrice:-110,underPrice:-110}}});
  const c=enrichNflInternationalGame(g);
  const p=projectNflProV1(c);
  assert.equal(p.ok,true);
  assert.equal(p.decomposition.home.hfa,0);
  assert.equal(p.decomposition.away.hfa,0);
  const control=projectNflProV1({...g,neutralSite:true});
  assert.equal(p.margin,control.margin);
  assert.equal(p.total,control.total);
  const d=evaluateNflGameWagers({...c,nflProShadow:p},{validated:false,minEv:0,minProbabilityEdge:0});
  assert.ok(d.candidates.length>0);
  assert.ok(d.candidates.every(x=>x.decision==="PASS"));
  assert.ok(d.candidates.every(x=>x.reasons.includes("international-context-unvalidated")));
  assert.ok(d.candidates.every(x=>x.reasons.includes("international-arrival-evidence-missing")));
  assert.equal(d.canAuthorizeWager,false);
});
