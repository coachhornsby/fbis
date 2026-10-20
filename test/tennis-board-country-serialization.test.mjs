import test from "node:test";
import assert from "node:assert/strict";
import {toBoardGame} from "../functions/lib/todayBoard.js";

test("today API does not discard sourced ATP player nationality and canonical identity",()=>{
 const source={id:"tennis:espn:atp:708-2026:185013",sport:"tennis",tour:"atp",
   start:"2026-10-20T09:30:00Z",status:"SCHEDULED",
   away:{name:"Fabian Marozsan",country:"HU",fbisPlayerId:"tennis:atp:research:fabian marozsan",rank:64,rankingPoints:860},
   home:{name:"Timofey Skatov",country:"KZ",fbisPlayerId:"tennis:atp:research:timofey skatov"},
   tennisProjection:{eventIntegrity:{valid:false},researchFixture:{verified:true,source:"ESPN_PUBLIC"}},
   market:{reference:{available:false}},quality:{state:"RESEARCH",flags:["research_only"]}
 };
 const out=toBoardGame(source,"tennis",Date.parse("2026-10-20T12:00:00Z"));
 assert.equal(out.away.countryCode,"HU");
 assert.equal(out.home.countryCode,"KZ");
 assert.equal(out.away.canonicalId,"tennis:atp:research:fabian marozsan");
 assert.equal(out.home.canonicalId,"tennis:atp:research:timofey skatov");
 assert.equal(out.away.rank,64);
 assert.equal(out.away.rankingPoints,860);
});
test("other sports retain their established country/identity normalization",()=>{
 const result=toBoardGame({id:"other",home:{name:"Home",country:"XX"},away:{name:"Away",country:"YY"}},"nfl");
 assert.equal(result.home.countryCode,null);
 assert.equal(result.away.countryCode,null);
});
