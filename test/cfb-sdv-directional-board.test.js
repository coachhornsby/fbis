import test from "node:test";
import assert from "node:assert/strict";
import {cfbSdvDirectionalEvidence} from "../src/lib/cfbSdvDirectionalEvidence.js";
const base={
 sport:"cfb",start:"2026-10-17T18:00:00Z",
 home:{name:"Kentucky",espnId:"96"},away:{name:"LSU",espnId:"99"},
 cfbUnitAudit:{available:0,tiles:{}},
 cfbSeasonEvidence:{
  state:"SOURCE_OBSERVED",canQualify:false,canAuthorizeWager:false,canInfluenceProjection:false,
  source:{sha256:"e".repeat(64),observedAt:"2026-10-14T23:03:56Z"},
  home:{teamId:"cfb:espn:96",games:6,passingOffenseEpa:.25,rushingOffenseEpa:.2,passingDefenseEpa:-.06,rushingDefenseEpa:-.03},
  away:{teamId:"cfb:espn:99",games:5,passingOffenseEpa:.2,rushingOffenseEpa:.1,passingDefenseEpa:.04,rushingDefenseEpa:.08},
 }
};
test("four SDV current-season directional matchups render exact EPA evidence, no qualification",()=>{
 const rows=cfbSdvDirectionalEvidence(base);
 assert.equal(rows.length,4);
 assert.deepEqual(rows.map(r=>r.id),["away-run-defense","away-run-offense","away-pass-defense","away-pass-offense"]);
 assert.deepEqual(rows.map(r=>r.available),[true,true,true,true]);
 const pass=rows.find(r=>r.id==="away-pass-defense");
 assert.equal(pass.offenseEpa,.25);assert.equal(pass.defenseEpaAllowed,.04);
 assert.equal(pass.value,.21);assert.equal(pass.winner,"home");
 assert.equal(pass.canQualify,false);assert.equal(pass.canAuthorizeWager,false);
 assert.equal(pass.historicalPitVerified,false);
});
test("rejects unverified source, names-only, contradictory identities and poststart acquisitions",()=>{
 assert.equal(cfbSdvDirectionalEvidence({...base,cfbSeasonEvidence:{...base.cfbSeasonEvidence,source:{sha256:"missing"}}}),null);
 assert.equal(cfbSdvDirectionalEvidence({...base,home:{name:"Kentucky"}}),null);
 assert.equal(cfbSdvDirectionalEvidence({...base,home:{name:"Kentucky",espnId:"98"}}),null);
 assert.equal(cfbSdvDirectionalEvidence({...base,cfbSeasonEvidence:{...base.cfbSeasonEvidence,source:{sha256:"e".repeat(64),observedAt:"2026-10-17T20:00:00Z"}}}),null);
 assert.equal(cfbSdvDirectionalEvidence({...base,cfbSeasonEvidence:{...base.cfbSeasonEvidence,canQualify:true}}),null);
});
test("null directional source values remain unavailable, not zero",()=>{
 const r=cfbSdvDirectionalEvidence({...base,cfbSeasonEvidence:{...base.cfbSeasonEvidence,home:{...base.cfbSeasonEvidence.home,rushingOffenseEpa:null}}});
 const match=r.find(x=>x.id==="away-run-defense");
 assert.equal(match.available,false);assert.equal(match.value,null);
 assert.equal(match.winner,null);
});
