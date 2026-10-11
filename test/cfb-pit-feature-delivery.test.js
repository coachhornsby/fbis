import test from "node:test";
import assert from "node:assert/strict";
import {safeCfbFeatureFreeze,loadCfbFrozenUnitEvidence} from "../functions/lib/cfbPitFeatureDelivery.js";
import {cfbUnitFeatureAudit} from "../functions/lib/cfbProspectiveAudit.js";
const start="2026-10-17T18:00:00Z",asOf="2026-10-17T15:00:00Z";
const features={home:{rushEpa:.25,rushEpaAllowed:-.1,passEpa:.3,passEpaAllowed:-.2},
 away:{rushEpa:.2,rushEpaAllowed:-.05,passEpa:.22,passEpaAllowed:-.1}};
const game={id:"401test",sport:"cfb",season:2026,start,home:{name:"Kentucky",espnId:"96"},away:{name:"LSU",espnId:"99"},cfbDeepInput:features};
const feed={season:2026,meta:{asOf,source:"cfbd-cached-pregame"},bySchool:{"kentucky":features.home}};
test("CFB freezes authenticated pregame values for four directional tiles",()=>{
 const r=safeCfbFeatureFreeze(game,feed,{now:"2026-10-17T16:00:00Z"});
 assert.equal(r.ok,true);assert.equal(r.record.features.home.passEpa,.3);
 assert.equal(cfbUnitFeatureAudit({...game,featureCutoffOk:true,featureSnapshotAt:asOf}).available,4);
 assert.equal(safeCfbFeatureFreeze(game,{...feed,meta:{asOf:"2026-10-17T19:00:00Z"}},{now:"2026-10-17T19:30:00Z"}).ok,false);
});
test("CFB D1 reads latest authentic snapshot and rejects post-kickoff observations",async()=>{
 const data={game_id:game.id,kickoff_timestamp:start,feature_as_of_timestamp:asOf,features_json:JSON.stringify(features)};
 const db={prepare(){return {bind(){return this;},async all(){return {results:[data]};}}}};
 const res=await loadCfbFrozenUnitEvidence(db,[game]);assert.equal(res.byGameId[game.id].available,4);
 const unsafe={...data,feature_as_of_timestamp:"2026-10-17T19:00:00Z"};
 const badDb={prepare(){return {bind(){return this;},async all(){return {results:[unsafe]};}}}};
 const bad=await loadCfbFrozenUnitEvidence(badDb,[game]);assert.equal(Object.keys(bad.byGameId).length,0);
});
