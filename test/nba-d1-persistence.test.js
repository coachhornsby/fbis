import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("NBA generated remote-D1 SQL does not use explicit transaction wrappers",()=>{
  for(const path of [
    "scripts/nba-shadow-project.mjs",
    "scripts/nba-game-decision-evaluate.mjs",
  ]){
    const s=fs.readFileSync(path,"utf8");
    assert.equal(s.includes('["BEGIN;"'),false,path);
    assert.equal(s.includes('"COMMIT;"'),false,path);
  }
});

test("NBA evaluator waits for shadow rows before exporting decision inputs",()=>{
  const s=fs.readFileSync(".github/workflows/nba-market-evaluator.yml","utf8");
  assert.match(s,/Wait for today's NBA shadow projection persistence/);
  assert.match(s,/COUNT\(\*\) AS n FROM nba_game_projections/);
});
