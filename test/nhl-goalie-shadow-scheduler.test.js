import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toBoardGame } from "../functions/lib/todayBoard.js";

test("NHL board DTO preserves goalie shadow and v2 state",()=>{
  const game={
    id:"x",sport:"nhl",start:"2026-10-06T23:00:00Z",
    home:{abbr:"MTL",name:"Montreal"},away:{abbr:"CAR",name:"Carolina"},
    model:{projHome:3.1,projAway:3.8,projTotal:6.9,projMargin:-0.7},
    nhlProV2:{ok:true,modelId:"NHL-PRO-v2"},
    nhlGoalieProbabilityShadow:{ok:true,modelId:"NHL-GOALIE-PROB-SHADOW-v1",gateFired:true}
  };
  const row=toBoardGame(game,"nhl",Date.parse("2026-10-06T12:00:00Z"));
  assert.equal(row.nhlProV2.modelId,"NHL-PRO-v2");
  assert.equal(row.nhlGoalieProbabilityShadow.modelId,"NHL-GOALIE-PROB-SHADOW-v1");
  assert.equal(row.nhlGoalieProbabilityShadow.gateFired,true);
});

test("NHL shadow grader requires official final state",async()=>{
  const src=await readFile(new URL("../functions/api/nhl-goalie-shadow.js",import.meta.url),"utf8");
  assert.match(src,/function isOfficialFinal/);
  assert.match(src,/state==="OFF"\|\|state==="FINAL"/);
  assert.match(src,/if\(!isOfficialFinal\(box\)\)return null/);
  assert.match(src,/function frozenOfficialGameId/);
  assert.match(src,/next_game_id/);
  assert.match(src,/fetchBox\(r\.event_id,officialEventId\)/);
});

test("Cloudflare NHL shadow scheduler is bounded and uses shared ops",async()=>{
  const src=await readFile(new URL("../workers/nhl-goalie-shadow-scheduler.mjs",import.meta.url),"utf8");
  const cfg=await readFile(new URL("../wrangler.nhl-goalie-shadow-scheduler.toml",import.meta.url),"utf8");
  assert.match(src,/freezeRows, persist, settle/);
  assert.match(src,/sport=nhl/);
  assert.match(src,/CLOUDFLARE_CRON/);
  assert.match(cfg,/crons = \["17 \* \* \* \*"\]/);
  assert.match(cfg,/binding = "DB"/);
});
