import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("MLB starter headshots use foreground segmentation for transparent portraits",()=>{
  const route=fs.readFileSync(new URL("../functions/api/mlb-headshot.js",import.meta.url),"utf8");
  const card=fs.readFileSync(new URL("../src/components/board/CompactGameCard.jsx",import.meta.url),"utf8");
  assert.match(route,/segment:\s*"foreground"/);
  assert.match(route,/background:\s*"rgba\(0,0,0,0\)"/);
  assert.match(route,/x-fbis-headshot/);
  assert.match(card,/\/api\/mlb-headshot\?id=/);
  assert.doesNotMatch(card,/img\.mlbstatic\.com\/mlb-photos\/image\/upload\/w_96/);
});
