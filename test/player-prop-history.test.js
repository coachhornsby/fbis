import test from "node:test";
import assert from "node:assert/strict";
import { valueForEspnEvent } from "../functions/lib/playerPropHistory.js";

test("all-sport Last 5 parser maps basketball markets",()=>{
  const payload={names:["date","opponent","gameResult","minutes","rebounds","assists","points"]};
  const event={stats:["34","8","11","27"]};
  assert.equal(valueForEspnEvent(payload,event,"points","nba","Player"),27);
  assert.equal(valueForEspnEvent(payload,event,"rebounds","wnba","Player"),8);
  assert.equal(valueForEspnEvent(payload,event,"assists","nba","Player"),11);
});

test("all-sport Last 5 parser maps football aliases",()=>{
  const payload={names:["date","opponent","gameResult","passingYards","rushingYards","receivingYards"]};
  const event={stats:["285","41","0"]};
  assert.equal(valueForEspnEvent(payload,event,"pass_yards","cfb","QB"),285);
  assert.equal(valueForEspnEvent(payload,event,"rush_yards","cfb","QB"),41);
});

test("all-sport Last 5 parser derives NHL points",()=>{
  const payload={names:["date","opponent","gameResult","goals","assists","shots"]};
  const event={stats:["1","2","5"]};
  assert.equal(valueForEspnEvent(payload,event,"points","nhl","Skater"),3);
  assert.equal(valueForEspnEvent(payload,event,"shots_on_goal","nhl","Skater"),5);
});

test("all-sport Last 5 parser derives tennis match games from set scores",()=>{
  const payload={names:[]};
  const event={competitors:[
    {displayName:"Player A",linescores:[{value:6},{value:4},{value:6}]},
    {displayName:"Player B",linescores:[{value:4},{value:6},{value:3}]},
  ]};
  assert.equal(valueForEspnEvent(payload,event,"total_games","tennis","Player A"),29);
  assert.equal(valueForEspnEvent(payload,event,"total_games_won","tennis","Player A"),16);
});
