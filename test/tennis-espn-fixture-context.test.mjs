import test from "node:test";
import assert from "node:assert/strict";
import {readEspnFixtureResearchContext} from "../functions/lib/tennisEspnFixtureContext.js";
const fixture={
 id:"tennis:espn:atp:708-2026:185013",source:"ESPN_PUBLIC",tour:"atp",
 source_event_id:"708-2026",source_competition_id:"185013",
 away_name:"Timofey Skatov",home_name:"Fabian Marozsan",
 fetched_at:"2026-10-20T05:08:04.260Z",
 raw_key:"tennis/external-fixtures/espn/raw/example.json"
};
const evidence={events:[{id:"708-2026",name:"Almaty Open",venue:{displayName:"Almaty, Kazakhstan"},
 groupings:[{competitions:[{id:"185013",round:{displayName:"Round 1"},
  venue:{fullName:"Almaty, Kazakhstan",court:"Center Court"},
  status:{type:{detail:"2nd Set"}},
  competitors:[{athlete:{displayName:"Timofey Skatov",flag:{href:"https://a.espncdn.com/i/teamlogos/countries/500/kaz.png"}}},
  {athlete:{fullName:"Fabian Marozsan",flag:{href:"https://a.espncdn.com/i/teamlogos/countries/500/hun.png"}}}]
 }]}]}]};
test("exact archived ESPN event supplies location, tournament, round and independently observed flags",async()=>{
 const archive={get:async()=>({json:async()=>evidence})};
 const x=await readEspnFixtureResearchContext(archive,fixture);
 assert.equal(x.tournament,"Almaty Open");
 assert.equal(x.venue,"Almaty, Kazakhstan");
 assert.equal(x.court,"Center Court");
 assert.equal(x.round,"Round 1");
 assert.equal(x.countryByName["timofey skatov"],"KZ");
 assert.equal(x.countryByName["fabian marozsan"],"HU");
 assert.equal(x.surface,null);
 assert.equal(x.officialEventVerified,false);
 assert.equal(x.canAuthorizeWager,false);
});
test("provider fixture player disagreement or mismatched event identity fails closed",async()=>{
 const archive={get:async()=>({json:async()=>evidence})};
 assert.equal(await readEspnFixtureResearchContext(archive,{...fixture,home_name:"Other Athlete"}),null);
 assert.equal(await readEspnFixtureResearchContext(archive,{...fixture,source_competition_id:"other"}),null);
 assert.equal(await readEspnFixtureResearchContext(archive,{...fixture,raw_key:"not-espn.json"}),null);
});
test("research context is cached once for fixtures sharing the same archived scoreboard snapshot",async()=>{
 let reads=0;const cache=new Map();
 const archive={get:async()=>{reads++;return {json:async()=>evidence}}};
 await readEspnFixtureResearchContext(archive,fixture,{cache});
 await readEspnFixtureResearchContext(archive,fixture,{cache});
 assert.equal(reads,1);
});
