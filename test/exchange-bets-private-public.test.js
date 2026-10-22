import test from "node:test";
import assert from "node:assert/strict";
import {publicBetsOnly} from "../functions/api/bets.js";
test("anonymous bets excludes exchange fills and their summary counts",()=>{
 const bets=[
  {executionBook:"Heritage",externalTicketId:"G123",result:"WON",riskAmount:2,profit:2,matchStatus:"matched"},
  {executionBook:"Kalshi",externalTicketId:"KALSHI:order123:YES",result:"OPEN",riskAmount:100,matchStatus:"tracker-synced"},
  {executionBook:"Polymarket US",externalTicketId:"PMUS:abc:NO",result:"LOST",riskAmount:10,profit:-10},
  {executionBook:"Kalshi",externalTicketId:"TRACKER-LEGACY",result:"OPEN",riskAmount:2}
 ];
 const before={bets,summary:{bets:4,risk:114},population:{settledN:2,openN:2},telemetry:{rowsReadEstimate:4}};
 const after=publicBetsOnly(before);
 assert.equal(after.bets.length,2);
 assert.deepEqual(after.bets.map(b=>b.externalTicketId),["G123","TRACKER-LEGACY"]);
 assert.equal(after.summary.bets,2);
 assert.equal(after.population.settledN,1);
 assert.equal(after.population.openN,1);
 assert.equal(after.telemetry.rowsReadEstimate,2);
 assert.equal(before.bets.length,4);
});
