import test from "node:test";
import assert from "node:assert/strict";
import {buildSdvPitResearchFeed} from "../functions/lib/cfbSdvPitFallback.js";
import {attachCfbDeepFeatures} from "../functions/lib/cfbDeepFeed.js";
import {safeCfbFeatureFreeze,freezeCfbPregameFeatures} from "../functions/lib/cfbPitFeatureDelivery.js";
import {resetCacheMem,writeCache} from "../functions/lib/cache.js";

const stamp="2026-10-17T15:59:00Z";
const now="2026-10-17T16:00:00Z";
const start="2026-10-17T18:00:00Z";
const stats=(a=0.2)=>({
 EPAplay_off_pass:a,EPAplay_off_rush:a/2,
 EPAplay_def_pass:-a/4,EPAplay_def_rush:-a/8,
 adj_off_epa:a,adj_def_epa:0.01,
 success_off:.48,success_def:.4,explosive_off:.11,explosive_def:.08,
 havoc_def:.18,pts_per_opp_off:4.3,pts_per_opp_def:3.7
});
const fixture={
 ok:true,season:2026,version:"cfb-sdv-intelligence-v3",
 source:{sha256:"c".repeat(64),observedAt:stamp,url:"https://example.com/sdv-2026.csv",providerPublicationAt:null},
 teams:[
  {teamId:"cfb:espn:96",espnId:"96",name:"Kentucky",games:6,stats:stats()},
  {teamId:"cfb:espn:99",espnId:"99",name:"LSU",games:6,stats:stats(.15)}
 ]
};
const game={id:"401test2",sport:"cfb",season:2026,start,
 home:{espnId:"96",name:"Kentucky"},away:{espnId:"99",name:"LSU"}};

test("unverified historical acquisition and post-start receipts cannot create SDV research snapshots",()=>{
 assert.equal(buildSdvPitResearchFeed({...fixture,source:{...fixture.source,sha256:"bad"}},{now}).ok,false);
 assert.equal(buildSdvPitResearchFeed(fixture,{now:"2026-10-17T18:01:00Z"}).ok,false);
 assert.equal(buildSdvPitResearchFeed(fixture,{now:"2026-10-17T15:00:00Z"}).ok,false);
});
test("SDV fallback has exact ESPN identities, no model authority and attribution",()=>{
 const feed=buildSdvPitResearchFeed(fixture,{now});
 assert.equal(feed.ok,true);
 assert.equal(feed.meta.historicalPitVerified,false);
 assert.equal(feed.meta.sourceHash,fixture.source.sha256);
 assert.match(feed.meta.attribution,/SportsDataverse/);
 const joined=attachCfbDeepFeatures([game],feed)[0];
 const save=safeCfbFeatureFreeze(joined,feed,{now});
 assert.equal(save.ok,true);
 assert.equal(save.record.decomposition.sourceHash,fixture.source.sha256);
 assert.equal(save.record.decomposition.providerPublicationAt,null);
 assert.equal(save.record.decomposition.authority,"display-only");
 assert.equal(save.record.uncertainty.sourcePublicationTimeVerified,false);
 const mislabeled=attachCfbDeepFeatures([{...game,home:{espnId:"98",name:"Kentucky"}}],feed)[0];
 assert.equal(safeCfbFeatureFreeze(mislabeled,feed,{now}).ok,false);
});
test("SDV source is read from cache when CFBD is unconfigured and persists only eligible prospective games",async()=>{
 resetCacheMem();
 await writeCache("cfb-sdv-intelligence-2026-v3",fixture,null,30*60*1000);
 const inserts=[];
 const db={prepare(sql){return {bind(...v){this.values=v;return this;},async run(){
  inserts.push({sql,values:this.values});return {meta:{changes:1}};
 }};}};
 try{
  const r=await freezeCfbPregameFeatures({DB:db},{games:[game,game],now,
   fetchFn:()=>{throw Error("unexpected network call");}});
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(r.inserted,1);assert.equal(r.checked,1);assert.equal(r.eligible,1);
  assert.equal(r.canQualify,false);assert.equal(r.canAuthorizeWager,false);
  assert.equal(r.source,"SPORTSDATAVERSE_2026_FBS_TEAM_SUMMARIES");
  assert.equal(inserts.length,1);
  assert.match(inserts[0].sql,/INSERT OR IGNORE INTO cfb_pregame_feature_vectors/);
 }finally{resetCacheMem();}
});
test("missing directional values withhold source records instead of producing synthetic zero EPA",()=>{
 const broken={...fixture,teams:[{...fixture.teams[0],stats:{...fixture.teams[0].stats,EPAplay_def_rush:null}},fixture.teams[1]]};
 const r=buildSdvPitResearchFeed(broken,{now});
 assert.equal(r.ok,true);
 assert.equal(r.byEspnId["96"],undefined);
 const g=attachCfbDeepFeatures([game],r)[0];
 assert.equal(safeCfbFeatureFreeze(g,r,{now}).ok,false);
});
test("prospective 8-day source scan cannot claim success when eligible FBS events lack directional coverage",async()=>{
 resetCacheMem();
 await writeCache("cfb-sdv-intelligence-2026-v3",fixture,null,30*60*1000);
 try {
  const incomplete={...game,home:{espnId:"98",name:"Unmatched FBS team"}};
  const DB={prepare(){throw Error("no invalid D1 writes permitted")}};
  const r=await freezeCfbPregameFeatures({DB},{games:[incomplete],now,
    fetchFn:()=>{throw Error("unexpected live provider request");}});
  assert.equal(r.ok,false);
  assert.equal(r.upcomingFbsGames,1);
  assert.equal(r.reason,"zero-eligible-pregame-feature-observations");
  assert.equal(r.inserted,0);
 }finally{resetCacheMem();}
});
